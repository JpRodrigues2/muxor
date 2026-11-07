import { describe, expect, it } from 'vitest';
import { ACOES_POR_ETAPA, acaoValida } from '../../src/dominio/selecao.js';

describe('ações por etapa da seleção', () => {
  it('cancelar vale em todas as etapas', () => {
    for (const etapa of Object.keys(ACOES_POR_ETAPA)) expect(acaoValida(etapa, 'cancel')).toBe(true);
  });

  it('despachar só na confirmação', () => {
    expect(acaoValida('confirmar', 'desp')).toBe(true);
    expect(acaoValida('info', 'desp')).toBe(false);
  });

  it('etapa nula ou desconhecida recusa tudo (botão de pergunta antiga)', () => {
    expect(acaoValida(null, 'cancel')).toBe(false);
    expect(acaoValida('inexistente', 'cancel')).toBe(false);
  });
});
