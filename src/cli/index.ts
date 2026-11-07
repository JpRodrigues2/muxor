// Comando `muxor` (terminal): a instalação e a manutenção do Muxor, fora do Telegram (O6).
// Antes de carregar o Muxor, aponta para os dados certos: no Mac, ~/.muxor (I5); no servidor, as variáveis do hub.service.
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { casaDoHub } from './casa.js';
import { rodar, variaveisDoServico, type Modo } from './diagnostico.js';

const AJUDA = `Uso: ./muxor <comando>   (de dentro da pasta do Muxor)

  init                            Configura o Muxor neste computador, passo a passo (retoma de onde parou)
  init --refazer <passo>          Refaz a partir de um passo (pre, modo, ferramentas, espacos, repositorios,
                                  existentes, depara, telegram, orca, servico, teste)
  diagnostico [--json]            Confere a instalação e diz o próximo passo de cada problema
  adicionar github-workspace      Um espaço novo (outra conta do GitHub)
  adicionar projeto               Traz para o Muxor projetos que já estão no Orca ou nas pastas dos espaços
  adicionar heartbeat             Aviso externo se o Muxor cair (Healthchecks.io)
  desinstalar                     Desfaz tudo o que o muxor init fez neste usuário

Guia completo: a pasta instalacao/ do repositório.`;

const modo: Modo = process.platform === 'darwin' ? 'local' : 'servidor';
const casa = casaDoHub();

async function prepararServidor() {
  const r = await rodar('systemctl', ['show', 'hub.service', '-p', 'Environment', '--value']);
  if (r.ok && r.saida) for (const [k, v] of Object.entries(variaveisDoServico(r.saida))) process.env[k] ??= v;
  if (userInfo().username !== 'hub') {
    console.error('No servidor, rode como o usuário hub (é ele quem lê a configuração):\n  sudo -u hub -i /home/hub/app/bin/muxor.mjs <comando>');
    process.exit(2);
  }
}

// No Mac: ~/.muxor quando existe (ou quando o muxor init vai criá-la); senão, a pasta do código, como na v1.
function prepararMac(criar: boolean) {
  if (process.env.HUB_DADOS_DIR || !(criar || existsSync(casa.dados))) return;
  process.env.HUB_DADOS_DIR = casa.dados;
  process.env.DOTENV_CONFIG_PATH = casa.env;
}

async function diagnostico(json: boolean) {
  process.env.HUB_LOG_SILENCIOSO = '1';
  const { CAMINHOS, ROOT, regrasPadrao } = await import('../caminhos.js');
  process.env.DOTENV_CONFIG_PATH ??= join(ROOT, '.env');
  const config = await import('../config.js');
  const { fontesDeRegras } = await import('../regras.js');
  const { Orca } = await import('../adaptadores/executor/orca.js');
  const { BnexoAdapter } = await import('../pm/bnexo.js');
  const { diagnosticar, formatarTexto, achaArquivoRegras } = await import('./diagnostico.js');

  const itens = await diagnosticar({
    modo,
    rodar,
    env: process.env,
    carregarEnv: async () => config.loadEnv(),
    carregarCatalogo: async () => config.loadCatalogo(),
    fontesDeRegras,
    arquivoRegras: achaArquivoRegras(CAMINHOS.regras, regrasPadrao),
    caminhos: CAMINHOS,
    arquivoEnv: process.env.DOTENV_CONFIG_PATH,
    statusOrca: (env) => new Orca(env.ORCA_BIN, env.ORCA_ENVIRONMENT).status(),
    reposNoOrca: async (env) => (await new Orca(env.ORCA_BIN, env.ORCA_ENVIRONMENT).listRepos()).map((r) => r.path),
    telegram: async (token) => {
      try {
        const r = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) })).json()) as {
          ok: boolean;
          result?: { username: string };
          description?: string;
        };
        return r.ok ? { ok: true, usuario: r.result?.username } : { ok: false, erro: r.description };
      } catch (e) {
        return { ok: false, erro: `sem resposta do Telegram (${(e as Error).message})` };
      }
    },
    bnexo: () => new BnexoAdapter(config.loadEnv(), () => ({})).ping(),
    jira: async () => new (await import('../pm/jira.js')).JiraAdapter(config.loadEnv()).ping(),
  });
  console.log(json ? JSON.stringify({ modo, itens }, null, 2) : formatarTexto(itens));
  return itens.some((i) => i.estado === 'falha') ? 1 : 0;
}

async function contexto() {
  const { lerEstado } = await import('./estado.js');
  const { criarCtx } = await import('./init/contexto.js');
  return criarCtx(casa, lerEstado(casa.estado));
}

async function adicionar(o: string | undefined) {
  const { tela, Parou } = await import('./tela.js');
  try {
    if (o === 'github-workspace') {
      if (modo !== 'local') return (console.error('No servidor, os espaços ainda são configurados à mão (instalacao/modo-servidor.md).'), 2);
      const p = await import('./init/passos.js');
      tela.abertura('Novo espaço (conta do GitHub)');
      await p.novoEspaco(await contexto(), !!process.env.FUNIFIER_PM_MCP_URL);
      tela.fim('Traga os repositórios para a pasta do espaço; os projetos novos eu ligo pelo Telegram quando chegar uma task.');
      return 0;
    }
    if (o === 'projeto') {
      if (modo !== 'local') return (console.error('No servidor, os projetos entram pelo Telegram, ao iniciar uma task.'), 2);
      const p = await import('./init/passos.js');
      const ctx = await contexto();
      tela.abertura('Trazer projetos para o Muxor');
      await p.existentes(ctx);
      await p.dePara(ctx);
      tela.fim('Pronto. Os projetos que entraram já recebem tasks; os que ficaram de fora o Muxor não toca.');
      return 0;
    }
    if (o === 'heartbeat') {
      tela.abertura('Heartbeat (Healthchecks.io)');
      tela.info('Crie um check em healthchecks.io (Period 5 minutes, Grace 10 minutes) e copie o "Ping URL". Passo a passo: instalacao/heartbeat.md');
      const url = await tela.segredo('Cole o Ping URL (https://hc-ping.com/…)', (v) => (/^https:\/\/hc-ping\.com\/\S+$/.test(v) ? undefined : 'Começa com https://hc-ping.com/'));
      if (modo !== 'local') return (console.error('No servidor: ponha HUB_HEARTBEAT_URL no /home/hub/dados/.env e reinicie o hub.service.'), 2);
      (await contexto()).definirEnv({ HUB_HEARTBEAT_URL: url });
      const { ROTULO } = await import('./init/servico-mac.js');
      await rodar('launchctl', ['kickstart', '-k', `gui/${userInfo().uid}/${ROTULO}`]);
      tela.fim('Heartbeat ligado. O "Hub online" no Telegram passa a dizer "heartbeat ligado".');
      return 0;
    }
  } catch (e) {
    if (e instanceof Parou) return (tela.fim('Nada foi alterado.'), 1);
    throw e;
  }
  console.log(AJUDA);
  return 2;
}

const [comando, ...resto] = process.argv.slice(2);
let codigo = 0;
if (modo === 'servidor' && comando && comando !== 'ajuda') await prepararServidor();
if (comando === 'diagnostico') {
  prepararMac(false);
  codigo = await diagnostico(resto.includes('--json'));
} else if (comando === 'init') {
  if (modo !== 'local') {
    console.error('No servidor, o muxor init ainda não está pronto: siga instalacao/modo-servidor.md.');
    codigo = 2;
  } else {
    prepararMac(true);
    process.env.HUB_LOG_SILENCIOSO = '1';
    const i = resto.indexOf('--refazer');
    codigo = await (await import('./init/index.js')).init(casa, i >= 0 ? resto[i + 1] : undefined);
  }
} else if (comando === 'adicionar') {
  prepararMac(false);
  process.env.HUB_LOG_SILENCIOSO = '1';
  codigo = await adicionar(resto[0]);
} else if (comando === 'desinstalar') {
  codigo = modo === 'local' ? await (await import('./desinstalar.js')).desinstalar(casa) : (console.error('No servidor, siga instalacao/modo-servidor.md (seção "Remover").'), 2);
} else {
  console.log(AJUDA);
  if (comando && comando !== 'ajuda' && comando !== '--help') codigo = 2;
}
// Conexões abertas (MCP, Orca) não seguram o terminal; o atraso deixa a saída terminar de ser escrita.
process.exitCode = codigo;
setTimeout(() => process.exit(), 100).unref();
