// "Do you trust this folder?": na primeira vez numa pasta, o Claude Code pergunta e para até alguém responder no
// terminal (no celular, a aba do Orca fica em "Conversa ainda não encontrada"). As pastas do Muxor são as que você
// trouxe para ele no muxor init (e a sandbox, dele mesmo): o Muxor responde por você, marcando a pasta como confiável
// no ~/.claude.json, como o servidor já faz com o hub-confiar-pasta. Só acrescenta a marca; o resto fica como estava.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// HUB_CLAUDE_JSON: outro arquivo (os testes usam um temporário, para nunca mexer no ~/.claude.json de verdade).
export function confiarPasta(pasta: string, arquivo = process.env.HUB_CLAUDE_JSON ?? join(homedir(), '.claude.json')): boolean {
  let d: { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> } = {};
  if (existsSync(arquivo)) {
    try {
      d = JSON.parse(readFileSync(arquivo, 'utf8'));
    } catch {
      return false; // arquivo que não entendo: não mexo (o Claude pergunta, como sempre)
    }
  }
  const projeto = ((d.projects ??= {})[pasta] ??= {});
  if (projeto.hasTrustDialogAccepted) return false;
  projeto.hasTrustDialogAccepted = true;
  const tmp = `${arquivo}.muxor-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(d, null, 2));
  chmodSync(tmp, 0o600);
  renameSync(tmp, arquivo); // troca de uma vez: o Claude nunca lê o arquivo pela metade
  return true;
}
