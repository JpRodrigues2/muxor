// Interface comum dos adaptadores de ferramenta de gestão (mapeamento em docs/referencia/mcp-ferramentas-de-gestao.md).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connect, type PmName } from './mcp-client.js';
import { log } from '../logger.js';

export type Categoria = 'atrasada' | 'em_progresso' | 'pendente' | 'backlog' | 'revisao' | 'concluida' | 'cancelada';

// Status do ponto de vista do hub; cada adaptador traduz para o status da ferramenta.
// 'concluida' só com confirmação explícita do usuário (botão Encerrar).
export type StatusHub = 'em_progresso' | 'em_revisao' | 'concluida';

export interface Task {
  ferramenta: PmName;
  id: string;
  titulo: string;
  projetoId: string | null;
  projetoNome: string | null;
  status: string; // status bruto da ferramenta
  categoria: Categoria;
  prazo: string | null; // ISO
  link: string | null;
  // Hierarquia da ferramenta (B20): a task pai, a posição entre as subtarefas dela e a sprint.
  pai?: { id: string; titulo: string } | null;
  ordem?: number;
  sprint?: string | null;
}

export interface TaskDetalhe extends Task {
  descricao: string; // texto puro
  comentarios: { autor: string; data: string; texto: string }[];
  imagens: string[]; // URLs de imagens/anexos (baixadas para runs/<id>/ no despacho)
}

export interface PmAdapter {
  readonly nome: PmName;
  listMyTasks(): Promise<Task[]>;
  getTask(id: string): Promise<TaskDetalhe>;
  setStatus(id: string, status: StatusHub): Promise<void>;
  comment(id: string, texto: string): Promise<void>;
  ping(): Promise<string>; // descrição curta de quem está logado
  fechar?(): Promise<void>; // fecha a conexão (MCP), quando há uma aberta
}

export class EscritaBloqueadaError extends Error {
  constructor(acao: string) {
    super(`Escrita na ferramenta de gestão bloqueada (HUB_ESCRITA_PM / HUB_ESCRITA_PM_SOMENTE): ${acao}`);
    this.name = 'EscritaBloqueadaError';
  }
}

export function escritaPermitida(env: { HUB_ESCRITA_PM: boolean; HUB_ESCRITA_PM_SOMENTE: string[] | null }, taskId: string) {
  return env.HUB_ESCRITA_PM && (!env.HUB_ESCRITA_PM_SOMENTE || env.HUB_ESCRITA_PM_SOMENTE.includes(taskId));
}

// Data AAAA-MM-DD no fuso do hub.
export function dataLocal(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Normaliza o prazo para ISO; qualquer coisa que não seja data ("No deadline", "") vira null.
export function prazoIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function atrasada(prazo: string | null, tz: string, agora = new Date()) {
  return !!prazo && dataLocal(new Date(prazo), tz) < dataLocal(agora, tz);
}

export function extrairImagens(html: string | null | undefined): string[] {
  return [...(html ?? '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
}

export function htmlParaTexto(html: string | null | undefined) {
  return (html ?? '')
    .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, '\n[imagem: $1]\n')
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Conexão MCP preguiçosa, com uma reconexão automática se a chamada falhar.
export class McpConexao {
  private client: Client | null = null;
  constructor(private nome: PmName) {}

  private async getClient() {
    this.client ??= await connect(this.nome, { interactive: false });
    return this.client;
  }

  async call(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        const client = await this.getClient();
        const res = await client.callTool({ name: tool, arguments: args });
        const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
        if (res.isError) throw new Error(`${this.nome}.${tool}: ${text.slice(0, 300)}`);
        if (res.structuredContent) return res.structuredContent;
        return parseJsonPrefix(text);
      } catch (e) {
        await this.client?.close().catch(() => {});
        this.client = null;
        if (tentativa >= 2 || (e as Error).name === 'PmLoginRequiredError') throw e;
        log.warn('mcp: falha, reconectando', { mcp: this.nome, tool, error: (e as Error).message });
      }
    }
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null;
  }
}

// Algumas respostas vêm como JSON seguido de texto livre; outras são só texto ("No tasks found…").
function parseJsonPrefix(text: string): unknown {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return { _texto: t };
  try {
    return JSON.parse(t);
  } catch {
    const fim = t.lastIndexOf(t.startsWith('{') ? '}' : ']');
    return JSON.parse(t.slice(0, fim + 1));
  }
}
