// Bot do Telegram (grammY, long polling). Só aceita o chat do usuário (TELEGRAM_CHAT_ID):
// o bot controla terminais no computador, então qualquer outro chat é ignorado e registrado.
import { InlineKeyboard, type Bot } from 'grammy';
import { existsSync } from 'node:fs';
import { loadCatalogo, type Env } from './config.js';
import { contagens, type DB } from './db.js';
import { errInfo, log } from './logger.js';
import type { Cofre, Executor } from './aplicacao/portas.js';
import type { PmAdapter } from './pm/types.js';
import type { CasosDespacho } from './aplicacao/despacho/index.js';
import type { CasosSelecao } from './aplicacao/selecao/index.js';
import { baixarArquivoTelegram } from './adaptadores/chat/telegram.js';
import { Gamificacoes } from './gamificacoes.js';
import { limparRunsManual } from './limpeza.js';
import { LoginPm } from './login-pm.js';
import { instalarRegistro, limparMensagens } from './mensagens.js';
import { Projetos } from './projetos.js';
import { ConfirmadorTelegram } from './confirmacao.js';
import { Regras } from './regras.js';
import { NOME_FERRAMENTA } from './dominio/selecao.js';
import { ICONE, cartao } from './msg.js';
import { escapeHtml } from './resumo.js';

// Comandos (B42): na lista do Telegram, só os do dia a dia; os da Funifier só com ela no catálogo.
// Os usados raramente ficam no /menu, clicáveis. Todos continuam funcionando se digitados.
const PRINCIPAIS = [
  { command: 'tarefas', description: 'Suas tasks agora, para selecionar' },
  { command: 'nova', description: 'Atividade avulsa: /nova <instruções>' },
  { command: 'continuar', description: 'Próximos passos das tasks concluídas' },
];
const DA_FUNIFIER = [
  { command: 'gamificacoes', description: 'Gamificações e credenciais por app' },
  { command: 'pm_login', description: 'Conecta o Funifier PM pelo celular' },
];
export const DO_MENU = [
  { command: 'status', description: 'Orca, ferramentas, fila e despachos' },
  { command: 'projetos', description: 'Projetos que entram na listagem' },
  { command: 'regras', description: 'Regras de trabalho por espaço' },
  { command: 'limpar', description: 'Limpa a conversa' },
  { command: 'limpar_runs', description: 'Apaga os arquivos de instruções (runs/)' },
];
const MENU = { command: 'menu', description: 'Outros comandos e a legenda dos ícones' };

export function comandosDaLista(o: { funifier: boolean }) {
  return [...PRINCIPAIS, ...(o.funifier ? DA_FUNIFIER : []), MENU];
}

// A Funifier entra quando algum app usa as gamificações dela ou o Funifier PM.
export const temFunifier = () => loadCatalogo().apps.some((a) => a.gamificacao || a.ferramenta === 'funifier-pm');

const linhaComando = (c: { command: string; description: string }) => `/${c.command} — ${escapeHtml(c.description)}`;
const LEGENDA = [
  '<b>Ícones</b>',
  `${ICONE.rodando} rodando · ${ICONE.fila} na fila · ${ICONE.voce} precisa de você`,
  `${ICONE.ok} concluída · ${ICONE.revisao} revisar · ${ICONE.bloqueado} bloqueada`,
  `${ICONE.falha} interrompida · ${ICONE.aviso} aviso · ${ICONE.pergunta} espera resposta`,
];

export interface Deps {
  env: Env;
  db: DB;
  orca: Executor;
  cofre: Cofre;
  adapters: PmAdapter[];
  despacho: CasosDespacho;
  selecao: CasosSelecao;
}

// Liga os comandos, botões e mensagens do bot (criado no main.ts) aos casos de uso.
export function instalarBot(bot: Bot, deps: Deps) {
  const { env, db, cofre, despacho, selecao } = deps;

  // Filtro obrigatório de chat — o primeiro middleware, antes de qualquer handler.
  bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) === env.TELEGRAM_CHAT_ID) return next();
    log.warn('telegram: update de chat não autorizado ignorado', {
      chatId: ctx.chat?.id ?? null,
      chatType: ctx.chat?.type ?? null,
      fromId: ctx.from?.id ?? null,
      fromUsername: ctx.from?.username ?? null,
      updateType: Object.keys(ctx.update).filter((k) => k !== 'update_id'),
    });
  });

  // Registro das mensagens para o /limpar (depois do filtro de chat).
  instalarRegistro(bot, db);
  const chatId = Number(env.TELEGRAM_CHAT_ID);

  bot.command('start', (ctx) =>
    ctx.reply(
      cartao({
        icone: ICONE.lista,
        titulo: 'Hub de tasks',
        corpo: [comandosDaLista({ funifier: temFunifier() }).map(linhaComando).join('\n')],
      }),
      { parse_mode: 'HTML' },
    ),
  );

  bot.command('menu', (ctx) =>
    ctx.reply(
      cartao({
        icone: ICONE.lista,
        titulo: 'Outros comandos',
        corpo: [DO_MENU.map(linhaComando).join('\n'), '', ...LEGENDA],
      }),
      { parse_mode: 'HTML' },
    ),
  );

  bot.command('status', async (ctx) => {
    await ctx.replyWithChatAction('typing');
    await ctx.reply(await montarStatus(deps), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  const regras = new Regras(db, bot.api, chatId);
  const projetos = new Projetos(db, bot.api, chatId);
  const gamificacoes = new Gamificacoes(db, bot.api, chatId, cofre);
  const loginPm = new LoginPm(bot.api, chatId);
  selecao.configurar.cadastrarGamificacao = (app, selecaoId) => gamificacoes.iniciar(app, selecaoId);
  gamificacoes.onConcluido = () => selecao.configurar.proximaPergunta();
  const confirmador = new ConfirmadorTelegram(bot.api, chatId);
  selecao.configurar.onDespachar = (id) => despacho.despachar.enfileirar(id);

  bot.command('tarefas', async (ctx) => {
    const nomes = deps.adapters.map((a) => NOME_FERRAMENTA[a.nome] ?? a.nome);
    await ctx.reply(nomes.length ? `🔎 Buscando suas tasks no ${nomes.join(' e no ')}…` : '⚠️ Nenhuma ferramenta de gestão configurada. Use /nova para atividades avulsas.');
    if (!nomes.length) return;
    await selecao.resumo.enviar('manual');
  });

  bot.command('nova', (ctx) => selecao.configurar.criarAvulsa(ctx.match));
  bot.command('continuar', () => despacho.proximos.listarConcluidos());

  // /t3: marca ou desmarca a task 3 do último resumo, na própria linha (B20). O comando some do chat.
  bot.hears(/^\/t(\d{1,3})(?:@\w+)?$/, async (ctx) => {
    const r = await selecao.resumo.alternarPorNumero(Number(ctx.match[1]));
    await ctx.deleteMessage().catch(() => {});
    if (!/marcada$/.test(r)) await ctx.reply(r);
  });
  bot.command('projetos', () => projetos.comando());
  bot.command('regras', () => regras.comando());
  bot.command('gamificacoes', () => gamificacoes.comando());
  bot.command('pm_login', () => loginPm.comando());

  bot.command('limpar', (ctx) =>
    ctx.reply(cartao({ icone: ICONE.pergunta, titulo: 'Limpar a conversa?' }), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🧹 Limpar', 'l:ok').text('✖️ Cancelar', 'l:no'),
    }),
  );
  bot.command('limpar_runs', (ctx) =>
    ctx.reply(
      cartao({
        icone: ICONE.pergunta,
        titulo: 'Apagar quais arquivos de instruções?',
        contexto: ['prompts .md, mídias e anexos de runs/; credenciais ficam'],
        rodape: 'Os de tasks em andamento nunca são apagados.',
      }),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('Só das concluídas', 'u:concluidas')
          .text('Todos', 'u:todas')
          .row()
          .text('✖️ Cancelar', 'u:no'),
      },
    ),
  );

  bot.on('callback_query:data', async (ctx) => {
    const [tipo, a, b, c] = ctx.callbackQuery.data.split(':');
    let resposta = '';
    if (tipo === 't') resposta = await selecao.resumo.alternarItem(Number(a), Number(b));
    else if (tipo === 'r' && (b === 'go' || b === 'lote' || b === 'none'))
      resposta = await selecao.resumo.finalizar(Number(a), b);
    else if (tipo === 's') resposta = await selecao.configurar.onAcao(Number(a), b, c);
    else if (tipo === 'f') resposta = await despacho.proximos.onBotao(Number(a), b, c, ctx.callbackQuery.message!.message_id);
    else if (tipo === 'g') resposta = await regras.onBotao(a, b, ctx.callbackQuery.message!.message_id);
    else if (tipo === 'm') resposta = await gamificacoes.onBotao(a, b, c, ctx.callbackQuery.message!.message_id);
    else if (tipo === 'p') resposta = await projetos.alternar(Number(a), ctx.callbackQuery.message!.message_id);
    else if (tipo === 'k') resposta = await confirmador.onBotao(a, b, ctx.callbackQuery.message!.message_id);
    else if (tipo === 'l') {
      const msgId = ctx.callbackQuery.message!.message_id;
      if (a === 'ok') {
        await ctx.answerCallbackQuery({ text: 'Limpando…' }).catch(() => {});
        await limparMensagens(db, bot.api, chatId, msgId);
        return;
      }
      await bot.api.deleteMessage(chatId, msgId).catch(() => {});
      resposta = 'Cancelado';
    } else if (tipo === 'u') {
      const msgId = ctx.callbackQuery.message!.message_id;
      await bot.api.editMessageReplyMarkup(chatId, msgId).catch(() => {});
      if (a === 'concluidas' || a === 'todas') {
        const n = limparRunsManual(db, a);
        await ctx.reply(
          cartao({ icone: ICONE.ok, titulo: `${n} item(ns) apagado(s) de runs/`, contexto: [a === 'todas' ? 'todos, menos em andamento' : 'só das concluídas'] }),
          { parse_mode: 'HTML' },
        );
        resposta = 'Feito';
      } else resposta = 'Cancelado';
    }
    await ctx.answerCallbackQuery({ text: resposta.slice(0, 190) }).catch(() => {});
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return ctx.reply('Comando desconhecido. Use /start para ver os comandos.');
    if (await loginPm.onTexto(ctx.message.text, ctx.message.message_id)) return;
    // Conversas abertas por botão vêm antes da coleta de info das tasks.
    if (await gamificacoes.onTexto(ctx.message.text, ctx.message.message_id)) return;
    if (await regras.onTexto(ctx.message.text)) return;
    if (await despacho.proximos.onTexto(ctx.message.text)) return;
    if (!(await selecao.configurar.onTexto(ctx.message.text))) await ctx.reply('Não entendi. Use /status ou /tarefas.');
  });

  bot.on(['message:photo', 'message:document'], async (ctx) => {
    const m = ctx.message;
    const foto = m.photo?.at(-1); // maior resolução
    const fileId = foto?.file_id ?? m.document!.file_id;
    const nome = m.document?.file_name ?? `foto-${m.message_id}.jpg`;
    const anexo = { nome, baixar: () => baixarArquivoTelegram(bot.api, env.TELEGRAM_BOT_TOKEN, fileId) };
    if (!(await selecao.configurar.onAnexo(anexo, m.caption)))
      await ctx.reply('Só aceito anexos enquanto configuro uma task (etapa de instruções ou informação extra).');
  });

  bot.on('message', (ctx) => ctx.reply('Não entendi. Use /status ou /tarefas.'));

  bot.catch((err) => log.error('telegram: erro no handler', { ...errInfo(err.error), updateId: err.ctx.update.update_id }));

  return { confirmador };
}

async function montarStatus({ env, db, orca, adapters }: Deps): Promise<string> {
  const conexoes: string[] = [];
  let reposOrca: Set<string> | null = null;
  try {
    const st = await orca.status();
    conexoes.push(`${st.ok ? '🟢' : '🔴'} Orca ${escapeHtml(st.versao ?? '')} · ${escapeHtml(st.estado ?? '?')}`);
    reposOrca = new Set((await orca.listRepos()).map((r) => r.path));
  } catch (e) {
    conexoes.push(`🔴 Orca inacessível: ${escapeHtml((e as Error).message)}`);
  }
  for (const a of adapters) {
    try {
      conexoes.push(`🟢 ${a.nome} · ${escapeHtml(await a.ping())}`);
    } catch (e) {
      conexoes.push(`🔴 ${a.nome}: ${escapeHtml((e as Error).message)}`);
    }
  }

  const catalogo: string[] = [];
  try {
    const cat = loadCatalogo();
    const comProjeto = cat.apps.filter((a) => a.projetos_na_ferramenta.length > 0);
    catalogo.push(`${cat.apps.length} apps · ${comProjeto.length} ligados a projetos`);
    const semPasta = cat.apps.filter((a) => !existsSync(a.pasta)).map((a) => a.app);
    if (semPasta.length) catalogo.push(`${ICONE.aviso} pasta inexistente: ${escapeHtml(semPasta.join(', '))}`);
    if (reposOrca) {
      const foraOrca = comProjeto.filter((a) => !reposOrca!.has(a.pasta)).map((a) => a.app);
      if (foraOrca.length) catalogo.push(`${ICONE.aviso} fora do Orca: ${escapeHtml(foraOrca.join(', '))}`);
    }
    const semGamif = comProjeto.filter((a) => a.gamificacao && !a.gamificacoes?.length).length;
    if (semGamif) catalogo.push(`${semGamif} apps da Funifier sem gamificação vinculada (despacham com aviso)`);
  } catch (e) {
    catalogo.push(`🔴 ${escapeHtml((e as Error).message)}`);
  }

  const c = contagens(db);
  const trabalho = [
    `<b>Fila:</b> ${c.fila} · <b>aguardando despacho:</b> ${c.aguardandoDespacho}`,
    ...(c.emAndamento.length
      ? c.emAndamento.map((d) => `${d.estado === 'aguardando_usuario' ? ICONE.voce : d.estado === 'pausado_limite' ? ICONE.pausa : ICONE.rodando} ${escapeHtml(d.app)} · ${d.estado.replace('_', ' ')}`)
      : ['Nada rodando agora.']),
  ];

  return cartao({
    icone: ICONE.status,
    titulo: 'Status do hub',
    corpo: [
      '<b>Conexões</b>',
      ...conexoes,
      '',
      '<b>Trabalho</b>',
      ...trabalho,
      '',
      '<b>Catálogo</b>',
      ...catalogo,
    ],
    rodape: `Status nas ferramentas: ${env.HUB_ESCRITA_PM ? 'ligado' : 'desligado'} · comentários: ${env.HUB_COMENTARIOS_PM ? 'ligados' : 'só com comando'}`,
  });
}
