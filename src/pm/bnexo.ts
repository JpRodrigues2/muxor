// Adaptador do Bnexo / Orbit (MCP bundle "Essencial").
import type { Env } from '../config.js';
import {
  atrasada,
  prazoIso,
  EscritaBloqueadaError,
  escritaPermitida,
  extrairImagens,
  htmlParaTexto,
  McpConexao,
  type Categoria,
  type PmAdapter,
  type StatusHub,
  type Task,
  type TaskDetalhe,
} from './types.js';

interface BnexoTask {
  id: string;
  name: string;
  status: string;
  deadline?: string | null;
  project_id?: string | null;
  observations?: string | null;
}

// Status ativos; get_my_tasks sem status devolve tudo (inclusive concluídas), então listamos por status.
const STATUS_ATIVOS = ['pending', 'in_progress', 'suspended', 'in_validation'] as const;

const CATEGORIA: Record<string, Categoria> = {
  pending: 'pendente',
  suspended: 'pendente',
  in_progress: 'em_progresso',
  in_validation: 'revisao',
  completed: 'concluida',
  cancelled: 'cancelada',
};

// Concluir via update_task(status: completed) — nunca complete_task.
const STATUS: Record<StatusHub, string> = { em_progresso: 'in_progress', em_revisao: 'in_validation', concluida: 'completed' };

export class BnexoAdapter implements PmAdapter {
  readonly nome = 'bnexo' as const;
  // Fecha a conexão MCP (o init usa o adaptador só para conferir o login).
  async fechar() {
    await this.mcp.close();
  }

  private mcp = new McpConexao('bnexo');
  // project_id não vem na listagem: cache id da task → project_id (não muda na prática).
  private projetoDaTask = new Map<string, string | null>();

  constructor(
    private env: Env,
    private nomesProjetos: () => Record<string, string>,
  ) {}

  private toTask(t: BnexoTask, projetoId: string | null): Task {
    const base = CATEGORIA[t.status] ?? 'pendente';
    const fechada = base === 'concluida' || base === 'cancelada';
    return {
      ferramenta: this.nome,
      id: t.id,
      titulo: t.name,
      projetoId,
      projetoNome: projetoId ? (this.nomesProjetos()[projetoId] ?? null) : null,
      status: t.status,
      categoria: !fechada && atrasada(prazoIso(t.deadline), this.env.TZ_HUB) ? 'atrasada' : base,
      prazo: prazoIso(t.deadline),
      // Não existe deep-link de task no Orbit; usamos o link do projeto.
      link: projetoId ? `https://app.bnexo.com.br/projects/${projetoId}` : 'https://app.bnexo.com.br/my-space',
    };
  }

  async listMyTasks(): Promise<Task[]> {
    const brutas: BnexoTask[] = [];
    for (const status of STATUS_ATIVOS) {
      const r = (await this.mcp.call('get_my_tasks', { status, limit: 100 })) as { tasks?: BnexoTask[] };
      brutas.push(...(r.tasks ?? []));
    }
    const out: Task[] = [];
    for (const t of brutas) {
      if (!this.projetoDaTask.has(t.id)) {
        const d = (await this.mcp.call('get_task', { task_id: t.id })) as { task?: BnexoTask };
        this.projetoDaTask.set(t.id, d.task?.project_id ?? null);
      }
      out.push(this.toTask(t, this.projetoDaTask.get(t.id) ?? null));
    }
    return out;
  }

  async getTask(id: string): Promise<TaskDetalhe> {
    const d = (await this.mcp.call('get_task', { task_id: id })) as { task: BnexoTask };
    this.projetoDaTask.set(id, d.task.project_id ?? null);
    return {
      ...this.toTask(d.task, d.task.project_id ?? null),
      descricao: htmlParaTexto(d.task.observations),
      comentarios: [], // o bundle Essencial não tem leitura de comentários
      imagens: extrairImagens(d.task.observations),
    };
  }

  async setStatus(id: string, status: StatusHub) {
    if (!escritaPermitida(this.env, id)) throw new EscritaBloqueadaError(`update_task ${id} → ${STATUS[status]}`);
    await this.mcp.call('update_task', { task_id: id, status: STATUS[status] });
  }

  async comment(id: string, texto: string) {
    if (!this.env.HUB_COMENTARIOS_PM || !escritaPermitida(this.env, id)) throw new EscritaBloqueadaError(`add_task_comment ${id}`);
    await this.mcp.call('add_task_comment', { task_id: id, content: texto });
  }

  async ping() {
    const r = (await this.mcp.call('list_organizations')) as { active_organization?: string };
    return `org ativa: ${r.active_organization ?? '?'}`;
  }
}
