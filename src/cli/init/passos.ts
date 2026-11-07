// Os passos do muxor init no modo local (docs/onboarding.md §4). Cada um confere de verdade antes de seguir e, se
// falhar, diz o próximo passo. Tudo o que muda fora de ~/.muxor fica registrado para o muxor desinstalar.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { adicionarApp, ligarProjeto, loadCatalogo, nomeEspaco, salvarEspaco, type App } from '../../config.js';
import { NOME_FERRAMENTA } from '../../dominio/selecao.js';
import { BnexoAdapter } from '../../pm/bnexo.js';
import { FunifierPmAdapter } from '../../pm/funifier-pm.js';
import { JiraAdapter } from '../../pm/jira.js';
import type { PmAdapter } from '../../pm/types.js';
import { ghDoEspaco, gitconfigDoEspaco } from '../casa.js';
import { rodar } from '../diagnostico.js';
import { tela } from '../tela.js';
import { MODELO_REGRAS, type Ctx } from './contexto.js';
import { aplicarContaGit } from './git-espaco.js';
import { conteudoPlist, instalarServico, pararServico, ROTULO } from './servico-mac.js';
import { conferirBot, esperarDono, mandar } from './telegram.js';

export class Interrompido extends Error {}

const ORCA_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca';
const ORCA_APARELHOS = join(homedir(), 'Library', 'Application Support', 'orca', 'orca-devices.json');
const GUIA = 'instalacao/pre-requisitos.md';
export type Ferramenta = 'funifier-pm' | 'bnexo' | 'jira';

export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const expandir = (p: string) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

// ───────────────────────── 1. Pré-requisitos ─────────────────────────

export async function preRequisitos() {
  const faltando: string[] = [];
  if (Number(process.version.slice(1).split('.')[0]) < 22) faltando.push(`Node 22 ou mais novo (você tem ${process.version})`);
  if (!(await rodar('git', ['--version'])).ok) faltando.push('git');
  if (!(await rodar('gh', ['--version'])).ok) faltando.push('GitHub CLI (gh): brew install gh');
  const claude = await rodar('claude', ['--version']);
  if (!claude.ok) faltando.push('Claude Code');
  else if (!/"loggedIn":\s*true/.test((await rodar('claude', ['auth', 'status'])).saida)) faltando.push('login no Claude Code: rode `claude` no terminal e entre com a sua conta');
  if (!existsSync(ORCA_BIN)) faltando.push('Orca (app para Mac)');
  if (faltando.length) {
    tela.nota(faltando.map((f) => `• ${f}`).join('\n'), 'Falta instalar');
    tela.info(`Como instalar cada um: ${GUIA}. Depois rode \`./muxor init\` de novo: eu continuo daqui.`);
    throw new Interrompido();
  }
  tela.ok('Node, git, gh, Claude Code (com login) e Orca instalados.');
  for (;;) {
    const s = await rodar(ORCA_BIN, ['status', '--json']);
    if (s.ok && /"reachable":\s*true/.test(s.saida)) break;
    tela.aviso('O Orca precisa estar aberto. Vou abri-lo agora.');
    await rodar('open', ['-a', 'Orca']);
    await tela.enter('Quando a janela do Orca aparecer, aperte Enter');
  }
  tela.ok('Orca aberto.');
}

// ───────────────────────── 2. Modo ─────────────────────────

export async function escolherModo(ctx: Ctx): Promise<'local' | 'servidor'> {
  const modo = await tela.escolher(
    'Onde o Muxor vai rodar?',
    [
      { valor: 'local', rotulo: 'Neste Mac', dica: 'o Mac precisa ficar ligado para as tasks rodarem' },
      { valor: 'servidor', rotulo: 'Num servidor meu (VPS)', dica: 'roda 24 h; o Mac e o celular só acompanham' },
    ],
    'local',
  );
  ctx.estado.modo = modo;
  ctx.salvar();
  if (modo === 'servidor') {
    tela.nota(
      'No modo servidor, o muxor init roda no próprio servidor, depois de prepará-lo.\nSiga instalacao/modo-servidor.md: ele explica como criar o servidor, entrar por SSH e rodar o muxor init lá.',
      'Modo servidor',
    );
    throw new Interrompido();
  }
  return modo;
}

// ───────────────────────── 3. Ferramentas de gestão ─────────────────────────

async function tentar(nome: string, fn: () => Promise<string>): Promise<boolean> {
  for (;;) {
    try {
      await tela.esperando(`Conferindo o ${nome}…`, fn, (r) => `${nome}: conectado (${r})`);
      return true;
    } catch (e) {
      tela.erro(`${nome}: ${(e as Error).message}`);
      if (!(await tela.sim('Tentar de novo?'))) return false;
    }
  }
}

export async function ferramentas(ctx: Ctx): Promise<Ferramenta[]> {
  tela.info('O Muxor lê as suas tasks nas ferramentas de gestão. Marque as que você usa (espaço marca, Enter confirma). Dá para mudar depois pelo Telegram.');
  const escolhidas = await tela.varios<Ferramenta>('Quais ferramentas de gestão você usa?', [
    { valor: 'funifier-pm', rotulo: 'Funifier PM' },
    { valor: 'bnexo', rotulo: 'Bnexo' },
    { valor: 'jira', rotulo: 'Jira (Cloud)' },
  ]);
  ctx.definirEnv({
    TZ_HUB: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
    RESUMO_HORARIO: '09:00',
    HUB_ESCRITA_PM: 'true', // muda só para "em progresso" ao despachar e "concluída" com o seu Sim (B01, B04)
    HUB_COMENTARIOS_PM: 'false', // nunca comenta sem pedido (B02)
    ORCA_BIN,
  });
  if (!escolhidas.length) tela.aviso('Sem ferramenta de gestão: o Muxor vai servir só para atividades avulsas (/nova no Telegram).');

  const ok: Ferramenta[] = [];
  if (escolhidas.includes('funifier-pm')) {
    ctx.definirEnv({ FUNIFIER_PM_MCP_URL: 'https://pm-mcp.funifier.com/mcp' });
    tela.info('Funifier PM: vou abrir o login no navegador. Entre com a sua conta, autorize o "Muxor" e volte aqui.');
    const { connect } = await import('../../pm/mcp-client.js');
    const conectou = await tentar('Funifier PM', async () => {
      const c = await connect('funifier-pm', { interactive: true });
      await c.close();
      return await new FunifierPmAdapter(ctx.envParcial()).ping();
    });
    if (conectou) ok.push('funifier-pm');
    else ctx.definirEnv({ FUNIFIER_PM_MCP_URL: null });
  }
  if (escolhidas.includes('bnexo')) {
    tela.info('Bnexo: você precisa do endereço do MCP e de um token. No Bnexo: Configurações → Integrações → MCP.');
    const conectou = await tentar('Bnexo', async () => {
      ctx.definirEnv({
        BNEXO_MCP_URL: await tela.texto('Endereço do MCP do Bnexo', { exemplo: 'https://…/mcp/essencial', validar: (v) => (/^https:\/\//.test(v) ? undefined : 'Começa com https://') }),
        BNEXO_MCP_TOKEN: await tela.segredo('Token do MCP do Bnexo (não aparece na tela)'),
      });
      return await new BnexoAdapter(ctx.envParcial(), () => ({})).ping();
    });
    if (conectou) ok.push('bnexo');
    else ctx.definirEnv({ BNEXO_MCP_URL: null, BNEXO_MCP_TOKEN: null });
  }
  if (escolhidas.includes('jira')) {
    tela.info('Jira: você precisa do endereço do site, do seu e-mail e de um API token. Vou abrir a página de criar o token.');
    await tela.link('https://id.atlassian.com/manage-profile/security/api-tokens', 'Criar o API token do Jira (Create API token, dê um nome como "hub")', { abrir: true });
    const conectou = await tentar('Jira', async () => {
      ctx.definirEnv({
        JIRA_URL: await tela.texto('Endereço do seu Jira', { exemplo: 'https://suaempresa.atlassian.net', validar: (v) => (/^https:\/\/[^/]+/.test(v) ? undefined : 'Ex.: https://suaempresa.atlassian.net') }),
        JIRA_EMAIL: await tela.texto('E-mail da sua conta Atlassian'),
        JIRA_API_TOKEN: await tela.segredo('API token do Jira (não aparece na tela)'),
      });
      return await new JiraAdapter(ctx.envParcial()).ping();
    });
    if (conectou) ok.push('jira');
    else ctx.definirEnv({ JIRA_URL: null, JIRA_EMAIL: null, JIRA_API_TOKEN: null });
  }
  return ok;
}

export function adaptadores(ctx: Ctx): PmAdapter[] {
  const e = ctx.envParcial();
  return [
    ...(e.FUNIFIER_PM_MCP_URL ? [new FunifierPmAdapter(e)] : []),
    ...(e.BNEXO_MCP_URL && e.BNEXO_MCP_TOKEN ? [new BnexoAdapter(e, () => ({}))] : []),
    ...(e.JIRA_URL && e.JIRA_EMAIL && e.JIRA_API_TOKEN ? [new JiraAdapter(e)] : []),
  ];
}

// ───────────────────────── 4. Espaços (uma conta do GitHub cada) ─────────────────────────

export async function espacos(ctx: Ctx) {
  tela.nota(
    [
      'Um espaço é uma pasta do seu Mac ligada a uma conta do GitHub. Ex.:',
      '  • "Empresa"  → ~/Documents/EMPRESA   (conta do trabalho)',
      '  • "Pessoal"  → ~/Documents/PESSOAL   (conta pessoal)',
      'Tudo o que o Claude fizer dentro da pasta (commit, push, PR) sai pela conta daquele espaço.',
      'As ferramentas de gestão não importam aqui: o projeto de cada uma é ligado a uma pasta mais adiante.',
      '',
      'Se hoje os seus repositórios estão misturados (de contas diferentes na mesma pasta), vale reorganizar:',
      'mova cada repositório para a pasta do espaço da conta dele. Dá para fazer depois, com calma.',
    ].join('\n'),
    'Espaços',
  );
  const usaFunifier = !!process.env.FUNIFIER_PM_MCP_URL;
  do await novoEspaco(ctx, usaFunifier);
  while (await tela.sim('Adicionar outro espaço (outra conta do GitHub)?', false));
}

export async function novoEspaco(ctx: Ctx, usaFunifier: boolean) {
  const cat = loadCatalogo();
  const nome = await tela.texto('Nome do espaço', {
    exemplo: 'Empresa, Pessoal…',
    validar: (v) => (!slug(v) ? 'Use letras ou números.' : cat.espacos.some((e) => e.id === slug(v)) ? 'Já existe um espaço com esse nome.' : undefined),
  });
  const id = slug(nome);
  const pasta = expandir(
    await tela.texto('Pasta do espaço (os projetos ficam dentro dela)', {
      padrao: join(homedir(), 'Documents', nome.toUpperCase().replace(/\s+/g, '-')),
      validar: (v) => (expandir(v).startsWith('/') ? undefined : 'Use um caminho completo, ex.: /Users/voce/Documents/EMPRESA'),
    }),
  );
  if (!existsSync(pasta)) {
    mkdirSync(pasta, { recursive: true });
    ctx.registrar({ tipo: 'pasta', caminho: pasta });
  }

  // Login do GitHub só deste espaço, guardado em ~/.muxor (não mexe no gh nem no Keychain de quem já usa o Mac).
  const ghConfig = ghDoEspaco(ctx.casa, id);
  mkdirSync(ghConfig, { recursive: true, mode: 0o700 });
  const ghEnv = { ...process.env, GH_CONFIG_DIR: ghConfig };
  tela.nota(
    [
      `Login do GitHub do espaço "${nome}":`,
      '1. Vai aparecer um código de 8 letras (já copiado). Aperte Enter e o navegador abre no GitHub.',
      '2. Cole o código e autorize. Se o navegador estiver logado em OUTRA conta, troque de conta lá antes.',
      '3. Se perguntar "Authenticate Git with your GitHub credentials?", responda N: o Muxor já faz isso só para esta pasta.',
    ].join('\n'),
    'GitHub',
  );
  for (;;) {
    const antes = await credenciaisGlobais();
    const code = await new Promise<number>((ok) =>
      spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard', '--insecure-storage'], { stdio: 'inherit', env: ghEnv }).on('exit', (c) =>
        ok(c ?? 1),
      ),
    );
    await desfazerCredenciaisNovas(antes); // se o gh mexeu no ~/.gitconfig global, volta como estava
    if (code === 0) break;
    tela.erro('O login do GitHub não terminou.');
    if (!(await tela.sim('Tentar de novo?'))) throw new Interrompido();
  }
  const u = await new Promise<{ login: string; id: number; name: string | null; email: string | null }>((ok, falha) => {
    let saida = '';
    spawn('gh', ['api', 'user'], { env: ghEnv })
      .on('exit', (c) => (c === 0 ? ok(JSON.parse(saida)) : falha(new Error('não consegui ler a conta do GitHub'))))
      .stdout.on('data', (d) => (saida += d));
  });
  tela.ok(`GitHub: conta ${u.login}.`);
  const nomeGit = await tela.texto('Nome que vai nos commits deste espaço', { padrao: u.name ?? u.login });
  const emailGit = await tela.texto('E-mail dos commits deste espaço', {
    padrao: u.email ?? `${u.id}+${u.login}@users.noreply.github.com`,
    validar: (v) => (/^\S+@\S+$/.test(v) ? undefined : 'E-mail inválido.'),
  });
  const gh = (await rodar('which', ['gh'])).saida;
  const alt = await aplicarContaGit(gitconfigDoEspaco(ctx.casa, id), pasta, { nome: nomeGit, email: emailGit, gh, ghConfig });
  ctx.registrar({ tipo: 'gitconfig', ...alt });
  tela.ok(`Dentro de ${pasta}, o git usa ${nomeGit} <${emailGit}> e a conta ${u.login}.`);

  const gamificacao = usaFunifier ? await tela.sim('Os projetos deste espaço usam gamificações da Funifier?', false) : false;
  const regras = await tela.escolher(
    'Regras de trabalho deste espaço (vão em todo prompt; dá para editar pelo /regras no Telegram)',
    [
      { valor: 'modelo', rotulo: 'Usar o modelo', dica: 'branch nova, sem push na principal, commits sem menção a IA' },
      { valor: 'nenhuma', rotulo: 'Nenhuma', dica: 'ex.: um espaço de testes, com projetos sem relação entre si' },
    ],
    'modelo',
  );
  if (regras === 'modelo') {
    const destino = join(ctx.casa.dados, 'regras', `${id}.md`);
    mkdirSync(dirname(destino), { recursive: true });
    if (!existsSync(destino)) writeFileSync(destino, readFileSync(MODELO_REGRAS, 'utf8').replace(/^# .*$/m, `# Regras de trabalho — ${nome}`));
  }
  salvarEspaco({ id, nome, pasta, github: u.login, gh_config: ghConfig, ...(regras === 'nenhuma' ? { regras: 'nenhuma' } : {}), gamificacao });
  tela.ok(`Espaço "${nome}" pronto.`);
}

// O `gh auth login` pode oferecer configurar o git do usuário inteiro (credential helper global). O Muxor configura só a
// pasta do espaço; se algo novo apareceu na configuração global, tira (só o que entrou agora).
const CHAVES_CREDENCIAL = ['credential.https://github.com.helper', 'credential.https://gist.github.com.helper'];

async function credenciaisGlobais() {
  const out: Record<string, string[]> = {};
  for (const k of CHAVES_CREDENCIAL) {
    const r = await rodar('git', ['config', '--global', '--get-all', k]);
    out[k] = r.ok ? r.saida.split('\n') : [];
  }
  return out;
}

async function desfazerCredenciaisNovas(antes: Record<string, string[]>) {
  const depois = await credenciaisGlobais();
  for (const k of CHAVES_CREDENCIAL) {
    const novas = depois[k].filter((v) => !antes[k].includes(v));
    if (!novas.length) continue;
    // Tira tudo da chave e devolve o que existia antes, na mesma ordem.
    await rodar('git', ['config', '--global', '--unset-all', k]);
    for (const v of antes[k]) await rodar('git', ['config', '--global', '--add', k, v]);
    tela.info('O gh tinha mudado o ~/.gitconfig global: desfiz (o Muxor configura só a pasta do espaço).');
  }
}

// ───────────────────────── 5. Projetos que a pessoa já tem no Orca ─────────────────────────

export async function existentes(ctx: Ctx) {
  const { Orca } = await import('../../adaptadores/executor/orca.js');
  const cat = loadCatalogo();
  const noHub = new Set(cat.apps.map((a) => a.pasta));
  const repos = (await new Orca(ORCA_BIN).listRepos().catch(() => [])).filter((r) => !noHub.has(r.path) && r.path !== ctx.casa.sandbox);
  if (!repos.length) return tela.info('Nenhum projeto no Orca fora do hub.');
  tela.nota(
    [
      `Você já tem ${repos.length} projeto(s) no Orca. Para cada um, você decide:`,
      '  • Trazer para o Muxor: ele entra no fluxo completo. O Muxor manda tasks para ele, abre sessões do Claude e',
      '    escreve nas sessões que já existem nessa pasta, e marca o status da área de trabalho no Orca.',
      '  • Deixar de fora: o Muxor nunca toca nesse projeto nem nas sessões dele.',
      'Dá para trazer mais depois: ./muxor adicionar projeto',
    ].join('\n'),
    'Projetos que você já tem no Orca',
  );
  const espacoDaPasta = (p: string) => cat.espacos.find((e) => p.startsWith(e.pasta.replace(/\/+$/, '') + '/'));
  const escolhidos = await tela.varios(
    'Quais trazer para o Muxor?',
    repos.map((r) => ({
      valor: r.path,
      rotulo: r.displayName || basename(r.path),
      dica: espacoDaPasta(r.path) ? `${r.path} · espaço ${nomeEspaco(espacoDaPasta(r.path)!)}` : `${r.path} · fora dos espaços`,
    })),
  );
  for (const pasta of escolhidos) {
    let e = espacoDaPasta(pasta);
    if (!e) {
      tela.aviso(`${pasta} está fora das pastas dos espaços: o git ali continua com a configuração que você já usa (a conta do espaço vale só dentro da pasta dele).`);
      const id = cat.espacos.length === 1 ? cat.espacos[0].id : await tela.escolher(`A que espaço ${basename(pasta)} pertence (para as regras de trabalho)?`, cat.espacos.map((x) => ({ valor: x.id, rotulo: nomeEspaco(x) })));
      e = cat.espacos.find((x) => x.id === id)!;
    }
    const atuais = loadCatalogo().apps;
    const base = slug(basename(pasta)) || 'projeto';
    const nome = atuais.some((a) => a.app === base) ? `${base}-${slug(e.id)}` : base;
    adicionarApp({ app: nome, espaco: e.id, ferramenta: 'nenhuma', pasta, projeto: null });
    tela.ok(`${nome} entrou no Muxor (espaço ${nomeEspaco(e)}).`);
  }
}

// ───────────────────────── 6. Repositórios (pelo Claude Code do usuário) ─────────────────────────

export async function repositorios(ctx: Ctx) {
  const cat = loadCatalogo();
  const lista = cat.espacos
    .map((e) => `- ${nomeEspaco(e)}: pasta ${e.pasta}${e.github ? `, conta do GitHub ${e.github}` : ''}${e.gh_config ? `, login do espaço GH_CONFIG_DIR=${e.gh_config}` : ''}`)
    .join('\n');
  const prompt = readFileSync(join(ctx.repo, 'instalacao', 'prompts', 'clonar-repositorios.md'), 'utf8')
    .replace(/^[\s\S]*?<!-- prompt -->\n/, '')
    .replace('{{ESPACOS}}', lista)
    .trim();
  await rodar('sh', ['-c', `printf %s "$1" | pbcopy`, 'sh', prompt]);
  tela.nota(
    [
      'Agora traga os repositórios que você quer trabalhar com o Muxor. Quem clona é o seu Claude Code:',
      '1. Abra uma janela nova do Terminal (Cmd+N) e rode: claude',
      '2. Cole (Cmd+V): o pedido já está copiado. Diga quais repositórios de cada conta você quer.',
      '3. Quando ele terminar, volte para esta janela.',
      '',
      'Projeto sem repositório (ex.: uma pasta só para instalar um MCP) também vale: crio a pasta no próximo passo.',
    ].join('\n'),
    'Repositórios',
  );
  await tela.enter('Quando os repositórios estiverem nas pastas (ou se quiser pular), aperte Enter');
  const total = cat.espacos.reduce((n, e) => n + subpastas(e.pasta).length, 0);
  tela.ok(`${total} pasta(s) de projeto nos espaços.`);
}

const subpastas = (p: string) => (existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()) : []);

// ───────────────────────── 7. De-para: projeto da ferramenta → pasta ─────────────────────────

export async function dePara(ctx: Ctx) {
  const pms = adaptadores(ctx);
  if (!pms.length) return tela.info('Sem ferramenta de gestão: nada para ligar.');
  tela.info('Agora ligo cada projeto das suas ferramentas a uma pasta. Mostro os projetos em que você tem tasks abertas; os outros eu pergunto pelo Telegram quando chegar uma task deles.');
  for (const pm of pms) {
    const nomeFer = NOME_FERRAMENTA[pm.nome] ?? pm.nome;
    const tasks = await tela.esperando(`Buscando suas tasks no ${nomeFer}…`, () => pm.listMyTasks(), (t) => `${nomeFer}: ${t.length} task(s) abertas`);
    const projetos = new Map<string, { nome: string; exemplo: string; n: number }>();
    for (const t of tasks) {
      if (!t.projetoId) continue;
      const p = projetos.get(t.projetoId) ?? { nome: t.projetoNome ?? `projeto ${t.projetoId.slice(0, 8)}`, exemplo: t.titulo, n: 0 };
      p.n++;
      projetos.set(t.projetoId, p);
    }
    for (const [projetoId, p] of projetos) {
      const cat = loadCatalogo();
      if (cat.apps.some((a) => a.ferramenta === pm.nome && a.projetos_na_ferramenta.includes(projetoId))) continue;
      // Os projetos que já estão no Muxor (trazidos do Orca ou de antes) e as pastas dos espaços que ainda não estão.
      const jaNoHub = cat.apps.filter((a) => a.ferramenta === pm.nome || a.ferramenta === 'nenhuma');
      const pastasHub = new Set(cat.apps.map((a) => a.pasta));
      const opcoes = [
        ...jaNoHub.map((a) => ({ valor: `app|${a.app}`, rotulo: `${a.app} (já no Muxor)`, dica: a.pasta })),
        ...cat.espacos.flatMap((e) => subpastas(e.pasta).filter((n) => !pastasHub.has(join(e.pasta, n))).map((n) => ({ valor: `${e.id}|${n}`, rotulo: `${nomeEspaco(e)} / ${n}` }))),
      ];
      const escolha = await tela.escolher(`${nomeFer} · "${p.nome}" (${p.n} task(s), ex.: ${p.exemplo.slice(0, 50)}): em qual pasta roda?`, [
        ...opcoes,
        { valor: 'nova', rotulo: 'Criar uma pasta nova (sem repositório)' },
        { valor: 'depois', rotulo: 'Depois, pelo Telegram' },
      ]);
      if (escolha === 'depois') continue;
      if (escolha.startsWith('app|')) {
        const app = escolha.slice(4);
        ligarProjeto(app, projetoId, pm.nome as Ferramenta);
        tela.ok(`"${p.nome}" → ${app}`);
        continue;
      }
      let [espaco, pasta] = escolha.split('|');
      if (escolha === 'nova') {
        espaco = cat.espacos.length === 1 ? cat.espacos[0].id : await tela.escolher('Em qual espaço?', cat.espacos.map((e) => ({ valor: e.id, rotulo: nomeEspaco(e) })));
        pasta = slug(await tela.texto('Nome da pasta', { padrao: slug(p.nome), validar: (v) => (slug(v) ? undefined : 'Use letras ou números.') }));
        const caminho = join(cat.espacos.find((e) => e.id === espaco)!.pasta, pasta);
        if (!existsSync(caminho)) {
          mkdirSync(caminho, { recursive: true });
          ctx.registrar({ tipo: 'pasta', caminho });
        }
        // O Orca só aceita pastas com git: um git só local, sem remoto.
        if (!existsSync(join(caminho, '.git'))) await rodar('git', ['-C', caminho, 'init', '-q']);
      }
      ligar(cat.apps, { espaco, pasta, ferramenta: pm.nome as Ferramenta, projetoId });
      tela.ok(`"${p.nome}" → ${pasta}`);
    }
  }
}

function ligar(apps: App[], o: { espaco: string; pasta: string; ferramenta: Ferramenta; projetoId: string }) {
  const base = slug(o.pasta);
  const mesmo = apps.find((a) => a.espaco === o.espaco && basename(a.pasta) === o.pasta && a.ferramenta === o.ferramenta);
  if (mesmo) return ligarProjeto(mesmo.app, o.projetoId);
  // A mesma pasta em outra ferramenta vira outro app (um app tem uma ferramenta).
  const nome = apps.some((a) => a.app === base) ? `${base}-${o.ferramenta}` : base;
  adicionarApp({ app: nome, espaco: o.espaco, ferramenta: o.ferramenta, pasta: o.pasta, projeto: o.projetoId });
}

// ───────────────────────── 8. Telegram ─────────────────────────

export async function telegram(ctx: Ctx) {
  await pararServico(); // com o Muxor rodando, o Telegram não deixa outro programa ler as mensagens do bot
  tela.nota(
    [
      'O Muxor fala com você por um bot do Telegram só seu. Para criar:',
      '1. Abra o BotFather (link e QR abaixo) e mande /newbot',
      '2. Escolha um nome (ex.: Meu Hub) e um usuário terminado em "bot" (ex.: meuhub_tasks_bot)',
      '3. Ele responde com um token (123456789:ABC…). Copie o token inteiro.',
    ].join('\n'),
    'Telegram',
  );
  await tela.link('https://t.me/BotFather', 'BotFather (abra no celular pelo QR, ou no Mac)', { qr: true, abrir: true });
  let bot: { usuario: string } | null = null;
  let token = '';
  while (!bot) {
    token = await tela.segredo('Cole o token do bot (não aparece na tela)', (v) => (/^\d{6,}:[\w-]{30,}$/.test(v) ? undefined : 'O token tem o formato 123456789:ABC…'));
    try {
      bot = await tela.esperando('Conferindo o bot…', () => conferirBot(token), (b) => `Bot @${b.usuario} conferido`);
    } catch (e) {
      tela.erro((e as Error).message);
    }
  }
  ctx.definirEnv({ TELEGRAM_BOT_TOKEN: token });
  await tela.link(`https://t.me/${bot.usuario}`, `Abra o @${bot.usuario} e toque em Iniciar (ou mande /start)`, { qr: true, abrir: true });
  for (;;) {
    const dono = await tela.esperando('Esperando o seu /start no bot…', () => esperarDono(token), (d) => `Mensagem recebida de ${d.nome}`);
    if (await tela.sim(`É você (${dono.nome})? Só esta conversa vai poder usar o hub.`)) {
      ctx.definirEnv({ TELEGRAM_CHAT_ID: String(dono.chatId) });
      await mandar(token, dono.chatId, '✅ Muxor conectado. Volte ao terminal para terminar a configuração.');
      ctx.registrar({ tipo: 'telegram-bot', usuario: bot.usuario });
      tela.ok('Telegram pronto: chegou uma mensagem de confirmação no bot.');
      return;
    }
    tela.info('Então mande /start pela conta certa.');
  }
}

// ───────────────────────── 9. Orca e celular ─────────────────────────

const aparelhosMoveis = () => {
  try {
    return (JSON.parse(readFileSync(ORCA_APARELHOS, 'utf8')) as { scope?: string }[]).filter((d) => d.scope === 'mobile').length;
  } catch {
    return 0;
  }
};

export async function orca() {
  tela.nota(
    [
      'O Muxor abre as sessões do Claude com --permission-mode auto (o Claude pede aprovação só para o arriscado).',
      'Recomendado também para as sessões que você abrir à mão no Orca:',
      '  Orca → Settings → Agents → Claude → Launch arguments: --permission-mode auto',
    ].join('\n'),
    'Orca',
  );
  if (!(await tela.sim('Quer acompanhar e responder as sessões pelo celular, de qualquer rede?'))) return;
  const antes = aparelhosMoveis();
  tela.nota(
    [
      '1. Instale o app do Orca no celular (App Store ou Google Play: "Orca").',
      '2. No Orca do Mac, abra a opção de conectar um celular e escolha Relay: funciona em qualquer rede (4G, outra Wi-Fi).',
      '   A outra opção (LAN) só funciona com o celular na mesma Wi-Fi do Mac.',
      '3. No app do celular, leia o QR code que o Orca do Mac mostrar.',
    ].join('\n'),
    'Celular',
  );
  await tela.enter('Quando o celular aparecer conectado no Orca, aperte Enter');
  if (aparelhosMoveis() > antes) tela.ok('Celular pareado com o Orca.');
  else tela.aviso('Não vi um celular novo no Orca. Dá para parear depois, pelo mesmo caminho; o resto do Muxor não depende disso.');
}

// ───────────────────────── 10. Serviço ─────────────────────────

export async function servico(ctx: Ctx) {
  // Sandbox: o app do teste do passo final (tasks fictícias, sem ferramenta de gestão).
  const cat = loadCatalogo();
  if (!cat.apps.some((a) => a.app === 'sandbox')) {
    mkdirSync(ctx.casa.sandbox, { recursive: true });
    if (!existsSync(join(ctx.casa.sandbox, '.git'))) await rodar('git', ['-C', ctx.casa.sandbox, 'init', '-q']);
    adicionarApp({ app: 'sandbox', espaco: cat.espacos[0].id, ferramenta: 'teste', pasta: ctx.casa.sandbox, projeto: null });
  }
  const log = join(ctx.casa.logs, 'servico.log');
  mkdirSync(ctx.casa.logs, { recursive: true });
  const caminho = [dirname(process.execPath), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const plist = await tela.esperando(
    'Instalando o Muxor como serviço do Mac…',
    () =>
      instalarServico(
        conteudoPlist({
          node: process.execPath,
          repo: ctx.repo,
          log,
          ambiente: { HUB_DADOS_DIR: ctx.casa.dados, DOTENV_CONFIG_PATH: ctx.casa.env, PATH: [...new Set(caminho)].join(':'), HOME: homedir(), LANG: 'pt_BR.UTF-8' },
        }),
      ),
    () => 'Serviço instalado: o Muxor sobe sozinho quando você entra no Mac',
  );
  ctx.registrar({ tipo: 'launchagent', plist, rotulo: ROTULO });
  ctx.registrar({ tipo: 'keychain', servico: process.env.HUB_KEYCHAIN_SERVICO ?? 'hub-tasks' });
  const subiu = await tela.esperando('Esperando o Muxor ficar online…', () => esperarOnline(ctx), (ok) => (ok ? 'Muxor online (chegou o aviso no Telegram)' : 'O Muxor não ficou online'));
  if (!subiu) {
    const fim = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-12).join('\n') : '(sem log)';
    tela.nota(fim, `Últimas linhas de ${log}`);
    tela.info('Rode `./muxor diagnostico` para ver o que falta. Depois, `./muxor init` continua daqui.');
    throw new Interrompido();
  }
}

async function esperarOnline(ctx: Ctx, limiteMs = 90_000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const hoje = join(ctx.casa.logs, `hub-${new Date().toISOString().slice(0, 10)}.log`);
    if (existsSync(hoje) && readFileSync(hoje, 'utf8').includes('"hub: bot online"')) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// ───────────────────────── 11. Teste de ponta a ponta ─────────────────────────

export async function teste() {
  tela.info('Último passo: uma task de teste no sandbox, de ponta a ponta. O Claude abre no Orca, responde e o Muxor avisa no Telegram.');
  const { openDb } = await import('../../db.js');
  const db = openDb();
  const agora = new Date().toISOString();
  const taskId = `teste-init-${Date.now()}`;
  const titulo = 'Teste do muxor init: responda só com o bloco de resultado, sem alterar nada';
  const id = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks_vistas (ferramenta, task_id, espaco, titulo, projeto_id, projeto_nome, status, prazo, link, primeira_vez, ultima_vez)
       VALUES ('teste', ?, '', ?, NULL, 'sandbox', 'teste', NULL, NULL, ?, ?)`,
    ).run(taskId, titulo, agora, agora);
    const sel = Number(
      db
        .prepare(`INSERT INTO selecoes (ferramenta, task_id, data_resumo, app, estado, criado_em, atualizado_em) VALUES ('teste', ?, ?, 'sandbox', 'aguardando_despacho', ?, ?)`)
        .run(taskId, agora.slice(0, 10), agora, agora).lastInsertRowid,
    );
    db.prepare("INSERT INTO fila (app, selecao_id, criado_em) VALUES ('sandbox', ?, ?)").run(sel, agora);
    return sel;
  })();
  tela.info('Na primeira vez numa pasta, o Claude pergunta se confia nela: o Muxor avisa no Telegram, e você responde "Yes" no Orca.');
  const estado = await tela.esperando(
    'Rodando a task de teste (até 5 min)…',
    async () => {
      const fim = Date.now() + 5 * 60_000;
      let e = '';
      while (Date.now() < fim) {
        e = (db.prepare('SELECT estado FROM despachos WHERE selecao_id = ?').get(id) as { estado: string } | undefined)?.estado ?? '';
        if (['concluido', 'interrompido', 'encerrado'].includes(e)) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      return e;
    },
    (e) => (e === 'concluido' ? 'Task de teste concluída' : `Task de teste: ${e || 'não começou'}`),
  );
  db.close();
  if (estado !== 'concluido') {
    tela.aviso('A task de teste não terminou. Veja o que o Muxor disse no Telegram e rode `./muxor diagnostico`. Rodar `./muxor init` de novo refaz este teste.');
    throw new Interrompido();
  }
}

export function resumoFinal(ferramentasOk: string[]) {
  const linhas = [
    'Pelo Telegram (no bot que você criou):',
    '  /tarefas    suas tasks para escolher e mandar ao Claude',
    '  /nova       atividade avulsa, sem ferramenta de gestão',
    '  /menu       os outros comandos',
    ...(ferramentasOk.includes('funifier-pm') ? ['  /gamificacoes  cadastre as credenciais das gamificações da Funifier'] : []),
    '',
    'No terminal:',
    '  ./muxor diagnostico              confere tudo e diz o próximo passo',
    '  ./muxor adicionar github-workspace   outro espaço (outra conta do GitHub)',
    '  ./muxor adicionar projeto        traz mais projetos (do Orca ou das pastas) para o Muxor',
    '  ./muxor adicionar heartbeat      aviso se o Muxor cair (opcional)',
    '  ./muxor desinstalar              desfaz tudo o que o muxor init fez',
    '',
    'Na primeira task de cada projeto o Claude pergunta se confia na pasta: responda "Yes" no Orca.',
  ];
  tela.nota(linhas.join('\n'), 'Pronto');
}
