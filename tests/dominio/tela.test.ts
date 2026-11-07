import { describe, expect, it } from 'vitest';
import { classificarTela, extrairResultado, ultimasLinhas } from '../../src/dominio/tela.js';
import { agenteDoOrca } from '../../src/adaptadores/executor/orca.js';
import { AGENTES } from './agentes.js';
import { TELAS, blocoResultado } from './telas.js';

const agente = (nome: keyof typeof AGENTES) => agenteDoOrca(AGENTES[nome]);

describe('classificarTela', () => {
  it('caixa de entrada vazia = ocioso', () => {
    expect(classificarTela(TELAS.ocioso)).toBe('ocioso');
  });

  it('spinner com "esc to interrupt" = ocupado', () => {
    expect(classificarTela(TELAS.ocupado)).toBe('ocupado');
  });

  it('diálogo de permissão = aguardando, mesmo com ❯ na tela', () => {
    expect(classificarTela(TELAS.permissao)).toBe('aguardando');
  });

  it('diálogo na tela tem prioridade sobre o agente "working" do Orca', () => {
    expect(classificarTela(TELAS.permissao, agente('trabalhando'))).toBe('aguardando');
  });

  it.each([TELAS.limite, TELAS.limite5h])('mensagem de limite = limite', (tela) => {
    expect(classificarTela(tela)).toBe('limite');
  });

  it('shell em segundo plano (pela tela): ocupado no acompanhamento, ocioso na hora de enviar', () => {
    expect(classificarTela(TELAS.shellRodando)).toBe('ocupado');
    expect(classificarTela(TELAS.shellRodando, undefined, true)).toBe('ocioso');
  });

  it('prompt do zsh sem a caixa do Claude não é ocioso', () => {
    expect(classificarTela(TELAS.zsh)).toBe('ocupado');
  });

  it('tela desconhecida ou vazia = ocupado (conservador: não envia)', () => {
    expect(classificarTela(TELAS.vazia)).toBe('ocupado');
    expect(classificarTela('algo inesperado')).toBe('ocupado');
  });

  it('só olha o fim da tela: um "usage limit reached" antigo na conversa não conta', () => {
    const antiga = ['Claude usage limit reached.', ...Array(20).fill('⏺ linha de conversa'), TELAS.ocioso].join('\n');
    expect(classificarTela(antiga)).toBe('ocioso');
  });
});

describe('classificarTela com o estado do agente no Orca (I2, capturas reais)', () => {
  // Tela vazia: o estado vem só do Orca.
  it('done = ocioso; working = ocupado', () => {
    expect(classificarTela('', agente('ocioso'))).toBe('ocioso');
    expect(classificarTela('', agente('trabalhando'))).toBe('ocupado');
    expect(classificarTela('', agente('trabalhando'), true)).toBe('ocupado');
  });

  it('pergunta esperando a pessoa = aguardando, com o texto da pergunta', () => {
    expect(classificarTela('', agente('pergunta'))).toBe('aguardando');
    expect(agente('pergunta').pergunta).toMatch(/azul ou verde/);
  });

  it('monitorando (shell em segundo plano): ocupado no acompanhamento, ocioso na hora de enviar', () => {
    expect(classificarTela('', agente('monitorando'))).toBe('ocupado');
    expect(classificarTela('', agente('monitorando'), true)).toBe('ocioso');
  });

  it('o limite de uso ainda vem da tela (o Orca não informa)', () => {
    expect(classificarTela(TELAS.limite, agente('ocioso'))).toBe('limite');
  });

  it('estado desconhecido do Orca: decide pela tela', () => {
    expect(classificarTela(TELAS.ocioso, { estado: 'outro' })).toBe('ocioso');
    expect(classificarTela(TELAS.zsh, { estado: 'outro' })).toBe('ocupado');
  });
});

describe('extrairResultado', () => {
  it('lê o bloco da última mensagem do Claude (markdown, sem quebras do terminal)', () => {
    const r = extrairResultado(agente('resultado').ultimaMensagem!, '999');
    expect(r).toMatchObject({ task: '#999', status: 'concluido', branch: 'teste-t3b', arquivos: 'a.ts, b.ts', pendencias: 'nenhuma' });
    expect(r!.resumo).toMatch(/^linha de teste longa.*longa$/);
  });

  it('bloco dentro de ``` termina no fechamento', () => {
    const msg = ['Pronto.', '', '```', '### RESULTADO HUB', 'task: #7', 'status: concluido', 'resumo: ok', 'pendencias: nenhuma', '```'].join('\n');
    expect(extrairResultado(msg, '7')?.pendencias).toBe('nenhuma');
  });

  it('lê os campos do bloco, juntando linhas quebradas pelo terminal', () => {
    expect(extrairResultado(blocoResultado('12'), '12')).toEqual({
      task: '#12',
      status: 'concluido',
      resumo: 'Ajustei o ranking e os testes passam.',
      arquivos: 'src/ranking.ts',
      branch: 'feat/ranking',
      pendencias: 'nenhuma',
    });
  });

  it('ignora o bloco de outra task ou de outra rodada', () => {
    expect(extrairResultado(blocoResultado('12'), '12.2')).toBeNull();
    expect(extrairResultado(blocoResultado('11'), '12')).toBeNull();
  });

  it('ignora o enunciado do formato (status com as opções)', () => {
    expect(extrairResultado(blocoResultado('12', 'concluido | bloqueado | precisa_revisao'), '12')).toBeNull();
  });

  it('usa o último bloco da tela', () => {
    const tela = [blocoResultado('12'), blocoResultado('12.2', 'bloqueado')].join('\n');
    expect(extrairResultado(tela, '12.2')?.status).toBe('bloqueado');
  });

  it('sem bloco = null', () => {
    expect(extrairResultado(TELAS.ocioso, '12')).toBeNull();
  });
});

describe('ultimasLinhas', () => {
  it('tira a caixa de entrada e o rodapé, e corta linhas longas', () => {
    const out = ultimasLinhas(['⏺ ' + 'x'.repeat(200), TELAS.ocioso].join('\n'));
    expect(out).not.toMatch(/─{5,}|auto mode/);
    expect(out.split('\n').every((l) => l.length <= 110)).toBe(true);
  });
});
