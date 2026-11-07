// Edita o .env do Muxor linha a linha: troca o valor da chave ou acrescenta no fim, mantendo comentários e a ordem.
// O arquivo tem segredos: sempre modo 600, e nada daqui vai para log ou tela.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function lerEnvArquivo(arquivo: string): Record<string, string> {
  if (!existsSync(arquivo)) return {};
  const out: Record<string, string> = {};
  for (const l of readFileSync(arquivo, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

export function gravarEnv(arquivo: string, valores: Record<string, string | null>) {
  const linhas = existsSync(arquivo) ? readFileSync(arquivo, 'utf8').replace(/\n$/, '').split('\n') : ['# .env do Muxor (gerado pelo muxor init). Tem segredos: não compartilhe.'];
  for (const [k, v] of Object.entries(valores)) {
    if (/[\n\r]/.test(v ?? '')) throw new Error(`valor de ${k} com quebra de linha`);
    const i = linhas.findIndex((l) => l.startsWith(`${k}=`));
    if (v === null) {
      if (i >= 0) linhas.splice(i, 1);
    } else if (i >= 0) linhas[i] = `${k}=${v}`;
    else linhas.push(`${k}=${v}`);
  }
  mkdirSync(dirname(arquivo), { recursive: true, mode: 0o700 });
  writeFileSync(arquivo, linhas.join('\n') + '\n', { mode: 0o600 });
  chmodSync(arquivo, 0o600);
}
