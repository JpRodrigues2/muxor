// Os programas de que o Muxor precisa no Mac (O19): confere cada um (com a versão mínima) e instala o que faltar,
// depois de uma confirmação. O que não pede senha baixa em segundo plano enquanto o muxor init segue; os passos que
// precisam de um programa esperam por ele (esperar). Tudo o que o Muxor instala fica registrado para o desinstalar.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { rodar } from '../diagnostico.js';

export type IdPrograma = 'gh' | 'claude' | 'orca' | 'tailscale' | 'ngrok';
export type ComoInstalou = 'brew' | 'brew-cask' | 'script-claude' | 'release-orca';

export const ORCA_APP = '/Applications/Orca.app';
export const TAILSCALE_APP = '/Applications/Tailscale.app';
export const TAILSCALE_BIN = `${TAILSCALE_APP}/Contents/MacOS/Tailscale`;

// Num Mac recém-instalado, o terminal do muxor init ainda não tem o Homebrew nem ~/.local/bin no PATH.
export function completarPath(env: NodeJS.ProcessEnv = process.env) {
  const extras = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', join(homedir(), '.local', 'bin')];
  const atual = (env.PATH ?? '').split(':').filter(Boolean);
  env.PATH = [...new Set([...atual, ...extras])].join(':');
}

// "1.4.246" ≥ "1.4.200"? Compara número por número; o que não é número é ignorado.
export function versaoMaiorOuIgual(atual: string, minima: string) {
  const n = (v: string) => (v.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  const [a, b] = [n(atual), n(minima)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

export interface Programa {
  id: IdPrograma;
  nome: string;
  paraQue: string;
  minima?: string;
  como: ComoInstalou;
  senha?: boolean; // o instalador pede a senha do Mac: roda em primeiro plano, com o terminal
  versao(): Promise<string | null>; // null: não instalado
}

const primeiraVersao = (s: string) => s.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null;
const versaoDe = async (bin: string, args = ['--version']) => {
  const r = await rodar(bin, args);
  return r.ok ? primeiraVersao(r.saida) : null;
};
const versaoDoApp = async (app: string) => {
  if (!existsSync(app)) return null;
  const r = await rodar('/usr/bin/defaults', ['read', join(app, 'Contents', 'Info'), 'CFBundleShortVersionString']);
  return r.ok ? r.saida.trim() : '0';
};

export const PROGRAMAS: Record<IdPrograma, Programa> = {
  gh: { id: 'gh', nome: 'GitHub CLI (gh)', paraQue: 'login do GitHub de cada espaço, sem chave SSH', como: 'brew', versao: () => versaoDe('gh') },
  claude: { id: 'claude', nome: 'Claude Code', paraQue: 'quem faz as tasks', como: 'script-claude', versao: () => versaoDe('claude') },
  orca: { id: 'orca', nome: 'Orca', paraQue: 'roda as sessões do Claude e mostra no celular', minima: '1.4.246', como: 'release-orca', versao: () => versaoDoApp(ORCA_APP) },
  tailscale: {
    id: 'tailscale',
    nome: 'Tailscale',
    paraQue: 'abrir no celular o front que roda neste Mac, só nos seus aparelhos',
    como: 'brew-cask',
    senha: true,
    versao: () => versaoDoApp(TAILSCALE_APP),
  },
  ngrok: { id: 'ngrok', nome: 'ngrok', paraQue: 'link público do seu front, para mostrar a outra pessoa', como: 'brew-cask', versao: () => versaoDe('ngrok', ['version']) },
};

export interface Situacao {
  p: Programa;
  versao: string | null;
  ok: boolean;
}

export async function conferir(ids: IdPrograma[]): Promise<Situacao[]> {
  return Promise.all(
    ids.map(async (id) => {
      const p = PROGRAMAS[id];
      const versao = await p.versao();
      return { p, versao, ok: versao !== null && (!p.minima || versaoMaiorOuIgual(versao, p.minima)) };
    }),
  );
}

export const brew = () => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(existsSync) ?? 'brew';

// Roda um comando com a saída no log (segundo plano) ou no terminal (primeiro plano, quando pede senha).
function executar(bin: string, args: string[], o: { log?: string; terminal?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<void>((ok, falhou) => {
    const saida = o.log ? createWriteStream(o.log, { flags: 'a' }) : null;
    const filho = spawn(bin, args, { stdio: o.terminal ? 'inherit' : ['ignore', 'pipe', 'pipe'], env: o.env ?? process.env });
    if (saida) {
      saida.write(`\n$ ${bin} ${args.join(' ')}\n`);
      filho.stdout?.pipe(saida, { end: false });
      filho.stderr?.pipe(saida, { end: false });
    }
    filho.on('error', falhou);
    filho.on('close', (codigo) => {
      saida?.end();
      codigo === 0 ? ok() : falhou(new Error(`${bin} terminou com erro ${codigo}${o.log ? ` (detalhes em ${o.log})` : ''}`));
    });
  });
}

// Orca: o release oficial do GitHub (o pacote "orca" do Homebrew é outro programa). Confere a assinatura e a
// notarização da Apple antes de pôr em /Applications.
export async function instalarOrca(log: string, destino = ORCA_APP) {
  if (destino === ORCA_APP && (await rodar('/usr/bin/pgrep', ['-x', 'Orca'])).ok && existsSync(ORCA_APP))
    throw new Error('o Orca está aberto. Atualize por ele (menu Orca → Check for Updates) e rode o muxor init de novo');
  const r = (await (await fetch('https://api.github.com/repos/stablyai/orca/releases/latest', { signal: AbortSignal.timeout(20_000) })).json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const padrao = process.arch === 'arm64' ? /^Orca-[\d.]+-arm64-mac\.zip$/ : /^Orca-[\d.]+-mac\.zip$/;
  const asset = r.assets.find((a) => padrao.test(a.name));
  if (!asset) throw new Error(`não achei o Orca para Mac no release ${r.tag_name}`);
  const pasta = mkdtempSync(join(tmpdir(), 'muxor-orca-'));
  try {
    const zip = join(pasta, asset.name);
    const res = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`download do Orca falhou (${res.status})`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    await executar('/usr/bin/ditto', ['-x', '-k', zip, pasta], { log });
    const app = join(pasta, 'Orca.app');
    await executar('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { log });
    await executar('/usr/sbin/spctl', ['--assess', '--type', 'execute', app], { log });
    rmSync(destino, { recursive: true, force: true });
    await executar('/usr/bin/ditto', [app, destino], { log });
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

export async function instalar(p: Programa, log: string) {
  completarPath();
  if (p.como === 'brew') return executar(brew(), ['install', p.id], { log, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } });
  if (p.como === 'brew-cask') {
    const cask = p.id === 'tailscale' ? 'tailscale-app' : p.id;
    // O Tailscale vem num .pkg: o Homebrew pede a senha do Mac no terminal.
    return executar(brew(), ['install', '--cask', cask], p.senha ? { terminal: true } : { log, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } });
  }
  if (p.como === 'script-claude') return executar('/bin/bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], { log });
  return instalarOrca(log);
}

// Fila de instalações em segundo plano. O Homebrew não instala duas coisas ao mesmo tempo: os de brew vão em fila;
// Claude Code e Orca correm em paralelo a ela.
export class Instalador {
  private tarefas = new Map<IdPrograma, Promise<void>>();
  private filaBrew: Promise<unknown> = Promise.resolve();
  constructor(
    private log: string,
    private aoInstalar: (p: Programa) => void,
  ) {}

  iniciar(p: Programa) {
    if (this.tarefas.has(p.id)) return this.tarefas.get(p.id)!;
    const rodarUm = async () => {
      await instalar(p, this.log);
      this.aoInstalar(p);
    };
    let t: Promise<void>;
    if (p.como.startsWith('brew')) {
      t = this.filaBrew.then(rodarUm, rodarUm);
      this.filaBrew = t.catch(() => {});
    } else t = rodarUm();
    t.catch(() => {}); // o erro aparece quando um passo esperar por ele
    this.tarefas.set(p.id, t);
    return t;
  }

  pendente(id: IdPrograma) {
    return this.tarefas.get(id);
  }
}
