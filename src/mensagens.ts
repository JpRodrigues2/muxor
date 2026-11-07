// Registro das mensagens do chat (do bot e do usuário) para o /limpar (B10).
//
// Cada update do Telegram e cada laço em segundo plano roda dentro de um "vínculo" (AsyncLocalStorage);
// quem souber a que task/resumo a conversa pertence chama vincular(), e toda mensagem enviada ou
// recebida depois disso fica registrada com esse vínculo.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Api, Bot } from 'grammy';
import type { DB } from './db.js';
import { log } from './logger.js';

export interface Vinculo {
  selecaoId?: number;
  resumoId?: number;
}

const als = new AsyncLocalStorage<Vinculo>();
const LIMITE_TELEGRAM_MS = 48 * 3600_000; // o Telegram só deixa apagar mensagens com menos de 48 h

export function comVinculo<T>(v: Vinculo, fn: () => T): T {
  return als.run({ ...v }, fn);
}

export function vincular(v: Vinculo) {
  const s = als.getStore();
  if (s) Object.assign(s, v);
}

function registrar(db: DB, msgId: number, v: Vinculo) {
  db.prepare('INSERT OR REPLACE INTO mensagens (msg_id, selecao_id, resumo_id, criado_em) VALUES (?, ?, ?, ?)').run(
    msgId,
    v.selecaoId ?? null,
    v.resumoId ?? null,
    new Date().toISOString(),
  );
}

// Registra as mensagens enviadas pelo bot e as recebidas do usuário (chamar depois do filtro de chat).
export function instalarRegistro(bot: Bot, db: DB) {
  bot.api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    if (res.ok && /^send(Message|Photo|Document)$/.test(method)) {
      const id = (res.result as { message_id?: number }).message_id;
      if (id) registrar(db, id, { ...(als.getStore() ?? {}) });
    }
    return res;
  });
  bot.use((ctx, next) =>
    comVinculo({}, async () => {
      try {
        await next();
      } finally {
        if (ctx.message) registrar(db, ctx.message.message_id, { ...(als.getStore() ?? {}) });
      }
    }),
  );
}

// Limpa a conversa: apaga todas as mensagens que o Telegram permite (até 48 h), registradas ou não.
// Tenta a faixa de ids da mais antiga registrada até a atual: no chat privado os ids são sequenciais.
export async function limparMensagens(db: DB, api: Api, chatId: number, ateId: number) {
  const corte = new Date(Date.now() - LIMITE_TELEGRAM_MS + 60_000).toISOString();
  db.prepare('DELETE FROM mensagens WHERE criado_em <= ?').run(corte);
  const menor = (db.prepare('SELECT MIN(msg_id) m FROM mensagens').get() as { m: number | null }).m ?? ateId;
  const ids = Array.from({ length: Math.min(ateId - menor + 1, 5000) }, (_, i) => ateId - i).reverse();

  let apagadas = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    try {
      await api.deleteMessages(chatId, lote); // ids inexistentes são ignorados pelo Telegram
      apagadas += lote.length;
    } catch {
      for (const id of lote) if (await api.deleteMessage(chatId, id).then(() => true, () => false)) apagadas++;
    }
  }
  db.prepare('DELETE FROM mensagens').run();
  log.info('limpar: conversa', { faixa: ids.length, apagadas });
  return apagadas;
}
