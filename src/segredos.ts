// Credenciais das gamificações (API key + secret) na sessão da task. Ficam no Cofre (porta), nunca no apps.yaml,
// prompts, logs ou commits. No despacho, só as das gamificações autorizadas vão para runs/<id>/credenciais.json,
// apagado quando a task é encerrada. O broker (D-A14) vai acabar com esse arquivo: o agente não verá mais a chave.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Cofre, Credencial } from './aplicacao/portas.js';
import { CAMINHOS } from './caminhos.js';
import type { Gamificacao } from './config.js';
import { log } from './logger.js';
import { dirAnexos } from './prompt.js';

// No servidor a sessão roda com outro usuário (agente), que lê runs/ pelo grupo; no Mac, só o dono.
const MODO = CAMINHOS.runsCompartilhado ? 0o640 : 0o600;

// Arquivo da task com as credenciais só das gamificações autorizadas. null = nenhuma tem credencial.
export async function escreverCredenciaisDaTask(cofre: Cofre, selecaoId: number, gamifs: Gamificacao[]): Promise<string | null> {
  const itens: [Gamificacao, Credencial][] = [];
  for (const g of gamifs) {
    const c = g.credencial ? await cofre.obter(g.credencial) : null;
    if (c) itens.push([g, c]);
  }
  if (!itens.length) return null;
  const dir = dirAnexos(selecaoId);
  mkdirSync(dir, { recursive: true });
  const arq = join(dir, 'credenciais.json');
  const conteudo = Object.fromEntries(itens.map(([g, c]) => [g.nome, { servidor: g.servidor, conta: g.conta, ...c }]));
  writeFileSync(arq, JSON.stringify(conteudo, null, 2), { mode: MODO });
  chmodSync(arq, MODO);
  return arq;
}

// Apaga também a pasta da task se ela ficar vazia (I13).
export function apagarCredenciaisDaTask(selecaoId: number) {
  const dir = dirAnexos(selecaoId);
  rmSync(join(dir, 'credenciais.json'), { force: true });
  if (existsSync(dir) && !readdirSync(dir).length) rmSync(dir, { recursive: true, force: true });
}

// v1 → v2: o cofre em texto puro (<dados>/segredos/gamificacoes.json) vai para o Cofre e o arquivo é apagado.
export async function migrarCofreAntigo(cofre: Cofre, arquivo = join(CAMINHOS.dados, 'segredos', 'gamificacoes.json')) {
  if (!existsSync(arquivo)) return 0;
  const antigo = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, Credencial>;
  for (const [id, c] of Object.entries(antigo)) await cofre.salvar(id, c);
  for (const id of Object.keys(antigo)) if (!(await cofre.obter(id))) throw new Error(`migração do cofre: ${id} não ficou salvo`);
  rmSync(arquivo);
  log.info('cofre: credenciais migradas do arquivo em texto puro', { quantidade: Object.keys(antigo).length });
  return Object.keys(antigo).length;
}
