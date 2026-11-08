import { describe, expect, it } from 'vitest';
import { abertura, cor256, linhasArte, suportaCorReal } from '../../src/cli/arte.js';
import { ARTE } from '../../src/cli/arte-dados.js';

const semCor = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('abertura no terminal', () => {
  it('a arte tem 26 células por linha', () => {
    expect(ARTE.every((l) => l.split(' ').length === 26)).toBe(true);
    expect(linhasArte(false).every((l) => semCor(l).length === 26)).toBe(true);
  });

  it('por padrão só o nome; com a arte, o personagem à esquerda (e só o nome em terminal estreito)', () => {
    const padrao = semCor(abertura({ colunas: 120, real: false })).split('\n');
    expect(padrao.find((l) => l.includes('███╗   ███╗'))!.indexOf('█')).toBe(0);
    const larga = semCor(abertura({ colunas: 120, real: false, comArte: true })).split('\n');
    expect(larga.some((l) => l.includes('███╗   ███╗'))).toBe(true);
    expect(larga.find((l) => l.includes('███╗   ███╗'))!.indexOf('█')).toBeGreaterThanOrEqual(26);
    const estreita = semCor(abertura({ colunas: 60, real: false, comArte: true })).split('\n');
    expect(estreita.length).toBeLessThan(12);
  });

  it('cor de 24 bits só onde o terminal suporta; senão as 256 cores', () => {
    expect(suportaCorReal({ COLORTERM: 'truecolor' })).toBe(true);
    expect(suportaCorReal({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false);
    expect(abertura({ colunas: 120, real: false })).not.toMatch(/38;2;/);
    expect(cor256('faf92a')).toBe(226); // amarelo puro do xterm
    expect(cor256('000000')).toBe(16);
  });
});
