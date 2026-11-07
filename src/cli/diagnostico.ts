// `muxor diagnostico`: confere cada peça da instalação e diz o próximo passo (O17). É a base do `muxor init`, que
// usa as mesmas conferências para marcar cada passo, e o que o agente de IA do usuário lê para ajudar (`--json`).
// Só lê: não muda nada e não renova logins (uma renovação aqui invalidaria a do Muxor rodando).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type Estado = 'ok' | 'aviso' | 'falha' | 'info';

export interface Item {
  grupo: string;
  nome: string;
  estado: Estado;
  detalhe: string;
  proximo?: string; // o que fazer, quando não está ok
}

export type Modo = 'local' | 'servidor';

// Roda um programa e devolve a saída (ou null se não existe / falhou). Sempre execFile com array.
export function rodar(bin: string, args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; saida: string }> {
  return new Promise((ok) =>
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) =>
      ok({ ok: !err, saida: (stdout || stderr || (err?.message ?? '')).toString().trim() }),
    ),
  );
}

// Variáveis do hub.service (systemctl show devolve "A=1 "B=com espaço" ..."); não sobrescreve as já definidas.
export function variaveisDoServico(saida: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of saida.matchAll(/"([^"]*)"|(\S+)/g)) {
    const par = m[1] ?? m[2];
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i)] = par.slice(i + 1);
  }
  return out;
}

type Rodar = typeof rodar;

export interface DepsDiagnostico {
  modo: Modo;
  rodar: Rodar;
  env: NodeJS.ProcessEnv;
  // Carregadas sob demanda: uma falha num passo (ex.: .env inválido) não impede os outros.
  carregarEnv: () => Promise<import('../config.js').Env>;
  carregarCatalogo: () => Promise<import('../config.js').Catalogo>;
  fontesDeRegras: (cat: import('../config.js').Catalogo) => { nome: string; titulo: string }[];
  arquivoRegras: (nome: string) => string | null;
  caminhos: import('../caminhos.js').Caminhos;
  arquivoEnv: string;
  statusOrca: (env: import('../config.js').Env) => Promise<{ ok: boolean; versao?: string; estado?: string }>;
  reposNoOrca: (env: import('../config.js').Env) => Promise<string[]>;
  telegram: (token: string) => Promise<{ ok: boolean; usuario?: string; erro?: string }>;
  bnexo: () => Promise<string>;
  jira: () => Promise<string>;
}

const versaoNode = (v: string) => Number(v.replace(/^v/, '').split('.')[0]);

export async function diagnosticar(d: DepsDiagnostico): Promise<Item[]> {
  const itens: Item[] = [];
  const add = (grupo: string, nome: string, estado: Estado, detalhe: string, proximo?: string) =>
    itens.push({ grupo, nome, estado, detalhe, ...(proximo ? { proximo } : {}) });
  const PRE = 'Pré-requisitos';
  const guia = 'instalacao/pre-requisitos.md';

  // ── Pré-requisitos
  add(PRE, 'Modo', 'info', d.modo === 'local' ? 'local (este computador)' : 'servidor');
  const node = process.version;
  if (versaoNode(node) >= 22) add(PRE, 'Node', 'ok', node);
  else add(PRE, 'Node', 'falha', `${node}; o Muxor precisa do 22 ou mais novo`, `Instale o Node 22 (${guia})`);

  const git = await d.rodar('git', ['--version']);
  if (git.ok) add(PRE, 'git', 'ok', git.saida.replace('git version ', ''));
  else add(PRE, 'git', 'falha', 'não encontrado', `Instale o git (${guia})`);

  if (d.modo === 'local') {
    const claude = await d.rodar('claude', ['--version']);
    if (!claude.ok) add(PRE, 'Claude Code', 'falha', 'não encontrado', `Instale o Claude Code (${guia})`);
    else {
      const auth = await d.rodar('claude', ['auth', 'status']);
      const logado = auth.ok && /"loggedIn":\s*true/.test(auth.saida);
      add(PRE, 'Claude Code', logado ? 'ok' : 'falha', `${claude.saida.split(' ')[0]}${logado ? ', com login' : ', sem login'}`, logado ? undefined : 'Rode `claude` no terminal e faça o login');
    }
  } else add(PRE, 'Claude Code', 'info', 'no servidor ele é do usuário agente; confira com: sudo -u agente -i claude auth status');

  // ── Configuração (.env)
  const CONF = 'Configuração';
  let env: import('../config.js').Env | null = null;
  try {
    env = await d.carregarEnv();
    add(CONF, '.env', 'ok', `válido (${d.arquivoEnv})`);
  } catch (e) {
    const msg = (e as Error).message.replace(/^\.env inválido — /, '');
    add(CONF, '.env', 'falha', `${d.arquivoEnv}: ${msg}`, 'Rode `muxor init` (ou corrija o .env indicado)');
  }

  // ── Telegram
  const TG = 'Telegram';
  if (env) {
    const r = await d.telegram(env.TELEGRAM_BOT_TOKEN);
    if (r.ok) add(TG, 'Bot', 'ok', `@${r.usuario}`);
    else add(TG, 'Bot', 'falha', r.erro ?? 'token recusado', 'Confira o TELEGRAM_BOT_TOKEN (BotFather → /mybots → API Token)');
    add(TG, 'Chat', 'ok', 'chat do dono configurado (só ele é atendido)');
  }

  // ── Ferramentas de gestão
  const FER = 'Ferramentas de gestão';
  if (env) {
    const nenhuma = !env.FUNIFIER_PM_MCP_URL && !env.BNEXO_MCP_URL && !env.JIRA_URL;
    if (nenhuma) add(FER, 'Nenhuma', 'aviso', 'nenhuma ferramenta configurada: só atividades avulsas (/nova)', 'Rode `muxor init` para escolher as ferramentas');
    if (env.FUNIFIER_PM_MCP_URL) {
      const login = existsSync(join(d.caminhos.dados, 'oauth', 'funifier-pm.json'));
      add(FER, 'Funifier PM', login ? 'ok' : 'falha', login ? 'login salvo' : 'sem login', login ? undefined : 'Mande /pm_login no Telegram');
    }
    if (env.JIRA_URL) {
      try {
        add(FER, 'Jira', 'ok', await d.jira());
      } catch (e) {
        add(FER, 'Jira', 'falha', (e as Error).message, 'Confira JIRA_URL, JIRA_EMAIL e JIRA_API_TOKEN no .env');
      }
    }
    if (env.BNEXO_MCP_URL) {
      try {
        add(FER, 'Bnexo', 'ok', await d.bnexo());
      } catch (e) {
        add(FER, 'Bnexo', 'falha', (e as Error).message, 'Confira o BNEXO_MCP_TOKEN no .env');
      }
    }
  }

  // ── Orca
  const ORCA = 'Orca';
  if (env) {
    if (!env.ORCA_ENVIRONMENT && !existsSync(env.ORCA_BIN)) add(ORCA, 'Orca', 'falha', `não achei ${env.ORCA_BIN}`, `Instale o Orca (${guia})`);
    else {
      try {
        const s = await d.statusOrca(env);
        if (s.ok) add(ORCA, 'Orca', 'ok', `versão ${s.versao ?? '?'}`);
        else add(ORCA, 'Orca', 'falha', `não está pronto (${s.estado ?? 'fechado'})`, d.modo === 'local' ? 'Abra o app do Orca' : 'sudo systemctl restart orca.service');
      } catch (e) {
        add(ORCA, 'Orca', 'falha', (e as Error).message, d.modo === 'local' ? 'Abra o app do Orca' : 'sudo systemctl status orca.service');
      }
    }
  }

  // ── Espaços e projetos (apps.yaml)
  const CAT = 'Espaços e projetos';
  let cat: import('../config.js').Catalogo | null = null;
  try {
    cat = await d.carregarCatalogo();
  } catch (e) {
    const msg = (e as Error).message;
    if (/formato antigo/.test(msg)) add(CAT, 'apps.yaml', 'aviso', 'formato antigo (com "empresa"); o Muxor converte para espaços sozinho ao iniciar', 'Inicie o Muxor uma vez (npm start) e rode o diagnóstico de novo');
    else add(CAT, 'apps.yaml', 'falha', msg, 'Corrija o apps.yaml indicado, ou rode `muxor init`');
  }
  if (cat) {
    if (!cat.espacos.length) add(CAT, 'Espaços', 'falha', 'nenhum espaço', 'Rode `muxor adicionar github-workspace`');
    for (const e of cat.espacos) {
      const projetos = cat.apps.filter((a) => a.espaco === e.id).length;
      const pasta = existsSync(e.pasta);
      add(
        CAT,
        `Espaço ${e.nome ?? e.id}`,
        pasta ? (e.github ? 'ok' : 'aviso') : 'falha',
        `${e.pasta} · ${projetos} projeto(s)${e.github ? ` · GitHub ${e.github}` : ' · sem conta do GitHub'}`,
        !pasta ? `A pasta não existe: crie-a ou corrija o apps.yaml` : e.github ? undefined : 'Rode `muxor adicionar github-workspace` para ligar a conta',
      );
    }
    const semPasta = cat.apps.filter((a) => !existsSync(a.pasta));
    if (semPasta.length) add(CAT, 'Pastas dos projetos', 'aviso', `não existem: ${semPasta.map((a) => a.app).join(', ')}`, 'Clone os repositórios ou tire esses projetos do apps.yaml');
    else add(CAT, 'Pastas dos projetos', 'ok', `${cat.apps.length} projeto(s), todas existem`);
    if (env && cat.apps.length) {
      try {
        const noOrca = new Set(await d.reposNoOrca(env));
        const fora = cat.apps.filter((a) => existsSync(a.pasta) && !noOrca.has(a.pasta));
        if (fora.length) add(CAT, 'Projetos no Orca', 'info', `ainda não abertos no Orca: ${fora.map((a) => a.app).join(', ')} (o Muxor adiciona no primeiro despacho)`);
        else add(CAT, 'Projetos no Orca', 'ok', 'todos abertos no Orca');
      } catch {
        // Orca fora do ar já aparece acima.
      }
    }

    // ── Regras de trabalho
    for (const f of d.fontesDeRegras(cat)) {
      const arq = d.arquivoRegras(f.nome);
      add('Regras de trabalho', f.titulo, arq ? 'ok' : 'aviso', arq ?? `sem regras/${f.nome}.md`, arq ? undefined : 'Escreva as regras pelo /regras no Telegram, ou use "regras: nenhuma"');
    }
  }

  // ── Serviço e extras
  const SRV = 'Serviço';
  if (d.modo === 'servidor') {
    for (const [unidade, nome] of [
      ['hub.service', 'Hub'],
      ['orca.service', 'Orca (serviço)'],
      ['hub-atualizar.timer', 'Deploy automático'],
    ]) {
      const r = await d.rodar('systemctl', ['is-active', unidade]);
      add(SRV, nome, r.saida === 'active' ? 'ok' : 'falha', `${unidade}: ${r.saida || 'desconhecido'}`, r.saida === 'active' ? undefined : `sudo systemctl status ${unidade}`);
    }
    const cofre = existsSync(join(d.caminhos.dados, 'cofre.enc'));
    add(SRV, 'Cofre', cofre ? 'ok' : 'info', cofre ? 'cofre.enc existe (só o hub.service abre)' : 'vazio: as credenciais entram pelo /gamificacoes');
  } else {
    add(SRV, 'Serviço', 'info', 'no Mac o Muxor ainda sobe com `npm start`; o `muxor init` vai instalá-lo como serviço');
  }
  if (env) {
    add(
      'Extras',
      'Heartbeat',
      env.HUB_HEARTBEAT_URL ? 'ok' : 'info',
      env.HUB_HEARTBEAT_URL ? 'ligado (Healthchecks.io)' : 'desligado (opcional: instalacao/heartbeat.md)',
    );
  }
  return itens;
}

const ICONE: Record<Estado, string> = { ok: '✅', aviso: '⚠️ ', falha: '❌', info: 'ℹ️ ' };

// Saída para pessoas: por grupo, uma linha por item e o próximo passo embaixo; no fim, o resumo.
export function formatarTexto(itens: Item[]): string {
  const L: string[] = ['Diagnóstico do Muxor', ''];
  let grupo = '';
  for (const i of itens) {
    if (i.grupo !== grupo) {
      if (grupo) L.push('');
      L.push(i.grupo);
      grupo = i.grupo;
    }
    L.push(`  ${ICONE[i.estado]} ${i.nome}: ${i.detalhe}`);
    if (i.proximo) L.push(`       → ${i.proximo}`);
  }
  const n = (e: Estado) => itens.filter((i) => i.estado === e).length;
  L.push('', n('falha') ? `${n('falha')} problema(s) e ${n('aviso')} aviso(s). Comece pelo primeiro ❌.` : n('aviso') ? `Tudo funcionando, com ${n('aviso')} aviso(s).` : 'Tudo certo.');
  return L.join('\n');
}

// Arquivo de regras em uso: o configurado ou o padrão do código.
export function achaArquivoRegras(dir: string, padrao: (f: string) => string | null) {
  return (nome: string) => {
    const f = join(dir, `${nome}.md`);
    return existsSync(f) ? f : padrao(`${nome}.md`);
  };
}

