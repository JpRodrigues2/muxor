// Caso de uso: resumo com seleção. Lista as tasks das ferramentas de gestão (um projeto por mensagem, com a hierarquia
// da ferramenta, B20); embaixo de cada mensagem, um botão com caixinha por task (⬜/✅) para marcar, e no fim Iniciar.
//
// callback_data  t:<resumo>:<idx>         alterna ⬜/✅ da task (redesenha os botões da mensagem)
//                r:<resumo>:go|lote|none  "Iniciar selecionadas" / "Iniciar em lote" / "Nenhuma hoje"
// /t<idx>        o mesmo que o botão da task (atalho antigo)
//
// Lote: as tasks marcadas vão juntas, num só prompt e numa só sessão (a 1ª é a líder).
import { log, errInfo } from '../../logger.js';
import { vincular, comVinculo } from '../../mensagens.js';
import { ICONE, cartao, esc } from '../../msg.js';
import { dataLocal } from '../../pm/types.js';
import { dividirMensagem, marcador, montarResumo } from '../../resumo.js';
import type { Teclado } from '../portas.js';
import type { DepsSelecao } from './contexto.js';
import type { ConfigurarSelecao } from './configurar.js';

// Uma linha por task, com a caixinha; os botões de iniciar vão só na última mensagem com tasks.
function tecladoItens(resumoId: number, itens: { idx: number; titulo: string; selecionada: boolean }[], final: boolean): Teclado | undefined {
  const linhas: Teclado = itens.map((i) => [{ texto: `${i.selecionada ? '✅' : '⬜'} ${i.idx}. ${i.titulo.length > 40 ? i.titulo.slice(0, 39) + '…' : i.titulo}`, dado: `t:${resumoId}:${i.idx}` }]);
  if (final) linhas.push(...tecladoFinal(resumoId));
  return linhas.length ? linhas : undefined;
}

function tecladoFinal(resumoId: number): Teclado {
  return [
    [
      { texto: '▶️ Iniciar selecionadas', dado: `r:${resumoId}:go` },
      { texto: '📦 Em lote', dado: `r:${resumoId}:lote` },
    ],
    [{ texto: '💤 Nenhuma hoje', dado: `r:${resumoId}:none` }],
  ];
}

export class ResumoDiario {
  private enviando = false;

  constructor(
    private d: DepsSelecao,
    private configurar: ConfigurarSelecao,
  ) {}

  // Resumo diário: idempotente por dia (agendado no horário + verificação periódica de catch-up).
  async talvezResumoDiario(origem: 'agendado' | 'catch_up') {
    const agora = new Date();
    const hoje = dataLocal(agora, this.d.env.TZ_HUB);
    const hora = new Intl.DateTimeFormat('en-GB', { timeZone: this.d.env.TZ_HUB, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(agora);
    if (hora < this.d.env.RESUMO_HORARIO || this.d.memoria.obter('resumo_diario_data') === hoje) return;
    if (await this.enviar(origem)) this.d.memoria.guardar('resumo_diario_data', hoje);
  }

  async enviar(origem: 'agendado' | 'catch_up' | 'manual'): Promise<boolean> {
    return comVinculo({}, () => this.enviarInterno(origem));
  }

  private async enviarInterno(origem: 'agendado' | 'catch_up' | 'manual'): Promise<boolean> {
    if (this.enviando) return false;
    this.enviando = true;
    const { notificador, resumos } = this.d;
    try {
      const cat = this.d.catalogo.atual();
      const busca = await this.d.buscar();
      const filtro = this.d.filtrar(busca.tasks);
      const r = { ...busca, tasks: filtro.visiveis };
      if (!r.ferramentas.length) return false; // todas desligadas no /ferramentas
      if (r.erros.length === r.ferramentas.length) {
        await notificador.enviar(
          cartao({ icone: ICONE.falha, titulo: 'Não consegui buscar as tasks', corpo: r.erros.map((e) => `${esc(e.ferramenta)}: ${esc(e.erro)}`) }),
        );
        return false;
      }
      const resumoId = resumos.abrir(dataLocal(new Date(), this.d.env.TZ_HUB), origem);
      vincular({ resumoId });

      // Uma mensagem por ferramenta; a última com tasks selecionáveis leva também os botões Iniciar/Nenhuma.
      const blocos = montarResumo(r, cat, this.d.env.TZ_HUB, origem === 'manual' ? 'Suas tasks agora' : 'Resumo do dia');
      const selecionaveis = blocos.reduce((n, b) => n + b.itens.length, 0);
      const ultimoComBotoes = blocos.map((b) => b.itens.length > 0).lastIndexOf(true);
      const rodapes: string[] = [];
      if (filtro.ocultas.length) rodapes.push(`${filtro.ocultas.length} task(s) oculta(s) em ${filtro.projetosOcultos} projeto(s) desligado(s) — /projetos`);

      for (const [bi, bloco] of blocos.entries()) {
        const final = bi === ultimoComBotoes;
        const extras = [
          final ? 'Marque nas caixinhas e toque em Iniciar. Em lote manda as marcadas juntas, numa sessão só.' : null,
          ...(bi === blocos.length - 1 ? rodapes : []),
        ].filter(Boolean);
        const partes = dividirMensagem(extras.length ? `${bloco.texto}\n\n${extras.join('\n')}` : bloco.texto);
        let msgId: number | null = null;
        const msgDoItem = new Map<number, number>();
        for (let p = 0; p < partes.length; p++) {
          const ultima = p === partes.length - 1;
          const daParte = bloco.itens.filter((i) => partes[p].includes(marcador(i.idx)));
          const teclado = tecladoItens(
            resumoId,
            daParte.map((i) => ({ idx: i.idx, titulo: i.task.titulo, selecionada: false })),
            ultima && final,
          );
          const id = await notificador.enviar(partes[p], teclado);
          if (id === null) throw new Error('o Telegram não aceitou o resumo');
          for (const i of daParte) msgDoItem.set(i.idx, id);
          if (ultima) msgId = id;
        }
        for (const i of bloco.itens)
          resumos.adicionarItem(
            resumoId,
            { idx: i.idx, ferramenta: i.task.ferramenta, task_id: i.task.id, espaco: cat.apps.find((a) => a.app === i.app)?.espaco ?? '', app_sugerido: i.app },
            msgDoItem.get(i.idx) ?? msgId,
          );
        if (final) resumos.definirMsgBotoes(resumoId, msgId);
      }
      if (!selecionaveis) resumos.fechar(resumoId, 'nenhuma');
      log.info('resumo enviado', { resumoId, origem, tasks: r.tasks.length, selecionaveis, erros: r.erros.length });
      return true;
    } catch (e) {
      log.error('resumo: falha ao enviar', errInfo(e));
      return false;
    } finally {
      this.enviando = false;
    }
  }

  // Marca/desmarca e redesenha os botões da mensagem da task (⬜/✅). Retorna o texto para a resposta.
  async alternarItem(resumoId: number, idx: number): Promise<string> {
    const { resumos, notificador } = this.d;
    if (!resumos.aberto(resumoId)) return 'Essa lista já foi fechada. Use /tarefas para uma nova.';
    const r = resumos.alternar(resumoId, idx);
    if (!r) return `Não há task ${idx} nesta lista.`;
    await notificador.botoes(r.msgId, tecladoItens(resumoId, r.itens, resumos.msgBotoes(resumoId) === r.msgId));
    return r.marcada ? `Task ${idx} marcada` : `Task ${idx} desmarcada`;
  }

  // /t<idx>: vale para o último resumo aberto.
  async alternarPorNumero(idx: number): Promise<string> {
    const id = this.d.resumos.ultimoAberto();
    if (id === null) return 'Nenhum resumo aberto. Use /tarefas.';
    return this.alternarItem(id, idx);
  }

  async finalizar(resumoId: number, acao: 'go' | 'lote' | 'none'): Promise<string> {
    const { resumos, selecoes, notificador } = this.d;
    if (!resumos.aberto(resumoId)) return 'Esse resumo já foi fechado.';
    const marcadas = resumos.marcados(resumoId);
    if (acao !== 'none' && !marcadas.length) return 'Marque pelo menos uma task (ou toque em "Nenhuma hoje").';
    if (acao === 'lote' && marcadas.length < 2) return 'Lote precisa de pelo menos duas tasks.';
    if (acao === 'lote' && new Set(marcadas.map((m) => m.ferramenta)).size > 1) return 'Lote só com tasks da mesma ferramenta (roda num app só).';

    resumos.fechar(resumoId, acao === 'go' ? 'iniciado' : 'nenhuma');
    for (const m of resumos.mensagens(resumoId)) await notificador.botoes(m);
    if (acao === 'none') return '💤 Nenhuma task hoje';

    const novas: number[] = [];
    const repetidas: number[] = [];
    // No lote, o app da líder é o primeiro app sugerido entre as tasks (dá para trocar na etapa "destino").
    const appLote = marcadas.find((m) => m.app_sugerido)?.app_sugerido ?? null;
    let lider: number | null = null;
    for (const m of marcadas) {
      if (selecoes.emAndamento(m.ferramenta, m.task_id)) {
        repetidas.push(m.idx);
        continue;
      }
      const id = selecoes.criar({
        ferramenta: m.ferramenta,
        taskId: m.task_id,
        dataResumo: dataLocal(new Date(), this.d.env.TZ_HUB),
        app: acao === 'lote' ? appLote : m.app_sugerido,
        etapa: 'info',
        resumoId,
      });
      if (acao === 'lote') {
        if (lider === null) lider = id;
        else selecoes.atualizar(id, { lote_de: lider, etapa: null });
      }
      novas.push(m.idx);
    }
    if (repetidas.length)
      await notificador.enviar(cartao({ icone: ICONE.aviso, titulo: `Já em andamento: ${repetidas.join(', ')}`, rodape: 'Essas tasks foram ignoradas.' }));
    await this.configurar.proximaPergunta();
    if (acao === 'lote' && novas.length > 1) return `Configurando o lote de ${novas.length}`;
    return novas.length ? `Configurando ${novas.length} task(s)` : 'Nenhuma task nova';
  }
}
