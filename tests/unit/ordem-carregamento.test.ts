// O comando muxor (src/cli/index.ts) decide onde ficam os dados (~/.muxor/dados) e só depois carrega o resto. Se algo
// importado no topo dele carregar caminhos.ts antes disso, as pastas ficam erradas: o muxor init leu um catálogo
// vazio na pasta do código. Este teste segue os imports estáticos a partir do index.ts e barra caminhos.ts.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = join(import.meta.dirname, '..', '..');

function importsEstaticos(arquivo: string): string[] {
  const texto = readFileSync(arquivo, 'utf8');
  return [...texto.matchAll(/^import\s[^'"]*['"](\.[^'"]+)['"]/gm)].map((m) => resolve(dirname(arquivo), m[1].replace(/\.js$/, '.ts')));
}

describe('ordem de carregamento do comando muxor', () => {
  it('nada carregado no topo do src/cli/index.ts leva a caminhos.ts', () => {
    const vistos = new Set<string>();
    const fila = [join(raiz, 'src', 'cli', 'index.ts')];
    while (fila.length) {
      const f = fila.pop()!;
      if (vistos.has(f)) continue;
      vistos.add(f);
      fila.push(...importsEstaticos(f));
    }
    expect([...vistos].map((f) => f.slice(raiz.length + 1))).not.toContain('src/caminhos.ts');
  });
});
