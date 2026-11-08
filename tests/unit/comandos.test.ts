import { describe, expect, it } from 'vitest';
import { DO_MENU, comandosDaLista } from '../../src/telegram.js';

const nomes = (l: { command: string }[]) => l.map((c) => c.command);

describe('comandos do Telegram (B42)', () => {
  it('na lista, só os do dia a dia e o /menu', () => {
    expect(nomes(comandosDaLista({ funifier: false }))).toEqual(['tarefas', 'nova', 'continuar', 'menu']);
  });

  it('os da Funifier só com ela no catálogo', () => {
    expect(nomes(comandosDaLista({ funifier: true }))).toEqual(['tarefas', 'nova', 'continuar', 'gamificacoes', 'pm_login', 'menu']);
  });

  it('o /menu tem os usados raramente, sem repetir os da lista', () => {
    const lista = new Set(nomes(comandosDaLista({ funifier: true })));
    expect(nomes(DO_MENU)).toEqual(['status', 'ferramentas', 'projetos', 'regras', 'limpar', 'limpar_runs']);
    expect(nomes(DO_MENU).some((c) => lista.has(c))).toBe(false);
  });
});
