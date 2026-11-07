// Cofre do Mac: itens "senha genérica" no Keychain (serviço HUB_KEYCHAIN_SERVICO, conta = id da credencial),
// pelo comando `security` do macOS. O valor é o JSON { api_key, secret }.
// Limite conhecido: `security add-generic-password -w` recebe o valor como argumento (visível no `ps` por um instante,
// só para o próprio usuário do Mac). O comando não tem entrada por stdin sem pedir interação.
import { execFile } from 'node:child_process';
import type { Cofre, Credencial } from '../../aplicacao/portas.js';

const SECURITY = '/usr/bin/security';

function security(args: string[]): Promise<string> {
  return new Promise((ok, falha) =>
    execFile(SECURITY, args, { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return falha(Object.assign(new Error(stderr.trim() || err.message), { code: (err as { code?: unknown }).code }));
      ok(stdout);
    }),
  );
}

// `security` sai com 44 quando o item não existe.
const naoExiste = (e: unknown) => (e as { code?: unknown }).code === 44;

export class CofreKeychain implements Cofre {
  constructor(private servico = 'hub-tasks') {}

  async obter(id: string) {
    try {
      return JSON.parse((await security(['find-generic-password', '-s', this.servico, '-a', id, '-w'])).trim()) as Credencial;
    } catch (e) {
      if (naoExiste(e)) return null;
      throw e;
    }
  }

  async salvar(id: string, c: Credencial) {
    await security(['add-generic-password', '-U', '-s', this.servico, '-a', id, '-l', `Muxor: ${id}`, '-w', JSON.stringify(c)]);
  }

  async remover(id: string) {
    try {
      await security(['delete-generic-password', '-s', this.servico, '-a', id]);
    } catch (e) {
      if (!naoExiste(e)) throw e;
    }
  }

  // Lista só os atributos dos itens (sem -d, o dump não traz os valores).
  async ids() {
    const dump = await security(['dump-keychain']);
    const ids: string[] = [];
    for (const bloco of dump.split(/^keychain: /m)) {
      if (!bloco.includes(`"svce"<blob>="${this.servico}"`)) continue;
      const conta = bloco.match(/"acct"<blob>="([^"]*)"/)?.[1];
      if (conta) ids.push(conta);
    }
    return ids;
  }
}
