// Caso de uso: despachar. Uma task por vez por app.
//
// A cada 30 s e logo após cada "Despachar": para cada app com fila (ou continuação pedida) e sem despacho ativo,
// acha uma sessão do Claude ociosa na pasta (ou abre uma), escreve o prompt em runs/ e manda UMA linha apontando
// para ele. Depois o acompanhamento é do Monitor.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Gamificacao } from '../../config.js';
import type { Despacho, Seguimento } from '../../dominio/despacho.js';
import { FERRAMENTA_REAL } from '../../dominio/selecao.js';
import { errInfo, log } from '../../logger.js';
import { comVinculo, vincular } from '../../mensagens.js';
import { ICONE, campo, cartao, esc } from '../../msg.js';
import { baixarImagens, dirAnexos, escreverPrompt, escreverSeguimento, linhaDespacho, type TaskDoPrompt } from '../../prompt.js';
import { escreverCredenciaisDaTask } from '../../segredos.js';
import { relativo, type DepsDespacho, type Tasks } from './contexto.js';
import type { Monitor } from './monitorar.js';
import type { Sessoes } from './sessoes.js';

export class Despachar {
  private rodando = false;

  constructor(
    private d: DepsDespacho,
    private tasks: Tasks,
    private sessoes: Sessoes,
    private monitor: Monitor,
  ) {}

  enfileirar(selecaoId: number) {
    const app = this.d.despachos.enfileirar(selecaoId);
    if (!app) return;
    log.info('despacho: enfileirada', { selecaoId, app });
    void this.processar();
  }

  async processar() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      this.monitor.retomar();
      for (const app of this.d.despachos.appsComTrabalho()) {
        try {
          await comVinculo({}, () => this.processarApp(app));
        } catch (e) {
          log.error('despacho: falha ao processar app', { app, ...errInfo(e) });
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  private async processarApp(nomeApp: string) {
    const { despachos, selecoes, executor, notificador } = this.d;
    if (despachos.temAtivoNoApp(nomeApp)) return;

    // Continuação pedida pelo usuário (instrução/PR) passa na frente da fila: a sessão ainda tem o contexto.
    const seg = despachos.seguimentoNaFila(nomeApp);
    if (seg) return this.enviarSeguimento(seg);

    const fila = despachos.proximoDaFila(nomeApp);
    if (!fila) return;
    const sel = selecoes.obter(fila.selecaoId);
    if (!sel) return;
    vincular({ selecaoId: sel.id });
    const app = this.d.apps().find((a) => a.app === nomeApp);
    if (!app) {
      return this.tasks.avisar(
        sel,
        'app_inexistente',
        cartao({ icone: ICONE.falha, titulo: this.tasks.tituloHtml(sel), contexto: [esc(nomeApp), 'app não existe mais no apps.yaml'] }),
      );
    }
    // Sem gamificação vinculada é permitido (o usuário já foi avisado na seleção): a sessão decide o alvo.
    const gamifs = JSON.parse(sel.gamificacoes ?? '[]') as Gamificacao[];

    // 1–2. Sessão do Claude ociosa nessa pasta (ou abre uma).
    const alvo = await this.sessoes.ociosa(app, sel);
    if (!alvo) return;

    // 3. Monta o prompt (uma task ou o lote inteiro) e envia uma única linha.
    const lote = this.tasks.lote(sel);
    const tasks: TaskDoPrompt[] = [];
    for (const [i, s] of lote.entries()) {
      const task = await this.tasks.detalhe(s);
      tasks.push({ task, imagens: await baixarImagens(sel.id, task.imagens, lote.length > 1 ? `t${i + 1}-` : '') });
    }
    // Com o broker, a sessão usa as gamificações pelo MCP do hub e não recebe o arquivo de credenciais.
    const broker = this.d.env.HUB_BROKER === 'ligado';
    const credenciais = broker ? null : await escreverCredenciaisDaTask(this.d.cofre, sel.id, gamifs);
    const arquivo = escreverPrompt({
      credenciais,
      broker,
      selecaoId: sel.id,
      tasks,
      avulsa: !FERRAMENTA_REAL.has(sel.ferramenta),
      infoExtra: sel.info_extra,
      app,
      gamificacoes: gamifs,
      anexosUsuario: JSON.parse(sel.anexos ?? '[]'),
    });

    // Confere de novo logo antes de enviar (o usuário pode ter começado a usar a sessão).
    if ((await this.sessoes.estado(alvo.handle, app.pasta, true)).estado !== 'ocioso') {
      return this.tasks.avisar(sel, 'fila_ocupado', cartao({ icone: ICONE.fila, titulo: this.tasks.tituloHtml(sel), contexto: [esc(app.app), 'na fila: a sessão ficou ocupada'] }));
    }
    await executor.send(alvo.handle, linhaDespacho(arquivo));

    const despachoId = despachos.iniciar({
      filaId: fila.filaId,
      selecaoId: sel.id,
      app: app.app,
      pasta: app.pasta,
      handle: alvo.handle,
      tituloTerminal: alvo.title,
      arquivo,
    });
    log.info('despacho: enviado', { despachoId, selecaoId: sel.id, app: app.app, terminal: alvo.handle, tasks: lote.length });
    // 4. Ferramenta de gestão: task "em progresso" (B01). Só status, nunca comentário.
    const status = await this.tasks.moverStatus(sel, 'em_progresso');
    const anexos = tasks.reduce((n, t) => n + t.task.imagens.length, 0) + (JSON.parse(sel.anexos ?? '[]') as string[]).length;
    await notificador.enviar(
      cartao({
        icone: ICONE.rodando,
        titulo: this.tasks.tituloHtml(sel),
        contexto: [esc(app.app), 'rodando', status],
        corpo: [campo('Prompt', `<code>${esc(relativo(arquivo))}</code>`), anexos ? campo('Anexos', String(anexos)) : null],
      }),
    );

    // 5. Acompanhamento até o RESULTADO HUB.
    this.monitor.monitorar(despachoId);
  }

  private async enviarSeguimento(desp: Despacho) {
    const { despachos, selecoes, executor, notificador } = this.d;
    const sel = selecoes.obter(desp.selecao_id);
    if (!sel) return;
    vincular({ selecaoId: sel.id });
    const app = this.d.apps().find((a) => a.app === desp.app);
    const seg = JSON.parse(desp.seguimento ?? 'null') as Seguimento | null;
    if (!app || !seg) {
      despachos.desistirSeguimento(desp.id);
      await notificador.enviar(
        cartao({ icone: ICONE.falha, titulo: this.tasks.tituloHtml(sel), contexto: [esc(desp.app), !app ? 'o app sumiu do apps.yaml' : 'pedido inválido'] }),
      );
      return;
    }
    const alvo = await this.sessoes.ociosa(app, sel, desp.terminal_handle);
    if (!alvo) return;

    const rodada = desp.rodada + 1;
    const credenciais = join(dirAnexos(sel.id), 'credenciais.json');
    const arquivo = escreverSeguimento({
      selecaoId: sel.id,
      rodada,
      titulo: this.tasks.tituloDe(sel).replace(/^📦 /, ''),
      link: this.tasks.link(sel),
      app,
      anterior: JSON.parse(desp.resultado ?? '{}'),
      credenciais: existsSync(credenciais) ? credenciais : null,
      broker: this.d.env.HUB_BROKER === 'ligado',
      ...seg,
    });

    if ((await this.sessoes.estado(alvo.handle, app.pasta, true)).estado !== 'ocioso') {
      return this.tasks.avisar(sel, 'fila_ocupado', cartao({ icone: ICONE.fila, titulo: this.tasks.tituloHtml(sel), contexto: [esc(app.app), 'na fila: a sessão ficou ocupada'] }));
    }
    await executor.send(alvo.handle, linhaDespacho(arquivo));
    despachos.iniciarSeguimento({ id: desp.id, selecaoId: sel.id, rodada, arquivo, handle: alvo.handle, tituloTerminal: alvo.title });
    log.info('seguimento: enviado', { despachoId: desp.id, rodada, tipo: seg.tipo, terminal: alvo.handle });
    await notificador.enviar(
      cartao({
        icone: seg.tipo === 'pr' ? ICONE.pr : ICONE.rodando,
        titulo: this.tasks.tituloHtml(sel),
        contexto: [esc(app.app), seg.tipo === 'pr' ? 'abrindo PR' : 'rodando instrução', `rodada ${rodada}`],
        corpo: [campo('Prompt', `<code>${esc(relativo(arquivo))}</code>`)],
      }),
    );
    this.monitor.monitorar(desp.id);
  }
}
