// Onde o hub lê e grava. No Mac os padrões reproduzem a v1 (tudo dentro da pasta do código);
// no servidor as variáveis HUB_* separam código (trocado a cada deploy) de dados (preservados).
// Nenhum outro módulo monta caminho com homedir() ou com a pasta do código.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pasta do código (onde estão package.json, regras/ padrão e deploy/).
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface Caminhos {
  dados: string; // banco, cofre, OAuth, históricos de apps.yaml e regras
  logs: string;
  runs: string; // prompts e anexos das tasks (a sessão do Claude lê)
  regras: string;
  apps: string; // arquivo apps.yaml
  repos: string; // pasta-mãe dos projetos; pasta relativa no apps.yaml é resolvida contra ela
  claude: string; // ~/.claude de quem roda as sessões (no servidor, o usuário agente)
  runsCompartilhado: boolean; // runs/ é lido por outro usuário (o agente), pelo grupo
}

export function lerCaminhos(env: NodeJS.ProcessEnv = process.env): Caminhos {
  const dados = env.HUB_DADOS_DIR ?? join(ROOT, 'data');
  // Sem HUB_DADOS_DIR (Mac), logs/, runs/ e regras/ continuam na pasta do código, como na v1.
  const base = env.HUB_DADOS_DIR ? dados : ROOT;
  return {
    dados,
    logs: env.HUB_LOGS_DIR ?? join(base, 'logs'),
    runs: env.HUB_RUNS_DIR ?? join(base, 'runs'),
    regras: env.HUB_REGRAS_DIR ?? join(base, 'regras'),
    apps: env.HUB_APPS_FILE ?? join(base, 'apps.yaml'),
    repos: env.HUB_REPOS_DIR ?? join(homedir(), 'Documents'),
    claude: env.HUB_CLAUDE_DIR ?? join(homedir(), '.claude'),
    runsCompartilhado: !!env.HUB_RUNS_DIR,
  };
}

export const CAMINHOS = lerCaminhos();

// Pasta de um app: absoluta como está; relativa ("DAC/vista") dentro de CAMINHOS.repos.
export function resolverPasta(pasta: string, c: Caminhos = CAMINHOS) {
  return isAbsolute(pasta) ? resolve(pasta) : resolve(c.repos, pasta);
}

// Pasta onde o Claude guarda os históricos das sessões de um projeto.
export function dirSessoesClaude(pasta: string, c: Caminhos = CAMINHOS) {
  return join(c.claude, 'projects', resolve(pasta).replace(/[^a-zA-Z0-9]/g, '-'));
}

// Regras padrão (regras/ do código) quando a pasta de regras configurada ainda não tem nenhuma.
export function regrasPadrao(arquivo: string) {
  const f = join(ROOT, 'regras', arquivo);
  return existsSync(f) ? f : null;
}
