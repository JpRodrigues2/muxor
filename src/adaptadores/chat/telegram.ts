// Notificador pelo Telegram: mensagens em HTML no chat do usuário, botões como InlineKeyboard.
import { InlineKeyboard, type Api } from 'grammy';
import type { Notificador, Teclado } from '../../aplicacao/portas.js';
import { errInfo, log } from '../../logger.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export function tecladoTelegram(t: Teclado): InlineKeyboard {
  return new InlineKeyboard(t.map((linha) => linha.map((b) => InlineKeyboard.text(b.texto, b.dado))));
}

export class NotificadorTelegram implements Notificador {
  constructor(
    private api: Api,
    private chatId: number,
  ) {}

  async enviar(html: string, teclado?: Teclado) {
    try {
      const m = await this.api.sendMessage(this.chatId, html, { ...HTML, ...(teclado ? { reply_markup: tecladoTelegram(teclado) } : {}) });
      return m.message_id;
    } catch (e) {
      log.error('telegram: falha ao enviar', errInfo(e));
      return null;
    }
  }

  async editar(msgId: number, html: string, teclado?: Teclado) {
    await this.api.editMessageText(this.chatId, msgId, html, { ...HTML, ...(teclado ? { reply_markup: tecladoTelegram(teclado) } : {}) }).catch(() => {});
  }

  async botoes(msgId: number, teclado?: Teclado) {
    await this.api.editMessageReplyMarkup(this.chatId, msgId, teclado ? { reply_markup: tecladoTelegram(teclado) } : undefined).catch(() => {});
  }
}

// Baixa um arquivo mandado no chat (foto ou documento).
export async function baixarArquivoTelegram(api: Api, token: string, fileId: string) {
  const f = await api.getFile(fileId);
  if (!f.file_path) throw new Error('Telegram não devolveu file_path');
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download do anexo falhou: HTTP ${res.status}`);
  return { conteudo: new Uint8Array(await res.arrayBuffer()), caminhoRemoto: f.file_path };
}
