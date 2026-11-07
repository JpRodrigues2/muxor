// funifier-mcp falso para os testes do broker: mesmas anotações das ferramentas reais, sem rede.
// Responde se recebeu a chave pelo ambiente, sem nunca devolver o valor.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const s = new McpServer({ name: 'funifier-falso', version: '0.0.0' });
const ok = (t) => ({ content: [{ type: 'text', text: t }] });
const temChave = () => (process.env.FUNIFIER_API_KEY && process.env.FUNIFIER_SECRET_KEY ? 'sim' : 'não');

s.registerTool('get', { inputSchema: { id: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false } }, async ({ id }) =>
  ok(`get ${id} em ${process.env.FUNIFIER_SERVER_URL}, chave: ${temChave()}`),
);
s.registerTool('save', { inputSchema: { id: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false } }, async ({ id }) => ok(`save ${id}`));
s.registerTool('delete', { inputSchema: { id: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true } }, async ({ id }) => ok(`delete ${id}`));
s.registerTool('funifier_connect', { inputSchema: { apiKey: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ok('conectado'));

await s.connect(new StdioServerTransport());
