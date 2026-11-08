import { describe, expect, it } from 'vitest';
import { ehConexaoOciosa } from '../../src/conexao-ociosa.js';

describe('conexão ociosa (Node 26, HTTP/2)', () => {
  it('reconhece o erro do undici quando o servidor fecha a sessão parada', () => {
    expect(ehConexaoOciosa(Object.assign(new Error('socket idle timeout'), { code: 'UND_ERR_INFO' }))).toBe(true);
    expect(ehConexaoOciosa(new Error('socket idle timeout'))).toBe(true);
  });
  it('outros erros continuam derrubando o processo', () => {
    expect(ehConexaoOciosa(new Error('ECONNREFUSED'))).toBe(false);
    expect(ehConexaoOciosa(null)).toBe(false);
  });
});
