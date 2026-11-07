// Confirmação pelo Telegram para o broker: manda a pergunta com Permitir/Negar e segura a chamada até a resposta.
// Sem resposta no prazo, nega. Botões "k:<id>:sim|nao" (ligados no telegram.ts).
import { InlineKeyboard, type Api } from 'grammy';
import { randomBytes } from 'node:crypto';
import type { Confirmador } from './aplicacao/portas.js';
import { errInfo, log } from './logger.js';
import { ICONE, cartao } from './msg.js';

export class ConfirmadorTelegram implements Confirmador {
  private pendentes = new Map<string, (ok: boolean) => void>();

  constructor(
    private api: Api,
    private chatId: number,
    private prazoMs = 10 * 60_000,
  ) {}

  confirmar(pergunta: string): Promise<boolean> {
    const id = randomBytes(4).toString('hex');
    const resposta = new Promise<boolean>((ok) => this.pendentes.set(id, ok));
    const prazo = setTimeout(() => this.resolver(id, false), this.prazoMs);
    void resposta.then(() => clearTimeout(prazo));
    this.api
      .sendMessage(
        this.chatId,
        cartao({ icone: ICONE.pergunta, titulo: 'Confirmação do broker', corpo: [pergunta], rodape: `Sem resposta em ${Math.round(this.prazoMs / 60_000)} min, eu nego.` }),
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('✅ Permitir', `k:${id}:sim`).text('❌ Negar', `k:${id}:nao`) },
      )
      .catch((e) => {
        log.warn('broker: falha ao pedir confirmação', errInfo(e));
        this.resolver(id, false);
      });
    return resposta;
  }

  private resolver(id: string, ok: boolean) {
    const f = this.pendentes.get(id);
    if (!f) return false;
    this.pendentes.delete(id);
    f(ok);
    return true;
  }

  async onBotao(id: string, r: string, msgId: number): Promise<string> {
    await this.api.editMessageReplyMarkup(this.chatId, msgId).catch(() => {});
    if (!this.resolver(id, r === 'sim')) return 'Expirou: a chamada já foi negada';
    return r === 'sim' ? 'Permitido' : 'Negado';
  }
}
