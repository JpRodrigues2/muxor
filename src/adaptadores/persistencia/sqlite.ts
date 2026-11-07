// Repositórios em SQLite (better-sqlite3): o único lugar com SQL de seleções e despachos.
// Mudança de estado da líder de um lote vale para o lote todo (WHERE id = ? OR lote_de = ?).
import type { ItemResumo, Memoria, RepositorioDespachos, RepositorioResumos, RepositorioSelecoes } from '../../aplicacao/portas.js';
import { getMeta, setMeta, type DB } from '../../db.js';
import { ESTADOS_ATIVOS, sqlLista, type Despacho, type EstadoDespacho, type ResultadoHub, type Seguimento } from '../../dominio/despacho.js';
import type { Selecao, TaskVista } from '../../dominio/selecao.js';

const agora = () => new Date().toISOString();

// Histórico de cada task do lote (título como o hub viu na ferramenta).
const SQL_HISTORICO = `
  INSERT INTO historico (ferramenta, task_id, titulo, app, status_final, resumo, branch, criado_em)
  SELECT s.ferramenta, s.task_id, COALESCE(tv.titulo, s.task_id), d.app, @status, @resumo, @branch, @agora
  FROM selecoes s
  JOIN despachos d ON d.id = @despacho
  LEFT JOIN tasks_vistas tv ON tv.ferramenta = s.ferramenta AND tv.task_id = s.task_id
  WHERE s.id = @selecao OR s.lote_de = @selecao
  ORDER BY s.id`;

export class RepositorioDespachosSqlite implements RepositorioDespachos {
  constructor(private db: DB) {}

  private estadoDoLote(selecaoId: number, estado: string, quando: string) {
    this.db.prepare('UPDATE selecoes SET estado = ?, atualizado_em = ? WHERE id = ? OR lote_de = ?').run(estado, quando, selecaoId, selecaoId);
  }

  enfileirar(selecaoId: number) {
    const s = this.db.prepare('SELECT app FROM selecoes WHERE id = ?').get(selecaoId) as { app: string } | undefined;
    if (!s) return null;
    this.db.prepare('INSERT OR IGNORE INTO fila (app, selecao_id, criado_em) VALUES (?, ?, ?)').run(s.app, selecaoId, agora());
    return s.app;
  }

  appsComTrabalho() {
    return (this.db.prepare("SELECT app FROM fila UNION SELECT app FROM despachos WHERE estado = 'seguimento_fila'").all() as { app: string }[]).map(
      (r) => r.app,
    );
  }

  temAtivoNoApp(app: string) {
    return !!this.db.prepare(`SELECT 1 FROM despachos WHERE app = ? AND estado IN (${sqlLista(ESTADOS_ATIVOS)})`).get(app);
  }

  seguimentoNaFila(app: string) {
    return this.db.prepare("SELECT * FROM despachos WHERE app = ? AND estado = 'seguimento_fila' ORDER BY atualizado_em LIMIT 1").get(app) as
      | Despacho
      | undefined;
  }

  proximoDaFila(app: string) {
    const f = this.db.prepare('SELECT id, selecao_id FROM fila WHERE app = ? ORDER BY id LIMIT 1').get(app) as { id: number; selecao_id: number } | undefined;
    return f && { filaId: f.id, selecaoId: f.selecao_id };
  }

  iniciar(d: { filaId: number; selecaoId: number; app: string; pasta: string; handle: string; tituloTerminal: string; arquivo: string }) {
    const quando = agora();
    return this.db.transaction(() => {
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO despachos (selecao_id, app, pasta, terminal_handle, titulo_terminal, run_file, estado, iniciado_em, atualizado_em)
             VALUES (?, ?, ?, ?, ?, ?, 'em_execucao', ?, ?)`,
          )
          .run(d.selecaoId, d.app, d.pasta, d.handle, d.tituloTerminal, d.arquivo, quando, quando).lastInsertRowid,
      );
      this.db.prepare('DELETE FROM fila WHERE id = ?').run(d.filaId);
      this.estadoDoLote(d.selecaoId, 'despachada', quando);
      return id;
    })();
  }

  ativos() {
    return (this.db.prepare(`SELECT id FROM despachos WHERE estado IN (${sqlLista(ESTADOS_ATIVOS)})`).all() as { id: number }[]).map((r) => r.id);
  }

  obter(id: number) {
    return this.db.prepare('SELECT * FROM despachos WHERE id = ?').get(id) as Despacho | undefined;
  }

  mudarEstado(id: number, estado: EstadoDespacho, limparAviso: boolean) {
    this.db
      .prepare(`UPDATE despachos SET estado = ?, atualizado_em = ?${limparAviso ? ', aviso_motivo = NULL, ultimo_aviso_em = NULL' : ''} WHERE id = ?`)
      .run(estado, agora(), id);
  }

  ultimoAviso(id: number) {
    const r = this.db.prepare('SELECT aviso_motivo, ultimo_aviso_em FROM despachos WHERE id = ?').get(id) as
      | { aviso_motivo: string | null; ultimo_aviso_em: string | null }
      | undefined;
    return { motivo: r?.aviso_motivo ?? null, em: r?.ultimo_aviso_em ?? null };
  }

  registrarAviso(id: number, motivo: string) {
    this.db.prepare('UPDATE despachos SET aviso_motivo = ?, ultimo_aviso_em = ? WHERE id = ?').run(motivo, agora(), id);
  }

  trocarTerminal(id: number, handle: string) {
    this.db.prepare('UPDATE despachos SET terminal_handle = ?, atualizado_em = ? WHERE id = ?').run(handle, agora(), id);
  }

  interromper(id: number, selecaoId: number) {
    const quando = agora();
    this.db.transaction(() => {
      this.db.prepare("UPDATE despachos SET estado = 'interrompido', atualizado_em = ? WHERE id = ?").run(quando, id);
      this.estadoDoLote(selecaoId, 'interrompida', quando);
      this.db.prepare(SQL_HISTORICO).run({ status: 'interrompido', resumo: null, branch: null, agora: quando, despacho: id, selecao: selecaoId });
    })();
  }

  concluir(id: number, selecaoId: number, r: ResultadoHub) {
    const quando = agora();
    this.db.transaction(() => {
      this.db.prepare("UPDATE despachos SET estado = 'concluido', resultado = ?, atualizado_em = ? WHERE id = ?").run(JSON.stringify(r), quando, id);
      this.estadoDoLote(selecaoId, 'finalizada', quando);
      this.db
        .prepare(SQL_HISTORICO)
        .run({ status: r.status, resumo: r.resumo ?? null, branch: r.branch ?? null, agora: quando, despacho: id, selecao: selecaoId });
    })();
  }

  guardarMsgFechamento(id: number, msgId: number | null) {
    this.db.prepare('UPDATE despachos SET msg_fechamento = ? WHERE id = ?').run(msgId, id);
  }

  concluidosRecentes(limite: number) {
    return this.db.prepare("SELECT * FROM despachos WHERE estado = 'concluido' ORDER BY atualizado_em DESC LIMIT ?").all(limite) as Despacho[];
  }

  branchesDoHistorico(ferramenta: string, taskId: string) {
    return (
      this.db
        .prepare('SELECT branch FROM historico WHERE ferramenta = ? AND task_id = ? AND branch IS NOT NULL ORDER BY id DESC')
        .all(ferramenta, taskId) as { branch: string }[]
    ).map((h) => h.branch);
  }

  encerrar(id: number, selecaoId: number) {
    const quando = agora();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE despachos SET estado = 'encerrado', encerrado_em = ?, msg_fechamento = NULL, atualizado_em = ? WHERE id = ?")
        .run(quando, quando, id);
      this.estadoDoLote(selecaoId, 'encerrada', quando);
    })();
  }

  pedirSeguimento(id: number, seg: Seguimento) {
    this.db
      .prepare("UPDATE despachos SET estado = 'seguimento_fila', seguimento = ?, atualizado_em = ? WHERE id = ? AND estado = 'concluido'")
      .run(JSON.stringify(seg), agora(), id);
  }

  desistirSeguimento(id: number) {
    this.db.prepare("UPDATE despachos SET estado = 'concluido', seguimento = NULL WHERE id = ?").run(id);
  }

  iniciarSeguimento(d: { id: number; selecaoId: number; rodada: number; arquivo: string; handle: string; tituloTerminal: string }) {
    const quando = agora();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE despachos SET estado = 'em_execucao', rodada = ?, run_file = ?, terminal_handle = ?, titulo_terminal = ?, seguimento = NULL,
             msg_fechamento = NULL, aviso_motivo = NULL, ultimo_aviso_em = NULL, atualizado_em = ? WHERE id = ?`,
        )
        .run(d.rodada, d.arquivo, d.handle, d.tituloTerminal, quando, d.id);
      this.estadoDoLote(d.selecaoId, 'despachada', quando);
    })();
  }
}

export class RepositorioSelecoesSqlite implements RepositorioSelecoes {
  constructor(private db: DB) {}

  obter(id: number) {
    return this.db.prepare('SELECT * FROM selecoes WHERE id = ?').get(id) as Selecao | undefined;
  }

  lote(s: Selecao) {
    return [s, ...(this.db.prepare('SELECT * FROM selecoes WHERE lote_de = ? ORDER BY id').all(s.id) as Selecao[])];
  }

  task(ferramenta: string, taskId: string) {
    return this.db
      .prepare('SELECT titulo, descricao, projeto_nome, projeto_id, link, espaco, prazo FROM tasks_vistas WHERE ferramenta = ? AND task_id = ?')
      .get(ferramenta, taskId) as TaskVista | undefined;
  }

  registrarAviso(id: number, motivo: string) {
    this.db.prepare('UPDATE selecoes SET aviso_em = ?, aviso_motivo = ? WHERE id = ?').run(agora(), motivo, id);
  }

  ativa() {
    return this.db.prepare("SELECT * FROM selecoes WHERE estado = 'coletando' AND lote_de IS NULL ORDER BY id LIMIT 1").get() as Selecao | undefined;
  }

  coletando() {
    return (this.db.prepare("SELECT COUNT(*) n FROM selecoes WHERE estado = 'coletando' AND lote_de IS NULL").get() as { n: number }).n;
  }

  emAndamento(ferramenta: string, taskId: string) {
    return !!this.db
      .prepare("SELECT 1 FROM selecoes WHERE ferramenta = ? AND task_id = ? AND estado IN ('coletando','aguardando_despacho','despachada')")
      .get(ferramenta, taskId);
  }

  criar(s: { ferramenta: string; taskId: string; dataResumo: string; app: string | null; etapa: string; resumoId?: number }) {
    const quando = agora();
    return Number(
      this.db
        .prepare(
          `INSERT INTO selecoes (ferramenta, task_id, data_resumo, app, estado, etapa, resumo_id, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, 'coletando', ?, ?, ?, ?)`,
        )
        .run(s.ferramenta, s.taskId, s.dataResumo, s.app, s.etapa, s.resumoId ?? null, quando, quando).lastInsertRowid,
    );
  }

  atualizar(id: number, campos: Partial<Omit<Selecao, 'id'>>) {
    const chaves = Object.keys(campos);
    if (chaves.some((k) => !/^[a-z_]+$/.test(k))) throw new Error(`campo inválido em selecoes: ${chaves.join(', ')}`);
    const quando = agora();
    this.db
      .prepare(`UPDATE selecoes SET ${chaves.map((k) => `${k} = @${k}`).join(', ')}, atualizado_em = @agora WHERE id = @id`)
      .run({ ...campos, id, agora: quando });
    if (campos.estado) this.db.prepare('UPDATE selecoes SET estado = ?, atualizado_em = ? WHERE lote_de = ?').run(campos.estado, quando, id);
  }

  registrarAvulsa(taskId: string, titulo: string, descricao: string | null) {
    const quando = agora();
    this.db
      .prepare(
        `INSERT INTO tasks_vistas (ferramenta, task_id, espaco, titulo, descricao, projeto_id, projeto_nome, status, prazo, link, primeira_vez, ultima_vez)
         VALUES ('avulsa', ?, '', ?, ?, NULL, 'atividade avulsa', 'avulsa', NULL, NULL, ?, ?)`,
      )
      .run(taskId, titulo, descricao, quando, quando);
  }

  definirInstrucoes(ferramenta: string, taskId: string, titulo: string, descricao: string) {
    this.db.prepare('UPDATE tasks_vistas SET titulo = ?, descricao = ? WHERE ferramenta = ? AND task_id = ?').run(titulo, descricao, ferramenta, taskId);
  }

  definirEspaco(ferramenta: string, taskId: string, espaco: string) {
    this.db.prepare('UPDATE tasks_vistas SET espaco = ? WHERE ferramenta = ? AND task_id = ?').run(espaco, ferramenta, taskId);
  }
}

export class RepositorioResumosSqlite implements RepositorioResumos {
  constructor(private db: DB) {}

  abrir(data: string, origem: string) {
    this.db.prepare("UPDATE resumos SET estado = 'substituido' WHERE estado = 'aberto'").run();
    return Number(this.db.prepare("INSERT INTO resumos (data, origem, estado, criado_em) VALUES (?, ?, 'aberto', ?)").run(data, origem, agora()).lastInsertRowid);
  }

  adicionarItem(resumoId: number, i: ItemResumo, msgId: number | null) {
    this.db
      .prepare('INSERT INTO resumo_itens (resumo_id, idx, ferramenta, task_id, espaco, app_sugerido, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(resumoId, i.idx, i.ferramenta, i.task_id, i.espaco, i.app_sugerido, msgId);
  }

  definirMsgBotoes(resumoId: number, msgId: number | null) {
    this.db.prepare('UPDATE resumos SET msg_botoes = ? WHERE id = ?').run(msgId, resumoId);
  }

  fechar(resumoId: number, estado: 'iniciado' | 'nenhuma') {
    this.db.prepare('UPDATE resumos SET estado = ? WHERE id = ?').run(estado, resumoId);
  }

  aberto(resumoId: number) {
    return (this.db.prepare('SELECT estado FROM resumos WHERE id = ?').get(resumoId) as { estado: string } | undefined)?.estado === 'aberto';
  }

  alternar(resumoId: number, idx: number) {
    const item = this.db.prepare('SELECT msg_id, selecionada FROM resumo_itens WHERE resumo_id = ? AND idx = ?').get(resumoId, idx) as
      | { msg_id: number; selecionada: number }
      | undefined;
    if (!item) return null;
    this.db.prepare('UPDATE resumo_itens SET selecionada = 1 - selecionada WHERE resumo_id = ? AND idx = ?').run(resumoId, idx);
    const itens = this.db
      .prepare(
        `SELECT ri.idx, ri.selecionada, COALESCE(tv.titulo, ri.task_id) titulo FROM resumo_itens ri
         LEFT JOIN tasks_vistas tv ON tv.ferramenta = ri.ferramenta AND tv.task_id = ri.task_id
         WHERE ri.resumo_id = ? AND ri.msg_id = ? ORDER BY ri.idx`,
      )
      .all(resumoId, item.msg_id) as { idx: number; selecionada: number; titulo: string }[];
    return { msgId: item.msg_id, marcada: !item.selecionada, itens: itens.map((i) => ({ ...i, selecionada: !!i.selecionada })) };
  }

  msgBotoes(resumoId: number) {
    return (this.db.prepare('SELECT msg_botoes FROM resumos WHERE id = ?').get(resumoId) as { msg_botoes: number | null } | undefined)?.msg_botoes ?? null;
  }

  marcados(resumoId: number) {
    return this.db
      .prepare('SELECT idx, ferramenta, task_id, espaco, app_sugerido FROM resumo_itens WHERE resumo_id = ? AND selecionada = 1 ORDER BY idx')
      .all(resumoId) as ItemResumo[];
  }

  mensagens(resumoId: number) {
    return (this.db.prepare('SELECT DISTINCT msg_id FROM resumo_itens WHERE resumo_id = ? AND msg_id IS NOT NULL').all(resumoId) as { msg_id: number }[]).map(
      (m) => m.msg_id,
    );
  }

  guardarTexto(resumoId: number, msgId: number, texto: string) {
    this.db
      .prepare('INSERT INTO resumo_mensagens (msg_id, resumo_id, texto) VALUES (?, ?, ?) ON CONFLICT(msg_id) DO UPDATE SET texto = excluded.texto')
      .run(msgId, resumoId, texto);
  }

  texto(msgId: number) {
    return (this.db.prepare('SELECT texto FROM resumo_mensagens WHERE msg_id = ?').get(msgId) as { texto: string } | undefined)?.texto ?? null;
  }

  ultimoAberto() {
    return (this.db.prepare("SELECT MAX(id) id FROM resumos WHERE estado = 'aberto'").get() as { id: number | null }).id ?? null;
  }

  appSugerido(resumoId: number | null, taskId: string) {
    return (
      (this.db.prepare('SELECT app_sugerido FROM resumo_itens WHERE resumo_id = ? AND task_id = ?').get(resumoId, taskId) as { app_sugerido: string | null } | undefined)
        ?.app_sugerido ?? null
    );
  }
}

export class MemoriaSqlite implements Memoria {
  constructor(private db: DB) {}
  obter(chave: string) {
    return getMeta(this.db, chave);
  }
  guardar(chave: string, valor: string) {
    setMeta(this.db, chave, valor);
  }
}
