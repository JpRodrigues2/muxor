// Listagem igual à do PM (B20): um projeto por mensagem, sprint, pai seguido das subtarefas na ordem do pai.
import { describe, expect, it } from 'vitest';
import type { Catalogo } from '../../src/config.js';
import type { Task } from '../../src/pm/types.js';
import { montarResumo } from '../../src/resumo.js';

const t = (id: string, o: Partial<Task> = {}): Task => ({
  ferramenta: 'funifier-pm',
  id,
  titulo: `Task ${id}`,
  projetoId: 'p1',
  projetoNome: 'Joga Junto',
  status: 'todo',
  categoria: 'pendente',
  prazo: null,
  link: null,
  ...o,
});
const cat = { espacos: [], apps: [{ app: 'jj', ferramenta: 'funifier-pm', projetos_na_ferramenta: ['p1'] }] } as unknown as Catalogo;

describe('listagem por projeto (B20)', () => {
  it('pai seguido das filhas na ordem do pai; órfãs embaixo do nome do pai; sprint no topo', () => {
    const tasks = [
      t('filha-2', { pai: { id: 'pai', titulo: 'Pai' }, ordem: 1, sprint: 'Novembro 2026' }),
      t('pai', { pai: null, sprint: 'Novembro 2026', categoria: 'em_progresso' }),
      t('filha-1', { pai: { id: 'pai', titulo: 'Pai' }, ordem: 0, sprint: 'Novembro 2026' }),
      t('orfa', { pai: { id: 'fora', titulo: 'Mensageria :: Ajustes' }, sprint: 'Novembro 2026' }),
      t('solta', { pai: null }),
    ];
    const [b] = montarResumo({ ferramentas: ['funifier-pm'], tasks, erros: [] }, cat, 'America/Sao_Paulo');
    expect(b.itens.map((i) => [i.idx, i.task.id])).toEqual([
      [1, 'pai'],
      [2, 'filha-1'],
      [3, 'filha-2'],
      [4, 'orfa'],
      [5, 'solta'],
    ]);
    const linhas = b.texto.split('\n');
    expect(linhas.findIndex((l) => l.includes('Novembro 2026'))).toBeLessThan(linhas.findIndex((l) => l.includes('<b>1.</b> ')));
    expect(b.texto).toMatch(/<b>1\.<\/b> Task pai\n\s+<i>🔵 em progresso<\/i>/);
    expect(b.texto).toMatch(/ {3}↳ <b>2\.<\/b> Task filha-1/);
    expect(b.texto).toMatch(/<b>Mensageria :: Ajustes<\/b>\n {3}↳ <b>4\.<\/b> Task orfa/);
    expect(b.texto).toMatch(/Joga Junto<\/b>\n<i>Funifier PM · Suas tasks · 5 tasks<\/i>/);
  });

  it('um bloco por projeto, numeração contínua; sem app avisa que configura ao iniciar', () => {
    const blocos = montarResumo(
      { ferramentas: ['funifier-pm'], tasks: [t('a'), t('b', { projetoId: 'p2', projetoNome: 'Outro' })], erros: [] },
      cat,
      'America/Sao_Paulo',
    );
    expect(blocos.map((b) => [b.texto.split('\n')[0], b.itens.map((i) => i.idx)])).toEqual([
      ['📋 <b>Joga Junto</b>', [1]],
      ['📋 <b>Outro</b>', [2]],
    ]);
    expect(blocos[1].texto).toMatch(/sem ambiente: configuro ao iniciar/);
    expect(blocos[0].texto).not.toMatch(/sem ambiente/);
  });

  it('ferramenta com erro ou sem tasks: um bloco com o aviso', () => {
    const blocos = montarResumo({ ferramentas: ['funifier-pm', 'jira'], tasks: [], erros: [{ ferramenta: 'jira', erro: 'token recusado' }] }, cat, 'America/Sao_Paulo');
    expect(blocos.map((b) => b.texto)).toEqual([expect.stringMatching(/Funifier PM[\s\S]*Nenhuma task aberta/), expect.stringMatching(/Jira[\s\S]*Não consegui buscar: token recusado/)]);
  });
});
