// Cofre em memória, para os testes.
import type { Cofre, Credencial } from '../../aplicacao/portas.js';

export class CofreMemoria implements Cofre {
  private dados = new Map<string, Credencial>();

  async obter(id: string) {
    return this.dados.get(id) ?? null;
  }

  async salvar(id: string, c: Credencial) {
    this.dados.set(id, { ...c });
  }

  async remover(id: string) {
    this.dados.delete(id);
  }

  async ids() {
    return [...this.dados.keys()];
  }
}
