// Git do hub. No servidor os repositórios são do usuário agente (é ele quem tem as chaves e logins do git):
// HUB_GIT_COMO="sudo -n -u agente" faz todo git rodar como ele (regra no sudoers só para /usr/bin/git).
// No Mac, sem a variável, o git roda como o próprio usuário. Sempre execFile com argumentos em array.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GitProjetos } from './aplicacao/portas.js';

export function comandoGit(args: string[], como = process.env.HUB_GIT_COMO): [string, string[]] {
  const prefixo = (como ?? '').trim().split(/\s+/).filter(Boolean);
  return prefixo.length ? [prefixo[0], [...prefixo.slice(1), 'git', ...args]] : ['git', args];
}

export function git(args: string[], { timeoutMs = 15_000 } = {}): Promise<string> {
  const [bin, argv] = comandoGit(args);
  return new Promise((ok, falha) =>
    execFile(bin, argv, { timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) =>
      err ? falha(new Error(stderr.trim().split('\n').pop() || err.message)) : ok(stdout.trim()),
    ),
  );
}

export const gitEm = (pasta: string, args: string[]) => git(['-C', pasta, ...args]);

export function clonar(url: string, pasta: string) {
  return git(['clone', '--', url, pasta], { timeoutMs: 10 * 60_000 });
}

// Pasta sem repositório remoto: o Orca só abre repositório git, então ela ganha um git só local.
export async function prepararPasta(pasta: string) {
  mkdirSync(pasta, { recursive: true });
  if (!existsSync(join(pasta, '.git'))) await git(['init', '-q', pasta]);
}

// Porta GitProjetos: o que o despacho lê do git dos projetos (Abrir PR).
export const gitProjetos: GitProjetos = {
  async branchesRemotas(pasta) {
    const out = await gitEm(pasta, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']).catch(() => '');
    return out
      .split('\n')
      .map((b) => b.replace(/^origin\//, ''))
      .filter((b) => b && b !== 'origin' && b !== 'HEAD');
  },
  // URL do origin sem credenciais embutidas (https://user:token@host/...).
  async remotoOrigin(pasta) {
    const url = await gitEm(pasta, ['remote', 'get-url', 'origin']).catch(() => '');
    return url ? url.replace(/\/\/[^@/]+@/, '//') : null;
  },
  clonar,
  prepararPasta,
};
