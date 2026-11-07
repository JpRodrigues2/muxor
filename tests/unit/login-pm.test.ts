import { describe, expect, it } from 'vitest';
import { acharEnderecoRetorno, extrairCodigoOAuth } from '../../src/pm/mcp-client.js';

describe('acharEnderecoRetorno (/pm_login)', () => {
  it('endereço completo', () => {
    expect(acharEnderecoRetorno('http://localhost:53682/callback?code=a&state=s')).toBe('http://localhost:53682/callback?code=a&state=s');
  });

  it('copiado do celular sem http://, com 127.0.0.1 ou com texto em volta', () => {
    expect(acharEnderecoRetorno('localhost:53682/callback?code=a')).toBe('http://localhost:53682/callback?code=a');
    expect(acharEnderecoRetorno('127.0.0.1:53682/callback?code=a')).toBe('http://127.0.0.1:53682/callback?code=a');
    expect(acharEnderecoRetorno('segue: localhost:53682/callback?code=a obrigado')).toBe('http://localhost:53682/callback?code=a');
  });

  it('ignora texto que não é o retorno do login', () => {
    expect(acharEnderecoRetorno('veja https://exemplo.com/callback?code=a')).toBeNull();
    expect(acharEnderecoRetorno('oi')).toBeNull();
  });
});

describe('extrairCodigoOAuth (/pm_login)', () => {
  it('pega o code do endereço de retorno colado', () => {
    expect(extrairCodigoOAuth(' http://localhost:53682/callback?code=abc123XYZ&state=s1 ')).toBe('abc123XYZ');
  });

  it('endereço sem code', () => {
    expect(extrairCodigoOAuth('http://localhost:53682/callback?state=s1')).toBeNull();
  });

  it('retorno com erro do servidor de login', () => {
    expect(() => extrairCodigoOAuth('http://localhost:53682/callback?error=access_denied')).toThrow(/access_denied/);
  });
});
