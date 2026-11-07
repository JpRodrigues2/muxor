import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnosticar, formatarTexto, variaveisDoServico, type DepsDiagnostico } from '../../src/cli/diagnostico.js';
import type { Catalogo, Env } from '../../src/config.js';

const raiz = mkdtempSync(join(tmpdir(), 'hub-diag-'));
const pastaEspaco = join(raiz, 'FUNIFIER');
mkdirSync(join(pastaEspaco, 'app-a'), { recursive: true });
mkdirSync(join(raiz, 'dados', 'oauth'), { recursive: true });
writeFileSync(join(raiz, 'dados', 'oauth', 'funifier-pm.json'), '{}');

const env = { TELEGRAM_BOT_TOKEN: 'x'.repeat(30), TELEGRAM_CHAT_ID: '1', FUNIFIER_PM_MCP_URL: 'https://pm', ORCA_BIN: '/bin/sh', ORCA_ENVIRONMENT: undefined } as unknown as Env;
const cat = {
  espacos: [{ id: 'funifier', nome: 'Funifier', pasta: pastaEspaco, github: 'jp', gamificacao: true }],
  apps: [{ app: 'app-a', espaco: 'funifier', pasta: join(pastaEspaco, 'app-a'), regras: 'funifier', gamificacao: true }],
} as unknown as Catalogo;

function deps(o: Partial<DepsDiagnostico> = {}): DepsDiagnostico {
  return {
    modo: 'local',
    rodar: async (bin, args) =>
      bin === 'claude' && args[0] === 'auth' ? { ok: true, saida: '{"loggedIn": true}' } : { ok: true, saida: bin === 'git' ? 'git version 2.50' : '2.1.0 (Claude Code)' },
    env: {},
    carregarEnv: async () => env,
    carregarCatalogo: async () => cat,
    fontesDeRegras: () => [{ nome: 'funifier', titulo: 'Funifier' }],
    arquivoRegras: () => '/regras/funifier.md',
    caminhos: { dados: join(raiz, 'dados') } as DepsDiagnostico['caminhos'],
    arquivoEnv: '/hub/.env',
    statusOrca: async () => ({ ok: true, versao: '1.4.246' }),
    reposNoOrca: async () => [join(pastaEspaco, 'app-a')],
    telegram: async () => ({ ok: true, usuario: 'MeuBot' }),
    bnexo: async () => 'ok',
    jira: async () => 'ok',
    ...o,
  };
}

describe('muxor diagnostico', () => {
  it('instalação completa: nada falha e o resumo diz "Tudo certo"', async () => {
    const itens = await diagnosticar(deps());
    expect(itens.filter((i) => i.estado === 'falha' || i.estado === 'aviso')).toEqual([]);
    expect(itens.find((i) => i.nome === 'Bot')?.detalhe).toBe('@MeuBot');
    expect(formatarTexto(itens)).toMatch(/Tudo certo\.$/);
  });

  it('cada problema vem com o próximo passo', async () => {
    const itens = await diagnosticar(
      deps({
        carregarEnv: async () => {
          throw new Error('.env inválido — TELEGRAM_BOT_TOKEN: falta');
        },
        rodar: async (bin) => (bin === 'claude' ? { ok: false, saida: '' } : { ok: true, saida: 'git version 2.50' }),
      }),
    );
    const env = itens.find((i) => i.nome === '.env')!;
    expect(env).toMatchObject({ estado: 'falha', detalhe: '/hub/.env: TELEGRAM_BOT_TOKEN: falta' });
    expect(env.proximo).toMatch(/\.\/muxor init/);
    expect(itens.find((i) => i.nome === 'Claude Code')).toMatchObject({ estado: 'falha', proximo: expect.stringMatching(/pre-requisitos/) });
    // Sem .env, não tenta Telegram nem ferramentas, mas confere o catálogo.
    expect(itens.some((i) => i.grupo === 'Telegram')).toBe(false);
    expect(itens.some((i) => i.grupo === 'Espaços e projetos')).toBe(true);
    expect(formatarTexto(itens)).toMatch(/2 problema\(s\)/);
  });

  it('espaço sem conta do GitHub e pasta de projeto faltando viram aviso', async () => {
    const semConta = {
      ...cat,
      espacos: [{ ...cat.espacos[0], github: undefined }],
      apps: [...cat.apps, { app: 'sumiu', espaco: 'funifier', pasta: join(raiz, 'nao-existe') }],
    } as unknown as Catalogo;
    const itens = await diagnosticar(deps({ carregarCatalogo: async () => semConta }));
    expect(itens.find((i) => i.nome === 'Espaço Funifier')).toMatchObject({ estado: 'aviso', proximo: expect.stringMatching(/github-workspace/) });
    expect(itens.find((i) => i.nome === 'Pastas dos projetos')).toMatchObject({ estado: 'aviso', detalhe: expect.stringMatching(/sumiu/) });
  });

  it('Orca fechado e login do PM faltando', async () => {
    const itens = await diagnosticar(deps({ statusOrca: async () => ({ ok: false, estado: 'stopped' }), caminhos: { dados: join(raiz, 'outro') } as DepsDiagnostico['caminhos'] }));
    expect(itens.find((i) => i.nome === 'Orca')).toMatchObject({ estado: 'falha', proximo: 'Abra o app do Orca' });
    expect(itens.find((i) => i.nome === 'Funifier PM')).toMatchObject({ estado: 'falha', proximo: 'Mande /pm_login no Telegram' });
  });

  it('lê as variáveis do hub.service, inclusive as com espaço', () => {
    expect(variaveisDoServico('HUB_COFRE=arquivo-cifrado "HUB_GIT_COMO=sudo -n -u agente" HUB_BROKER=ligado')).toEqual({
      HUB_COFRE: 'arquivo-cifrado',
      HUB_GIT_COMO: 'sudo -n -u agente',
      HUB_BROKER: 'ligado',
    });
  });
});
