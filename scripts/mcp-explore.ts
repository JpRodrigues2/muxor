// Lista todas as ferramentas de cada MCP de gestão, com seus parâmetros.
// Uso: npm run mcp:explore [-- funifier-pm|bnexo]
// Saída completa (schemas) em data/mcp-tools-<nome>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, type PmName } from '../src/pm/mcp-client.js';

const targets: PmName[] = process.argv[2] ? [process.argv[2] as PmName] : ['bnexo', 'funifier-pm'];

for (const name of targets) {
  console.log(`\n===== ${name} =====`);
  try {
    const client = await connect(name);
    const info = client.getServerVersion();
    console.log(`Servidor: ${info?.name} ${info?.version}`);
    const tools = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    for (const t of tools) {
      const props = (t.inputSchema?.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
      const required = new Set((t.inputSchema?.required as string[] | undefined) ?? []);
      const params = Object.entries(props)
        .map(([k, v]) => `${k}${required.has(k) ? '' : '?'}:${v.enum ? v.enum.join('|') : (v.type ?? 'any')}`)
        .join(', ');
      const ro = t.annotations?.readOnlyHint ? ' [read-only]' : '';
      console.log(`- ${t.name}(${params})${ro}\n    ${(t.description ?? '').split('\n')[0].slice(0, 160)}`);
    }
    console.log(`Total: ${tools.length} ferramentas`);
    mkdirSync('data', { recursive: true });
    writeFileSync(`data/mcp-tools-${name}.json`, JSON.stringify(tools, null, 2));
    await client.close();
  } catch (e) {
    console.error(`Erro em ${name}: ${(e as Error).message}`);
  }
}
process.exit(0);
