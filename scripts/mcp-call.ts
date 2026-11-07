// Chama UMA ferramenta MCP de LEITURA e imprime o resultado.
// Uso: npm run -s mcp:call -- <funifier-pm|bnexo> <ferramenta> '<json args>'
// Recusa ferramentas que não sejam de leitura (durante a construção nada pode ser alterado).
import { connect, type PmName } from '../src/pm/mcp-client.js';

const [name, tool, rawArgs] = process.argv.slice(2);
const READ_ONLY = /^(list|get|search|check|whoami|find|show|read|preview)/i;
if (!READ_ONLY.test(tool ?? '')) {
  console.error(`Ferramenta "${tool}" não parece ser de leitura; recusada.`);
  process.exit(1);
}

const client = await connect(name as PmName);
const res = await client.callTool({ name: tool, arguments: rawArgs ? JSON.parse(rawArgs) : {} });
for (const c of res.content as { type: string; text?: string }[]) {
  console.log(c.type === 'text' ? c.text : JSON.stringify(c));
}
if (res.structuredContent) console.log(JSON.stringify(res.structuredContent, null, 2));
await client.close();
process.exit(0);
