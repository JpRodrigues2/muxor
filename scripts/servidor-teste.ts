// Verificação do servidor sem Telegram: roda como o hub.service (usuário hub, mesmas variáveis e chave do cofre)
// e confere caminhos, cofre, Orca do agente e a pasta confiável. Não toca em tasks nem em ferramentas de gestão.
//   sudo systemd-run --wait --pipe -p User=hub -p WorkingDirectory=/home/hub/app \
//     -p LoadCredentialEncrypted=cofre-chave:/etc/hub/cofre-chave.cred <-E de cada Environment do hub.service> \
//     /usr/bin/npx tsx scripts/servidor-teste.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CofreArquivoCifrado } from '../src/adaptadores/cofre/arquivo-cifrado.js';
import { Orca } from '../src/adaptadores/executor/orca.js';
import { CAMINHOS, dirSessoesClaude } from '../src/caminhos.js';
import { clonar, gitEm, prepararPasta } from '../src/git.js';

let falhas = 0;
async function etapa(nome: string, fn: () => Promise<string | void>) {
  try {
    const r = await fn();
    console.log(`✅ ${nome}${r ? `: ${r}` : ''}`);
  } catch (e) {
    falhas++;
    console.log(`❌ ${nome}: ${(e as Error).message}`);
  }
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('caminhos:', JSON.stringify(CAMINHOS));

await etapa('cofre cifrado com a chave do systemd', async () => {
  const cofre = CofreArquivoCifrado.doSystemd(join(CAMINHOS.dados, 'cofre-teste.enc'));
  await cofre.salvar('verificacao', { api_key: 'teste', secret: 'teste' });
  if ((await cofre.obter('verificacao'))?.api_key !== 'teste') throw new Error('não leu de volta');
  await cofre.remover('verificacao');
  return 'grava, lê e remove';
});

const orca = new Orca(process.env.ORCA_BIN ?? 'orca-ide', process.env.ORCA_ENVIRONMENT);
await etapa('Orca do agente pelo pareamento', async () => {
  const st = await orca.status();
  if (!st.ok) throw new Error(`status ${st.estado}`);
  return `versão ${st.versao}`;
});

const pasta = join(CAMINHOS.repos, 'VERIFICACAO', `teste-${Date.now().toString(36)}`);
await etapa('pasta nova sem remoto (git só local, como o agente) aberta no Orca', async () => {
  await prepararPasta(pasta);
  await orca.addRepo(pasta);
  return pasta;
});

await etapa('clone como o agente, aberto no Orca', async () => {
  const destino = `${pasta}-clone`;
  await clonar('https://github.com/octocat/Hello-World.git', destino);
  const dono = await gitEm(destino, ['config', '--get', 'remote.origin.url']);
  await orca.addRepo(destino);
  const { statSync } = await import('node:fs');
  const { userInfo } = await import('node:os');
  return `origin ${dono}; dono uid ${statSync(destino).uid} (hub é ${userInfo().uid})`;
});

await etapa('sessão como agente, com a pasta marcada como confiável', async () => {
  const confiar = process.env.HUB_CONFIAR_PASTA_CMD;
  if (!confiar) throw new Error('sem HUB_CONFIAR_PASTA_CMD');
  const verifica = `python3 -c 'import json,os;print("CONFIAVEL", os.getlogin() if False else os.environ.get("USER"), json.load(open(os.path.expanduser("~/.claude.json")))["projects"][os.getcwd()]["hasTrustDialogAccepted"])'`;
  const handle = await orca.createTerminal(pasta, `${confiar} && ${verifica}`, 'verificacao');
  for (let i = 0; i < 20; i++) {
    const tela = (await orca.readScreen(handle, 20)).join('\n');
    const m = tela.match(/^CONFIAVEL (\S+) (\S+)$/m);
    if (m) {
      if (m[1] !== 'agente' || m[2] !== 'True') throw new Error(`rodou como ${m[1]}, confiável=${m[2]}`);
      return 'rodou como agente; confiável=True';
    }
    await dormir(500);
  }
  throw new Error('a verificação não apareceu na tela');
});

await etapa('hub lê a pasta de históricos do Claude do agente', async () => {
  const { readdirSync } = await import('node:fs');
  readdirSync(join(CAMINHOS.claude, 'projects'));
  return dirSessoesClaude(pasta);
});

await etapa('agente lê o que o hub grava em runs/', async () => {
  const { writeFileSync } = await import('node:fs');
  mkdirSync(CAMINHOS.runs, { recursive: true });
  const arq = join(CAMINHOS.runs, `verificacao-${Date.now().toString(36)}.md`);
  writeFileSync(arq, 'LEITURA-OK\n');
  const handle = await orca.createTerminal(pasta, `cat ${arq}; touch ${CAMINHOS.runs}/escrita-agente 2>&1 | grep -o 'Permission denied'`, 'verificacao-runs');
  for (let i = 0; i < 20; i++) {
    const tela = (await orca.readScreen(handle, 20)).join('\n');
    if (/LEITURA-OK/.test(tela) && /Permission denied/.test(tela)) return 'lê, mas não escreve';
    await dormir(500);
  }
  throw new Error('o agente não leu, ou conseguiu escrever');
});

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
// O CLI do Orca não tem "repo remove": os projetos de teste somem do Orca só pela interface.
console.log('Depois: tirar os projetos "teste-*" do Orca (⋯ no projeto → remover) e apagar /srv/hub/repos/VERIFICACAO e os runs.');
process.exit(falhas ? 1 : 0);
