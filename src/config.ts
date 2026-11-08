// Leitura e validação do .env e do apps.yaml.
import 'dotenv/config';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse, parseDocument, type Document } from 'yaml';
import { z } from 'zod';
import { CAMINHOS, resolverPasta } from './caminhos.js';

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/, 'TELEGRAM_CHAT_ID precisa ser numérico'),
  // Ferramentas de gestão: cada uma liga só se configurada (I3); o hub init grava as escolhidas.
  BNEXO_MCP_URL: z.url().optional(),
  BNEXO_MCP_TOKEN: z.string().min(10).optional(),
  FUNIFIER_PM_MCP_URL: z.url().optional(),
  // Jira Cloud: endereço do site, e-mail da conta e API token (id.atlassian.com → Segurança → Tokens de API).
  JIRA_URL: z.url().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().min(10).optional(),
  RESUMO_HORARIO: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  TZ_HUB: z.string().default('America/Sao_Paulo'),
  ORCA_BIN: z.string().default('/Applications/Orca.app/Contents/Resources/bin/orca'),
  // Pareamento salvo no CLI do Orca (`orca environment add`) quando o Orca roda com outro usuário (servidor).
  ORCA_ENVIRONMENT: z.string().optional(),
  // Comando que marca a pasta como confiável no Claude de quem roda as sessões, antes de abrir o Claude (servidor).
  HUB_CONFIAR_PASTA_CMD: z.string().optional(),
  // Cofre das credenciais: Keychain no Mac, arquivo cifrado no servidor (chave-mestra do systemd-creds).
  HUB_COFRE: z.enum(['keychain', 'arquivo-cifrado']).default(process.platform === 'darwin' ? 'keychain' : 'arquivo-cifrado'),
  // Broker: a sessão usa a Funifier pelo MCP do hub e não recebe mais o credenciais.json (docs/seguranca.md).
  HUB_BROKER: z.enum(['ligado', 'desligado']).default('desligado'),
  HUB_BROKER_PORTA: z.coerce.number().int().default(7790),
  // Arquivo com o token que a sessão manda ao broker (o mesmo registrado no MCP "hub" do Claude do agente).
  HUB_BROKER_TOKEN_ARQ: z.string().optional(),
  HUB_FUNIFIER_MCP: z.string().default('npx -y funifier-mcp@0.8.1'),
  // Heartbeat (B24): endereço de ping do Healthchecks.io. Sem ele, o hub não manda batimento.
  HUB_HEARTBEAT_URL: z.url().optional(),
  // Modo de permissão das sessões do Claude que o hub abre (auto = classificador aprova o seguro e pede aprovação para o arriscado; bypassPermissions é proibido).
  HUB_CLAUDE_PERMISSAO: z.enum(['auto', 'acceptEdits', 'manual', 'plan']).default('auto'),
  // Trava de segurança: enquanto for false, o hub não muda status nas ferramentas de gestão.
  HUB_ESCRITA_PM: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Comentários nas tasks: bloqueados por padrão; o hub só comenta com comando explícito do usuário (B02).
  HUB_COMENTARIOS_PM: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Se definido (IDs separados por vírgula), a escrita vale SÓ para essas tasks — para testar com tasks aprovadas.
  HUB_ESCRITA_PM_SOMENTE: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null)),
});
export type Env = z.infer<typeof EnvSchema>;

const GamificacaoSchema = z.object({
  nome: z.string(),
  servidor: z.string(),
  conta: z.string(),
  padrao: z.boolean().default(false),
  // Id das credenciais (API key + secret) no Cofre — nunca a credencial em si.
  credencial: z.string().optional(),
  // Sem o campo, o broker trata como produção o nome que começa com "prod".
  ambiente: z.enum(['dev', 'producao']).optional(),
});

// Espaço (O4): uma pasta-mãe por conta do GitHub. As ferramentas de gestão não definem espaço.
const EspacoSchema = z.object({
  id: z.string().regex(/^[a-z0-9._-]+$/),
  nome: z.string().optional(),
  pasta: z.string().min(1).transform((p) => resolverPasta(p)), // relativa: dentro de HUB_REPOS_DIR
  github: z.string().optional(), // conta do GitHub do espaço (login configurado pelo hub init)
  // Pasta do login do gh deste espaço (GH_CONFIG_DIR): as sessões abrem com ela, e push e PR saem pela conta certa.
  gh_config: z.string().regex(/^\/[A-Za-z0-9/._-]+$/).optional(),
  regras: z.string().optional(), // O14: arquivo em regras/ (sem .md) ou "nenhuma"; padrão: o id do espaço
  gamificacao: z.boolean().default(false), // projetos usam gamificações da Funifier (a task escolhe o alvo)
});

const AppSchema = z.object({
  app: z.string().regex(/^[a-z0-9._-]+$/),
  espaco: z.string(),
  // teste = tasks fictícias (sandbox); nenhuma = projeto trazido para o hub sem ferramenta de gestão (recebe /nova e
  // adota a ferramenta do primeiro projeto ligado a ele)
  ferramenta: z.enum(['funifier-pm', 'bnexo', 'jira', 'teste', 'nenhuma']),
  projetos_na_ferramenta: z.array(z.string()).default([]),
  pasta: z.string().min(1), // relativa: dentro da pasta do espaço
  sessao_resume_id: z.string().nullable().default(null),
  gamificacoes: z.array(GamificacaoSchema).optional(),
  gamificacao: z.boolean().optional(), // sem o campo, vale o do espaço
  regras: z.string().optional(), // O14: regra própria (arquivo) ou "nenhuma"; sem o campo, a do espaço
});
export type Espaco = z.infer<typeof EspacoSchema>;
export type Gamificacao = z.infer<typeof GamificacaoSchema>;
// App como o resto do hub usa: pasta absoluta e o que herda do espaço já resolvido.
export type App = Omit<z.infer<typeof AppSchema>, 'gamificacao' | 'regras'> & {
  gamificacao: boolean;
  regras: string | null; // arquivo das regras (sem .md); null = nenhuma
  gh_config?: string; // do espaço
};

const CatalogoSchema = z.object({
  espacos: z.array(EspacoSchema).default([]),
  apps: z.array(AppSchema),
  nao_mapeados: z
    .object({ 'funifier-pm': z.array(z.string()).default([]), bnexo: z.array(z.string()).default([]) })
    .default({ 'funifier-pm': [], bnexo: [] }),
  nomes_projetos: z.object({ bnexo: z.record(z.string(), z.string()).default({}) }).default({ bnexo: {} }),
});
export type Catalogo = Omit<z.infer<typeof CatalogoSchema>, 'apps'> & { apps: App[] };

function formatIssues(e: z.ZodError) {
  return e.issues.map((i) => `${i.path.join('.')}: ${/received undefined/.test(i.message) ? 'falta' : i.message}`).join('; ');
}

export function loadEnv(): Env {
  const r = EnvSchema.safeParse(process.env);
  if (!r.success) throw new Error(`.env inválido — ${formatIssues(r.error)}`);
  return r.data;
}

export const APPS_FILE = CAMINHOS.apps;
const CATALOGO_VAZIO = 'apps: []\n';

function lerArquivoCatalogo() {
  return existsSync(APPS_FILE) ? readFileSync(APPS_FILE, 'utf8') : CATALOGO_VAZIO;
}

// Relido a cada uso (antes de cada resumo / /status), para pegar edições sem reiniciar o bot.
// Sem apps.yaml (servidor novo), o catálogo começa vazio e o arquivo nasce na primeira edição.
export function loadCatalogo(): Catalogo {
  const bruto = parse(lerArquivoCatalogo());
  if (ehCatalogoAntigo(bruto)) throw new Error('apps.yaml no formato antigo (com "empresa"): o hub migra ao iniciar (migrarCatalogo)');
  const r = CatalogoSchema.safeParse(bruto);
  if (!r.success) throw new Error(`apps.yaml inválido — ${formatIssues(r.error)}`);
  return resolverCatalogo(r.data);
}

// Valida as referências e resolve o que o app herda do espaço (pasta, gamificação, regras).
function resolverCatalogo(c: z.infer<typeof CatalogoSchema>): Catalogo {
  const espacos = new Map<string, Espaco>();
  for (const e of c.espacos) {
    if (espacos.has(e.id)) throw new Error(`apps.yaml: espaço duplicado "${e.id}"`);
    espacos.set(e.id, e);
  }
  const nomes = new Set<string>();
  const apps = c.apps.map((a): App => {
    if (nomes.has(a.app)) throw new Error(`apps.yaml: app duplicado "${a.app}"`);
    nomes.add(a.app);
    const e = espacos.get(a.espaco);
    if (!e) throw new Error(`apps.yaml: o app "${a.app}" usa o espaço "${a.espaco}", que não existe`);
    const regras = a.regras ?? e.regras ?? e.id;
    return {
      ...a,
      pasta: isAbsolute(a.pasta) ? resolve(a.pasta) : resolve(e.pasta, a.pasta),
      gamificacao: a.gamificacao ?? e.gamificacao,
      regras: regras === 'nenhuma' ? null : regras,
      ...(e.gh_config ? { gh_config: e.gh_config } : {}),
    };
  });
  return { ...c, apps };
}

export function espacoDe(cat: Catalogo, id: string): Espaco | undefined {
  return cat.espacos.find((e) => e.id === id);
}

export const nomeEspaco = (e: Pick<Espaco, 'id' | 'nome'>) => e.nome ?? e.id;

// ─────────────── migração do formato antigo (empresa funifier/dac) para espaços (B34) ───────────────

const ESPACOS_ANTIGOS = [
  { id: 'funifier', nome: 'Funifier', pasta: 'FUNIFIER', gamificacao: true },
  { id: 'dac', nome: 'DAC', pasta: 'DAC' },
];

function ehCatalogoAntigo(bruto: unknown) {
  const c = bruto as { espacos?: unknown; apps?: { empresa?: unknown }[] } | null;
  return !!c && !c.espacos && !!c.apps?.some((a) => a.empresa !== undefined);
}

// Cada empresa vira um espaço com o mesmo id (os dados do banco continuam valendo) e a pasta de cada app passa a ser
// relativa à pasta do espaço (fora dela, fica absoluta). Guarda a versão anterior no histórico. true = migrou.
export function migrarCatalogo(): boolean {
  if (!ehCatalogoAntigo(parse(lerArquivoCatalogo()))) return false;
  editarCatalogo((doc) => {
    const usados = new Set((doc.toJS().apps as { empresa: string }[]).map((a) => a.empresa));
    const espacos = ESPACOS_ANTIGOS.filter((e) => usados.has(e.id));
    doc.set('espacos', doc.createNode(espacos, { flow: false }));
    const apps = doc.toJS().apps as { empresa: string; pasta: string }[];
    apps.forEach((a, i) => {
      const base = resolverPasta(espacos.find((e) => e.id === a.empresa)!.pasta);
      const antiga = resolverPasta(a.pasta);
      const rel = relative(base, antiga);
      // Renomeia a chave no lugar: mantém a posição e o comentário da linha.
      const par = (doc.getIn(['apps', i]) as { items: { key: { value: string } }[] }).items.find((x) => x.key.value === 'empresa')!;
      par.key.value = 'espaco';
      doc.setIn(['apps', i, 'pasta'], rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : antiga);
    });
    // "espacos" antes de "apps", para ler de cima para baixo.
    const itens = (doc.contents as { items: { key: { value: string } }[] }).items;
    const i = itens.findIndex((x) => x.key.value === 'espacos');
    itens.unshift(...itens.splice(i, 1));
  });
  return true;
}

export function appsDoProjeto(cat: Catalogo, ferramenta: App['ferramenta'], projetoId: string): App[] {
  return cat.apps.filter((a) => a.ferramenta === ferramenta && a.projetos_na_ferramenta.includes(projetoId));
}

export function pastaExiste(a: App) {
  return existsSync(a.pasta);
}

// ─────────────── edição do apps.yaml pelo Telegram (B15) ───────────────
// Edita preservando os comentários; valida o resultado antes de gravar e guarda a versão anterior em data/.

function editarCatalogo(fn: (doc: Document.Parsed) => void) {
  const original = lerArquivoCatalogo();
  const doc = parseDocument(original);
  fn(doc);
  const novo = doc.toString();
  const r = CatalogoSchema.safeParse(parse(novo));
  if (!r.success) throw new Error(`apps.yaml ficaria inválido — ${formatIssues(r.error)}`);
  resolverCatalogo(r.data); // referências (espaço do app) também
  if (existsSync(APPS_FILE)) {
    const hist = join(CAMINHOS.dados, 'apps-historico');
    mkdirSync(hist, { recursive: true });
    copyFileSync(APPS_FILE, join(hist, `apps-${new Date().toISOString().replace(/[:.]/g, '-')}.yaml`));
  }
  writeFileSync(APPS_FILE, novo);
}

function indiceApp(doc: Document.Parsed, nome: string) {
  const apps = doc.toJS().apps as { app: string }[];
  const i = apps.findIndex((a) => a.app === nome);
  if (i < 0) throw new Error(`app "${nome}" não existe no apps.yaml`);
  return i;
}

export function adicionarApp(a: { app: string; espaco: string; ferramenta: App['ferramenta']; pasta: string; projeto: string | null }) {
  editarCatalogo((doc) => {
    if ((doc.toJS().apps as { app: string }[]).some((x) => x.app === a.app)) throw new Error(`já existe um app "${a.app}"`);
    doc.addIn(['apps'], {
      app: a.app,
      espaco: a.espaco,
      ferramenta: a.ferramenta,
      projetos_na_ferramenta: a.projeto ? [a.projeto] : [],
      pasta: a.pasta,
      sessao_resume_id: null,
      gamificacoes: [],
    });
  });
}

// Espaço novo (hub init, hub adicionar github-workspace); se o id já existe, atualiza os campos.
export function salvarEspaco(e: { id: string; nome?: string; pasta: string; github?: string; gh_config?: string; regras?: string; gamificacao?: boolean }) {
  editarCatalogo((doc) => {
    if (!doc.has('espacos')) {
      doc.set('espacos', doc.createNode([], { flow: false }));
      const itens = (doc.contents as { items: { key: { value: string } }[] }).items;
      itens.unshift(...itens.splice(itens.findIndex((x) => x.key.value === 'espacos'), 1));
    }
    const lista = (doc.toJS().espacos ?? []) as { id: string }[];
    const limpo = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
    const i = lista.findIndex((x) => x.id === e.id);
    if (i < 0) doc.addIn(['espacos'], limpo);
    else for (const [k, v] of Object.entries(limpo)) doc.setIn(['espacos', i, k], v);
  });
}

// Liga o projeto da ferramenta ao app. App sem ferramenta ("nenhuma") passa a ser dessa ferramenta.
export function ligarProjeto(app: string, projeto: string, ferramenta?: App['ferramenta']) {
  editarCatalogo((doc) => {
    const i = indiceApp(doc, app);
    if (ferramenta && doc.getIn(['apps', i, 'ferramenta']) === 'nenhuma') doc.setIn(['apps', i, 'ferramenta'], ferramenta);
    const atuais = (doc.getIn(['apps', i, 'projetos_na_ferramenta']) as { toJSON(): string[] } | undefined)?.toJSON() ?? [];
    if (atuais.includes(projeto)) return;
    // Sem a lista (app escrito à mão), cria; senão acrescenta.
    if (!doc.hasIn(['apps', i, 'projetos_na_ferramenta'])) doc.setIn(['apps', i, 'projetos_na_ferramenta'], doc.createNode([projeto]));
    else doc.addIn(['apps', i, 'projetos_na_ferramenta'], projeto);
  });
}

// Tira o projeto da ferramenta de todas as pastas (para religar em outra, ou deixar para decidir depois).
export function desligarProjeto(ferramenta: App['ferramenta'], projeto: string) {
  if (!appsDoProjeto(loadCatalogo(), ferramenta, projeto).length) return;
  editarCatalogo((doc) => {
    const apps = doc.toJS().apps as { ferramenta?: string; projetos_na_ferramenta?: string[] }[];
    apps.forEach((a, i) => {
      const j = a.ferramenta === ferramenta ? (a.projetos_na_ferramenta ?? []).indexOf(projeto) : -1;
      if (j >= 0) doc.deleteIn(['apps', i, 'projetos_na_ferramenta', j]);
    });
  });
}

export function adicionarGamificacao(app: string, g: Gamificacao) {
  editarCatalogo((doc) => {
    const i = indiceApp(doc, app);
    // `gamificacoes: []` é uma lista entre colchetes; a primeira gamificação troca por lista em bloco (uma por linha).
    const atual = doc.getIn(['apps', i, 'gamificacoes']) as { items?: unknown[] } | undefined;
    if (!atual?.items?.length) doc.setIn(['apps', i, 'gamificacoes'], doc.createNode([], { flow: false }));
    doc.addIn(['apps', i, 'gamificacoes'], Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined)));
  });
}

export function removerGamificacao(app: string, indice: number) {
  editarCatalogo((doc) => {
    doc.deleteIn(['apps', indiceApp(doc, app), 'gamificacoes', indice]);
  });
}
