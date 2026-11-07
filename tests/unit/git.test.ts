import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comandoGit, gitEm, prepararPasta } from '../../src/git.js';

describe('comandoGit', () => {
  it('no Mac, git direto', () => {
    expect(comandoGit(['status'], undefined)).toEqual(['git', ['status']]);
  });

  it('no servidor, como o agente', () => {
    expect(comandoGit(['clone', '--', 'u', 'p'], 'sudo -n -u agente')).toEqual(['sudo', ['-n', '-u', 'agente', 'git', 'clone', '--', 'u', 'p']]);
  });
});

describe('prepararPasta', () => {
  it('cria a pasta com um git só local, sem remoto, e é idempotente', async () => {
    const pasta = join(mkdtempSync(join(tmpdir(), 'hub-git-')), 'DAC', 'novo-app');
    await prepararPasta(pasta);
    expect(existsSync(join(pasta, '.git'))).toBe(true);
    expect(await gitEm(pasta, ['remote'])).toBe('');
    await prepararPasta(pasta);
  });
});
