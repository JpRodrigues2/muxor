// Caso de uso: acompanhar um despacho até o "### RESULTADO HUB".
//
// Um laço por despacho ativo: espera o TUI ficar ocioso (timeout 60 s) e lê o estado do agente e a tela.
//   ocupado                      → em_execucao
//   ocioso com RESULTADO HUB     → fechamento (Orca em revisão, histórico, mensagem com os próximos passos)
//   ocioso sem bloco / pergunta  → aguardando_usuario (aviso com as últimas linhas, no máx. 1 a cada 15 min)
//   limite de uso                → pausado_limite (aviso para trocar de conta)
//   terminal sumiu               → redescobre pela pasta; se não achar, interrompido
import { ativo, podeTransicionar, tagRodada, type Despacho, type EstadoDespacho, type ResultadoHub } from '../../dominio/despacho.js';
import { classificarTela, extrairResultado, ultimasLinhas } from '../../dominio/tela.js';
import { errInfo, log } from '../../logger.js';
import { comVinculo } from '../../mensagens.js';
import { ICONE, campo, cartao, curto, esc } from '../../msg.js';
import { apagarCredenciaisDaTask } from '../../segredos.js';
import { ErroExecutor } from '../portas.js';
import { dormirDe, type DepsDespacho, type Tasks } from './contexto.js';
import { tecladoFechamento } from './proximos-passos.js';
import type { LeituraSessao, Sessoes } from './sessoes.js';

const REPETIR_AVISO_MS = 15 * 60_000;

// O bloco vem da última mensagem do Claude (inteira, pelo Orca) e, sem ela, da tela.
function resultadoDa(l: LeituraSessao, tag: string) {
  return (l.agente?.ultimaMensagem && extrairResultado(l.agente.ultimaMensagem, tag)) || extrairResultado(l.tela, tag);
}

export class Monitor {
  // Chamado quando um despacho termina (concluído ou interrompido): libera a fila do app.
  aoLiberar: () => void = () => {};
  private monitorados = new Set<number>();
  private falhasTerminal = new Map<number, number>();
  private dormir: (ms: number) => Promise<void>;

  constructor(
    private d: DepsDespacho,
    private tasks: Tasks,
    private sessoes: Sessoes,
  ) {
    this.dormir = dormirDe(d);
  }

  // Depois de reiniciar o hub: volta a acompanhar o que estava ativo.
  retomar() {
    for (const id of this.d.despachos.ativos()) this.monitorar(id);
  }

  monitorar(despachoId: number) {
    if (this.monitorados.has(despachoId)) return;
    this.monitorados.add(despachoId);
    log.info('monitor: iniciado', { despachoId });
    const selecaoId = this.d.despachos.obter(despachoId)?.selecao_id;
    void comVinculo({ selecaoId }, () => this.laco(despachoId))
      .catch((e) => log.error('monitor: laço abortado', { despachoId, ...errInfo(e) }))
      .finally(() => this.monitorados.delete(despachoId));
  }

  // Quantos laços estão rodando (para os testes e o /status).
  get emAcompanhamento() {
    return this.monitorados.size;
  }

  private async laco(id: number) {
    await this.dormir(20_000); // dá tempo do Claude começar
    for (;;) {
      const d = this.d.despachos.obter(id);
      if (!d || !ativo(d.estado)) return;

      let leitura: LeituraSessao;
      try {
        if (!d.terminal_handle) throw new ErroExecutor('despacho sem terminal');
        // Lê antes de esperar: um terminal fechado falha na hora, sem gastar o timeout do wait.
        leitura = await this.sessoes.estado(d.terminal_handle, d.pasta);
        let ficouOcioso = false;
        if (leitura.estado === 'ocupado') {
          ficouOcioso = await this.d.executor.waitIdle(d.terminal_handle, 60_000);
          leitura = await this.sessoes.estado(d.terminal_handle, d.pasta);
        }
        this.falhasTerminal.delete(id);
        // Turno encerrado com o bloco de resultado na tela, mas com shell em segundo plano (ex.: servidor de dev):
        // a task acabou — o shell não é dela.
        if (
          leitura.estado === 'ocupado' &&
          classificarTela(leitura.tela, leitura.agente, true) === 'ocioso' &&
          resultadoDa(leitura, tagRodada(d.selecao_id, d.rodada))
        )
          leitura = { ...leitura, estado: 'ocioso' };
        if (leitura.estado === 'ocupado') {
          this.mudarEstado(d, 'em_execucao');
          if (ficouOcioso) await this.dormir(5_000); // TUI parado mas ainda trabalhando: evita laço apertado
          continue;
        }
      } catch (e) {
        if (!(e instanceof ErroExecutor)) throw e;
        const r = await this.redescobrir(d);
        if (r === 'interrompido') return;
        await this.dormir(r === 'ok' ? 1_000 : 30_000);
        continue;
      }

      const resultado = leitura.estado === 'ocioso' ? resultadoDa(leitura, tagRodada(d.selecao_id, d.rodada)) : null;
      if (resultado) {
        await this.concluir(d, resultado);
        this.aoLiberar();
        return;
      }

      const sel = this.d.selecoes.obter(d.selecao_id);
      const nome = sel ? this.tasks.tituloHtml(sel) : `#${d.selecao_id}`;
      if (leitura.estado === 'limite') {
        this.mudarEstado(d, 'pausado_limite');
        await this.avisar(
          d,
          'limite',
          cartao({
            icone: ICONE.pausa,
            titulo: nome,
            contexto: [esc(d.app), 'pausada: conta no limite de uso'],
            rodape: 'Troque de conta no Orca; eu retomo sozinho quando a sessão voltar a trabalhar.',
          }),
        );
        await this.dormir(60_000);
      } else {
        this.mudarEstado(d, 'aguardando_usuario');
        await this.avisar(
          d,
          'usuario',
          cartao({
            icone: ICONE.voce,
            titulo: nome,
            contexto: [esc(d.app), 'precisa de você no Orca'],
            corpo: [...(leitura.agente?.pergunta ? [`<b>${esc(curto(leitura.agente.pergunta, 300))}</b>`] : []), `<pre>${esc(ultimasLinhas(leitura.tela))}</pre>`],
          }),
        );
        await this.dormir(30_000);
      }
    }
  }

  private mudarEstado(d: Despacho, estado: EstadoDespacho) {
    if (d.estado === estado) return;
    if (!podeTransicionar(d.estado, estado)) {
      log.error('monitor: transição inválida', { despachoId: d.id, de: d.estado, para: estado });
      return;
    }
    // Voltou a trabalhar: o próximo pedido de atenção é um aviso novo.
    this.d.despachos.mudarEstado(d.id, estado, estado === 'em_execucao');
    log.info('monitor: estado', { despachoId: d.id, de: d.estado, para: estado });
    d.estado = estado;
  }

  private async avisar(d: Despacho, motivo: string, html: string) {
    const atual = this.d.despachos.ultimoAviso(d.id);
    const recente = atual.em && Date.now() - Date.parse(atual.em) < REPETIR_AVISO_MS;
    if (atual.motivo === motivo && recente) return;
    this.d.despachos.registrarAviso(d.id, motivo);
    await this.d.notificador.enviar(html);
  }

  // O handle mudou (Orca reiniciou) ou o terminal fechou.
  private async redescobrir(d: Despacho): Promise<'ok' | 'esperar' | 'interrompido'> {
    const { executor, despachos, notificador } = this.d;
    const orcaOk = await executor
      .status()
      .then((s) => s.ok)
      .catch(() => false);
    if (!orcaOk) return 'esperar'; // Orca fechado/reiniciando: não conclui nada ainda

    const sessoes = await this.sessoes.doApp(d.pasta).catch(() => []);
    let achado = sessoes.length === 1 ? sessoes[0].term : null;
    if (sessoes.length > 1) {
      const tag = tagRodada(d.selecao_id, d.rodada);
      for (const s of sessoes) {
        const tela = (await executor.readScreen(s.term.handle, 60).catch(() => [])).join('\n');
        if (new RegExp(`runs/${d.selecao_id}(-\\d+)?\\.md|task: #${tag.replace('.', '\\.')}\\b`).test(tela)) achado = s.term;
      }
    }
    if (achado) {
      despachos.trocarTerminal(d.id, achado.handle);
      log.info('monitor: terminal redescoberto', { despachoId: d.id, handle: achado.handle });
      return 'ok';
    }

    // Dá uma segunda chance (o Orca pode estar restaurando os terminais).
    const falhas = (this.falhasTerminal.get(d.id) ?? 0) + 1;
    this.falhasTerminal.set(d.id, falhas);
    if (falhas < 3) return 'esperar';

    despachos.interromper(d.id, d.selecao_id);
    this.falhasTerminal.delete(d.id);
    apagarCredenciaisDaTask(d.selecao_id);
    log.warn('monitor: despacho interrompido', { despachoId: d.id });
    const sel = this.d.selecoes.obter(d.selecao_id);
    await notificador.enviar(
      cartao({
        icone: ICONE.falha,
        titulo: sel ? this.tasks.tituloHtml(sel) : `#${d.selecao_id}`,
        contexto: [esc(d.app), 'interrompida: o terminal sumiu'],
        rodape: 'O Orca reiniciou ou a aba foi fechada. Veja o que ficou na branch e selecione a task de novo se precisar.',
      }),
    );
    this.aoLiberar();
    return 'interrompido';
  }

  private async concluir(d: Despacho, r: ResultadoHub) {
    const notas: string[] = [];

    // 1. Orca: worktree "em revisão" com o resumo.
    try {
      await this.d.executor.setWorktreeStatus(d.pasta, 'in-review', `hub #${d.selecao_id} (${r.status}): ${r.resumo ?? ''}`.slice(0, 500));
    } catch (e) {
      notas.push(`${ICONE.aviso} Orca: não marquei em revisão (${esc(curto((e as Error).message, 80))})`);
      log.warn('fechamento: falha no Orca', { despachoId: d.id, ...errInfo(e) });
    }

    // 2. Ferramenta de gestão: nada. A task continua "em progresso" até o usuário encerrar (B03/B04);
    //    comentário só com comando explícito dele (B02).

    // 3. Banco + histórico.
    this.d.despachos.concluir(d.id, d.selecao_id, r);
    log.info('fechamento: concluído', { despachoId: d.id, status: r.status });

    // 4. Mensagem com os próximos passos.
    const sel = this.d.selecoes.obter(d.selecao_id);
    const icone = r.status === 'concluido' ? ICONE.ok : r.status === 'bloqueado' ? ICONE.bloqueado : ICONE.revisao;
    const estado = { concluido: 'concluída', bloqueado: 'bloqueada', precisa_revisao: 'precisa de revisão' }[r.status] ?? r.status;
    const pendencias = r.pendencias && !/^nenhuma/i.test(r.pendencias) ? r.pendencias : null;
    const msgId = await this.d.notificador.enviar(
      cartao({
        icone,
        titulo: sel ? this.tasks.tituloHtml(sel) : `#${d.selecao_id}`,
        contexto: [esc(d.app), estado, d.rodada > 1 ? `rodada ${d.rodada}` : null],
        corpo: [
          esc(r.resumo ?? ''),
          '',
          r.arquivos ? campo('Arquivos', esc(r.arquivos)) : null,
          r.branch ? campo('Branch', `<code>${esc(r.branch)}</code>`) : null,
          pendencias ? campo('Pendências', esc(pendencias)) : null,
          ...notas,
        ],
        rodape: 'Revise no Orca e escolha o próximo passo.',
      }),
      tecladoFechamento(d.id),
    );
    if (msgId) this.d.despachos.guardarMsgFechamento(d.id, msgId);
  }
}
