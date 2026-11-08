// Todo pacote que o código importa precisa estar nas "dependencies" do package.json. Um pacote que só existe por
// tabela (dependência de uma ferramenta de desenvolvimento) funciona aqui e quebra na instalação do usuário, que roda
// npm ci --omit=dev.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = join(import.meta.dirname, '..', '..');
const deps = Object.keys(JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).dependencies ?? {});
const arquivos = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? arquivos(join(d, n)) : /\.(ts|mjs)$/.test(n) ? [join(d, n)] : []));

describe('dependências', () => {
  it('o código só importa pacotes declarados em dependencies', () => {
    const faltam = new Set<string>();
    for (const f of [...arquivos(join(raiz, 'src')), ...arquivos(join(raiz, 'bin'))]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"./][^'"]*)['"]/g)) {
        const nome = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
        if (nome.startsWith('node:') || builtinModules.includes(nome)) continue;
        if (!deps.includes(nome)) faltam.add(`${nome} (${f.slice(raiz.length + 1)})`);
      }
    }
    expect([...faltam]).toEqual([]);
  });
});
