import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { confiarPasta } from '../../src/claude-confianca.js';
import { subiuDesde } from '../../src/cli/init/passos.js';

describe('pasta confiável no Claude', () => {
  it('acrescenta a marca e preserva o resto do ~/.claude.json', () => {
    const arq = join(mkdtempSync(join(tmpdir(), 'muxor-confia-')), '.claude.json');
    writeFileSync(arq, JSON.stringify({ numStartups: 9, projects: { '/outra': { allowedTools: ['x'] } } }));
    expect(confiarPasta('/proj', arq)).toBe(true);
    const d = JSON.parse(readFileSync(arq, 'utf8'));
    expect(d.numStartups).toBe(9);
    expect(d.projects['/outra']).toEqual({ allowedTools: ['x'] });
    expect(d.projects['/proj'].hasTrustDialogAccepted).toBe(true);
    expect(confiarPasta('/proj', arq)).toBe(false); // já confiável: não regrava
  });
  it('arquivo ilegível: não mexe', () => {
    const arq = join(mkdtempSync(join(tmpdir(), 'muxor-confia-')), '.claude.json');
    writeFileSync(arq, '{quebrado');
    expect(confiarPasta('/proj', arq)).toBe(false);
    expect(readFileSync(arq, 'utf8')).toBe('{quebrado');
  });
});

describe('Muxor ligado', () => {
  it('só conta o "bot online" desta subida', () => {
    const log = '{"ts":"2026-11-08T22:19:54.925Z","level":"info","msg":"hub: bot online"}\n';
    expect(subiuDesde(log, '2026-11-08T22:21:00.000Z')).toBe(false);
    expect(subiuDesde(log + '{"ts":"2026-11-08T22:23:20.939Z","level":"info","msg":"hub: bot online"}\n', '2026-11-08T22:21:00.000Z')).toBe(true);
  });
});
