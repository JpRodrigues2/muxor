import { describe, expect, it } from 'vitest';
import { enderecoJira } from '../../src/cli/init/passos.js';

describe('endereço do Jira', () => {
  it('completa a partir do nome, do domínio ou da URL', () => {
    expect(enderecoJira('minhaempresa')).toBe('https://minhaempresa.atlassian.net');
    expect(enderecoJira('MinhaEmpresa.atlassian.net')).toBe('https://minhaempresa.atlassian.net');
    expect(enderecoJira('https://minhaempresa.atlassian.net/jira/software/projects')).toBe('https://minhaempresa.atlassian.net');
    expect(enderecoJira('jira.minhaempresa.com.br')).toBe('https://jira.minhaempresa.com.br');
  });
  it('vazio ou com espaços: inválido', () => {
    expect(enderecoJira('')).toBe('');
    expect(enderecoJira('minha empresa')).toBe('');
  });
});

describe('token colado no lugar do endereço', () => {
  it('é recusado', () => {
    expect(enderecoJira('ATATT3xFfGF08n4e3JZsCDOZsWDVz9-nqI7nTVUWyYN3wreCWtlNTMFvyLeoPhWwlsAJY2PTuWZSjecNvuUS0cSBWGXFLM0E5vBkSKL5')).toBe('');
  });
});
