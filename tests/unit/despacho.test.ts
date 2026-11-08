// Ciclo do despacho de ponta a ponta, com o banco SQLite de verdade e executor/chat falsos:
// fila → sessão → acompanhamento → resultado → próximos passos (instrução, PR, encerrar) e as falhas do terminal.
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgenteExecutor, Executor, TerminalExecutor } from '../../src/aplicacao/portas.js';
import type { App } from '../../src/config.js';
import { TELAS, blocoResultado } from '../dominio/telas.js';
import { ChatFalso, ate } from '../fakes.js';

// Antes de importar o hub: dados, runs/ e históricos do Claude numa pasta temporária.
const raiz = mkdtempSync(join(tmpdir(), 'hub-despacho-'));
process.env.HUB_DADOS_DIR = join(raiz, 'dados');
process.env.HUB_CLAUDE_DIR = join(raiz, 'claude');
const { openDb } = await import('../../src/db.js');
const { ErroExecutor } = await import('../../src/aplicacao/portas.js');
const { MemoriaSqlite, RepositorioDespachosSqlite, RepositorioSelecoesSqlite } = await import('../../src/adaptadores/persistencia/sqlite.js');
const { CofreMemoria } = await import('../../src/adaptadores/cofre/memoria.js');
const { criarDespacho } = await import('../../src/aplicacao/despacho/index.js');
const { CAMINHOS } = await import('../../src/caminhos.js');

class ExecutorFalso implements Executor {
  telas = new Map<string, string>();
  agentes = new Map<string, AgenteExecutor>(); // por handle (o pane do terminal falso é "<handle>:l")
  terminais: TerminalExecutor[] = [];
  enviados: { handle: string; linha: string }[] = [];
  repos: string[] = [];
  revisao: string[] = [];
  private n = 0;

  async status() {
    return { ok: true };
  }
  async listRepos() {
    return this.repos.map((p) => ({ id: p, path: p, displayName: p }));
  }
  async addRepo(pasta: string) {
    this.repos.push(pasta);
  }
  async listTerminals(pasta: string) {
    return this.terminais.filter((t) => t.worktreePath === pasta);
  }
  async agentStates() {
    return new Map([...this.agentes].map(([h, a]) => [`${h}:l`, a]));
  }
  async createTerminal(pasta: string, _comando: string, titulo = '') {
    const handle = `term-${++this.n}`;
    this.terminais.push({ handle, title: titulo, agentIdentity: 'claude', worktreePath: pasta, connected: true, writable: true, tabId: handle, leafId: 'l' });
    this.telas.set(handle, TELAS.ocioso);
    return handle;
  }
  async readScreen(handle: string) {
    const t = this.telas.get(handle);
    if (t === undefined) throw new ErroExecutor('terminal não existe', 'terminal_not_found');
    return t.split('\n');
  }
  async send(handle: string, linha: string) {
    this.enviados.push({ handle, linha });
    this.telas.set(handle, TELAS.ocupado);
  }
  async waitIdle() {
    return true;
  }
  async setWorktreeStatus(_pasta: string, status: string) {
    this.revisao.push(status);
  }
  // A sessão termina a rodada com o bloco de resultado.
  responder(tag: string, status = 'concluido') {
    for (const h of this.telas.keys()) this.telas.set(h, blocoResultado(tag, status));
  }
  fechar(handle: string) {
    this.telas.delete(handle);
    this.terminais = this.terminais.filter((t) => t.handle !== handle);
  }
}

const pasta = join(raiz, 'repos', 'sandbox');
mkdirSync(pasta, { recursive: true });
const dev = { nome: 'dev', servidor: 's', conta: 'c', padrao: true, credencial: 'x' };
const app: App = { app: 'sandbox', espaco: 'funifier', gamificacao: true, regras: null, ferramenta: 'teste', projetos_na_ferramenta: [], pasta, sessao_resume_id: null, gamificacoes: [dev] };
const db = openDb(join(raiz, 'hub.db'));
const exec = new ExecutorFalso();
const chat = new ChatFalso();
const remotas = ['main', 'develop', 'feat/ranking'];
const despacho = criarDespacho({
  env: { HUB_BROKER: 'ligado', HUB_CLAUDE_PERMISSAO: 'auto', HUB_CONFIAR_PASTA_CMD: undefined },
  despachos: new RepositorioDespachosSqlite(db),
  selecoes: new RepositorioSelecoesSqlite(db),
  memoria: new MemoriaSqlite(db),
  executor: exec,
  notificador: chat,
  cofre: new CofreMemoria(),
  gestao: [],
  git: { branchesRemotas: async () => remotas, remotoOrigin: async () => 'https://github.com/org/sandbox.git', clonar: async () => {}, prepararPasta: async () => {} },
  apps: () => [app],
  dormir: () => new Promise((r) => setTimeout(r, 1)),
});

function novaTask(titulo: string) {
  const agora = new Date().toISOString();
  const taskId = `teste-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO tasks_vistas (ferramenta, task_id, espaco, titulo, projeto_id, projeto_nome, status, prazo, link, primeira_vez, ultima_vez)
     VALUES ('teste', ?, 'dac', ?, NULL, 'sandbox', 'teste', NULL, NULL, ?, ?)`,
  ).run(taskId, titulo, agora, agora);
  return Number(
    db
      .prepare(
        `INSERT INTO selecoes (ferramenta, task_id, data_resumo, app, estado, gamificacoes, criado_em, atualizado_em)
         VALUES ('teste', ?, ?, 'sandbox', 'aguardando_despacho', ?, ?, ?)`,
      )
      .run(taskId, agora.slice(0, 10), JSON.stringify([dev]), agora, agora)
      .lastInsertRowid,
  );
}
const estadoSel = (id: number) => (db.prepare('SELECT estado FROM selecoes WHERE id = ?').get(id) as { estado: string }).estado;
const despachoDe = (selId: number) =>
  db.prepare('SELECT * FROM despachos WHERE selecao_id = ?').get(selId) as { id: number; estado: string; rodada: number; msg_fechamento: number | null };

let sel = 0;
let desp = 0;

beforeAll(() => {
  mkdirSync(CAMINHOS.runs, { recursive: true });
});
afterAll(() => db.close());

describe('despacho de ponta a ponta', () => {
  it('sem sessão na pasta: adiciona ao Orca, abre o Claude e manda uma linha com o prompt', async () => {
    sel = novaTask('Criar OLA.md');
    despacho.despachar.enfileirar(sel);
    await ate(() => exec.enviados.length === 1);
    expect(exec.repos).toEqual([pasta]);
    const arquivo = join(CAMINHOS.runs, `${sel}.md`);
    expect(exec.enviados[0].linha).toBe(`Leia e execute a task descrita em ${arquivo}.`);
    expect(readFileSync(arquivo, 'utf8')).toMatch(/Criar OLA\.md/);
    // Broker ligado: a sessão usa o MCP do hub e não recebe arquivo de credenciais.
    expect(readFileSync(arquivo, 'utf8')).toMatch(/MCP \*\*hub\*\*/);
    expect(existsSync(join(CAMINHOS.runs, String(sel), 'credenciais.json'))).toBe(false);
    await ate(() => chat.mensagens.some((m) => m.html.includes('rodando')));
    expect(chat.mensagens[0].html).toMatch(/Abrindo o Claude em sandbox/);
    expect(estadoSel(sel)).toBe('despachada');
    desp = despachoDe(sel).id;
  });

  it('acompanha até o RESULTADO HUB e oferece os próximos passos', async () => {
    exec.responder(String(sel));
    await ate(() => despachoDe(sel).estado === 'concluido');
    await ate(() => chat.dados().includes(`f:${desp}:i`));
    expect(chat.ultima().html).toMatch(/concluída/);
    expect(chat.ultima().html).toMatch(/feat\/ranking/);
    expect(exec.revisao).toEqual(['in-review']);
    expect(estadoSel(sel)).toBe('finalizada');
    const h = db.prepare('SELECT titulo, status_final, branch FROM historico').all();
    expect(h).toEqual([{ titulo: 'Criar OLA.md', status_final: 'concluido', branch: 'feat/ranking' }]);
    await ate(() => despacho.monitor.emAcompanhamento === 0);
  });

  it('botões já usados ou de outra mensagem são recusados', async () => {
    expect(await despacho.proximos.onBotao(desp, 'i', undefined, 1)).toMatch(/já foram usados/);
    expect(await despacho.proximos.onTexto('solto')).toBe(false);
  });

  it('Dar instrução: rodada 2 na mesma sessão, com a branch da rodada anterior', async () => {
    const msg = despachoDe(sel).msg_fechamento!;
    expect(await despacho.proximos.onBotao(desp, 'i', undefined, msg)).toBe('Mande a instrução');
    expect(await despacho.proximos.onTexto('Acrescente a hora')).toBe(true);
    await ate(() => exec.enviados.length === 2);
    const arquivo = join(CAMINHOS.runs, `${sel}-2.md`);
    expect(exec.enviados[1]).toEqual({ handle: 'term-1', linha: `Leia e execute a task descrita em ${arquivo}.` });
    const prompt = readFileSync(arquivo, 'utf8');
    expect(prompt).toMatch(/Acrescente a hora/);
    expect(prompt).toMatch(/`feat\/ranking`/);
    expect(despachoDe(sel)).toMatchObject({ estado: 'em_execucao', rodada: 2 });

    exec.responder(`${sel}.2`);
    await ate(() => despachoDe(sel).estado === 'concluido');
    await ate(() => chat.ultima().html.includes('rodada 2'));
  });

  it('Abrir PR: base pelas branches do origin, confirmação e prompt de PR sem merge', async () => {
    await ate(() => despacho.monitor.emAcompanhamento === 0);
    const msg = despachoDe(sel).msg_fechamento!;
    expect(await despacho.proximos.onBotao(desp, 'pr', undefined, msg)).toBe('Escolha a branch base');
    expect(chat.dados()).toEqual([`f:${desp}:b:0`, `f:${desp}:b:1`, `f:${desp}:no`]); // main, develop
    expect(await despacho.proximos.onBotao(desp, 'b', '1', chat.ultima().id)).toBe('develop');
    expect(chat.ultima().html).toMatch(/Confirma o PR\?[\s\S]*github\.com\/org\/sandbox[\s\S]*feat\/ranking[\s\S]*develop/);
    expect(await despacho.proximos.onBotao(desp, 'ok', undefined, chat.ultima().id)).toBe('PR pedido');
    await ate(() => exec.enviados.length === 3);
    const prompt = readFileSync(join(CAMINHOS.runs, `${sel}-3.md`), 'utf8');
    expect(prompt).toMatch(/gh pr create --base develop/);
    expect(prompt).toMatch(/Não faça merge/);
    exec.responder(`${sel}.3`);
    await ate(() => despachoDe(sel).estado === 'concluido');
  });

  it('resultado só na última mensagem do Orca (tela sem o bloco) também conclui', async () => {
    await ate(() => despacho.monitor.emAcompanhamento === 0);
    await despacho.proximos.onBotao(desp, 'x', undefined, despachoDe(sel).msg_fechamento!);
    const outra = novaTask('Resultado pelo Orca');
    exec.telas.set('term-1', TELAS.ocioso);
    despacho.despachar.enfileirar(outra);
    await ate(() => exec.enviados.at(-1)!.linha.includes(`runs/${outra}.md`));
    exec.telas.set('term-1', TELAS.ocioso);
    exec.agentes.set('term-1', { estado: 'done', ultimaMensagem: `### RESULTADO HUB\ntask: #${outra}\nstatus: concluido\nresumo: feito\nbranch: feat/orca\npendencias: nenhuma` });
    await ate(() => despachoDe(outra).estado === 'concluido');
    expect(db.prepare('SELECT branch FROM historico WHERE titulo = ?').get('Resultado pelo Orca')).toEqual({ branch: 'feat/orca' });
    exec.agentes.clear();
    sel = outra;
    desp = despachoDe(outra).id;
  });

  it('Encerrar: task sem ferramenta de gestão encerra direto', async () => {
    await ate(() => despacho.monitor.emAcompanhamento === 0);
    await ate(() => despachoDe(sel).msg_fechamento !== null);
    expect(await despacho.proximos.onBotao(desp, 'x', undefined, despachoDe(sel).msg_fechamento!)).toBe('Encerrado');
    expect(despachoDe(sel).estado).toBe('encerrado');
    expect(estadoSel(sel)).toBe('encerrada');
    expect(chat.ultima().html).toMatch(/encerrada/);
  });

  it('sessão ocupada: a task espera na fila, avisa uma vez e sai quando a sessão fica livre', async () => {
    exec.telas.set('term-1', TELAS.ocupado);
    const outra = novaTask('Segunda task');
    const antes = chat.mensagens.length;
    despacho.despachar.enfileirar(outra);
    await ate(() => chat.mensagens.length === antes + 1);
    expect(chat.ultima().html).toMatch(/na fila: a sessão está ocupada/);
    await despacho.despachar.processar();
    expect(chat.mensagens.length).toBe(antes + 1); // mesmo motivo não repete
    expect(estadoSel(outra)).toBe('aguardando_despacho');

    exec.telas.set('term-1', TELAS.ocioso);
    await despacho.despachar.processar();
    expect(exec.enviados.at(-1)!.linha).toMatch(new RegExp(`runs/${outra}\\.md`));
    sel = outra;
  });

  it('terminal fechado: depois de três tentativas, interrompe, registra e libera a fila', async () => {
    exec.fechar('term-1');
    await ate(() => despachoDe(sel).estado === 'interrompido');
    expect(estadoSel(sel)).toBe('interrompida');
    await ate(() => chat.ultima().html.includes('interrompida'));
    const h = db.prepare("SELECT titulo FROM historico WHERE status_final = 'interrompido'").all();
    expect(h).toEqual([{ titulo: 'Segunda task' }]);
  });
});
