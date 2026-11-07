// Adaptador do Jira Cloud (D-A16), pela API REST v3 com e-mail + API token (id.atlassian.com → Segurança → Tokens).
// Mesmas proteções das outras ferramentas: status só "em progresso" e "concluída" (B01, B04), nunca "em revisão"
// (B03), comentário só com comando explícito (B02).
import type { Env } from '../config.js';
import {
  atrasada,
  prazoIso,
  EscritaBloqueadaError,
  escritaPermitida,
  extrairImagens,
  htmlParaTexto,
  type Categoria,
  type PmAdapter,
  type StatusHub,
  type Task,
  type TaskDetalhe,
} from './types.js';

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: string } };
    project?: { id: string; key: string; name: string };
    duedate?: string | null;
    parent?: { key: string; fields?: { summary?: string } };
  };
  renderedFields?: { description?: string | null; comment?: { comments: { author?: { displayName?: string }; created: string; body: string }[] } };
}

// Categoria do status no Jira: new (a fazer), indeterminate (em andamento), done (feito).
const CATEGORIA: Record<string, Categoria> = { new: 'pendente', indeterminate: 'em_progresso', done: 'concluida' };
const ALVO: Partial<Record<StatusHub, string>> = { em_progresso: 'indeterminate', concluida: 'done' };

export type FetchJira = (url: string, init?: RequestInit) => Promise<Response>;

export class JiraAdapter implements PmAdapter {
  readonly nome = 'jira' as const;
  private base: string;
  private auth: string;

  constructor(
    private env: Pick<Env, 'JIRA_URL' | 'JIRA_EMAIL' | 'JIRA_API_TOKEN' | 'TZ_HUB' | 'HUB_ESCRITA_PM' | 'HUB_ESCRITA_PM_SOMENTE' | 'HUB_COMENTARIOS_PM'>,
    private buscar: FetchJira = fetch,
  ) {
    if (!env.JIRA_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw new Error('Jira: faltam JIRA_URL, JIRA_EMAIL ou JIRA_API_TOKEN no .env');
    this.base = env.JIRA_URL.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`;
  }

  private async api<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const r = await this.buscar(`${this.base}/rest/api/3${caminho}`, {
      ...init,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (r.status === 401 || r.status === 403) throw new Error('Jira: e-mail ou API token recusado');
    if (!r.ok) throw new Error(`Jira: ${r.status} em ${caminho.split('?')[0]}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }

  private toTask(i: JiraIssue): Task {
    const base = CATEGORIA[i.fields.status.statusCategory.key] ?? 'pendente';
    const prazo = prazoIso(i.fields.duedate);
    return {
      ferramenta: this.nome,
      id: i.key,
      titulo: i.fields.summary,
      projetoId: i.fields.project?.id ?? null,
      projetoNome: i.fields.project?.name ?? null,
      status: i.fields.status.name,
      categoria: base !== 'concluida' && atrasada(prazo, this.env.TZ_HUB) ? 'atrasada' : base,
      prazo,
      link: `${this.base}/browse/${i.key}`,
      pai: i.fields.parent ? { id: i.fields.parent.key, titulo: i.fields.parent.fields?.summary ?? i.fields.parent.key } : null,
    };
  }

  async listMyTasks(): Promise<Task[]> {
    const out: Task[] = [];
    let pagina: string | undefined;
    do {
      const q = new URLSearchParams({
        jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY duedate ASC, updated DESC',
        fields: 'summary,status,project,duedate,parent',
        maxResults: '100',
        ...(pagina ? { nextPageToken: pagina } : {}),
      });
      const r = await this.api<{ issues: JiraIssue[]; nextPageToken?: string }>(`/search/jql?${q}`);
      out.push(...r.issues.map((i) => this.toTask(i)));
      pagina = r.nextPageToken;
    } while (pagina && out.length < 500);
    return out;
  }

  async getTask(id: string): Promise<TaskDetalhe> {
    const i = await this.api<JiraIssue>(`/issue/${encodeURIComponent(id)}?fields=summary,status,project,duedate,parent,comment,description&expand=renderedFields`);
    const html = i.renderedFields?.description ?? '';
    return {
      ...this.toTask(i),
      descricao: htmlParaTexto(html),
      comentarios: (i.renderedFields?.comment?.comments ?? []).map((c) => ({ autor: c.author?.displayName ?? '?', data: c.created, texto: htmlParaTexto(c.body) })),
      imagens: extrairImagens(html).map((u) => (u.startsWith('/') ? `${this.base}${u}` : u)),
    };
  }

  // Leva a task para o primeiro status cuja categoria é a pedida (o fluxo de cada projeto tem nomes próprios).
  async setStatus(id: string, status: StatusHub) {
    const alvo = ALVO[status];
    if (!alvo) throw new Error(`Jira: o hub não muda para ${status}`);
    if (!escritaPermitida(this.env, id)) throw new EscritaBloqueadaError(`transição ${id} → ${status}`);
    const r = await this.api<{ transitions: { id: string; to: { statusCategory: { key: string } } }[] }>(`/issue/${encodeURIComponent(id)}/transitions`);
    const t = r.transitions.find((x) => x.to.statusCategory.key === alvo);
    if (!t) throw new Error(`Jira: nenhuma transição de ${id} para "${status}" no fluxo do projeto`);
    await this.api(`/issue/${encodeURIComponent(id)}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: t.id } }) });
  }

  async comment(id: string, texto: string) {
    if (!this.env.HUB_COMENTARIOS_PM || !escritaPermitida(this.env, id)) throw new EscritaBloqueadaError(`comentário ${id}`);
    const body = { type: 'doc', version: 1, content: texto.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })) };
    await this.api(`/issue/${encodeURIComponent(id)}/comment`, { method: 'POST', body: JSON.stringify({ body }) });
  }

  async ping() {
    const r = await this.api<{ displayName: string; emailAddress?: string }>('/myself');
    return r.emailAddress ? `${r.displayName} (${r.emailAddress})` : r.displayName;
  }

  // Projetos visíveis, para o de-para do hub init.
  async projetos(): Promise<{ id: string; nome: string }[]> {
    const r = await this.api<{ values: { id: string; key: string; name: string }[] }>('/project/search?maxResults=100&orderBy=name');
    return r.values.map((p) => ({ id: p.id, nome: `${p.name} (${p.key})` }));
  }
}
