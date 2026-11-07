// Verificação do broker com o funifier-mcp real, SÓ LEITURA: lista as ferramentas de uma gamificação do catálogo.
// Roda como o hub.service (usuário hub, chave do cofre pelo systemd), num broker próprio em outra porta:
//   sudo systemd-run --wait --pipe -p User=hub -p WorkingDirectory=/home/hub/app \
//     -p LoadCredentialEncrypted=cofre-chave:/etc/hub/cofre-chave.cred <-E de cada Environment do hub.service> \
//     /usr/bin/npx tsx scripts/broker-teste.ts <app> <gamificacao>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { join } from 'node:path';
import { CofreArquivoCifrado } from '../src/adaptadores/cofre/arquivo-cifrado.js';
import { ConexoesFunifier } from '../src/adaptadores/funifier/conexoes.js';
import { Broker } from '../src/broker/broker.js';
import { CAMINHOS } from '../src/caminhos.js';
import { loadCatalogo, loadEnv } from '../src/config.js';
import { idGamificacao } from '../src/dominio/broker.js';

const [appNome, nome] = process.argv.slice(2);
const env = loadEnv();
const app = loadCatalogo().apps.find((a) => a.app === appNome);
const g = app?.gamificacoes?.find((x) => x.nome === nome);
if (!app || !g) throw new Error(`gamificação ${appNome}/${nome} não está no catálogo`);

const token = 'verificacao';
const broker = new Broker({
  porta: 0,
  token,
  autorizadas: () => [{ id: idGamificacao(app.app, g.nome), app: app.app, selecaoId: 0, gamificacao: g }],
  conexoes: new ConexoesFunifier(CofreArquivoCifrado.doSystemd(join(CAMINHOS.dados, 'cofre.enc')), env.HUB_FUNIFIER_MCP),
  confirmador: { confirmar: async () => false },
  arquivoAuditoria: join(CAMINHOS.logs, 'broker-teste.jsonl'),
});
const porta = await broker.iniciar();
const c = new Client({ name: 'verificacao', version: '0' });
await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${porta}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const r = (await c.callTool({ name: 'funifier_ferramentas', arguments: { gamificacao: idGamificacao(app.app, g.nome) } })) as { content: { text: string }[]; isError?: boolean };
if (r.isError) console.log('❌', r.content[0].text);
else {
  const lista = JSON.parse(r.content[0].text) as { nome: string; classe: string; decisao: string }[];
  console.log(`✅ ${lista.length} ferramentas pelo broker`);
  for (const f of lista) console.log(`   ${f.nome}: ${f.classe} → ${f.decisao}`);
}
await c.close();
await broker.parar();
process.exit(0);
