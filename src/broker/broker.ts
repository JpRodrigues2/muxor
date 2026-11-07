// Broker: servidor MCP do hub em 127.0.0.1 que a sessão do Claude usa para falar com a Funifier sem nunca ver a chave.
// Três ferramentas: funifier_gamificacoes, funifier_ferramentas e funifier_chamar. Cada chamada passa pela política
// (src/dominio/broker.ts), só vale para gamificação de task em andamento e vai para a auditoria (sem valores).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Confirmador } from '../aplicacao/portas.js';
import type { FabricaConexoes } from '../adaptadores/funifier/conexoes.js';
import { CAMINHOS } from '../caminhos.js';
import type { Gamificacao } from '../config.js';
import type { DB } from '../db.js';
import { ESTADOS_ATIVOS, sqlLista } from '../dominio/despacho.js';
import { FERRAMENTAS_BLOQUEADAS, classificar, decidir, ehProducao, idGamificacao } from '../dominio/broker.js';
import { errInfo, log } from '../logger.js';

export interface Autorizada {
  id: string; // "<app>/<nome>"
  app: string;
  selecaoId: number;
  gamificacao: Gamificacao;
}

// Gamificações das tasks em andamento. Consultado a cada chamada: no Encerrar, a autorização some sozinha.
export function autorizadasDoBanco(db: DB): () => Autorizada[] {
  return () => {
    const linhas = db
      .prepare(
        `SELECT d.selecao_id AS selecaoId, d.app AS app, s.gamificacoes AS gamificacoes
         FROM despachos d JOIN selecoes s ON s.id = d.selecao_id
         WHERE d.estado IN (${sqlLista(ESTADOS_ATIVOS)})`,
      )
      .all() as { selecaoId: number; app: string; gamificacoes: string | null }[];
    return linhas.flatMap((l) =>
      (JSON.parse(l.gamificacoes ?? '[]') as Gamificacao[]).map((g) => ({ id: idGamificacao(l.app, g.nome), app: l.app, selecaoId: l.selecaoId, gamificacao: g })),
    );
  };
}

export interface OpcoesBroker {
  porta: number;
  token: string;
  autorizadas: () => Autorizada[];
  conexoes: FabricaConexoes;
  confirmador: Confirmador;
  arquivoAuditoria?: string;
}

type Resultado = { content: { type: 'text'; text: string }[]; isError?: boolean };
const texto = (t: string, erro = false): Resultado => ({ content: [{ type: 'text', text: t }], ...(erro ? { isError: true } : {}) });

export class Broker {
  private http?: Server;
  private auditoria: string;

  constructor(private o: OpcoesBroker) {
    this.auditoria = o.arquivoAuditoria ?? join(CAMINHOS.logs, 'broker.jsonl');
  }

  private auditar(registro: Record<string, unknown>) {
    try {
      mkdirSync(join(this.auditoria, '..'), { recursive: true });
      appendFileSync(this.auditoria, JSON.stringify({ ts: new Date().toISOString(), ...registro }) + '\n', { mode: 0o640 });
    } catch (e) {
      log.warn('broker: falha na auditoria', errInfo(e));
    }
  }

  private achar(id: string): Autorizada | Resultado {
    const a = this.o.autorizadas().find((x) => x.id === id);
    if (!a) return texto(`A gamificação "${id}" não está autorizada em nenhuma task em andamento. Use funifier_gamificacoes para ver as autorizadas.`, true);
    if (!a.gamificacao.credencial) return texto(`A gamificação "${id}" não tem credencial cadastrada no hub (/gamificacoes no Telegram).`, true);
    return a;
  }

  private servidorMcp(): McpServer {
    const s = new McpServer({ name: 'hub', version: '0.1.0' });

    s.registerTool(
      'funifier_gamificacoes',
      {
        description: 'Gamificações da Funifier autorizadas nas tasks em andamento. Use o id (app/nome) nas outras ferramentas.',
        annotations: { readOnlyHint: true },
      },
      async () => {
        const lista = this.o.autorizadas().map((a) => ({
          id: a.id,
          servidor: a.gamificacao.servidor,
          conta: a.gamificacao.conta,
          producao: ehProducao(a.gamificacao),
          task: a.selecaoId,
        }));
        return texto(lista.length ? JSON.stringify(lista, null, 2) : 'Nenhuma gamificação autorizada agora.');
      },
    );

    s.registerTool(
      'funifier_ferramentas',
      {
        description: 'Ferramentas da Funifier disponíveis para uma gamificação autorizada, com o esquema dos argumentos e a classe (leitura, escrita, destrutiva).',
        inputSchema: { gamificacao: z.string().describe('id da gamificação, ex.: meu-app/dev') },
        annotations: { readOnlyHint: true },
      },
      async ({ gamificacao }) => {
        const a = this.achar(gamificacao);
        if ('content' in a) return a;
        try {
          const con = await this.o.conexoes.abrir(a.gamificacao.credencial!, a.gamificacao.servidor);
          const producao = ehProducao(a.gamificacao);
          const lista = (await con.ferramentas())
            .filter((f) => !FERRAMENTAS_BLOQUEADAS.has(f.name))
            .map((f) => {
              const classe = classificar(f.annotations, f.name);
              return { nome: f.name, classe, decisao: decidir(classe, producao), descricao: f.description, argumentos: f.inputSchema };
            });
          return texto(JSON.stringify(lista, null, 2));
        } catch (e) {
          log.warn('broker: falha ao listar ferramentas', { gamificacao, ...errInfo(e) });
          return texto(`Não consegui falar com a Funifier: ${(e as Error).message}`, true);
        }
      },
    );

    s.registerTool(
      'funifier_chamar',
      {
        description:
          'Chama uma ferramenta da Funifier numa gamificação autorizada. Ação destrutiva e escrita em produção esperam a confirmação do usuário no Telegram.',
        inputSchema: {
          gamificacao: z.string().describe('id da gamificação, ex.: meu-app/dev'),
          ferramenta: z.string().describe('nome vindo de funifier_ferramentas'),
          argumentos: z.record(z.string(), z.unknown()).default({}).describe('argumentos da ferramenta'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ gamificacao, ferramenta, argumentos }) => {
        const a = this.achar(gamificacao);
        if ('content' in a) return a;
        const base = { task: a.selecaoId, gamificacao, ferramenta, argumentos: Object.keys(argumentos) };
        if (FERRAMENTAS_BLOQUEADAS.has(ferramenta)) {
          this.auditar({ ...base, decisao: 'negar', motivo: 'bloqueada' });
          return texto(`A ferramenta ${ferramenta} não é permitida: o hub já conecta a gamificação.`, true);
        }
        try {
          const con = await this.o.conexoes.abrir(a.gamificacao.credencial!, a.gamificacao.servidor);
          const f = (await con.ferramentas()).find((x) => x.name === ferramenta);
          if (!f) return texto(`Ferramenta ${ferramenta} não existe. Use funifier_ferramentas.`, true);
          const producao = ehProducao(a.gamificacao);
          const classe = classificar(f.annotations, f.name);
          let decisao = decidir(classe, producao);
          if (decisao === 'confirmar') {
            const oQue = classe === 'destrutiva' ? 'uma ação <b>destrutiva</b>' : '<b>escrever em produção</b>';
            const ok = await this.o.confirmador.confirmar(
              `A task #${a.selecaoId} quer ${oQue}: <code>${ferramenta}</code> em <b>${gamificacao}</b>${producao ? ' (produção)' : ''}.`,
            );
            decisao = ok ? 'permitir' : 'negar';
          }
          if (decisao === 'negar') {
            this.auditar({ ...base, classe, producao, decisao: 'negar' });
            return texto(`Negado: o usuário não confirmou ${ferramenta} em ${gamificacao}. Não tente outro caminho; explique no encerramento.`, true);
          }
          const r = (await con.chamar(ferramenta, argumentos)) as Resultado;
          this.auditar({ ...base, classe, producao, decisao: 'permitir', ok: !r.isError });
          return r;
        } catch (e) {
          this.auditar({ ...base, decisao: 'erro', erro: (e as Error).message });
          log.warn('broker: falha na chamada', { gamificacao, ferramenta, ...errInfo(e) });
          return texto(`Falha ao chamar a Funifier: ${(e as Error).message}`, true);
        }
      },
    );
    return s;
  }

  private autorizado(cabecalho: string | undefined) {
    const esperado = Buffer.from(`Bearer ${this.o.token}`);
    const recebido = Buffer.from(cabecalho ?? '');
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
  }

  // Sem estado (um servidor MCP por requisição): simples e sobrevive a reinícios do hub.
  async iniciar(): Promise<number> {
    this.http = createServer(async (req, res) => {
      if (!req.url?.startsWith('/mcp')) return void res.writeHead(404).end();
      if (!this.autorizado(req.headers.authorization)) return void res.writeHead(401).end();
      const servidor = this.servidorMcp();
      const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transporte.close();
        void servidor.close();
      });
      try {
        await servidor.connect(transporte);
        await transporte.handleRequest(req, res);
      } catch (e) {
        log.warn('broker: falha na requisição', errInfo(e));
        if (!res.headersSent) res.writeHead(500).end();
      }
    });
    await new Promise<void>((ok) => this.http!.listen(this.o.porta, '127.0.0.1', ok));
    const endereco = this.http.address();
    const porta = typeof endereco === 'object' && endereco ? endereco.port : this.o.porta;
    log.info('broker: no ar', { porta });
    return porta;
  }

  async parar() {
    await new Promise<void>((ok) => (this.http ? this.http.close(() => ok()) : ok()));
    await this.o.conexoes.fecharTodas();
  }
}
