// O instalador (O19) e o front-end no celular (O20): versão mínima, o registro que o install.sh deixa para o
// muxor init, a leitura do status do Tailscale e do token do ngrok, e o desinstalar tirando só a linha do Muxor.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { casaDoHub } from '../../src/cli/casa.js';
import { tirarLinha } from '../../src/cli/desinstalar.js';
import { lerEstado } from '../../src/cli/estado.js';
import { criarCtx } from '../../src/cli/init/contexto.js';
import { absorverInstalador, lerStatusTailscale, ngrokTemToken } from '../../src/cli/init/preparar.js';
import { completarPath, versaoMaiorOuIgual } from '../../src/cli/init/programas.js';

const raiz = mkdtempSync(join(tmpdir(), 'muxor-programas-'));

describe('instalador', () => {
  it('versão mínima compara número por número', () => {
    expect(versaoMaiorOuIgual('1.4.246', '1.4.246')).toBe(true);
    expect(versaoMaiorOuIgual('1.4.253', '1.4.246')).toBe(true);
    expect(versaoMaiorOuIgual('1.10.0', '1.4.246')).toBe(true);
    expect(versaoMaiorOuIgual('1.4.99', '1.4.246')).toBe(false);
    expect(versaoMaiorOuIgual('v2', '1.4')).toBe(true);
  });

  it('PATH ganha o Homebrew e ~/.local/bin sem repetir', () => {
    const env = { PATH: '/usr/bin:/opt/homebrew/bin' };
    completarPath(env);
    const partes = env.PATH.split(':');
    expect(partes.filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1);
    expect(partes.some((p) => p.endsWith('/.local/bin'))).toBe(true);
    expect(partes[0]).toBe('/usr/bin');
  });

  it('o registro do install.sh vira alterações do muxor init e o arquivo some', () => {
    const casa = casaDoHub(join(raiz, 'casa'));
    const ctx = criarCtx(casa, lerEstado(casa.estado));
    const arq = join(casa.raiz, 'instalador.txt');
    ctx.salvar();
    writeFileSync(arq, 'programa\thomebrew\tscript\nprograma\tnode\tbrew\nlinha-shell\t/x/.zprofile\texport PATH="$HOME/.local/bin:$PATH"\natalho\t/x/.local/bin/muxor\n');
    absorverInstalador(ctx);
    expect(lerEstado(casa.estado).alteracoes).toEqual([
      { tipo: 'programa', id: 'homebrew', como: 'script-homebrew' },
      { tipo: 'programa', id: 'node', como: 'brew' },
      { tipo: 'linha-shell', arquivo: '/x/.zprofile', linha: 'export PATH="$HOME/.local/bin:$PATH"' },
      { tipo: 'atalho', caminho: '/x/.local/bin/muxor' },
    ]);
    absorverInstalador(ctx); // sem o arquivo: nada muda
    expect(lerEstado(casa.estado).alteracoes).toHaveLength(4);
  });

  it('desinstalar tira só a linha do Muxor do ~/.zprofile', () => {
    const f = join(raiz, '.zprofile');
    const linha = 'export PATH="$HOME/.local/bin:$PATH"';
    writeFileSync(f, `alias x=y\n\n${linha}\nexport FOO=1\n`);
    tirarLinha(f, linha);
    expect(readFileSync(f, 'utf8')).toBe('alias x=y\nexport FOO=1\n');
  });
});

describe('front-end no celular', () => {
  it('status do Tailscale: conectado, nome do Mac e celulares da rede', () => {
    const s = lerStatusTailscale(
      JSON.stringify({
        BackendState: 'Running',
        Self: { HostName: 'mac', DNSName: 'mac.tail123.ts.net.' },
        Peer: { a: { HostName: 'iphone', OS: 'iOS' }, b: { HostName: 'vps', OS: 'linux' }, c: { HostName: 'pixel', OS: 'android' } },
      }),
    );
    expect(s).toEqual({ rodando: true, mac: 'mac.tail123.ts.net', celulares: ['iphone', 'pixel'] });
    expect(lerStatusTailscale('{"BackendState":"NeedsLogin"}')).toEqual({ rodando: false, mac: undefined, celulares: [] });
    expect(lerStatusTailscale('não é json')).toEqual({ rodando: false, celulares: [] });
  });

  it('ngrok: sabe se já tem o authtoken sem ler o valor para fora', () => {
    const f = join(raiz, 'ngrok.yml');
    writeFileSync(f, 'version: "3"\nagent:\n  authtoken: abc123\n');
    expect(ngrokTemToken(f)).toBe(true);
    writeFileSync(f, 'version: "3"\n');
    expect(ngrokTemToken(f)).toBe(false);
    expect(ngrokTemToken(join(raiz, 'nao-existe.yml'))).toBe(false);
  });
});
