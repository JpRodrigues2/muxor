// Limpeza de runs/: prompts (runs/<id>.md, runs/<id>-<rodada>.md) e mídias/anexos (runs/<id>/).
// Credenciais nunca: runs/<id>/credenciais.json fica, e o cofre data/segredos/ nunca é tocado.
// Nunca mexe em task em andamento.
//   automática (B11): tasks encerradas há mais de 30 dias, todo dia às 04:00;
//   manual (/limpar_runs): só as concluídas, ou todas menos as em andamento.
// O histórico no banco continua.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.js';
import { log } from './logger.js';
import { ESTADOS_ATIVOS, sqlLista } from './dominio/despacho.js';
import { RUNS_DIR } from './prompt.js';

const DIAS = 30;
const PRESERVAR = new Set(['credenciais.json']);

// Apaga um item de runs/ (prompt .md ou pasta de anexos), preservando as credenciais. true = apagou algo.
function apagarItem(nome: string): boolean {
  const caminho = join(RUNS_DIR, nome);
  if (!statSync(caminho).isDirectory()) {
    rmSync(caminho, { force: true });
    return true;
  }
  let apagou = false;
  for (const f of readdirSync(caminho)) {
    if (PRESERVAR.has(f)) continue;
    rmSync(join(caminho, f), { recursive: true, force: true });
    apagou = true;
  }
  if (!readdirSync(caminho).length) rmSync(caminho, { recursive: true, force: true });
  return apagou;
}

export function limparRuns(db: DB) {
  if (!existsSync(RUNS_DIR)) return 0;
  const corte = new Date(Date.now() - DIAS * 86400_000).toISOString();
  const ids = new Set(
    (
      db
        .prepare("SELECT id FROM selecoes WHERE estado IN ('encerrada', 'cancelada', 'interrompida') AND atualizado_em < ?")
        .all(corte) as { id: number }[]
    ).map((r) => String(r.id)),
  );
  let apagados = 0;
  for (const nome of readdirSync(RUNS_DIR)) {
    const id = nome.match(/^(\d+)(?:-\d+\.md|\.md)?$/)?.[1];
    if (!id || !ids.has(id)) continue;
    if (apagarItem(nome)) apagados++;
  }
  if (apagados) log.info('limpeza: runs apagados', { apagados, dias: DIAS });
  return apagados;
}

// Em andamento: configurando, na fila, rodando, esperando o usuário ou com continuação na fila.
function emAndamento(db: DB): Set<string> {
  return new Set(
    (
      db
        .prepare(
          `SELECT id FROM selecoes WHERE estado IN ('coletando', 'aguardando_despacho', 'despachada')
           UNION SELECT selecao_id FROM despachos WHERE estado IN (${sqlLista([...ESTADOS_ATIVOS, 'seguimento_fila'])})`,
        )
        .all() as { id: number }[]
    ).map((r) => String(r.id)),
  );
}

export function limparRunsManual(db: DB, modo: 'concluidas' | 'todas') {
  if (!existsSync(RUNS_DIR)) return 0;
  const ativos = emAndamento(db);
  const concluidas = new Set(
    (
      db
        .prepare("SELECT id FROM selecoes WHERE estado IN ('finalizada', 'encerrada', 'cancelada', 'interrompida')")
        .all() as { id: number }[]
    ).map((r) => String(r.id)),
  );
  let apagados = 0;
  for (const nome of readdirSync(RUNS_DIR)) {
    const id = nome.match(/^(\d+)(?:-\d+\.md|\.md)?$/)?.[1];
    if (!id || ativos.has(id)) continue;
    if (modo === 'concluidas' && !concluidas.has(id)) continue;
    if (apagarItem(nome)) apagados++;
  }
  log.info('limpeza: runs (manual)', { modo, apagados, emAndamento: ativos.size });
  return apagados;
}
