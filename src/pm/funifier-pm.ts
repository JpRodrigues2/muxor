// Adaptador do Funifier PM (MCP pm-mcp.funifier.com).
import type { Env } from '../config.js';
import {
  atrasada,
  prazoIso,
  EscritaBloqueadaError,
  escritaPermitida,
  McpConexao,
  type Categoria,
  type PmAdapter,
  type StatusHub,
  type Task,
  type TaskDetalhe,
} from './types.js';

interface PmTask {
  id: string;
  title: string;
  status: string;
  project?: { id: string; name: string };
  due?: string | null;
  url?: string;
  notes?: string;
  attachments?: { url?: string; name?: string }[];
  isSubtask?: boolean;
  sprint?: { id: string; name: string };
  parentTask?: { id: string; name: string };
  subtasks?: { id: string }[];
  comments?: { author?: { name?: string }; createdAt?: string; created?: string; content?: string; text?: string }[];
}

const CATEGORIA: Record<string, Categoria> = {
  backlog: 'backlog',
  todo: 'pendente',
  in_progress: 'em_progresso',
  review: 'revisao',
  done: 'concluida',
};

const STATUS: Record<StatusHub, string> = { em_progresso: 'in_progress', em_revisao: 'review', concluida: 'done' };

export class FunifierPmAdapter implements PmAdapter {
  readonly nome = 'funifier-pm' as const;
  private mcp = new McpConexao('funifier-pm');
  // Pai de cada subtarefa e a ordem das subtarefas de cada pai (B20). Não mudam na prática: cache do processo.
  private paiDe = new Map<string, { id: string; titulo: string } | null>();
  private filhasDe = new Map<string, string[]>();

  constructor(private env: Env) {}

  private toTask(t: PmTask): Task {
    const base = CATEGORIA[t.status] ?? 'pendente';
    const projetoId = t.project?.id ?? null;
    return {
      ferramenta: this.nome,
      id: t.id,
      titulo: t.title,
      projetoId,
      projetoNome: t.project?.name ?? null,
      status: t.status,
      categoria: base !== 'concluida' && atrasada(prazoIso(t.due), this.env.TZ_HUB) ? 'atrasada' : base,
      prazo: prazoIso(t.due),
      link: t.url ?? (projetoId ? `https://pm.funifier.app/project/${projetoId}/task/${t.id}` : null),
    };
  }

  async listMyTasks(): Promise<Task[]> {
    const out: Task[] = [];
    let cursor: string | undefined;
    do {
      const r = (await this.mcp.call('list_my_tasks', { limit: 50, ...(cursor ? { cursor } : {}) })) as {
        tasks?: PmTask[];
        nextCursor?: string;
      };
      out.push(...(r.tasks ?? []).map((t) => ({ ...this.toTask(t), sprint: t.sprint?.name ?? null, ...(t.isSubtask ? {} : { pai: null }) })));
      cursor = r.nextCursor;
    } while (cursor);
    return this.hierarquia(out);
  }

  // A listagem só diz se é subtarefa; o pai e a ordem vêm do get_task (do filho e do pai).
  private async hierarquia(tasks: Task[]) {
    for (const t of tasks) {
      if (t.pai === null) continue;
      if (!this.paiDe.has(t.id)) {
        const d = (await this.mcp.call('get_task', { taskId: t.id }).catch(() => null)) as PmTask | null;
        this.paiDe.set(t.id, d?.parentTask ? { id: d.parentTask.id, titulo: d.parentTask.name } : null);
      }
      t.pai = this.paiDe.get(t.id) ?? null;
      if (t.pai && !this.filhasDe.has(t.pai.id)) {
        const p = (await this.mcp.call('get_task', { taskId: t.pai.id }).catch(() => null)) as PmTask | null;
        this.filhasDe.set(t.pai.id, (p?.subtasks ?? []).map((s) => s.id));
      }
      const i = t.pai ? (this.filhasDe.get(t.pai.id) ?? []).indexOf(t.id) : -1;
      if (i >= 0) t.ordem = i;
    }
    return tasks;
  }

  async getTask(id: string): Promise<TaskDetalhe> {
    const t = (await this.mcp.call('get_task', { taskId: id })) as PmTask;
    return {
      ...this.toTask(t),
      descricao: t.notes ?? '',
      comentarios: (t.comments ?? []).map((c) => ({
        autor: c.author?.name ?? '?',
        data: c.createdAt ?? c.created ?? '',
        texto: c.content ?? c.text ?? '',
      })),
      // Hoje o MCP devolve attachments vazio e a descrição sem imagens; pronto para quando vier URL.
      imagens: (t.attachments ?? []).map((x) => x.url).filter((u): u is string => !!u),
    };
  }

  async setStatus(id: string, status: StatusHub) {
    if (!escritaPermitida(this.env, id)) throw new EscritaBloqueadaError(`move_task ${id} → ${STATUS[status]}`);
    await this.mcp.call('move_task', { taskId: id, status: STATUS[status] });
  }

  async comment(id: string, texto: string) {
    if (!this.env.HUB_COMENTARIOS_PM || !escritaPermitida(this.env, id)) throw new EscritaBloqueadaError(`add_comment ${id}`);
    // O PM exige o "confirmation" devolvido pelo preview com exatamente os mesmos campos.
    const p = (await this.mcp.call('preview_add_comment', { taskId: id, content: texto })) as { confirmation?: string };
    if (!p.confirmation) throw new Error('preview_add_comment não devolveu confirmation');
    await this.mcp.call('add_comment', { taskId: id, content: texto, confirmation: p.confirmation });
  }

  async ping() {
    const r = (await this.mcp.call('whoami')) as { id: string; role: string };
    return `${r.id} (${r.role})`;
  }

  async listProjects() {
    const r = (await this.mcp.call('list_projects')) as { projects: { id: string; name: string }[] };
    return r.projects;
  }
}
