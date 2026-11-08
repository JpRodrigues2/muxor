// Sessões do Claude no executor (Orca): achar uma ociosa na pasta do app, ler o estado de um terminal e,
// quando não há nenhuma, abrir uma nova.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dirSessoesClaude } from '../../caminhos.js';
import type { App } from '../../config.js';
import type { Selecao } from '../../dominio/selecao.js';
import { classificarTela, type EstadoSessao } from '../../dominio/tela.js';
import { log } from '../../logger.js';
import { ICONE, cartao, curto, esc } from '../../msg.js';
import { ErroExecutor, type AgenteExecutor, type TerminalExecutor } from '../portas.js';
import type { DepsDespacho, Tasks } from './contexto.js';

const ESPERA_SESSAO_NOVA_MS = 120_000;

// Há sessão anterior do Claude nessa pasta? (para decidir entre `claude -c` e `claude`)
function temSessaoAnterior(pasta: string) {
  const dir = dirSessoesClaude(pasta);
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.jsonl'));
}

export interface LeituraSessao {
  estado: EstadoSessao;
  tela: string;
  agente?: AgenteExecutor;
}

// O claude pelo caminho completo, no Mac: o terminal que o Orca abre nem sempre lê o ~/.zprofile (onde o instalador
// põe ~/.local/bin no PATH) e aí não acha o claude; a sessão não abria. No servidor a sessão roda com outro usuário
// (o agente), então fica só "claude", que o PATH dele resolve.
export function binClaude(plataforma = process.platform, existe = existsSync, casa = homedir()) {
  if (plataforma !== 'darwin') return 'claude';
  return [join(casa, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find((p) => existe(p)) ?? 'claude';
}

export class Sessoes {
  constructor(
    private d: DepsDespacho,
    private tasks: Tasks,
  ) {}

  async doApp(pasta: string) {
    // Pasta que o Orca ainda não conhece não tem sessão; o abrir() adiciona.
    const todos = await this.d.executor.listTerminals(pasta).catch((e) => {
      if (e instanceof ErroExecutor && e.code === 'selector_not_found') return [];
      throw e;
    });
    const terms = todos.filter((t) => t.agentIdentity === 'claude' && t.writable);
    if (!terms.length) return [];
    const estados = await this.d.executor.agentStates().catch(() => new Map<string, AgenteExecutor>());
    const out: { term: TerminalExecutor; estado: EstadoSessao }[] = [];
    for (const term of terms) {
      const tela = (await this.d.executor.readScreen(term.handle, 40)).join('\n');
      out.push({ term, estado: classificarTela(tela, estados.get(`${term.tabId}:${term.leafId}`), true) });
    }
    return out;
  }

  // Estado de um terminal específico: tela + estado do agente no Orca (via pasta → tabId:leafId).
  async estado(handle: string, pasta?: string, paraEnviar = false): Promise<LeituraSessao> {
    const tela = (await this.d.executor.readScreen(handle, 60)).join('\n');
    let agente: AgenteExecutor | undefined;
    if (pasta) {
      const t = (await this.d.executor.listTerminals(pasta).catch(() => [])).find((x) => x.handle === handle);
      if (t) agente = (await this.d.executor.agentStates().catch(() => new Map<string, AgenteExecutor>())).get(`${t.tabId}:${t.leafId}`);
    }
    return { estado: classificarTela(tela, agente, paraEnviar), tela, agente };
  }

  // Sessão do Claude ociosa na pasta (preferindo `preferida`); se não houver nenhuma, abre uma. null = avisou e espera.
  async ociosa(app: App, sel: Selecao, preferida?: string | null): Promise<TerminalExecutor | null> {
    const sessoes = await this.doApp(app.pasta);
    const ociosas = sessoes.filter((s) => s.estado === 'ocioso');
    const alvo = (ociosas.find((s) => s.term.handle === preferida) ?? ociosas[0])?.term;
    if (alvo) return alvo;
    if (sessoes.length) {
      const e = sessoes[0].estado;
      const motivo = e === 'limite' ? 'conta no limite de uso' : e === 'aguardando' ? 'a sessão está esperando você' : 'a sessão está ocupada';
      await this.tasks.avisar(sel, `fila_${e}`, cartao({ icone: ICONE.fila, titulo: this.tasks.tituloHtml(sel), contexto: [esc(app.app), `na fila: ${motivo}`] }));
      return null;
    }
    return this.abrir(app, sel);
  }

  private async abrir(app: App, sel: Selecao): Promise<TerminalExecutor | null> {
    const { executor, env, notificador } = this.d;
    // A aba desta task já existe e não virou uma sessão do Claude: o claude não abriu nela. Avisar em vez de abrir
    // outra aba a cada volta (eram três abas "hub #2" vazias).
    const aba = `hub #${sel.id}`;
    if ((await executor.listTerminals(app.pasta).catch(() => [])).some((t) => t.title === aba)) {
      await this.tasks.avisar(
        sel,
        'sessao_sem_claude',
        cartao({
          icone: ICONE.falha,
          titulo: `${esc(app.app)}: o Claude não abriu`,
          contexto: [`Veja a aba ${aba} no Orca. Feche a aba para eu tentar de novo`],
        }),
      );
      return null;
    }
    const claude = binClaude();
    const base = app.sessao_resume_id ? `${claude} --resume ${app.sessao_resume_id}` : temSessaoAnterior(app.pasta) ? `${claude} -c` : claude;
    // Login do GitHub do espaço (O5): o gh da sessão usa a conta certa para o PR.
    const gh = app.gh_config ? `GH_CONFIG_DIR=${app.gh_config} ` : '';
    const comando = `${gh}${base} --permission-mode ${env.HUB_CLAUDE_PERMISSAO}`;
    if (!/^(GH_CONFIG_DIR=\/[A-Za-z0-9/._-]+ )?(\/[A-Za-z0-9/._-]+\/)?claude( -c| --resume [A-Za-z0-9-]+)? --permission-mode [A-Za-z]+$/.test(comando))
      throw new Error(`comando inesperado: ${comando}`);
    await notificador.enviar(cartao({ icone: ICONE.sessao, titulo: `Abrindo o Claude em ${esc(app.app)}`, contexto: [`aba ${aba} no Orca`] }));
    // No servidor, antes do Claude, marca a pasta como confiável no Claude do agente (senão ele para perguntando).
    const linha = env.HUB_CONFIAR_PASTA_CMD ? `${env.HUB_CONFIAR_PASTA_CMD} && ${comando}` : comando;
    // Pasta do catálogo que o Orca ainda não conhece (servidor novo, pasta criada fora do hub): adiciona antes.
    if (!(await executor.listRepos()).some((r) => r.path === app.pasta)) await executor.addRepo(app.pasta);
    const handle = await executor.createTerminal(app.pasta, linha, aba);
    log.info('despacho: sessão aberta', { app: app.app, handle, comando });

    const limite = Date.now() + ESPERA_SESSAO_NOVA_MS;
    let estado: EstadoSessao = 'ocupado';
    while (Date.now() < limite) {
      await executor.waitIdle(handle, 15_000).catch(() => false);
      estado = (await this.estado(handle)).estado;
      if (estado !== 'ocupado') break;
    }
    if (estado === 'ocioso') {
      const t = (await executor.listTerminals(app.pasta)).find((x) => x.handle === handle);
      return t ?? ({ handle, title: `hub #${sel.id}` } as TerminalExecutor);
    }
    const titulo = this.tasks.tituloDe(sel);
    await this.tasks.avisar(
      sel,
      `nova_sessao_${estado}`,
      estado === 'aguardando'
        ? cartao({
            icone: ICONE.voce,
            titulo: `${esc(app.app)}: o Claude precisa de você`,
            contexto: [esc(curto(titulo, 60))],
            rodape: `Abra a sessão hub #${sel.id} no Orca e responda. Na primeira vez numa pasta ele pergunta se confia nela: escolha Yes. Depois a task segue sozinha.`,
          })
        : cartao({
            icone: ICONE.aviso,
            titulo: `${esc(app.app)}: a sessão do Claude não abriu`,
            contexto: [esc(curto(titulo, 60))],
            rodape: 'Tento de novo em instantes.',
          }),
    );
    return null;
  }
}
