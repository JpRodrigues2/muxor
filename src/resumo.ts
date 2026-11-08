// Busca as tasks nas duas ferramentas e monta o resumo em texto (HTML do Telegram).
// Na Fase 4 este resumo ganha os botões de seleção.
import { appsDoProjeto, type Catalogo } from './config.js';
import type { DB } from './db.js';
import { errInfo, log } from './logger.js';
import type { Categoria, PmAdapter, Task } from './pm/types.js';
import { NOME_FERRAMENTA } from './dominio/selecao.js';
import { registrarProjetos } from './projetos.js';

export interface ResultadoBusca {
  ferramentas: string[]; // as consultadas, na ordem de exibição
  tasks: Task[];
  erros: { ferramenta: string; erro: string }[];
}

export async function buscarTasks(adapters: PmAdapter[], db: DB): Promise<ResultadoBusca> {
  const tasks: Task[] = [];
  const erros: ResultadoBusca['erros'] = [];
  await Promise.all(
    adapters.map(async (a) => {
      try {
        tasks.push(...(await a.listMyTasks()));
      } catch (e) {
        log.error('resumo: falha ao listar tasks', { ferramenta: a.nome, ...errInfo(e) });
        erros.push({ ferramenta: a.nome, erro: (e as Error).message });
      }
    }),
  );
  registrarVistas(db, tasks);
  registrarProjetos(db, tasks);
  return { ferramentas: adapters.map((a) => a.nome), tasks, erros };
}

function registrarVistas(db: DB, tasks: Task[]) {
  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO tasks_vistas (ferramenta, task_id, espaco, titulo, projeto_id, projeto_nome, status, prazo, link, primeira_vez, ultima_vez)
    VALUES (@ferramenta, @id, '', @titulo, @projetoId, @projetoNome, @status, @prazo, @link, @agora, @agora)
    ON CONFLICT(ferramenta, task_id) DO UPDATE SET
      titulo = excluded.titulo, projeto_id = excluded.projeto_id, projeto_nome = excluded.projeto_nome,
      status = excluded.status, prazo = excluded.prazo, link = excluded.link, ultima_vez = excluded.ultima_vez`);
  db.transaction(() => tasks.forEach((t) => stmt.run({ ...t, agora })))();
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Status como etiqueta na linha (B20); concluídas e canceladas não entram.
// Só o atraso leva cor: é o que precisa saltar aos olhos. O resto é texto.
const ETIQUETA: Partial<Record<Categoria, string>> = {
  atrasada: '🔴 atrasada',
  em_progresso: 'em progresso',
  pendente: 'a fazer',
  backlog: 'backlog',
  revisao: 'em revisão',
};

function formatarPrazo(prazo: string | null, tz: string) {
  if (!prazo) return null;
  return `prazo ${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date(prazo))}`;
}

export interface ItemResumo {
  idx: number; // número mostrado ao usuário (global no resumo)
  task: Task;
  app: string | null; // app sugerido; null = projeto não mapeado
}

export interface BlocoResumo {
  ferramenta: string;
  texto: string;
  itens: ItemResumo[];
}

export function appSugerido(t: Task, cat: Catalogo): string | null {
  return t.projetoId ? (appsDoProjeto(cat, t.ferramenta, t.projetoId)[0]?.app ?? null) : null;
}

// O número da task na linha; a marcação é pelos botões com caixinha embaixo da mensagem. Em negrito: o título vem
// escapado, então "<b>3.</b>" nunca aparece dentro dele (serve para achar a mensagem de cada task).
export const marcador = (idx: number) => `<b>${idx}.</b> `;

function linhaTask(i: ItemResumo, tz: string, filha: boolean) {
  const t = i.task;
  const titulo = escapeHtml(t.titulo.length > 90 ? t.titulo.slice(0, 87) + '…' : t.titulo);
  const link = t.link ? `<a href="${escapeHtml(t.link)}">${titulo}</a>` : titulo;
  const meta = [ETIQUETA[t.categoria], formatarPrazo(t.prazo, tz)].filter(Boolean).join(' · ');
  const recuo = filha ? '   ↳ ' : '';
  return `${recuo}${marcador(i.idx)}${link}\n${filha ? '        ' : '     '}<i>${meta}</i>`;
}

// As tasks de um projeto na ordem e hierarquia da ferramenta: por sprint; cada pai seguido das subtarefas (na ordem
// do pai); subtarefa cujo pai não está na lista aparece embaixo do nome do pai.
export function ordenarProjeto(tasks: Task[]): { sprint: string | null; linhas: ({ tipo: 'task'; task: Task; filha: boolean } | { tipo: 'pai'; titulo: string })[] }[] {
  const posicao = new Map(tasks.map((t, i) => [t, i]));
  const sprints = [...new Set(tasks.map((t) => t.sprint ?? null))].sort((a, b) => (a === null ? 1 : b === null ? -1 : 0));
  return sprints.map((sprint) => {
    const doSprint = tasks.filter((t) => (t.sprint ?? null) === sprint);
    const ids = new Set(doSprint.map((t) => t.id));
    const filhas = new Map<string, Task[]>();
    const raiz: (Task | { orfasDe: string; titulo: string })[] = [];
    for (const t of doSprint) {
      const pai = t.pai;
      if (!pai) {
        raiz.push(t);
        continue;
      }
      if (!filhas.has(pai.id)) {
        filhas.set(pai.id, []);
        if (!ids.has(pai.id)) raiz.push({ orfasDe: pai.id, titulo: pai.titulo });
      }
      filhas.get(pai.id)!.push(t);
    }
    const emOrdem = (l: Task[]) => [...l].sort((a, b) => (a.ordem ?? 1e9) - (b.ordem ?? 1e9) || posicao.get(a)! - posicao.get(b)!);
    const linhas: ({ tipo: 'task'; task: Task; filha: boolean } | { tipo: 'pai'; titulo: string })[] = [];
    for (const r of raiz) {
      const id = 'orfasDe' in r ? r.orfasDe : r.id;
      if ('orfasDe' in r) linhas.push({ tipo: 'pai', titulo: r.titulo });
      else linhas.push({ tipo: 'task', task: r, filha: false });
      for (const f of emOrdem(filhas.get(id) ?? [])) linhas.push({ tipo: 'task', task: f, filha: true });
    }
    return { sprint, linhas };
  });
}

// Uma mensagem por projeto (B20), na ordem: ferramenta, depois projeto como a ferramenta devolveu.
export function montarResumo(r: ResultadoBusca, cat: Catalogo, tz: string, rotulo = 'Suas tasks'): BlocoResumo[] {
  let idx = 0;
  const blocos: BlocoResumo[] = [];
  for (const ferramenta of r.ferramentas) {
    const nomeFer = NOME_FERRAMENTA[ferramenta] ?? ferramenta;
    const abertas = r.tasks.filter((t) => t.ferramenta === ferramenta && ETIQUETA[t.categoria]);
    const erro = r.erros.find((e) => e.ferramenta === ferramenta);
    if (erro || !abertas.length) {
      const corpo = erro ? `⚠️ Não consegui buscar: ${escapeHtml(erro.erro)}` : 'Nenhuma task aberta.';
      blocos.push({ ferramenta, texto: `<b>${escapeHtml(nomeFer)}</b>\n${rotulo}\n\n${corpo}`, itens: [] });
      continue;
    }
    const projetos = [...new Set(abertas.map((t) => t.projetoId ?? ''))];
    for (const pid of projetos) {
      const doProjeto = abertas.filter((t) => (t.projetoId ?? '') === pid);
      const nomeProjeto = doProjeto[0].projetoNome ?? (pid ? `projeto ${pid}` : 'Sem projeto');
      const itens: ItemResumo[] = [];
      const corpo: string[] = [];
      const app = appSugerido(doProjeto[0], cat);
      for (const g of ordenarProjeto(doProjeto)) {
        const linhas: string[] = [];
        for (const l of g.linhas) {
          if (l.tipo === 'pai') {
            linhas.push(`<b>${escapeHtml(l.titulo)}</b>`);
            continue;
          }
          const item = { idx: ++idx, task: l.task, app: appSugerido(l.task, cat) };
          itens.push(item);
          linhas.push(linhaTask(item, tz, l.filha));
        }
        corpo.push([...(g.sprint ? [`<b>${escapeHtml(g.sprint)}</b>`] : []), ...linhas].join('\n'));
      }
      const n = doProjeto.length;
      const contexto = [nomeFer, `${n} task${n === 1 ? '' : 's'}`, ...(app ? [] : ['sem pasta, escolho ao iniciar'])].join(' · ');
      blocos.push({ ferramenta, texto: [`<b>${escapeHtml(nomeProjeto)}</b>\n${contexto}`, ...corpo].join('\n\n'), itens });
    }
  }
  return blocos;
}

// Telegram limita mensagens a 4096 caracteres; quebra por linhas.
export function dividirMensagem(texto: string, max = 4000): string[] {
  if (texto.length <= max) return [texto];
  const out: string[] = [];
  let atual = '';
  for (const linha of texto.split('\n')) {
    if (atual.length + linha.length + 1 > max) {
      out.push(atual);
      atual = '';
    }
    atual += (atual ? '\n' : '') + linha;
  }
  if (atual) out.push(atual);
  return out;
}
