// Caso de uso: próximos passos depois da conclusão.
//
// callback_data  f:<despacho>:i | pr | x | b:<idx> | bn | ok | xs | xn | no
//   💬 i  → espera um texto do usuário e manda como continuação para a mesma sessão (rodada N+1)
//   🔀 pr → pergunta a branch base (b), opcionalmente o nome da branch (bn), confirma (ok) e pede o PR ao Claude
//   ✅ x  → encerra o ciclo; com ferramenta de gestão, pergunta se marca a task como concluída (xs) ou não (xn)
import { branchDeTrabalho, nomeBranchValido, type Despacho, type ResultadoHub, type Seguimento } from '../../dominio/despacho.js';
import { NOME_FERRAMENTA, type Selecao } from '../../dominio/selecao.js';
import { log } from '../../logger.js';
import { vincular } from '../../mensagens.js';
import { ICONE, campo, cartao, esc } from '../../msg.js';
import { apagarCredenciaisDaTask } from '../../segredos.js';
import type { Teclado } from '../portas.js';
import { botao, type DepsDespacho, type Tasks } from './contexto.js';

// Conversa curta depois da conclusão (guardada na memória como pos_conversa): esperando texto da instrução,
// a branch base do PR ou a confirmação do PR.
interface PosConversa {
  despachoId: number;
  tipo: 'instrucao' | 'pr_base' | 'pr_confirmar' | 'pr_branch' | 'encerrar';
  msgId?: number;
  bases?: string[];
  base?: string;
  remoto?: string | null;
  branch?: string | null;
  novaBranch?: string;
}

const BASES_PREFERIDAS = ['main', 'master', 'develop', 'development', 'dev', 'homolog', 'homologacao', 'staging', 'release'];

export function tecladoFechamento(id: number): Teclado {
  return [[botao('💬 Dar instrução', `f:${id}:i`), botao('🔀 Abrir PR', `f:${id}:pr`)], [botao('✅ Encerrar', `f:${id}:x`)]];
}

const iconeDoStatus = (status: string | undefined) => (status === 'concluido' ? ICONE.ok : status === 'bloqueado' ? ICONE.bloqueado : ICONE.revisao);

export class ProximosPassos {
  constructor(
    private d: DepsDespacho,
    private tasks: Tasks,
    // Continuação pedida: o Despachar manda quando a sessão estiver livre.
    private aoPedirSeguimento: () => void,
  ) {}

  private conversa(): PosConversa | null {
    const v = this.d.memoria.obter('pos_conversa');
    return v ? (JSON.parse(v) as PosConversa) : null;
  }

  private async setConversa(c: PosConversa | null) {
    const atual = this.conversa();
    if (atual?.msgId && atual.msgId !== c?.msgId) await this.d.notificador.botoes(atual.msgId);
    this.d.memoria.guardar('pos_conversa', c ? JSON.stringify(c) : '');
  }

  // Branch de trabalho da task: a última citada nos resultados que não seja URL de PR. null = a sessão não informou.
  private branchDaTask(desp: Despacho, sel: Selecao): string | null {
    const atual = desp.resultado ? (JSON.parse(desp.resultado) as ResultadoHub).branch : undefined;
    return branchDeTrabalho([atual, ...this.d.despachos.branchesDoHistorico(sel.ferramenta, sel.task_id)]);
  }

  private ferramentasDe(reais: Selecao[]) {
    return [...new Set(reais.map((s) => NOME_FERRAMENTA[s.ferramenta]))].join('/');
  }

  // /continuar: reenvia os botões de próximos passos das últimas tasks concluídas.
  async listarConcluidos() {
    const { despachos, selecoes, notificador } = this.d;
    const ds = despachos.concluidosRecentes(5);
    if (!ds.length) {
      await notificador.enviar(cartao({ icone: ICONE.ok, titulo: 'Nada esperando próximos passos' }));
      return;
    }
    for (const desp of ds) {
      const sel = selecoes.obter(desp.selecao_id);
      if (!sel) continue;
      vincular({ selecaoId: sel.id });
      const r = JSON.parse(desp.resultado ?? '{}') as ResultadoHub;
      if (desp.msg_fechamento) await notificador.botoes(desp.msg_fechamento);
      const branch = this.branchDaTask(desp, sel);
      const msgId = await notificador.enviar(
        cartao({ icone: iconeDoStatus(r.status), titulo: this.tasks.tituloHtml(sel), contexto: [esc(desp.app), branch ? `<code>${esc(branch)}</code>` : null] }),
        tecladoFechamento(desp.id),
      );
      despachos.guardarMsgFechamento(desp.id, msgId);
    }
  }

  // Retorna o texto para a resposta do toque no botão.
  async onBotao(despachoId: number, acao: string, arg: string | undefined, msgId: number): Promise<string> {
    const { despachos, selecoes, notificador } = this.d;
    const desp = despachos.obter(despachoId);
    if (!desp) return 'Despacho não encontrado.';
    const sel = selecoes.obter(desp.selecao_id);
    if (!sel) return 'Task não encontrada.';
    vincular({ selecaoId: sel.id });
    const conv = this.conversa();
    const cancelar = [[botao('✖ Cancelar', `f:${desp.id}:no`)]];

    if (acao === 'i' || acao === 'pr' || acao === 'x') {
      if (desp.estado !== 'concluido' || desp.msg_fechamento !== msgId) return 'Esses botões já foram usados.';
      await notificador.botoes(msgId);
      if (acao === 'x') {
        const reais = this.tasks.reais(sel);
        if (!reais.length) {
          await this.encerrar(desp, sel, false);
          return 'Encerrado';
        }
        const onde = this.ferramentasDe(reais);
        const m = await notificador.enviar(
          cartao({
            icone: ICONE.pergunta,
            titulo: reais.length > 1 ? `Marcar as ${reais.length} tasks como concluídas no ${onde}?` : `Marcar como concluída no ${onde}?`,
            contexto: [this.tasks.tituloHtml(sel), 'encerrar'],
          }),
          [
            [botao('✔ Sim, concluir a task', `f:${desp.id}:xs`)],
            [botao('Não, só encerrar', `f:${desp.id}:xn`), botao('✖ Cancelar', `f:${desp.id}:no`)],
          ],
        );
        await this.setConversa({ despachoId: desp.id, tipo: 'encerrar', msgId: m ?? undefined });
        return 'Concluir a task?';
      }
      if (acao === 'i') {
        const m = await notificador.enviar(
          cartao({
            icone: ICONE.pergunta,
            titulo: 'Qual a instrução?',
            contexto: [this.tasks.tituloHtml(sel), esc(desp.app)],
            rodape: 'Mande em texto. Vai para a mesma sessão.',
          }),
          cancelar,
        );
        await this.setConversa({ despachoId: desp.id, tipo: 'instrucao', msgId: m ?? undefined });
        return 'Mande a instrução';
      }
      const remotas = await this.d.git.branchesRemotas(desp.pasta);
      const bases = BASES_PREFERIDAS.filter((b) => remotas.includes(b));
      const linhas: Teclado = [];
      bases.forEach((b, i) => {
        if (i % 3 === 0) linhas.push([]);
        linhas.at(-1)!.push(botao(b, `f:${desp.id}:b:${i}`));
      });
      const m = await notificador.enviar(
        cartao({
          icone: ICONE.pergunta,
          titulo: 'PR para qual branch?',
          contexto: [this.tasks.tituloHtml(sel), esc(desp.app)],
          rodape: bases.length ? 'Toque numa opção ou escreva o nome.' : 'Escreva o nome da branch.',
        }),
        [...linhas, ...cancelar],
      );
      await this.setConversa({ despachoId: desp.id, tipo: 'pr_base', msgId: m ?? undefined, bases });
      return 'Escolha a branch base';
    }

    if (!conv || conv.despachoId !== desp.id || conv.msgId !== msgId) return 'Essa pergunta já foi respondida.';
    if (acao === 'no') {
      await this.setConversa(null);
      if (desp.estado === 'concluido' && desp.msg_fechamento) await notificador.botoes(desp.msg_fechamento, tecladoFechamento(desp.id));
      await notificador.enviar(cartao({ icone: ICONE.cancelado, titulo: 'Cancelado', rodape: 'Os botões voltaram no resultado.' }));
      return 'Cancelado';
    }
    if ((acao === 'xs' || acao === 'xn') && conv.tipo === 'encerrar') {
      await this.setConversa(null);
      await this.encerrar(desp, sel, acao === 'xs');
      return 'Encerrado';
    }
    if (acao === 'b' && conv.tipo === 'pr_base') {
      const base = conv.bases?.[Number(arg)];
      if (!base) return 'Opção inválida.';
      await this.confirmarPr(desp, sel, base);
      return base;
    }
    if (acao === 'bn' && conv.tipo === 'pr_confirmar') {
      const m = await notificador.enviar(
        cartao({
          icone: ICONE.pergunta,
          titulo: 'Qual o nome da branch?',
          contexto: [this.tasks.tituloHtml(sel), conv.branch ? `hoje: <code>${esc(conv.branch)}</code>` : null],
          rodape: 'O Claude renomeia antes do push.',
        }),
        cancelar,
      );
      await this.setConversa({ ...conv, tipo: 'pr_branch', msgId: m ?? undefined });
      return 'Escreva o nome';
    }
    if (acao === 'ok' && conv.tipo === 'pr_confirmar') {
      await this.pedirSeguimento(desp, { tipo: 'pr', base: conv.base, remoto: conv.remoto, branch: conv.branch ?? null, novaBranch: conv.novaBranch });
      return 'PR pedido';
    }
    return 'Essa pergunta já foi respondida.';
  }

  // Texto livre do usuário: só vale quando há uma conversa de próximos passos aberta.
  async onTexto(texto: string): Promise<boolean> {
    const conv = this.conversa();
    if (!conv) return false;
    const desp = this.d.despachos.obter(conv.despachoId);
    const sel = desp && this.d.selecoes.obter(desp.selecao_id);
    if (!desp || !sel || desp.estado !== 'concluido') {
      await this.setConversa(null);
      return false;
    }
    vincular({ selecaoId: sel.id });
    const aviso = (titulo: string, rodape: string, contexto?: string[]) =>
      this.d.notificador.enviar(cartao({ icone: ICONE.aviso, titulo, contexto, rodape })).then(() => true);
    const t = texto.trim();

    if (conv.tipo === 'instrucao') {
      await this.pedirSeguimento(desp, { tipo: 'instrucao', instrucao: t, branch: this.branchDaTask(desp, sel) });
      return true;
    }
    if (conv.tipo === 'pr_base') {
      if (!nomeBranchValido(t)) return aviso('Nome de branch inválido', 'Escreva só o nome, ex.: develop.');
      const remotas = await this.d.git.branchesRemotas(desp.pasta);
      if (remotas.length && !remotas.includes(t)) return aviso(`Não achei ${esc(t)} no origin`, 'Confira o nome e mande de novo.', [esc(desp.app)]);
      await this.confirmarPr(desp, sel, t);
      return true;
    }
    if (conv.tipo === 'pr_branch') {
      if (!nomeBranchValido(t)) return aviso('Nome de branch inválido', 'Use letras, números, - _ . e /.');
      await this.confirmarPr(desp, sel, conv.base!, t);
      return true;
    }
    return aviso('Use os botões da última mensagem', 'Ou toque em Cancelar.');
  }

  private async confirmarPr(desp: Despacho, sel: Selecao, base: string, novaBranch?: string) {
    const branch = this.branchDaTask(desp, sel);
    const remoto = await this.d.git.remotoOrigin(desp.pasta);
    const de = novaBranch
      ? `<code>${esc(novaBranch)}</code>${branch && branch !== novaBranch ? ` (renomeando <code>${esc(branch)}</code>)` : ''}`
      : branch
        ? `<code>${esc(branch)}</code>`
        : 'branch de trabalho da task (nome não informado)';
    const m = await this.d.notificador.enviar(
      cartao({
        icone: ICONE.pr,
        titulo: 'Confirma o PR?',
        contexto: [this.tasks.tituloHtml(sel), esc(desp.app)],
        corpo: [campo('Repositório', `<code>${esc(remoto ?? 'origin')}</code>`), campo('De', de), campo('Para', `<code>${esc(base)}</code>`)],
        rodape: 'Push e PR, sem merge. O push pode pedir aprovação no Orca.',
      }),
      [
        [botao('✔ Confirmar', `f:${desp.id}:ok`), botao('✏️ Nome da branch', `f:${desp.id}:bn`)],
        [botao('✖ Cancelar', `f:${desp.id}:no`)],
      ],
    );
    await this.setConversa({ despachoId: desp.id, tipo: 'pr_confirmar', msgId: m ?? undefined, base, remoto, branch, novaBranch });
  }

  // Encerrar (B04): só marca a task como concluída na ferramenta de gestão se o usuário confirmou.
  private async encerrar(desp: Despacho, sel: Selecao, concluirTask: boolean) {
    const status = concluirTask ? await this.tasks.moverStatus(sel, 'concluida') : null;
    this.d.despachos.encerrar(desp.id, sel.id);
    apagarCredenciaisDaTask(sel.id);
    log.info('despacho: encerrado', { despachoId: desp.id, concluirTask });
    const reais = this.tasks.reais(sel);
    const continua = reais.length && !concluirTask ? `${this.ferramentasDe(reais)}: ${reais.length > 1 ? 'continuam' : 'continua'} em progresso` : null;
    await this.d.notificador.enviar(cartao({ icone: ICONE.ok, titulo: this.tasks.tituloHtml(sel), contexto: [esc(desp.app), 'encerrada', status ?? continua] }));
  }

  private async pedirSeguimento(desp: Despacho, seg: Seguimento) {
    await this.setConversa(null);
    this.d.despachos.pedirSeguimento(desp.id, seg);
    log.info('seguimento: enfileirado', { despachoId: desp.id, tipo: seg.tipo });
    // Sem mensagem própria: o "rodando" chega em seguida, ou o aviso de fila se a sessão estiver ocupada.
    this.aoPedirSeguimento();
  }
}
