// Cria uma task FICTÍCIA para o app sandbox e a coloca na fila de despacho.
// O bot (rodando) pega a fila em até 30 s.
// Uso: npm run -s despacho:teste -- "crie um arquivo OLA.md com a data de hoje"
import { openDb } from '../src/db.js';

const texto = process.argv.slice(2).join(' ').trim() || 'crie um arquivo OLA.md com a data de hoje';
const db = openDb();
const agora = new Date().toISOString();
const taskId = `teste-${Date.now()}`;

const selecaoId = db.transaction(() => {
  db.prepare(
    `INSERT INTO tasks_vistas (ferramenta, task_id, espaco, titulo, projeto_id, projeto_nome, status, prazo, link, primeira_vez, ultima_vez)
     VALUES ('teste', ?, '', ?, NULL, 'sandbox', 'teste', NULL, NULL, ?, ?)`,
  ).run(taskId, texto, agora, agora);
  const id = Number(
    db
      .prepare(
        `INSERT INTO selecoes (ferramenta, task_id, data_resumo, app, estado, criado_em, atualizado_em)
         VALUES ('teste', ?, ?, 'sandbox', 'aguardando_despacho', ?, ?)`,
      )
      .run(taskId, agora.slice(0, 10), agora, agora).lastInsertRowid,
  );
  db.prepare("INSERT INTO fila (app, selecao_id, criado_em) VALUES ('sandbox', ?, ?)").run(id, agora);
  return id;
})();

console.log(`Task fictícia #${selecaoId} na fila do sandbox: "${texto}"`);
