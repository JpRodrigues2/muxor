import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CofreMemoria } from '../../src/adaptadores/cofre/memoria.js';
import { ConexoesFunifier } from '../../src/adaptadores/funifier/conexoes.js';
import { Broker, type Autorizada } from '../../src/broker/broker.js';

const TOKEN = 'token-de-teste-do-broker';
const CHAVE = 'chave-secreta-que-nunca-aparece';
const dir = mkdtempSync(join(tmpdir(), 'hub-broker-'));
const auditoria = join(dir, 'broker.jsonl');

let autorizadas: Autorizada[] = [];
let respostaConfirmacao = false;
const perguntas: string[] = [];
const g = (nome: string, credencial?: string): Autorizada => ({
  id: `app-x/${nome}`,
  app: 'app-x',
  selecaoId: 7,
  gamificacao: { nome, servidor: 'exemplo.funifier.com', conta: 'x', padrao: false, credencial },
});

const cofre = new CofreMemoria();
const broker = new Broker({
  porta: 0,
  token: TOKEN,
  autorizadas: () => autorizadas,
  conexoes: new ConexoesFunifier(cofre, `node ${resolve('tests/fixtures/funifier-falso.mjs')}`, join(dir, 'cwd')),
  confirmador: {
    confirmar: async (p) => {
      perguntas.push(p);
      return respostaConfirmacao;
    },
  },
  arquivoAuditoria: auditoria,
});

let porta = 0;
let cliente: Client;

async function conectar(token: string) {
  const c = new Client({ name: 'teste', version: '0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${porta}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}
const textoDe = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');
const chamar = (gamificacao: string, ferramenta: string, argumentos: Record<string, unknown> = { id: '1' }) =>
  cliente.callTool({ name: 'funifier_chamar', arguments: { gamificacao, ferramenta, argumentos } });

beforeAll(async () => {
  await cofre.salvar('cred-dev', { api_key: CHAVE, secret: CHAVE });
  await cofre.salvar('cred-prod', { api_key: CHAVE, secret: CHAVE });
  porta = await broker.iniciar();
  cliente = await conectar(TOKEN);
});

afterAll(async () => {
  await cliente.close();
  await broker.parar();
});

describe('broker', () => {
  it('recusa sem o token certo', async () => {
    await expect(conectar('errado')).rejects.toThrow();
  });

  it('só três ferramentas, sem funifier_connect', async () => {
    const nomes = (await cliente.listTools()).tools.map((t) => t.name).sort();
    expect(nomes).toEqual(['funifier_chamar', 'funifier_ferramentas', 'funifier_gamificacoes']);
  });

  it('lista só as gamificações de tasks em andamento', async () => {
    autorizadas = [];
    expect(textoDe(await cliente.callTool({ name: 'funifier_gamificacoes', arguments: {} }))).toMatch(/Nenhuma/);
    autorizadas = [g('dev', 'cred-dev'), g('prod', 'cred-prod')];
    const lista = JSON.parse(textoDe(await cliente.callTool({ name: 'funifier_gamificacoes', arguments: {} })));
    expect(lista.map((x: { id: string; producao: boolean }) => [x.id, x.producao])).toEqual([
      ['app-x/dev', false],
      ['app-x/prod', true],
    ]);
  });

  it('a ferramenta real recebe a chave pelo ambiente; a sessão nunca a vê', async () => {
    const r = await chamar('app-x/dev', 'get');
    expect(textoDe(r)).toBe('get 1 em https://exemplo.funifier.com, chave: sim');
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('lista as ferramentas com classe e decisão, sem funifier_connect', async () => {
    const lista = JSON.parse(textoDe(await cliente.callTool({ name: 'funifier_ferramentas', arguments: { gamificacao: 'app-x/prod' } })));
    const porNome = Object.fromEntries(lista.map((f: { nome: string; classe: string; decisao: string }) => [f.nome, `${f.classe}/${f.decisao}`]));
    expect(porNome).toEqual({ get: 'leitura/permitir', save: 'escrita/confirmar', delete: 'destrutiva/confirmar' });
  });

  it('nega funifier_connect sem perguntar; destrutiva pergunta até em dev', async () => {
    expect((await chamar('app-x/dev', 'funifier_connect', { apiKey: 'x' })).isError).toBe(true);
    expect(perguntas.length).toBe(0);
    respostaConfirmacao = false;
    expect((await chamar('app-x/dev', 'delete')).isError).toBe(true);
    expect(perguntas.length).toBe(1);
    perguntas.length = 0;
  });

  it('escrita em produção espera a confirmação', async () => {
    respostaConfirmacao = false;
    expect((await chamar('app-x/prod', 'save')).isError).toBe(true);
    respostaConfirmacao = true;
    expect(textoDe(await chamar('app-x/prod', 'save'))).toBe('save 1');
    expect(perguntas.length).toBe(2);
    expect(perguntas[0]).toMatch(/#7.*save.*app-x\/prod/);
    expect(textoDe(await chamar('app-x/dev', 'save'))).toBe('save 1'); // dev não pergunta
    expect(perguntas.length).toBe(2);
  });

  it('gamificação fora das tasks em andamento ou sem credencial', async () => {
    expect((await chamar('outro-app/dev', 'get')).isError).toBe(true);
    autorizadas = [g('sem-cred')];
    expect(textoDe(await chamar('app-x/sem-cred', 'get'))).toMatch(/não tem credencial/);
  });

  it('auditoria registra decisões sem valores', () => {
    const linhas = readFileSync(auditoria, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(linhas.some((l) => l.ferramenta === 'delete' && l.decisao === 'negar')).toBe(true);
    expect(linhas.some((l) => l.ferramenta === 'save' && l.producao && l.decisao === 'permitir')).toBe(true);
    expect(readFileSync(auditoria, 'utf8')).not.toContain(CHAVE);
  });
});
