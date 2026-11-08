// Ferramentas de gestão na listagem: dá para tirar uma do /tarefas e do resumo diário pelo Telegram, sem desconectar
// (o login continua no .env). Desligada, o Muxor nem consulta a ferramenta.
//
// callback_data  fg:<nome>  liga/desliga a ferramenta na listagem
import { InlineKeyboard, type Api } from 'grammy';
import { getMeta, setMeta, type DB } from './db.js';
import { NOME_FERRAMENTA } from './dominio/selecao.js';
import { cartao } from './msg.js';
import type { PmAdapter } from './pm/types.js';

const CHAVE = 'ferramentas_ocultas';

export function ferramentasOcultas(db: DB): Set<string> {
  try {
    return new Set(JSON.parse(getMeta(db, CHAVE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function ferramentasVisiveis(db: DB, adapters: PmAdapter[]) {
  const ocultas = ferramentasOcultas(db);
  return adapters.filter((a) => !ocultas.has(a.nome));
}

export class Ferramentas {
  constructor(
    private db: DB,
    private api: Api,
    private chatId: number,
    private adapters: PmAdapter[],
  ) {}

  private teclado() {
    const ocultas = ferramentasOcultas(this.db);
    const kb = new InlineKeyboard();
    for (const a of this.adapters) kb.text(`${ocultas.has(a.nome) ? '⬜' : '✅'} ${NOME_FERRAMENTA[a.nome] ?? a.nome}`, `fg:${a.nome}`).row();
    return kb;
  }

  async comando() {
    if (!this.adapters.length) {
      await this.api.sendMessage(this.chatId, cartao({ titulo: 'Nenhuma ferramenta de gestão conectada', contexto: ['para conectar, rode muxor init --refazer ferramentas no Mac'] }), {
        parse_mode: 'HTML',
      });
      return;
    }
    await this.api.sendMessage(
      this.chatId,
      cartao({ titulo: 'Ferramentas na listagem', contexto: ['Toque para ligar ou desligar. Desligada some do /tarefas e do resumo, e continua conectada'] }),
      { parse_mode: 'HTML', reply_markup: this.teclado() },
    );
  }

  async alternar(nome: string, msgId: number): Promise<string> {
    if (!this.adapters.some((a) => a.nome === nome)) return 'Ferramenta não encontrada.';
    const ocultas = ferramentasOcultas(this.db);
    const desligar = !ocultas.has(nome);
    if (desligar) ocultas.add(nome);
    else ocultas.delete(nome);
    setMeta(this.db, CHAVE, JSON.stringify([...ocultas]));
    await this.api.editMessageReplyMarkup(this.chatId, msgId, { reply_markup: this.teclado() }).catch(() => {});
    return `${desligar ? 'Desligada' : 'Ligada'}: ${NOME_FERRAMENTA[nome] ?? nome}`;
  }
}

