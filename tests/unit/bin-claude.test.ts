import { describe, expect, it } from 'vitest';
import { binClaude } from '../../src/aplicacao/despacho/sessoes.js';

describe('caminho do claude na sessão', () => {
  it('no Mac, o caminho completo (o terminal do Orca nem sempre tem ~/.local/bin no PATH)', () => {
    expect(binClaude('darwin', (p) => p === '/Users/a/.local/bin/claude', '/Users/a')).toBe('/Users/a/.local/bin/claude');
    expect(binClaude('darwin', (p) => p === '/opt/homebrew/bin/claude', '/Users/a')).toBe('/opt/homebrew/bin/claude');
    expect(binClaude('darwin', () => false, '/Users/a')).toBe('claude');
  });
  it('no servidor, só "claude" (a sessão roda com outro usuário)', () => {
    expect(binClaude('linux', () => true, '/home/hub')).toBe('claude');
  });
});
