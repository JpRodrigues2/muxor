// Passo 1 do muxor init (O19) e o passo do front-end no celular (O20): o Muxor confere e instala sozinho o que falta,
// e guia só o que precisa da pessoa (senha do Mac, logins, permissões). Ver docs/onboarding.md §4.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { rodar } from '../diagnostico.js';
import type { Alteracao } from '../estado.js';
import { tela } from '../tela.js';
import type { Ctx } from './contexto.js';
import { completarPath, conferir, instalar, Instalador, PROGRAMAS, TAILSCALE_BIN, type IdPrograma, type Programa } from './programas.js';

export class Interrompido extends Error {}

export const ORCA_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca';
export const PAGINA_CELULAR = 'https://muxor.com.br/celular';
const GUIA = 'instalacao/pre-requisitos.md';
const NECESSARIOS: IdPrograma[] = ['gh', 'claude', 'orca', 'tailscale'];

let instalador: Instalador | null = null;

// O instalador do site (install.sh) anota o que instalou antes de o muxor init existir; aqui isso vira registro.
export function absorverInstalador(ctx: Ctx) {
  const arq = join(ctx.casa.raiz, 'instalador.txt');
  if (!existsSync(arq)) return;
  for (const linha of readFileSync(arq, 'utf8').split('\n')) {
    const [tipo, a, b] = linha.split('\t');
    if (tipo === 'programa' && a) ctx.registrar({ tipo: 'programa', id: a, como: b === 'script' ? 'script-homebrew' : 'brew' });
    else if (tipo === 'linha-shell' && a && b) ctx.registrar({ tipo: 'linha-shell', arquivo: a, linha: b });
    else if (tipo === 'atalho' && a) ctx.registrar({ tipo: 'atalho', caminho: a });
  }
  rmSync(arq);
}

const registroDe = (p: Programa): Alteracao => ({ tipo: 'programa', id: p.id, como: p.como });

export async function preRequisitos(ctx: Ctx) {
  completarPath();
  absorverInstalador(ctx);
  mkdirSync(ctx.casa.logs, { recursive: true });
  const log = join(ctx.casa.logs, 'instalacao.log');
  instalador ??= new Instalador(log, (p) => ctx.registrar(registroDe(p)));

  if (Number(process.version.slice(1).split('.')[0]) < 22) {
    tela.erro(`O Muxor precisa do Node 22 ou mais novo (você tem ${process.version}). Rode o instalador do site de novo: curl -fsSL https://muxor.com.br/install | bash`);
    throw new Interrompido();
  }
  if (!(await rodar('git', ['--version'])).ok) {
    tela.erro('Falta o git (as "Command Line Tools" da Apple). Rode xcode-select --install, aceite a janela e rode o muxor init de novo.');
    throw new Interrompido();
  }
  const situacao = await tela.esperando('Conferindo os programas de que o Muxor precisa…', () => conferir(NECESSARIOS), (s) => `${s.filter((x) => x.ok).length} de ${s.length} programas prontos`);
  const faltam = situacao.filter((s) => !s.ok);
  if (faltam.length) {
    const temBrew = existsSync('/opt/homebrew/bin/brew') || existsSync('/usr/local/bin/brew');
    if (!temBrew && faltam.some((s) => s.p.como.startsWith('brew'))) {
      tela.erro('Falta o Homebrew (instalador de programas do Mac). Rode o instalador do site, que cuida dele: curl -fsSL https://muxor.com.br/install | bash');
      throw new Interrompido();
    }
    tela.nota(
      [
        'Vou instalar:',
        ...faltam.map((s) => `  • ${s.p.nome}: ${s.p.paraQue}${s.versao ? ` (você tem a ${s.versao}; preciso da ${s.p.minima} ou mais nova)` : ''}`),
        '',
        ...(faltam.some((s) => s.p.senha) ? ['O Tailscale pede a senha do Mac (a mesma de entrar no Mac): ele instala uma VPN.'] : []),
        'O resto baixa em segundo plano enquanto você segue a configuração.',
      ].join('\n'),
      'Programas',
    );
    if (!(await tela.sim('Instalar agora?'))) {
      tela.info(`Sem eles o Muxor não funciona. Para instalar você mesmo, veja ${GUIA}; depois rode muxor init de novo.`);
      throw new Interrompido();
    }
    const orcaAberto = (await rodar('/usr/bin/pgrep', ['-x', 'Orca'])).ok;
    for (const s of faltam) {
      if (s.p.id === 'orca' && s.versao && orcaAberto) {
        tela.aviso(`O seu Orca (${s.versao}) é antigo para o Muxor. Atualize por ele: menu Orca → Check for Updates. Confiro de novo quando chegar a vez dele.`);
        continue;
      }
      if (!s.p.senha && !s.p.como.startsWith('brew')) instalador.iniciar(s.p);
    }
    for (const s of faltam.filter((x) => x.p.senha)) {
      tela.info(`Instalando o ${s.p.nome}. Quando aparecer "Password:", digite a senha do Mac (ela não aparece enquanto você digita) e aperte Enter.`);
      try {
        await instalar(s.p, log);
        ctx.registrar(registroDe(s.p));
        tela.ok(`${s.p.nome} instalado.`);
      } catch (e) {
        tela.aviso(`${s.p.nome}: ${(e as Error).message}. Tento de novo no passo do front-end.`);
      }
    }
    for (const s of faltam) if (s.p.como === 'brew' || (s.p.como === 'brew-cask' && !s.p.senha)) instalador.iniciar(s.p);
    const fundo = faltam.filter((s) => instalador!.pendente(s.p.id));
    if (fundo.length) tela.ok(`Instalando em segundo plano: ${fundo.map((s) => s.p.nome).join(', ')}. O registro fica em ${log}.`);
  } else tela.ok('GitHub CLI, Claude Code, Orca e Tailscale instalados.');

  if (!ctx.estado.passos.appsCelular) {
    await tela.link(PAGINA_CELULAR, 'No celular: instale o Telegram, o Orca e o Tailscale (leia o QR code)', { qr: true });
    ctx.estado.passos.appsCelular = new Date().toISOString();
    ctx.salvar();
  }
}

// Um passo que precisa de um programa espera a instalação dele terminar (ou confere, se já estava instalado).
export async function esperar(id: IdPrograma) {
  completarPath();
  const p = PROGRAMAS[id];
  const t = instalador?.pendente(id);
  if (t) {
    try {
      await tela.esperando(`Terminando de instalar o ${p.nome}…`, () => t, () => `${p.nome} instalado`);
    } catch (e) {
      tela.erro(`Não consegui instalar o ${p.nome}: ${(e as Error).message}`);
      tela.info(`Como instalar à mão: ${GUIA}. Depois rode muxor init de novo: eu continuo daqui.`);
      throw new Interrompido();
    }
  }
  const [s] = await conferir([id]);
  if (!s.ok) {
    tela.erro(s.versao ? `O ${p.nome} ${s.versao} é antigo: preciso da ${p.minima} ou mais nova.` : `Falta o ${p.nome}.`);
    tela.info(`Rode muxor init de novo para eu instalar (ou veja ${GUIA}).`);
    throw new Interrompido();
  }
}

export async function claudeComLogin() {
  await esperar('claude');
  const logado = async () => /"loggedIn":\s*true/.test((await rodar('claude', ['auth', 'status'])).saida);
  if (await logado()) return;
  tela.info('Falta entrar no Claude Code com a sua conta (a assinatura que ele vai usar). Vou abrir o login no navegador.');
  await new Promise<void>((ok) => spawn('claude', ['auth', 'login'], { stdio: 'inherit' }).on('close', () => ok()));
  if (!(await logado())) {
    tela.erro('O Claude Code continua sem login. Rode `claude` num terminal, entre com a sua conta e rode muxor init de novo.');
    throw new Interrompido();
  }
  tela.ok('Claude Code com login.');
}

export async function orcaAberto() {
  await esperar('orca');
  for (;;) {
    const s = await rodar(ORCA_BIN, ['status', '--json']);
    if (s.ok && /"reachable":\s*true/.test(s.saida)) break;
    tela.aviso('O Orca precisa estar aberto. Vou abri-lo agora. Na primeira vez o Mac pergunta se quer abrir um app baixado da internet: clique em Abrir.');
    await rodar('open', ['-a', 'Orca']);
    await tela.enter('Quando a janela do Orca aparecer, aperte Enter');
  }
  tela.ok('Orca aberto.');
}

// ───────────────────────── Front-end no celular (O20) ─────────────────────────

interface EstadoTailscale {
  rodando: boolean;
  mac?: string;
  celulares: string[];
}

export function lerStatusTailscale(json: string): EstadoTailscale {
  try {
    const d = JSON.parse(json) as { BackendState?: string; Self?: { HostName?: string; DNSName?: string }; Peer?: Record<string, { HostName?: string; OS?: string }> };
    return {
      rodando: d.BackendState === 'Running',
      mac: d.Self?.DNSName?.replace(/\.$/, '') || d.Self?.HostName,
      celulares: Object.values(d.Peer ?? {})
        .filter((p) => /^(ios|android)$/i.test(p.OS ?? ''))
        .map((p) => p.HostName ?? p.OS!),
    };
  } catch {
    return { rodando: false, celulares: [] };
  }
}

const statusTailscale = async () => lerStatusTailscale((await rodar(TAILSCALE_BIN, ['status', '--json'])).saida);

async function aguardar(texto: string, ok: (s: EstadoTailscale) => boolean, minutos: number) {
  return tela.esperando(
    texto,
    async () => {
      const fim = Date.now() + minutos * 60_000;
      for (;;) {
        const s = await statusTailscale();
        if (ok(s) || Date.now() > fim) return s;
        await new Promise((r) => setTimeout(r, 3000));
      }
    },
    (s) => (ok(s) ? 'Conectado' : 'Ainda não conectou'),
  );
}

async function pularOuParar(oQue: string) {
  if (await tela.sim(`${oQue} Pular por agora? (dá para fazer depois com muxor init --refazer front)`, false)) return true;
  throw new Interrompido();
}

export function ngrokTemToken(caminho: string) {
  return existsSync(caminho) && /^\s*authtoken:\s*\S+/m.test(readFileSync(caminho, 'utf8'));
}

export async function front(ctx: Ctx) {
  tela.nota(
    [
      'Para abrir no celular o front-end que o Claude sobe neste Mac (o localhost), o Muxor usa o Tailscale: uma rede',
      'privada só entre os seus aparelhos. É grátis, não cria link público e o endereço não muda.',
      'Para mostrar o front a outra pessoa, o ngrok gera um link público (opcional, logo depois).',
    ].join('\n'),
    'Front-end no celular',
  );
  if (!(await tela.sim('Configurar agora? (recomendado se você mexe com front-end)'))) return;
  if (!(await conferir(['tailscale']))[0].ok && !instalador?.pendente('tailscale')) {
    tela.info('Instalando o Tailscale. Quando aparecer "Password:", digite a senha do Mac e aperte Enter.');
    await instalar(PROGRAMAS.tailscale, join(ctx.casa.logs, 'instalacao.log'));
    ctx.registrar(registroDe(PROGRAMAS.tailscale));
  }
  await esperar('tailscale');

  let s = await statusTailscale();
  if (!s.rodando) {
    await rodar('open', ['-a', 'Tailscale']);
    tela.nota(
      [
        '1. O Mac vai pedir para permitir a configuração de VPN do Tailscale: clique em Permitir (Allow).',
        '   Se ele mandar ativar em Ajustes → Privacidade e Segurança, ative e volte para cá.',
        '2. No ícone do Tailscale na barra de menus (no alto, à direita), clique em Log in e entre com uma conta',
        '   (Google, GitHub, Microsoft ou Apple). Lembre qual: o celular entra com a mesma.',
      ].join('\n'),
      'Tailscale no Mac',
    );
    s = await aguardar('Esperando o Tailscale do Mac conectar (até 10 min)…', (x) => x.rodando, 10);
    if (!s.rodando && (await pularOuParar('O Tailscale do Mac não conectou.'))) return;
  }
  tela.ok(`Tailscale do Mac conectado (${s.mac ?? 'este Mac'}).`);

  if (!s.celulares.length) {
    await tela.link(PAGINA_CELULAR, 'No celular: instale o Tailscale e entre com a MESMA conta do Mac', { qr: true });
    s = await aguardar('Esperando o celular aparecer na sua rede do Tailscale (até 10 min)…', (x) => x.celulares.length > 0, 10);
    if (!s.celulares.length && (await pularOuParar('Não vi nenhum celular na sua rede do Tailscale.'))) return;
  }
  tela.ok(`Celular na sua rede do Tailscale (${s.celulares.join(', ')}).`);

  if (!(await tela.sim('Quer também poder mandar um link público do seu front para outra pessoa (ngrok)?'))) return;
  if (!(await conferir(['ngrok']))[0].ok) {
    instalador?.iniciar(PROGRAMAS.ngrok) ?? (await instalar(PROGRAMAS.ngrok, join(ctx.casa.logs, 'instalacao.log')));
    await esperar('ngrok');
  }
  const cfg = (await rodar('ngrok', ['config', 'check'])).saida.match(/at (.+\.yml)/)?.[1] ?? '';
  if (!ngrokTemToken(cfg)) {
    await tela.link('https://dashboard.ngrok.com/get-started/your-authtoken', 'Crie uma conta grátis no ngrok (ou entre) e copie o seu Authtoken', { abrir: true });
    const token = await tela.segredo('Cole o Authtoken do ngrok', (v) => (/^[A-Za-z0-9_-]{20,}$/.test(v) ? undefined : 'O Authtoken tem só letras, números, _ e -.'));
    const r = await rodar('ngrok', ['config', 'add-authtoken', token]);
    if (!r.ok) {
      tela.erro('O ngrok não aceitou o token. Confira se copiou o Authtoken inteiro.');
      throw new Interrompido();
    }
  }
  tela.ok('ngrok pronto (link público só quando você pedir).');
}
