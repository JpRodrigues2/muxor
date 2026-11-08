// Raiz de composição: o único lugar que escolhe os adaptadores concretos (Orca, cofre, ferramentas) e liga tudo.
// O resto do código só conhece as portas (src/aplicacao/portas.ts e PmAdapter).
import { Bot } from 'grammy';
import cron from 'node-cron';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { Cofre } from './aplicacao/portas.js';
import { CofreArquivoCifrado } from './adaptadores/cofre/arquivo-cifrado.js';
import { CofreKeychain } from './adaptadores/cofre/keychain.js';
import { NotificadorTelegram } from './adaptadores/chat/telegram.js';
import { ConexoesFunifier } from './adaptadores/funifier/conexoes.js';
import { Orca } from './adaptadores/executor/orca.js';
import { MemoriaSqlite, RepositorioDespachosSqlite, RepositorioResumosSqlite, RepositorioSelecoesSqlite } from './adaptadores/persistencia/sqlite.js';
import { criarDespacho } from './aplicacao/despacho/index.js';
import { criarSelecao } from './aplicacao/selecao/index.js';
import { Broker, autorizadasDoBanco } from './broker/broker.js';
import { CAMINHOS, ROOT } from './caminhos.js';
import { adicionarApp, ligarProjeto, loadCatalogo, loadEnv, migrarCatalogo, type Env } from './config.js';
import { tolerarConexaoOciosa } from './conexao-ociosa.js';
import { openDb } from './db.js';
import { gitProjetos } from './git.js';
import { INTERVALO_HEARTBEAT_MS, baterCoracao } from './heartbeat.js';
import { limparRuns } from './limpeza.js';
import { errInfo, log } from './logger.js';
import { BnexoAdapter } from './pm/bnexo.js';
import { FunifierPmAdapter } from './pm/funifier-pm.js';
import { JiraAdapter } from './pm/jira.js';
import type { PmAdapter } from './pm/types.js';
import { filtrarPorProjeto } from './projetos.js';
import { buscarTasks } from './resumo.js';
import { migrarCofreAntigo } from './segredos.js';
import { ICONE, cartao, esc } from './msg.js';
import { comandosDaLista, instalarBot, temFunifier } from './telegram.js';

function criarCofre(env: Env): Cofre {
  return env.HUB_COFRE === 'keychain'
    ? new CofreKeychain(process.env.HUB_KEYCHAIN_SERVICO)
    : CofreArquivoCifrado.doSystemd(join(CAMINHOS.dados, 'cofre.enc'));
}

const env = loadEnv();
// Commit em produção, gravado pelo deploy automático (deploy/atualizar.sh); no Mac não existe.
const VERSAO = (() => {
  try {
    return readFileSync(join(ROOT, '.versao'), 'utf8').trim().slice(0, 7);
  } catch {
    return '';
  }
})();
if (migrarCatalogo()) log.info('catálogo: migrado de empresas para espaços (B34); versão anterior no histórico');
loadCatalogo(); // falha cedo se o apps.yaml estiver inválido
const db = openDb();
const orca = new Orca(env.ORCA_BIN, env.ORCA_ENVIRONMENT);
const cofre = criarCofre(env);
await migrarCofreAntigo(cofre);
// Só as ferramentas de gestão configuradas (I3): nenhuma é obrigatória.
const adapters: PmAdapter[] = [
  ...(env.FUNIFIER_PM_MCP_URL ? [new FunifierPmAdapter(env)] : []),
  ...(env.BNEXO_MCP_URL && env.BNEXO_MCP_TOKEN ? [new BnexoAdapter(env, () => loadCatalogo().nomes_projetos.bnexo)] : []),
  ...(env.JIRA_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN ? [new JiraAdapter(env)] : []),
];

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
const notificador = new NotificadorTelegram(bot.api, Number(env.TELEGRAM_CHAT_ID));
const selecoes = new RepositorioSelecoesSqlite(db);
const memoria = new MemoriaSqlite(db);
const despachos = new RepositorioDespachosSqlite(db);
const despacho = criarDespacho({
  env,
  despachos,
  selecoes,
  memoria,
  executor: orca,
  notificador,
  cofre,
  gestao: adapters,
  git: gitProjetos,
  apps: () => loadCatalogo().apps,
});
const selecao = criarSelecao({
  env,
  selecoes,
  resumos: new RepositorioResumosSqlite(db),
  memoria,
  executor: orca,
  notificador,
  catalogo: { atual: loadCatalogo, adicionarApp, ligarProjeto },
  git: gitProjetos,
  buscar: () => buscarTasks(adapters, db),
  ferramentas: adapters.length,
  filtrar: (tasks) => filtrarPorProjeto(db, tasks),
});
const { confirmador } = instalarBot(bot, { env, db, orca, cofre, adapters, despacho, selecao });

// Broker: a sessão usa as gamificações pelo MCP do hub, sem ver a chave (docs/seguranca.md).
let broker: Broker | null = null;
if (env.HUB_BROKER === 'ligado') {
  if (!env.HUB_BROKER_TOKEN_ARQ) throw new Error('HUB_BROKER=ligado precisa de HUB_BROKER_TOKEN_ARQ');
  broker = new Broker({
    porta: env.HUB_BROKER_PORTA,
    token: readFileSync(env.HUB_BROKER_TOKEN_ARQ, 'utf8').trim(),
    autorizadas: autorizadasDoBanco(db),
    conexoes: new ConexoesFunifier(cofre, env.HUB_FUNIFIER_MCP),
    confirmador,
  });
  await broker.iniciar();
}

// Heartbeat (B24): ping externo a cada 5 min; o Healthchecks.io avisa quando os pings param.
if (env.HUB_HEARTBEAT_URL) {
  const url = env.HUB_HEARTBEAT_URL;
  void baterCoracao(url, orca);
  setInterval(() => void baterCoracao(url, orca), INTERVALO_HEARTBEAT_MS);
}

// Despacho: fila por app, a cada 30 s (e imediatamente após cada "Despachar").
setInterval(() => void despacho.despachar.processar(), 30_000);

// Resumo diário no horário configurado + verificação a cada 5 min para catch-up
// (computador desligado/dormindo no horário). Ambos são idempotentes por dia.
const [hh, mm] = env.RESUMO_HORARIO.split(':').map(Number);
cron.schedule(`${mm} ${hh} * * *`, () => selecao.resumo.talvezResumoDiario('agendado'), { timezone: env.TZ_HUB, noOverlap: true });
cron.schedule('*/5 * * * *', () => selecao.resumo.talvezResumoDiario('catch_up'), { timezone: env.TZ_HUB, noOverlap: true });

// Limpeza de runs/ de tasks encerradas há mais de 30 dias: todo dia às 04:00 e na inicialização.
cron.schedule('0 4 * * *', () => limparRuns(db), { timezone: env.TZ_HUB, noOverlap: true });
limparRuns(db);

await bot.api.setMyCommands(comandosDaLista({ funifier: temFunifier() }));

async function parar(sinal: string) {
  log.info('hub: encerrando', { sinal });
  await bot.stop();
  await broker?.parar();
  db.close();
  process.exit(0);
}
process.once('SIGINT', () => void parar('SIGINT'));
process.once('SIGTERM', () => void parar('SIGTERM'));
process.on('unhandledRejection', (e) => log.error('hub: promise rejeitada', errInfo(e)));
tolerarConexaoOciosa((e) => log.warn('hub: conexão ociosa encerrada pelo servidor', errInfo(e)));

log.info('hub: iniciando bot (long polling)', { escritaPm: env.HUB_ESCRITA_PM, cofre: env.HUB_COFRE, broker: env.HUB_BROKER, dados: CAMINHOS.dados });
await bot.start({
  onStart: (me) => {
    log.info('hub: bot online', { bot: me.username, resumoHorario: env.RESUMO_HORARIO });
    // Aviso de que o hub (re)começou: depois de deploy, reinício do servidor ou queda, o usuário sabe que voltou.
    const ativos = despachos.ativos().length;
    void notificador.enviar(
      cartao({
        icone: ICONE.status,
        titulo: 'Muxor online',
        contexto: [esc(hostname()), ...(VERSAO ? [`versão ${VERSAO}`] : []), `broker ${env.HUB_BROKER}`, `heartbeat ${env.HUB_HEARTBEAT_URL ? 'ligado' : 'desligado'}`, ativos ? `retomando ${ativos} task(s)` : 'nada rodando'],
      }),
    );
    void selecao.resumo.talvezResumoDiario('catch_up');
    void despacho.despachar.processar();
  },
});
