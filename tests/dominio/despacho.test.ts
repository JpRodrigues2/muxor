import { describe, expect, it } from 'vitest';
import { ESTADOS_ATIVOS, ESTADOS_DESPACHO, TRANSICOES, ativo, podeTransicionar, sqlLista, tagRodada } from '../../src/dominio/despacho.js';

describe('máquina de estados do despacho', () => {
  it('todo estado tem entrada na tabela, e todo destino é um estado', () => {
    for (const e of ESTADOS_DESPACHO) {
      expect(TRANSICOES[e]).toBeDefined();
      for (const para of TRANSICOES[e]) expect(ESTADOS_DESPACHO).toContain(para);
    }
  });

  it('acompanhamento circula entre os estados ativos', () => {
    expect(podeTransicionar('em_execucao', 'aguardando_usuario')).toBe(true);
    expect(podeTransicionar('aguardando_usuario', 'pausado_limite')).toBe(true);
    expect(podeTransicionar('pausado_limite', 'em_execucao')).toBe(true);
  });

  it('encerrado e interrompido são finais', () => {
    for (const para of ESTADOS_DESPACHO.filter((e) => e !== 'encerrado')) expect(podeTransicionar('encerrado', para)).toBe(false);
    expect(podeTransicionar('interrompido', 'em_execucao')).toBe(false);
  });

  it('concluído só volta a rodar passando pela fila de seguimento', () => {
    expect(podeTransicionar('concluido', 'em_execucao')).toBe(false);
    expect(podeTransicionar('concluido', 'seguimento_fila')).toBe(true);
    expect(podeTransicionar('seguimento_fila', 'em_execucao')).toBe(true);
  });

  it('mesmo estado é idempotente; estado desconhecido não transiciona', () => {
    expect(podeTransicionar('concluido', 'concluido')).toBe(true);
    expect(podeTransicionar('aguardando_joao', 'em_execucao')).toBe(false);
  });

  it('ativos', () => {
    expect(ESTADOS_ATIVOS.every(ativo)).toBe(true);
    expect(ativo('concluido')).toBe(false);
  });
});

describe('auxiliares', () => {
  it('tagRodada: rodada 1 sem sufixo', () => {
    expect(tagRodada(12, 1)).toBe('12');
    expect(tagRodada(12, 3)).toBe('12.3');
  });

  it('sqlLista escapa aspas', () => {
    expect(sqlLista(['a', "b'c"])).toBe("'a', 'b''c'");
  });
});
