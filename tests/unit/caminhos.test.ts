import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, dirSessoesClaude, lerCaminhos, resolverPasta } from '../../src/caminhos.js';

describe('lerCaminhos', () => {
  it('sem variáveis, reproduz a v1 (tudo na pasta do código)', () => {
    const c = lerCaminhos({});
    expect(c.dados).toBe(join(ROOT, 'data'));
    expect(c.runs).toBe(join(ROOT, 'runs'));
    expect(c.logs).toBe(join(ROOT, 'logs'));
    expect(c.regras).toBe(join(ROOT, 'regras'));
    expect(c.apps).toBe(join(ROOT, 'apps.yaml'));
    expect(c.repos).toBe(join(homedir(), 'Documents'));
    expect(c.claude).toBe(join(homedir(), '.claude'));
    expect(c.runsCompartilhado).toBe(false);
  });

  it('no servidor, separa dados do código', () => {
    const c = lerCaminhos({
      HUB_DADOS_DIR: '/home/hub/dados',
      HUB_RUNS_DIR: '/srv/hub/runs',
      HUB_REPOS_DIR: '/srv/hub/repos',
      HUB_CLAUDE_DIR: '/home/agente/.claude',
    });
    expect(c.dados).toBe('/home/hub/dados');
    expect(c.logs).toBe('/home/hub/dados/logs');
    expect(c.regras).toBe('/home/hub/dados/regras');
    expect(c.apps).toBe('/home/hub/dados/apps.yaml');
    expect(c.runs).toBe('/srv/hub/runs');
    expect(c.runsCompartilhado).toBe(true);
  });
});

describe('resolverPasta', () => {
  const c = lerCaminhos({ HUB_REPOS_DIR: '/srv/hub/repos' });
  it('relativa fica dentro dos repositórios', () => expect(resolverPasta('DAC/vista', c)).toBe('/srv/hub/repos/DAC/vista'));
  it('absoluta fica como está (v1)', () => expect(resolverPasta('/Users/x/Documents/DAC/vista', c)).toBe('/Users/x/Documents/DAC/vista'));
  it('não sai da pasta por acidente com ..', () => expect(resolverPasta('DAC/../FUNIFIER/a', c)).toBe('/srv/hub/repos/FUNIFIER/a'));
});

describe('dirSessoesClaude', () => {
  it('usa o ~/.claude configurado e o nome de pasta do Claude', () => {
    const c = lerCaminhos({ HUB_CLAUDE_DIR: '/home/agente/.claude' });
    expect(dirSessoesClaude('/srv/hub/repos/DAC/vista', c)).toBe('/home/agente/.claude/projects/-srv-hub-repos-DAC-vista');
  });
});
