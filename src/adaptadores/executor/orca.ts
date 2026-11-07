// Adaptador Executor sobre a CLI do Orca. Sempre execFile com argumentos em array (nunca string de shell)
// e sempre --json. Handles de terminal mudam quando o Orca reinicia: redescobrir pela pasta.
// No servidor o Orca roda com outro usuário (agente): todo comando leva --environment <pareamento do hub>.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import {
  ErroExecutor,
  type AgenteExecutor,
  type Executor,
  type StatusWorktree,
  type TerminalExecutor,
} from '../../aplicacao/portas.js';

interface OrcaResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code?: string; message?: string };
}

interface AgenteOrca {
  paneKey: string;
  state: string;
  workingMode?: string;
  lastAssistantMessage?: string | null;
  programStatus?: { state?: string; kind?: string; message?: string } | null;
  agentWait?: { source?: string } | null;
}

export function agenteDoOrca(a: AgenteOrca): AgenteExecutor {
  const bloqueado = a.programStatus?.state === 'blocked';
  const esperaHumano = !!a.agentWait || bloqueado || a.state === 'waiting';
  return {
    estado: a.state,
    ...(a.workingMode === 'monitoring' ? { monitorando: true } : {}),
    ...(esperaHumano ? { esperaHumano } : {}),
    ...(esperaHumano && a.programStatus?.message ? { pergunta: a.programStatus.message } : {}),
    ...(a.lastAssistantMessage ? { ultimaMensagem: a.lastAssistantMessage } : {}),
  };
}

export class Orca implements Executor {
  constructor(
    private bin: string,
    private ambiente?: string,
  ) {}

  private run<T>(args: string[], timeoutMs = 30_000): Promise<T> {
    const completos = this.ambiente ? [...args, '--environment', this.ambiente, '--json'] : [...args, '--json'];
    return new Promise((resolvePromise, reject) => {
      execFile(this.bin, completos, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
        let parsed: OrcaResponse<T> | undefined;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // sem JSON: falha do processo (binário ausente, timeout, Orca fechado)
        }
        if (parsed?.ok) return resolvePromise(parsed.result as T);
        if (parsed?.error) return reject(new ErroExecutor(parsed.error.message ?? 'erro do Orca', parsed.error.code));
        reject(new ErroExecutor(err ? err.message : `resposta inesperada do Orca: ${stdout.slice(0, 200)}`));
      });
    });
  }

  async status() {
    // Pelo pareamento (servidor) o "app" é o desktop local do hub, que não existe: vale só o runtime remoto.
    const r = await this.run<{ app?: { running: boolean }; runtime?: { state: string; reachable: boolean; appVersion?: string } }>(
      ['status'],
      15_000,
    );
    const appOk = this.ambiente ? true : (r.app?.running ?? true);
    const ok = appOk && !!r.runtime?.reachable && r.runtime?.state === 'ready';
    return { ok, versao: r.runtime?.appVersion, estado: r.runtime?.state };
  }

  async listRepos() {
    const r = await this.run<{ repos: { id: string; path: string; displayName: string }[] }>(['repo', 'list']);
    return r.repos;
  }

  // Terminais vivos cuja pasta é exatamente `pasta`.
  async listTerminals(pasta: string): Promise<TerminalExecutor[]> {
    const alvo = resolve(pasta);
    const r = await this.run<{ terminals: TerminalExecutor[] }>(['terminal', 'list', '--worktree', `path:${alvo}`]);
    return r.terminals.filter((t) => t.worktreePath && resolve(t.worktreePath) === alvo);
  }

  // Estado dos agentes por pane ("tabId:leafId"), via worktree ps. --agent-wait traz o agentWait (pergunta ou
  // permissão esperando a pessoa, provada pelo hook). Formato capturado no servidor (T3b): tests/unit/orca.test.ts.
  async agentStates(): Promise<Map<string, AgenteExecutor>> {
    const r = await this.run<{ worktrees: { agents?: AgenteOrca[] }[] }>(['worktree', 'ps', '--agent-wait']);
    return new Map(r.worktrees.flatMap((w) => (w.agents ?? []).map((a) => [a.paneKey, agenteDoOrca(a)] as [string, AgenteExecutor])));
  }

  // Tela atual do terminal (últimas `linhas` linhas).
  async readScreen(handle: string, linhas = 60): Promise<string[]> {
    const r = await this.run<{ terminal: { tail: string[]; status?: string } }>([
      'terminal',
      'read',
      '--terminal',
      handle,
      '--screen',
      '--limit',
      String(linhas),
    ]);
    // Terminal fechado continua legível por um tempo, com status "exited" e tela vazia.
    if (r.terminal.status && r.terminal.status !== 'running')
      throw new ErroExecutor(`terminal ${handle} não está rodando (${r.terminal.status})`, 'terminal_not_running');
    return r.terminal.tail;
  }

  // Envia UMA linha seguida de Enter. Quebras de linha são recusadas (o prompt vai num arquivo em runs/).
  async send(handle: string, linha: string) {
    if (/[\r\n]/.test(linha)) throw new ErroExecutor('send: a linha não pode conter quebras de linha');
    return this.run(['terminal', 'send', '--terminal', handle, '--text', linha, '--enter']);
  }

  // true se o TUI ficou ocioso dentro do prazo; false se estourou o timeout.
  async waitIdle(handle: string, timeoutMs: number): Promise<boolean> {
    try {
      await this.run(
        ['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(timeoutMs)],
        timeoutMs + 15_000,
      );
      return true;
    } catch (e) {
      if (e instanceof ErroExecutor && /timeout|timed out/i.test(`${e.code} ${e.message}`)) return false;
      throw e;
    }
  }

  // Adiciona uma pasta ao Orca como projeto.
  async addRepo(pasta: string) {
    return this.run(['repo', 'add', '--path', resolve(pasta)]);
  }

  async createTerminal(pasta: string, comando: string, titulo?: string): Promise<string> {
    const args = ['terminal', 'create', '--worktree', `path:${resolve(pasta)}`, '--command', comando];
    if (titulo) args.push('--title', titulo);
    const r = await this.run<{ terminal?: { handle?: string }; handle?: string }>(args);
    const handle = r.terminal?.handle ?? r.handle;
    if (!handle) throw new ErroExecutor('terminal create não devolveu handle');
    return handle;
  }

  async setWorktreeStatus(pasta: string, status: StatusWorktree, comentario?: string) {
    const args = ['worktree', 'set', '--worktree', `path:${resolve(pasta)}`, '--workspace-status', status];
    if (comentario) args.push('--comment', comentario);
    return this.run(args);
  }
}
