// Os passos do muxor init no modo local (docs/onboarding.md §4). Cada um confere de verdade antes de seguir e, se
// falhar, diz o próximo passo. Tudo o que muda fora de ~/.muxor fica registrado para o muxor desinstalar.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { adicionarApp, appsDoProjeto, desligarProjeto, ligarProjeto, loadCatalogo, nomeEspaco, salvarEspaco, type App } from '../../config.js';
import { NOME_FERRAMENTA } from '../../dominio/selecao.js';
import { BnexoAdapter } from '../../pm/bnexo.js';
import { FunifierPmAdapter } from '../../pm/funifier-pm.js';
import { JiraAdapter } from '../../pm/jira.js';
import type { PmAdapter } from '../../pm/types.js';
import { ghDoEspaco, gitconfigDoEspaco } from '../casa.js';
import { rodar } from '../diagnostico.js';
import { destaque, tela } from '../tela.js';
import { MODELO_REGRAS, type Ctx } from './contexto.js';
import { aplicarContaGit } from './git-espaco.js';
import { conteudoPlist, instalarServico, pararServico, ROTULO } from './servico-mac.js';
import { claudeComLogin, esperar, Interrompido, ORCA_BIN, orcaAberto } from './preparar.js';
import { conferirBot, esperarDono, mandar } from './telegram.js';

export { Interrompido };
const ORCA_APARELHOS = join(homedir(), 'Library', 'Application Support', 'orca', 'orca-devices.json');
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

// ───────────────────────── 2. Modo ─────────────────────────

export async function escolherModo(ctx: Ctx): Promise<'local' | 'servidor'> {
  const modo = await tela.escolher(
    'Onde o Muxor vai rodar?',
    [
      { valor: 'local', rotulo: 'Neste Mac', dica: 'as tasks rodam com o Mac ligado' },
      { valor: 'servidor', rotulo: 'Num servidor meu', dica: 'roda 24 h, com o Mac desligado' },
    ],
    'local',
  );
  ctx.estado.modo = modo;
  ctx.salvar();
  if (modo === 'servidor') {
    tela.nota(
      'No servidor, a configuração roda lá. Siga o guia: muxor.com.br/docs/modo-servidor',
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
      await tela.esperando(`Conectando ao ${nome}`, fn, (r) => `${nome} conectado: ${r}`);
      return true;
    } catch (e) {
      tela.erro(`${nome}: ${(e as Error).message}`);
      if (!(await tela.sim('Tentar de novo?'))) return false;
    }
  }
}

export async function ferramentas(ctx: Ctx): Promise<Ferramenta[]> {
  let escolhidas: Ferramenta[] = [];
  for (;;) {
    escolhidas = await tela.varios<Ferramenta>('De onde vêm as suas tasks? Marque com Espaço', [
      { valor: 'funifier-pm', rotulo: 'Funifier PM' },
      { valor: 'bnexo', rotulo: 'Bnexo' },
      { valor: 'jira', rotulo: 'Jira Cloud' },
    ]);
    // Enter sem marcar nada costuma ser engano: confirma antes de seguir sem nenhuma.
    if (escolhidas.length || !(await tela.sim('Nenhuma marcada. Marcar de novo?'))) break;
  }
  ctx.definirEnv({
    TZ_HUB: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
    RESUMO_HORARIO: '09:00',
    HUB_ESCRITA_PM: 'true', // muda só para "em progresso" ao despachar e "concluída" com o seu Sim (B01, B04)
    HUB_COMENTARIOS_PM: 'false', // nunca comenta sem pedido (B02)
    ORCA_BIN,
  });
  if (!escolhidas.length) tela.aviso('Sem ferramenta de gestão, você manda atividades avulsas pelo /nova no Telegram.');

  const ok: Ferramenta[] = [];
  if (escolhidas.includes('funifier-pm')) {
    ctx.definirEnv({ FUNIFIER_PM_MCP_URL: 'https://pm-mcp.funifier.com/mcp' });
    tela.info('Funifier PM: o login abre no navegador. Entre, autorize o Muxor e volte aqui.');
    const { connect } = await import('../../pm/mcp-client.js');
    const conectou = await tentar('Funifier PM', async () => {
      const c = await connect('funifier-pm', { interactive: true });
      await c.close();
      const pm = new FunifierPmAdapter(ctx.envParcial());
      return await pm.ping().finally(() => pm.fechar());
    });
    if (conectou) ok.push('funifier-pm');
    else ctx.definirEnv({ FUNIFIER_PM_MCP_URL: null });
  }
  if (escolhidas.includes('bnexo')) {
    tela.info('Bnexo: pegue o endereço e o token em Configurações › Integrações › MCP.');
    const conectou = await tentar('Bnexo', async () => {
      ctx.definirEnv({
        BNEXO_MCP_URL: await tela.texto('Endereço do MCP do Bnexo', { validar: (v) => (/^https:\/\//.test(v) ? undefined : 'O endereço começa com https://') }),
        BNEXO_MCP_TOKEN: await tela.segredo('Token do MCP do Bnexo'),
      });
      const bnexo = new BnexoAdapter(ctx.envParcial(), () => ({}));
      return await bnexo.ping().finally(() => bnexo.fechar());
    });
    if (conectou) ok.push('bnexo');
    else ctx.definirEnv({ BNEXO_MCP_URL: null, BNEXO_MCP_TOKEN: null });
  }
  if (escolhidas.includes('jira')) {
    tela.info('Jira: abri a página do token no navegador. Clique em Create API token, dê o nome Muxor e copie o token.');
    await tela.link('https://id.atlassian.com/manage-profile/security/api-tokens', 'API token do Jira', { abrir: true });
    const conectou = await tentar('Jira', async () => {
      ctx.definirEnv({
        JIRA_URL: enderecoJira(await tela.texto('Nome do seu Jira, o que vem antes de .atlassian.net', { validar: (v) => (enderecoJira(v) ? undefined : 'Só o nome, ex.: minhaempresa') })),
        JIRA_EMAIL: await tela.texto('E-mail da conta Atlassian', { validar: (v) => (/^\S+@\S+$/.test(v) ? undefined : 'Digite o e-mail.') }),
        JIRA_API_TOKEN: await tela.segredo('API token do Jira'),
      });
      return await new JiraAdapter(ctx.envParcial()).ping();
    });
    if (conectou) ok.push('jira');
    else ctx.definirEnv({ JIRA_URL: null, JIRA_EMAIL: null, JIRA_API_TOKEN: null });
  }
  return ok;
}

// O endereço do Jira completo a partir do que a pessoa digitar: "minhaempresa", "minhaempresa.atlassian.net" ou a URL.
export function enderecoJira(v: string) {
  const t = v.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!t || !/^[a-z0-9.-]+$/.test(t)) return '';
  return `https://${t.includes('.') ? t : `${t}.atlassian.net`}`;
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
      'Um espaço é uma pasta ligada a uma conta do GitHub. Commit, push e PR feitos lá saem por essa conta.',
      'Exemplo: Empresa em ~/Documents/EMPRESA com a conta do trabalho, Pessoal em ~/Documents/PESSOAL com a sua.',
    ].join('\n'),
    'Espaços',
  );
  await esperar('gh');
  const usaFunifier = !!process.env.FUNIFIER_PM_MCP_URL;
  // Retomando (ou voltando a este passo): os espaços já criados ficam, e eu só pergunto se quer outro.
  const jaTem = loadCatalogo().espacos;
  if (jaTem.length) {
    tela.ok(`Seus espaços:\n${jaTem.map((e) => `  ${nomeEspaco(e)}  ${e.pasta}${e.github ? `  conta ${e.github}` : ''}`).join('\n')}`);
    if (!(await tela.sim('Criar mais um espaço?', false))) return;
  }
  do await novoEspaco(ctx, usaFunifier);
  while (await tela.sim('Criar outro espaço, com outra conta do GitHub?', false));
}

export async function novoEspaco(ctx: Ctx, usaFunifier: boolean) {
  const cat = loadCatalogo();
  const nome = await tela.texto('Nome do espaço, ex.: Empresa', {
    validar: (v) => (!slug(v) ? 'Use letras ou números.' : cat.espacos.some((e) => e.id === slug(v)) ? 'Já existe um espaço com esse nome.' : undefined),
  });
  const id = slug(nome);
  const pasta = expandir(
    await tela.texto('Pasta do espaço, onde ficam os projetos', {
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
      '1. Aperte Enter. O navegador abre no GitHub e o código já está copiado.',
      '2. Confira se o navegador está na conta deste espaço. Cole o código com Cmd+V e autorize.',
      '3. Se o terminal perguntar "Authenticate Git with your GitHub credentials?", responda N.',
    ].join('\n'),
    `GitHub do espaço ${nome}`,
  );
  for (;;) {
    const antes = await credenciaisGlobais();
    const code = await new Promise<number>((ok) => {
      const filho = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard', '--insecure-storage'], {
        stdio: ['inherit', 'inherit', 'pipe'],
        env: ghEnv,
      });
      // O gh mostra o código de uso único na saída de erro ("First copy your one-time code: ABCD-1234"): copio eu
      // mesmo para a área de transferência e mostro em destaque, sem depender do --clipboard do gh.
      let copiado = false;
      filho.stderr.on('data', (d: Buffer) => {
        process.stderr.write(d);
        const m = !copiado && d.toString().match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/);
        if (m) {
          copiado = true;
          void rodar('sh', ['-c', 'printf %s "$1" | pbcopy', 'sh', m[1]]);
          process.stderr.write(`\n  Código ${m[1]} copiado. No GitHub, cole com Cmd+V.\n\n`);
        }
      });
      filho.on('exit', (c) => ok(c ?? 1));
    });
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
  const nomeGit = await tela.texto('Nome nos commits', { padrao: u.name ?? u.login });
  const sugestao = u.email ?? `${u.id}+${u.login}@users.noreply.github.com`;
  tela.info(`E-mail da conta ${u.login}: ${sugestao}`);
  const emailGit = await tela.texto('E-mail nos commits. Digite ou cole o de cima', {
    validar: (v) => (/^\S+@\S+$/.test(v) ? undefined : 'Digite o e-mail.'),
  });
  const gh = (await rodar('which', ['gh'])).saida;
  const alt = await aplicarContaGit(gitconfigDoEspaco(ctx.casa, id), pasta, { nome: nomeGit, email: emailGit, gh, ghConfig });
  ctx.registrar({ tipo: 'gitconfig', ...alt });
  tela.ok(`Em ${pasta}, os commits saem como ${nomeGit} <${emailGit}>, pela conta ${u.login}.`);

  const gamificacao = usaFunifier ? await tela.sim('Os projetos deste espaço usam gamificações da Funifier?', false) : false;
  const regras = await tela.escolher(
    'Regras de trabalho do Claude neste espaço. Dá para editar depois pelo /regras',
    [
      { valor: 'modelo', rotulo: 'Usar o modelo', dica: 'branch nova, sem push na principal, commits sem menção a IA' },
      { valor: 'nenhuma', rotulo: 'Sem regras' },
    ],
    'modelo',
  );
  if (regras === 'modelo') {
    const destino = join(ctx.casa.dados, 'regras', `${id}.md`);
    mkdirSync(dirname(destino), { recursive: true });
    if (!existsSync(destino)) writeFileSync(destino, readFileSync(MODELO_REGRAS, 'utf8').replace(/^# .*$/m, `# Regras de trabalho — ${nome}`));
  }
  salvarEspaco({ id, nome, pasta, github: u.login, gh_config: ghConfig, ...(regras === 'nenhuma' ? { regras: 'nenhuma' } : {}), gamificacao });
  tela.ok(`Espaço ${nome} pronto.`);
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
    tela.info('Desfiz a mudança que o gh fez no seu ~/.gitconfig. O Muxor configura só a pasta do espaço.');
  }
}

// ───────────────────────── 5. Projetos que a pessoa já tem no Orca ─────────────────────────

export async function existentes(ctx: Ctx) {
  await orcaAberto();
  const { Orca } = await import('../../adaptadores/executor/orca.js');
  const cat = loadCatalogo();
  const noHub = new Set(cat.apps.map((a) => a.pasta));
  const doOrca = (await new Orca(ORCA_BIN).listRepos().catch(() => [])).filter((r) => r.path !== ctx.casa.sandbox);
  const jaNoMuxor = cat.apps.filter((a) => doOrca.some((r) => r.path === a.pasta));
  if (jaNoMuxor.length) tela.ok(`Já no Muxor:\n${jaNoMuxor.map((a) => `  ${a.app}  ${a.pasta}`).join('\n')}`);
  const repos = doOrca.filter((r) => !noHub.has(r.path));
  if (!repos.length) return tela.info(jaNoMuxor.length ? 'Todos os seus projetos do Orca já estão no Muxor.' : 'Nenhum projeto no Orca para trazer.');
  tela.info('Marque os projetos do Orca que o Muxor pode usar. Os outros ele nunca toca. Dá para trazer mais depois com muxor adicionar projeto.');
  const espacoDaPasta = (p: string) => cat.espacos.find((e) => p.startsWith(e.pasta.replace(/\/+$/, '') + '/'));
  const escolhidos = await tela.varios(
    'Quais projetos trazer? Marque com Espaço',
    repos.map((r) => ({
      valor: r.path,
      rotulo: r.displayName || basename(r.path),
      dica: r.path,
    })),
  );
  for (const pasta of escolhidos) {
    let e = espacoDaPasta(pasta);
    if (!e) {
      tela.aviso(`${basename(pasta)} fica fora das pastas dos espaços. Ali o git continua com a sua configuração de sempre.`);
      const id = cat.espacos.length === 1 ? cat.espacos[0].id : await tela.escolher(`Quais regras de trabalho valem para ${basename(pasta)}?`, cat.espacos.map((x) => ({ valor: x.id, rotulo: `As do espaço ${nomeEspaco(x)}` })));
      e = cat.espacos.find((x) => x.id === id)!;
    }
    const atuais = loadCatalogo().apps;
    const base = slug(basename(pasta)) || 'projeto';
    const nome = atuais.some((a) => a.app === base) ? `${base}-${slug(e.id)}` : base;
    adicionarApp({ app: nome, espaco: e.id, ferramenta: 'nenhuma', pasta, projeto: null });
    tela.ok(`${nome} entrou no Muxor.`);
  }
}

// ───────────────────────── 6. Repositórios (pelo Claude Code do usuário) ─────────────────────────

export async function repositorios(ctx: Ctx) {
  const cat = loadCatalogo();
  // Primeiro o que já está nos espaços: quem já tem os projetos só segue.
  const resumo = cat.espacos.map((e) => {
    const pastas = subpastas(e.pasta);
    return `  ${nomeEspaco(e)}: ${pastas.length ? pastas.slice(0, 8).join(', ') + (pastas.length > 8 ? ` e mais ${pastas.length - 8}` : '') : 'nenhum projeto'}`;
  });
  tela.nota(['Projetos que já estão nos seus espaços:', ...resumo].join('\n'), 'Baixar repositórios');
  const quer = await tela.escolher('Falta clonar algum repositório?', [
    { valor: 'nao', rotulo: 'Não, já tenho os projetos' },
    { valor: 'sim', rotulo: 'Sim, clonar agora com o Claude Code' },
  ]);
  if (quer === 'nao') return;
  await claudeComLogin();
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
      '1. Abra outra janela do Terminal com Cmd+N e rode claude',
      '2. Cole com Cmd+V. O pedido já está copiado: ele clona cada repositório no espaço da conta certa.',
      '3. Diga quais repositórios quer e volte aqui quando ele terminar.',
    ].join('\n'),
    'Clonar com o Claude Code',
  );
  await tela.enter('Quando o Claude terminar de clonar, aperte Enter');
  const total = cat.espacos.reduce((n, e) => n + subpastas(e.pasta).length, 0);
  tela.ok(`${total} projetos nos espaços.`);
}

const subpastas = (p: string) => (existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()) : []);

// ───────────────────────── 7. De-para: projeto da ferramenta → pasta ─────────────────────────

export async function dePara(ctx: Ctx) {
  const pms = adaptadores(ctx);
  if (!pms.length) return tela.info('Sem ferramenta de gestão, não há projetos para ligar.');
  tela.nota(
    [
      'Cada projeto da ferramenta de gestão roda numa pasta do seu Mac.',
      'Não precisa ligar tudo agora: quando você mandar uma task de um projeto sem pasta, o Telegram pergunta',
      'qual pasta usar. Assim você liga aos poucos, só os projetos que usar.',
    ].join('\n'),
    'Ligar projetos às pastas',
  );
  const agora = await tela.escolher('Como quer ligar?', [
    { valor: 'telegram', rotulo: 'Pelo Telegram, quando chegar cada task', dica: 'recomendado' },
    { valor: 'agora', rotulo: 'Agora, os projetos com tasks abertas' },
  ]);
  if (agora === 'telegram') return;
  try {
    await ligarProjetos(ctx, pms);
  } finally {
    await Promise.all(pms.map((pm) => pm.fechar?.()));
  }
}

interface ProjetoDaFerramenta {
  ferramenta: Ferramenta;
  nomeFer: string;
  projetoId: string;
  nome: string;
  exemplo: string;
  n: number;
}

export async function ligarProjetos(ctx: Ctx, pms: PmAdapter[]) {
  const projetos: ProjetoDaFerramenta[] = [];
  for (const pm of pms) {
    const nomeFer = NOME_FERRAMENTA[pm.nome] ?? pm.nome;
    const tasks = await tela.esperando(`Buscando suas tasks no ${nomeFer}`, () => pm.listMyTasks(), (t) => `${nomeFer}: ${t.length} ${t.length === 1 ? 'task aberta' : 'tasks abertas'}`);
    const porId = new Map<string, ProjetoDaFerramenta>();
    for (const t of tasks) {
      if (!t.projetoId) continue;
      const p = porId.get(t.projetoId) ?? { ferramenta: pm.nome as Ferramenta, nomeFer, projetoId: t.projetoId, nome: t.projetoNome ?? `projeto ${t.projetoId.slice(0, 8)}`, exemplo: t.titulo, n: 0 };
      p.n++;
      porId.set(t.projetoId, p);
    }
    projetos.push(...porId.values());
  }
  if (!projetos.length) return tela.info('Nenhuma task aberta agora. Você liga os projetos pelo Telegram, quando chegarem.');

  for (const p of projetos) await perguntarPasta(ctx, p);
  // Antes de seguir, o resumo: um Enter sem querer não passa do passo sem você ver como ficou.
  for (;;) {
    const cat = loadCatalogo();
    const destino = (p: ProjetoDaFerramenta) => appsDoProjeto(cat, p.ferramenta, p.projetoId)[0];
    tela.nota(projetos.map((p) => `${p.nomeFer} · ${p.nome}  →  ${destino(p) ? destino(p).app : 'pelo Telegram'}`).join('\n'), 'Como ficou');
    const escolha = await tela.escolher('Está certo?', [
      { valor: 'ok', rotulo: 'Sim, seguir' },
      ...projetos.map((p, i) => ({ valor: String(i), rotulo: `Mudar: ${p.nomeFer} · ${p.nome}` })),
    ]);
    if (escolha === 'ok') return;
    await perguntarPasta(ctx, projetos[Number(escolha)]);
  }
}

async function perguntarPasta(ctx: Ctx, p: ProjetoDaFerramenta) {
  const cat = loadCatalogo();
  const atual = appsDoProjeto(cat, p.ferramenta, p.projetoId)[0];
  const pastasHub = new Set(cat.apps.map((a) => a.pasta));
  const opcoes = [
    ...cat.apps
      .filter((a) => a === atual || a.ferramenta === p.ferramenta || a.ferramenta === 'nenhuma')
      .map((a) => ({ valor: `app|${a.app}`, rotulo: a.app, dica: a === atual ? 'ligado agora' : a.pasta })),
    ...cat.espacos.flatMap((e) =>
      subpastas(e.pasta)
        .filter((n) => !pastasHub.has(join(e.pasta, n)))
        .map((n) => ({ valor: `${e.id}|${n}`, rotulo: `${nomeEspaco(e)} / ${n}`, dica: 'pasta nova no Muxor' })),
    ),
    { valor: 'nova', rotulo: 'Criar uma pasta nova, sem repositório' },
    { valor: 'depois', rotulo: 'Decidir pelo Telegram' },
  ];
  const escolha = await tela.escolher(
    `Pasta de ${p.nomeFer} · ${p.nome}`,
    opcoes,
    atual ? `app|${atual.app}` : 'depois', // o cursor começa no que já vale (ou em "depois"): Enter sem querer não liga nada errado
  );
  if (escolha === (atual ? `app|${atual.app}` : '')) return;
  desligarProjeto(p.ferramenta, p.projetoId);
  if (escolha === 'depois') return;
  if (escolha.startsWith('app|')) {
    ligarProjeto(escolha.slice(4), p.projetoId, p.ferramenta);
    return;
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
  ligar(loadCatalogo().apps, { espaco, pasta, ferramenta: p.ferramenta, projetoId: p.projetoId });
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
      'O Muxor fala com você por um bot do Telegram só seu. Faça pelo celular:',
      '1. Leia o QR code abaixo com a câmera. Ele abre o BotFather no Telegram.',
      '2. Mande /newbot',
      '3. O BotFather pede dois nomes, um de cada vez:',
      '   primeiro, o nome que aparece nos contatos, ex.: Meu Muxor',
      '   depois, o usuário do bot, terminado em bot, ex.: meu_muxor_bot',
      '4. Ele responde com o token, uma linha como 123456789:AAH4kX. Copie e cole aqui.',
    ].join('\n'),
    'Bot do Telegram',
  );
  await tela.link('https://t.me/BotFather', 'BotFather', { qr: true });
  let bot: { usuario: string } | null = null;
  let token = '';
  while (!bot) {
    token = await tela.segredo('Token do bot', (v) => (/^\d{6,}:[\w-]{30,}$/.test(v) ? undefined : 'Copie a linha inteira do token, com os números, os dois-pontos e as letras.'));
    try {
      bot = await tela.esperando('Conferindo o bot', () => conferirBot(token), (b) => `Bot @${b.usuario} conferido`);
    } catch (e) {
      tela.erro((e as Error).message);
    }
  }
  ctx.definirEnv({ TELEGRAM_BOT_TOKEN: token });
  await tela.link(`https://t.me/${bot.usuario}`, `Leia com o celular, abra o @${bot.usuario} e toque em Iniciar`, { qr: true });
  for (;;) {
    const dono = await tela.esperando('Esperando você tocar em Iniciar no bot', () => esperarDono(token), (d) => `Chegou a mensagem de ${d.nome}`);
    if (await tela.sim(`${dono.nome} é você? Só esta conta vai usar o Muxor.`)) {
      ctx.definirEnv({ TELEGRAM_CHAT_ID: String(dono.chatId) });
      await mandar(token, dono.chatId, 'Muxor conectado. Volte ao terminal para terminar a configuração.');
      ctx.registrar({ tipo: 'telegram-bot', usuario: bot.usuario });
      tela.ok('Telegram pronto. Mandei uma mensagem de confirmação no bot.');
      return;
    }
    tela.info('Então toque em Iniciar pela sua conta.');
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
  if (!(await tela.sim('Quer acompanhar e responder as sessões pelo celular, em qualquer rede?'))) return;
  const antes = aparelhosMoveis();
  tela.nota(
    [
      '1. No celular, instale o app Orca pela App Store ou pelo Google Play.',
      '2. No Orca do Mac, abra Settings e clique em Mobile.',
      `3. Em "How the phone reaches this computer", escolha ${destaque('Orca Relay')}.`,
      `   ${destaque('Não use LAN')}: ela só funciona com o celular na mesma Wi-Fi do Mac.`,
      '4. Clique em Sign in for Relay e entre com a sua conta.',
      '5. Clique em Generate code. Aparece um QR code.',
      '6. No celular, abra o Orca, toque em Pair Desktop e leia o QR code.',
    ].join('\n'),
    'Orca no celular',
  );
  await tela.enter('Aperte Enter quando o celular aparecer pareado no Orca');
  if (aparelhosMoveis() > antes) tela.ok('Celular pareado com o Orca.');
  else tela.aviso('Não vi um celular novo no Orca. Dá para parear depois, pelo mesmo caminho. O resto funciona sem isso.');
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
    'Instalando o Muxor como serviço do Mac',
    () =>
      instalarServico(
        conteudoPlist({
          node: nodeEstavel(),
          repo: ctx.repo,
          log,
          ambiente: { HUB_DADOS_DIR: ctx.casa.dados, DOTENV_CONFIG_PATH: ctx.casa.env, PATH: [...new Set(caminho)].join(':'), HOME: homedir(), LANG: 'pt_BR.UTF-8' },
        }),
      ),
    () => 'Serviço instalado. O Muxor liga sozinho quando você entra no Mac',
  );
  ctx.registrar({ tipo: 'launchagent', plist, rotulo: ROTULO });
  ctx.registrar({ tipo: 'keychain', servico: process.env.HUB_KEYCHAIN_SERVICO ?? 'hub-tasks' });
  const subiu = await tela.esperando('Ligando o Muxor', () => esperarOnline(ctx), (ok) => (ok ? 'Muxor ligado. Chegou o aviso no Telegram' : 'O Muxor não ligou'));
  if (!subiu) {
    const fim = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-12).join('\n') : 'Sem registro';
    tela.nota(fim, `Últimas linhas de ${log}`);
    tela.info('Rode muxor diagnostico para ver o que falta. Depois, muxor init continua daqui.');
    throw new Interrompido();
  }
}

// O Node do Homebrew mora numa pasta com a versão (Cellar/node/25.1.0): o serviço usa o atalho estável, que continua
// valendo depois de um brew upgrade.
function nodeEstavel() {
  if (!process.execPath.includes('/Cellar/')) return process.execPath;
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find(existsSync) ?? process.execPath;
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
  tela.info('Último passo: uma task de teste numa pasta de teste. O Claude abre no Orca, responde, e o Muxor avisa no Telegram.');
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
  tela.info(`Na primeira vez numa pasta, o Claude pergunta se confia nela. Abra a sessão no Orca, no Mac ou no celular, e escolha ${destaque('Yes')}.`);
  const estado = await tela.esperando(
    'Rodando a task de teste, leva até 5 minutos',
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
    (e) => (e === 'concluido' ? 'Task de teste concluída' : `A task de teste ficou em: ${e || 'não começou'}`),
  );
  db.close();
  if (estado !== 'concluido') {
    tela.aviso('A task de teste não terminou. Veja a mensagem no Telegram e rode muxor diagnostico. Depois, muxor init refaz o teste.');
    throw new Interrompido();
  }
}

export function resumoFinal(ferramentasOk: string[]) {
  const linhas = [
    'No Telegram:',
    '  /tarefas       suas tasks, para mandar ao Claude',
    '  /nova          uma atividade avulsa',
    '  /menu          os outros comandos',
    ...(ferramentasOk.includes('funifier-pm') ? ['  /gamificacoes  as credenciais das gamificações'] : []),
    '',
    'No terminal:',
    '  muxor diagnostico                  confere tudo',
    '  muxor adicionar github-workspace   outro espaço',
    '  muxor adicionar projeto            mais projetos',
    '  muxor update                       a versão nova do Muxor',
    '  muxor desinstalar                  desfaz a instalação',
  ];
  tela.nota(linhas.join('\n'), 'Pronto');
}
