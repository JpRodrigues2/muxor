// Seleção de ponta a ponta, com o SQLite de verdade e chat/catálogo/git falsos:
// resumo → marcar → iniciar (sozinha ou em lote) → conversa por task → "Despachar"; atividade avulsa; ambiente novo.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CatalogoApps, Executor } from '../../src/aplicacao/portas.js';
import type { App, Catalogo } from '../../src/config.js';
import type { PmAdapter, Task } from '../../src/pm/types.js';
import { ChatFalso } from '../fakes.js';

const raiz = mkdtempSync(join(tmpdir(), 'hub-selecao-'));
process.env.HUB_DADOS_DIR = join(raiz, 'dados');
process.env.HUB_REPOS_DIR = join(raiz, 'repos');
const { openDb } = await import('../../src/db.js');
const { MemoriaSqlite, RepositorioResumosSqlite, RepositorioSelecoesSqlite } = await import('../../src/adaptadores/persistencia/sqlite.js');
const { criarSelecao } = await import('../../src/aplicacao/selecao/index.js');
const { buscarTasks } = await import('../../src/resumo.js');
const { filtrarPorProjeto } = await import('../../src/projetos.js');

const gamificacoes = [
  { nome: 'dev', servidor: 's.funifier.com', conta: 'c', padrao: true },
  { nome: 'prod', servidor: 's.funifier.com', conta: 'c', padrao: false },
];
const espacos = [
  { id: 'funifier', nome: 'Funifier', pasta: join(raiz, 'repos', 'FUNIFIER'), gamificacao: true },
  { id: 'dac', nome: 'DAC', pasta: join(raiz, 'repos', 'DAC'), gamificacao: false },
];
const appX: App = {
  app: 'app-x',
  espaco: 'funifier',
  gamificacao: true,
  regras: 'funifier',
  ferramenta: 'funifier-pm',
  projetos_na_ferramenta: ['p1'],
  pasta: join(raiz, 'repos', 'app-x'),
  sessao_resume_id: null,
  gamificacoes,
};
const appD: App = { app: 'app-d', espaco: 'dac', gamificacao: false, regras: 'dac', ferramenta: 'bnexo', projetos_na_ferramenta: [], pasta: join(raiz, 'repos', 'app-d'), sessao_resume_id: null };
const cat: Catalogo = { espacos, apps: [appX, appD], nao_mapeados: { 'funifier-pm': [], bnexo: [] }, nomes_projetos: { bnexo: {} } };
const adicionados: string[] = [];
const catalogo: CatalogoApps = {
  atual: () => cat,
  adicionarApp: (a) => {
    adicionados.push(a.app);
    const e = espacos.find((x) => x.id === a.espaco)!;
    cat.apps.push({ app: a.app, espaco: a.espaco, gamificacao: e.gamificacao, regras: e.id, ferramenta: a.ferramenta, projetos_na_ferramenta: a.projeto ? [a.projeto] : [], pasta: join(e.pasta, a.pasta), sessao_resume_id: null });
  },
  ligarProjeto: () => {},
};

const task = (id: string, titulo: string, projetoId: string): Task => ({
  ferramenta: 'funifier-pm',
  id,
  titulo,
  projetoId,
  projetoNome: projetoId === 'p1' ? 'Projeto X' : 'Projeto novo',
  status: 'todo',
  categoria: 'pendente',
  prazo: null,
  link: `https://pm/${id}`,
});
let tasks = [task('a1', 'Ranking semanal', 'p1'), task('a2', 'Tela de login', 'p1')];
const pm = { nome: 'funifier-pm', listMyTasks: async () => tasks } as unknown as PmAdapter;

const db = openDb(join(raiz, 'hub.db'));
const chat = new ChatFalso();
const repos: string[] = [];
const preparadas: string[] = [];
const despachadas: number[] = [];
const selecao = criarSelecao({
  env: { TZ_HUB: 'America/Sao_Paulo', RESUMO_HORARIO: '08:00' },
  selecoes: new RepositorioSelecoesSqlite(db),
  resumos: new RepositorioResumosSqlite(db),
  memoria: new MemoriaSqlite(db),
  executor: { listRepos: async () => repos.map((p) => ({ id: p, path: p, displayName: p })), addRepo: async (p: string) => repos.push(p) } as unknown as Executor,
  notificador: chat,
  catalogo,
  git: { branchesRemotas: async () => [], remotoOrigin: async () => null, clonar: async () => {}, prepararPasta: async (p) => void preparadas.push(p) },
  buscar: () => buscarTasks([pm], db),
  ferramentas: 1,
  filtrar: (t) => filtrarPorProjeto(db, t),
});
selecao.configurar.onDespachar = (id) => despachadas.push(id);
const { configurar, resumo } = selecao;

const sel = (id: number) => db.prepare('SELECT * FROM selecoes WHERE id = ?').get(id) as { estado: string; etapa: string | null; lote_de: number | null; gamificacoes: string | null; info_extra: string | null; app: string | null };
const ultimaSelecao = () => (db.prepare('SELECT MAX(id) id FROM selecoes').get() as { id: number }).id;

afterAll(() => db.close());

describe('resumo e conversa até o despacho', () => {
  let s = 0;

  it('resumo por projeto (B20): uma caixinha por task embaixo da mensagem e, no fim, os botões de iniciar', async () => {
    expect(await resumo.enviar('manual')).toBe(true);
    const comBotoes = chat.mensagens.find((m) => m.teclado)!;
    expect(comBotoes.html).toMatch(/^<b>Projeto X<\/b>/);
    expect(comBotoes.html).toMatch(/<b>1\.<\/b> <a href="https:\/\/pm\/a1">Ranking semanal<\/a>/);
    expect(chat.dados(comBotoes)).toEqual(['t:1:1', 't:1:2', 'r:1:go', 'r:1:lote', 'r:1:none']);
    expect(chat.textos(comBotoes)[0]).toMatch(/^⬜ 1\. Ranking semanal/);
  });

  it('a caixinha troca ⬜ por ✅ e os botões de iniciar continuam; iniciar sem marcar é recusado', async () => {
    expect(await resumo.finalizar(1, 'go')).toMatch(/Marque pelo menos uma/);
    expect(await resumo.alternarItem(1, 1)).toBe('Task 1 marcada');
    const troca = chat.trocas.at(-1)!;
    const textos = troca.teclado!.flat().map((b) => b.texto);
    expect(textos[0]).toMatch(/^✅ 1\./);
    expect(textos[1]).toMatch(/^⬜ 2\./);
    expect(troca.teclado!.flat().map((b) => b.dado).slice(-3)).toEqual(['r:1:go', 'r:1:lote', 'r:1:none']);
    expect(await resumo.alternarPorNumero(9)).toMatch(/Não há task 9/);
  });

  it('iniciar abre a conversa da task: info extra → app sugerido → gamificações → confirmar → despachar', async () => {
    expect(await resumo.finalizar(1, 'go')).toBe('Configurando 1 task(s)');
    expect(await resumo.alternarItem(1, 2)).toMatch(/já foi fechada/);
    s = ultimaSelecao();
    expect(chat.ultima().html).toMatch(/Algo a acrescentar\?/);

    expect(await configurar.onTexto('Falado na reunião: só a semana atual')).toBe(true);
    expect(chat.ultima().html).toMatch(/Rodar em app-x\?/);
    expect(chat.ultima().html).toMatch(/não está aberto no Orca/);

    expect(await configurar.onAcao(s, 'ok', undefined)).toBe('Ok');
    expect(chat.ultima().html).toMatch(/Quais gamificações/);
    expect(chat.textos().slice(0, 2)).toEqual(['✅ dev — c', '⬜ prod — c']); // padrão já vem marcada

    const pergunta = chat.ultima().id;
    expect(await configurar.onAcao(s, 'g', '1')).toBe('✅ prod');
    expect(chat.trocas.at(-1)).toMatchObject({ msgId: pergunta });
    expect(await configurar.onAcao(s, 'gok', undefined)).toBe('Ok');
    expect(chat.ultima().html).toMatch(/Confirma o despacho\?[\s\S]*Gamificações:<\/b> dev \(c\), prod \(c\)/);
    expect(chat.ultima().html).toMatch(/só a semana atual/);

    expect(await configurar.onAcao(s, 'desp', undefined)).toBe('Ok');
    expect(despachadas).toEqual([s]);
    expect(sel(s).estado).toBe('aguardando_despacho');
    expect(JSON.parse(sel(s).gamificacoes!).map((g: { nome: string }) => g.nome)).toEqual(['dev', 'prod']);
  });

  it('botão de pergunta já respondida é recusado', async () => {
    expect(await configurar.onAcao(s, 'ok', undefined)).toBe('Essa pergunta já foi respondida.');
    expect(await configurar.onTexto('texto solto')).toBe(false);
  });

  it('em lote: a líder configura pelas duas; task já em andamento fica de fora; cancelar vale para o lote', async () => {
    await resumo.enviar('manual');
    const r = 2;
    await resumo.alternarItem(r, 1);
    expect(await resumo.finalizar(r, 'lote')).toMatch(/pelo menos duas/);
    await resumo.alternarItem(r, 2);
    expect(await resumo.finalizar(r, 'lote')).toBe('Configurando 1 task(s)'); // a 1 já está aguardando despacho
    expect(chat.mensagens.at(-2)!.html).toMatch(/Já em andamento: 1/);

    tasks = [...tasks, task('a3', 'Tela de cadastro', 'p1')];
    await resumo.enviar('manual');
    await resumo.alternarItem(3, 2);
    await resumo.alternarItem(3, 3);
    // a2 ainda está coletando: só a a3 entra
    expect(await resumo.finalizar(3, 'lote')).toBe('Configurando 1 task(s)');
  });

  it('cancelar a task ativa passa para a próxima', async () => {
    const lider = (db.prepare("SELECT id FROM selecoes WHERE estado = 'coletando' ORDER BY id LIMIT 1").get() as { id: number }).id;
    expect(await configurar.onAcao(lider, 'cancel', undefined)).toBe('Ok');
    expect(sel(lider).estado).toBe('cancelada');
    expect(chat.mensagens.at(-2)!.html).toMatch(/Task cancelada/);
    expect(chat.ultima().html).toMatch(/Algo a acrescentar\?/); // a próxima (a3)
    const prox = (db.prepare("SELECT id FROM selecoes WHERE estado = 'coletando'").get() as { id: number }).id;
    await configurar.onAcao(prox, 'cancel', undefined);
  });

  it('lote de verdade: membros apontam para a líder e acompanham o estado dela', async () => {
    tasks = [task('b1', 'Parte A', 'p1'), task('b2', 'Parte B', 'p1')];
    await resumo.enviar('manual');
    const r = (db.prepare('SELECT MAX(id) id FROM resumos').get() as { id: number }).id;
    await resumo.alternarItem(r, 1);
    await resumo.alternarItem(r, 2);
    expect(await resumo.finalizar(r, 'lote')).toBe('Configurando o lote de 2');
    const membro = ultimaSelecao();
    const lider = membro - 1;
    expect(sel(membro).lote_de).toBe(lider);
    expect(chat.ultima().html).toMatch(/📦 lote: Parte A e mais 1/);
    await configurar.onAcao(lider, 'cancel', undefined);
    expect(sel(membro).estado).toBe('cancelada');
  });
});

describe('atividade avulsa (/nova)', () => {
  it('instruções → info → espaço → app → confirmar; recomeçar volta para a info', async () => {
    await configurar.criarAvulsa('');
    const s = ultimaSelecao();
    expect(chat.ultima().html).toMatch(/O que o Claude deve fazer\?/);
    await configurar.onTexto('Gerar relatório de uso\ncom os números de outubro');
    expect(chat.ultima().html).toMatch(/Gerar relatório de uso/);
    expect(await configurar.onAcao(s, 'pular', undefined)).toBe('Ok');
    expect(chat.dados()).toContain(`s:${s}:esp:dac`);
    expect(await configurar.onAcao(s, 'esp', 'outro')).toBe('Espaço inválido.');
    await configurar.onAcao(s, 'esp', 'dac');
    expect(chat.dados()).toEqual([`s:${s}:app:app-d`, `s:${s}:cancel`]);
    expect(await configurar.onAcao(s, 'app', 'app-x')).toBe('App inválido.'); // outro espaço
    await configurar.onAcao(s, 'app', 'app-d');
    expect(chat.ultima().html).toMatch(/Confirma o despacho\?[\s\S]*com os números de outubro/);
    await configurar.onAcao(s, 'reset', undefined);
    expect(sel(s)).toMatchObject({ etapa: 'info', app: null });
    await configurar.onAcao(s, 'cancel', undefined);
  });
});

describe('ambiente novo (B15)', () => {
  it('projeto sem app: cria a pasta com git local, adiciona ao Orca e ao catálogo, e segue para as gamificações', async () => {
    tasks = [task('c1', 'Primeira task do projeto novo', 'p9')];
    await resumo.enviar('manual');
    const r = (db.prepare('SELECT MAX(id) id FROM resumos').get() as { id: number }).id;
    await resumo.alternarItem(r, 1);
    await resumo.finalizar(r, 'go');
    const s = ultimaSelecao();
    await configurar.onAcao(s, 'pular', undefined);
    expect(chat.ultima().html).toMatch(/Em qual pasta este projeto roda\?/);
    await configurar.onAcao(s, 'amb', 'novo');
    expect(chat.ultima().html).toMatch(/Em qual espaço criar a pasta\?/);
    await configurar.onAcao(s, 'aesp', 'funifier');
    expect(chat.ultima().html).toMatch(/Nome do diretório\?/);
    await configurar.onTexto('Nome Inválido!');
    expect(chat.ultima().html).toMatch(/Nome inválido/);
    await configurar.onTexto('app-x');
    expect(chat.ultima().html).toMatch(/Já existe o app app-x/);
    await configurar.onTexto('novo-app');
    expect(chat.ultima().html).toMatch(/Tem URL do Git/);
    expect(await configurar.onAcao(s, 'agit', 'pasta')).toBe('Ambiente pronto');
    const pasta = join(raiz, 'repos', 'FUNIFIER', 'novo-app');
    expect(preparadas).toEqual([pasta]);
    expect(repos).toContain(pasta);
    expect(adicionados).toEqual(['novo-app']);
    expect(sel(s)).toMatchObject({ app: 'novo-app', etapa: 'alvo' });
    expect(chat.ultima().html).toMatch(/novo-app não tem gamificação vinculada/);
  });

  it('projeto sem app: liga a um projeto que já está no Orca, fora do Muxor', async () => {
    await configurar.onAcao(ultimaSelecao(), 'cancel', undefined); // a do teste anterior ainda espera a gamificação
    const doOrca = join(raiz, 'repos', 'FUNIFIER', 'do-orca');
    repos.push(doOrca);
    tasks = [task('c2', 'Task de um projeto do Orca', 'p8')];
    await resumo.enviar('manual');
    const r = (db.prepare('SELECT MAX(id) id FROM resumos').get() as { id: number }).id;
    await resumo.alternarItem(r, 1);
    await resumo.finalizar(r, 'go');
    const s = ultimaSelecao();
    await configurar.onAcao(s, 'pular', undefined);
    await configurar.onAcao(s, 'amb', 'orca');
    expect(chat.ultima().html).toMatch(/Qual projeto do Orca\?/);
    const i = chat.textos().indexOf(doOrca);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(chat.textos()).not.toContain(join(raiz, 'repos', 'FUNIFIER', 'novo-app')); // já está no Muxor
    expect(await configurar.onAcao(s, 'orca', String(i))).toBe('Projeto ligado');
    expect(adicionados.at(-1)).toBe('do-orca');
    expect(sel(s)).toMatchObject({ app: 'do-orca' });
  });
});
