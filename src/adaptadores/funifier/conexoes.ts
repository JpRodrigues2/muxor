// Conexões do broker com o funifier-mcp: um processo filho por credencial, rodando como o usuário do hub,
// com a chave só no ambiente dele (o agente, outro usuário, não lê). Ficam abertas e fecham depois de ociosas.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Cofre } from '../../aplicacao/portas.js';
import { CAMINHOS } from '../../caminhos.js';
import { log } from '../../logger.js';

const OCIOSA_MS = 15 * 60_000;

export interface Ferramenta {
  name: string;
  description?: string;
  inputSchema: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface ConexaoFunifier {
  ferramentas(): Promise<Ferramenta[]>;
  chamar(nome: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface FabricaConexoes {
  abrir(credencial: string, servidor: string): Promise<ConexaoFunifier>;
  fecharTodas(): Promise<void>;
}

export class ConexoesFunifier implements FabricaConexoes {
  private abertas = new Map<string, { client: Client; timer: NodeJS.Timeout }>();

  constructor(
    private cofre: Cofre,
    private comando: string, // ex.: "npx -y funifier-mcp@0.8.1"
    private cwd = join(CAMINHOS.dados, 'broker'),
  ) {}

  async abrir(credencial: string, servidor: string): Promise<ConexaoFunifier> {
    const chave = `${credencial}@${servidor}`;
    let c = this.abertas.get(chave);
    if (!c) {
      const cred = await this.cofre.obter(credencial);
      if (!cred) throw new Error(`credencial ${credencial} não está no cofre`);
      // Pasta vazia como cwd: o funifier-mcp procura um funifier.json na pasta atual antes do ambiente.
      const cwd = this.cwd;
      mkdirSync(cwd, { recursive: true, mode: 0o700 });
      const [bin, ...args] = this.comando.trim().split(/\s+/);
      const transport = new StdioClientTransport({
        command: bin,
        args,
        cwd,
        stderr: 'ignore',
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: process.env.HOME ?? cwd,
          FUNIFIER_API_KEY: cred.api_key,
          FUNIFIER_SECRET_KEY: cred.secret,
          FUNIFIER_SERVER_URL: servidor.startsWith('http') ? servidor : `https://${servidor}`,
        },
      });
      const client = new Client({ name: 'hub-broker', version: '0.1.0' });
      await client.connect(transport);
      c = { client, timer: setTimeout(() => {}, 0) };
      this.abertas.set(chave, c);
      log.info('broker: conexão aberta', { credencial });
    }
    clearTimeout(c.timer);
    c.timer = setTimeout(() => void this.fechar(chave), OCIOSA_MS);
    const { client } = c;
    return {
      ferramentas: async () => (await client.listTools()).tools as Ferramenta[],
      chamar: (nome, args) => client.callTool({ name: nome, arguments: args }),
    };
  }

  private async fechar(chave: string) {
    const c = this.abertas.get(chave);
    if (!c) return;
    this.abertas.delete(chave);
    clearTimeout(c.timer);
    await c.client.close().catch(() => {});
  }

  async fecharTodas() {
    await Promise.all([...this.abertas.keys()].map((k) => this.fechar(k)));
  }
}
