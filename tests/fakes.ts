// Dublês comuns dos testes dos casos de uso.
import type { Notificador, Teclado } from '../src/aplicacao/portas.js';

// Chat que guarda as mensagens e as trocas de botões.
export class ChatFalso implements Notificador {
  mensagens: { id: number; html: string; teclado?: Teclado }[] = [];
  trocas: { msgId: number; teclado?: Teclado }[] = [];
  private n = 100;
  async enviar(html: string, teclado?: Teclado) {
    this.mensagens.push({ id: ++this.n, html, teclado });
    return this.n;
  }
  async botoes(msgId: number, teclado?: Teclado) {
    this.trocas.push({ msgId, teclado });
  }
  async editar(msgId: number, html: string, teclado?: Teclado) {
    const m = this.mensagens.find((x) => x.id === msgId);
    if (m) Object.assign(m, { html, teclado });
  }
  ultima() {
    return this.mensagens.at(-1)!;
  }
  dados(m: { teclado?: Teclado } = this.ultima()) {
    return (m.teclado ?? []).flat().map((b) => b.dado);
  }
  textos(m: { teclado?: Teclado } = this.ultima()) {
    return (m.teclado ?? []).flat().map((b) => b.texto);
  }
}

export async function ate(cond: () => boolean, ms = 3000) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error('condição não aconteceu a tempo');
    await new Promise((r) => setTimeout(r, 5));
  }
}
