// Peças do muxor init que mexem no computador: .env, registro de alterações, conta git por espaço, serviço do Mac
// e o /start do Telegram. O git roda de verdade, num ~/.gitconfig temporário (GIT_CONFIG_GLOBAL).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gravarEnv, lerEnvArquivo } from '../../src/cli/envfile.js';
import { lerEstado, registrar, salvarEstado } from '../../src/cli/estado.js';
import { aplicarContaGit, chaveInclude, conteudoGitconfig, removerContaGit } from '../../src/cli/init/git-espaco.js';
import { conteudoPlist } from '../../src/cli/init/servico-mac.js';
import { esperarDono } from '../../src/cli/init/telegram.js';

const raiz = mkdtempSync(join(tmpdir(), 'hub-init-'));

describe('muxor init: peças', () => {
  it('.env: troca, acrescenta e remove chaves mantendo comentários; modo 600', () => {
    const f = join(raiz, 'dados', '.env');
    gravarEnv(f, { A: '1', B: '2' });
    writeFileSync(f, readFileSync(f, 'utf8') + '# comentário\n');
    gravarEnv(f, { A: '10', C: '3', B: null });
    expect(lerEnvArquivo(f)).toEqual({ A: '10', C: '3' });
    expect(readFileSync(f, 'utf8')).toMatch(/# comentário/);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(() => gravarEnv(f, { X: 'a\nb' })).toThrow(/quebra de linha/);
  });

  it('registro de alterações não duplica e sobrevive a reabrir', () => {
    const f = join(raiz, 'instalacao.json');
    const e = lerEstado(f);
    registrar(e, { tipo: 'pasta', caminho: '/x' });
    registrar(e, { tipo: 'pasta', caminho: '/x' });
    salvarEstado(f, e);
    expect(lerEstado(f).alteracoes).toEqual([{ tipo: 'pasta', caminho: '/x' }]);
  });

  it('conta git do espaço: vale só dentro da pasta, e o desinstalar tira só a linha do Muxor', async () => {
    const global = join(raiz, 'gitconfig-global');
    // Como no Mac do João: o global força a conta pessoal no github.com e usa o Keychain.
    writeFileSync(global, '[user]\n\tname = Dono do Mac\n[credential]\n\thelper = osxkeychain\n[credential "https://github.com"]\n\tusername = conta-pessoal\n');
    process.env.GIT_CONFIG_GLOBAL = global;
    const pasta = join(raiz, 'EMPRESA');
    const repo = join(pasta, 'app');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['-C', repo, 'init', '-q']);
    const fora = join(raiz, 'outro');
    mkdirSync(fora);
    execFileSync('git', ['-C', fora, 'init', '-q']);

    const arquivo = join(raiz, 'git', 'empresa.gitconfig');
    const conta = { nome: 'JP Empresa', email: 'jp@empresa.com', usuario: 'conta-empresa', gh: '/opt/homebrew/bin/gh', ghConfig: join(raiz, 'gh', 'empresa') };
    const alt = await aplicarContaGit(arquivo, pasta, conta);
    await aplicarContaGit(arquivo, pasta, conta); // de novo: não duplica
    expect(alt.chave).toBe(chaveInclude(realpathSync(pasta)));
    const nome = (dir: string) => execFileSync('git', ['-C', dir, 'config', 'user.name']).toString().trim();
    expect(nome(repo)).toBe('JP Empresa');
    expect(nome(fora)).toBe('Dono do Mac');
    // Dentro do espaço: só o gh do espaço (o Keychain fica de fora) e o usuário da conta do espaço, não o pessoal.
    expect(execFileSync('git', ['-C', repo, 'config', '--get-urlmatch', 'credential.helper', 'https://github.com/org/repo']).toString().trim()).toMatch(/^!GH_CONFIG_DIR=.*auth git-credential$/);
    expect(execFileSync('git', ['-C', repo, 'config', '--get-urlmatch', 'credential.username', 'https://github.com/org/repo']).toString().trim()).toBe('conta-empresa');
    expect(execFileSync('git', ['-C', fora, 'config', '--get-urlmatch', 'credential.username', 'https://github.com/org/repo']).toString().trim()).toBe('conta-pessoal');
    expect(readFileSync(global, 'utf8').match(/includeIf/g)).toHaveLength(1);

    await removerContaGit(alt.chave, alt.valor);
    expect(nome(repo)).toBe('Dono do Mac');
    expect(readFileSync(global, 'utf8')).not.toMatch(/includeIf/);
    expect(readFileSync(global, 'utf8')).toMatch(/Dono do Mac/);
    delete process.env.GIT_CONFIG_GLOBAL;
  });

  it('gitconfig escapa aspas no nome', () => {
    expect(conteudoGitconfig({ nome: 'Ana "A"', email: 'a@b.c', usuario: 'ana', gh: '/gh', ghConfig: '/c' })).toMatch(/name = "Ana \\"A\\""/);
  });

  it('serviço do Mac: roda o código desta pasta com os dados em ~/.muxor', () => {
    const plist = conteudoPlist({ node: '/usr/local/bin/node', repo: '/Users/x/hub', log: '/Users/x/.hub/dados/logs/servico.log', ambiente: { HUB_DADOS_DIR: '/Users/x/.hub/dados', PATH: '/a&b' } });
    expect(plist).toMatch(/<string>\/Users\/x\/hub\/src\/main\.ts<\/string>/);
    expect(plist).toMatch(/<key>HUB_DADOS_DIR<\/key><string>\/Users\/x\/\.hub\/dados<\/string>/);
    expect(plist).toMatch(/\/a&amp;b/);
    expect(plist).toMatch(/<key>KeepAlive<\/key><true\/>/);
  });

  it('Telegram: o dono é quem manda a primeira mensagem privada; grupo não conta', async () => {
    const chamadas: string[] = [];
    let n = 0;
    const buscar = async (url: string) => {
      chamadas.push(url);
      n++;
      const result =
        n === 1
          ? [{ update_id: 5, message: { chat: { id: -100, type: 'group' } } }]
          : n === 2
            ? [{ update_id: 6, message: { chat: { id: 42, type: 'private', first_name: 'Ana' } } }]
            : [];
      return new Response(JSON.stringify({ ok: true, result }));
    };
    expect(await esperarDono('123:abc', 10_000, buscar)).toEqual({ chatId: 42, nome: 'Ana' });
    expect(chamadas[1]).toMatch(/offset=6/);
    expect(chamadas.at(-1)).toMatch(/offset=7/); // confirma a leitura: o Muxor não processa esse /start de novo
  });
});
