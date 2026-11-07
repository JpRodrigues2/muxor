import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Orca } from '../../src/adaptadores/executor/orca.js';
import { ErroExecutor } from '../../src/aplicacao/portas.js';
import { AGENTES } from '../dominio/agentes.js';

// Um "orca" falso: grava os argumentos recebidos e responde o JSON pedido.
function orcaFalso(resposta: object) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-orca-'));
  const args = join(dir, 'args.txt');
  const bin = join(dir, 'orca');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\ncat <<'EOF'\n${JSON.stringify(resposta)}\nEOF\n`);
  chmodSync(bin, 0o755);
  return { bin, args: () => readFileSync(args, 'utf8').trim().split('\n') };
}

describe('Orca (adaptador Executor)', () => {
  it('no Mac: só --json', async () => {
    const f = orcaFalso({ ok: true, result: { repos: [] } });
    await new Orca(f.bin).listRepos();
    expect(f.args()).toEqual(['repo', 'list', '--json']);
  });

  it('no servidor: todo comando vai pelo pareamento do hub', async () => {
    const f = orcaFalso({ ok: true, result: { repos: [] } });
    await new Orca(f.bin, 'agente').listRepos();
    expect(f.args()).toEqual(['repo', 'list', '--environment', 'agente', '--json']);
  });

  it('status pelo pareamento ignora o desktop local (que não existe no servidor)', async () => {
    const f = orcaFalso({ ok: true, result: { app: { running: false }, runtime: { state: 'ready', reachable: true, appVersion: '1.4.246' } } });
    expect((await new Orca(f.bin, 'agente').status()).ok).toBe(true);
    expect((await new Orca(f.bin).status()).ok).toBe(false); // no Mac, o app precisa estar aberto
  });

  it('status sem o bloco "app" (servidor sem desktop)', async () => {
    const f = orcaFalso({ ok: true, result: { runtime: { state: 'ready', reachable: true, appVersion: '1.4.246' } } });
    expect(await new Orca(f.bin, 'agente').status()).toEqual({ ok: true, versao: '1.4.246', estado: 'ready' });
  });

  it('estado dos agentes: worktree ps com --agent-wait, por pane', async () => {
    const f = orcaFalso({ ok: true, result: { worktrees: [{ agents: [AGENTES.pergunta] }, { agents: [] }] } });
    const m = await new Orca(f.bin, 'agente').agentStates();
    expect(f.args()).toEqual(['worktree', 'ps', '--agent-wait', '--environment', 'agente', '--json']);
    expect(m.get(AGENTES.pergunta.paneKey)).toEqual({ estado: 'waiting', esperaHumano: true, pergunta: 'answer: Você prefere azul ou verde? (Azul · Verde)' });
  });

  it('erro do Orca vira ErroExecutor com o código', async () => {
    const f = orcaFalso({ ok: false, error: { code: 'timeout', message: 'timeout' } });
    await expect(new Orca(f.bin).readScreen('t')).rejects.toBeInstanceOf(ErroExecutor);
    expect(await new Orca(f.bin).waitIdle('t', 10)).toBe(false); // timeout = não ficou ocioso
  });
});
