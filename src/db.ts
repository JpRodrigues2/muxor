// SQLite local (data/hub.db) com migrações versionadas por PRAGMA user_version.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAMINHOS } from './caminhos.js';
import { log } from './logger.js';
import { ESTADOS_ATIVOS, sqlLista } from './dominio/despacho.js';

const MIGRATIONS: string[] = [
  // 1 — esquema inicial
  `
  CREATE TABLE tasks_vistas (
    ferramenta    TEXT NOT NULL,             -- funifier-pm | bnexo
    task_id       TEXT NOT NULL,
    empresa       TEXT NOT NULL,             -- funifier | dac
    titulo        TEXT NOT NULL,
    projeto_id    TEXT,
    projeto_nome  TEXT,
    status        TEXT NOT NULL,             -- status bruto da ferramenta
    prazo         TEXT,
    link          TEXT,
    primeira_vez  TEXT NOT NULL,
    ultima_vez    TEXT NOT NULL,
    PRIMARY KEY (ferramenta, task_id)
  );

  -- Uma linha por task marcada pelo usuário num resumo; percorre os estados até virar despacho.
  CREATE TABLE selecoes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ferramenta       TEXT NOT NULL,
    task_id          TEXT NOT NULL,
    data_resumo      TEXT NOT NULL,          -- AAAA-MM-DD do resumo de origem
    info_extra       TEXT,
    app              TEXT,
    gamificacoes     TEXT,                   -- JSON com as gamificações autorizadas
    estado           TEXT NOT NULL,          -- selecionada | coletando | aguardando_despacho | despachada | cancelada
    criado_em        TEXT NOT NULL,
    atualizado_em    TEXT NOT NULL
  );
  CREATE INDEX selecoes_estado ON selecoes(estado);

  CREATE TABLE fila (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app         TEXT NOT NULL,
    selecao_id  INTEGER NOT NULL REFERENCES selecoes(id),
    criado_em   TEXT NOT NULL
  );
  CREATE INDEX fila_app ON fila(app, id);

  CREATE TABLE despachos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    selecao_id       INTEGER NOT NULL REFERENCES selecoes(id),
    app              TEXT NOT NULL,
    pasta            TEXT NOT NULL,
    terminal_handle  TEXT,                   -- muda se o Orca reiniciar; redescobrir pela pasta
    run_file         TEXT NOT NULL,
    estado           TEXT NOT NULL,          -- ver src/dominio/despacho.ts (ESTADOS_DESPACHO)
    ultimo_aviso_em  TEXT,
    resultado        TEXT,                   -- JSON do bloco "### RESULTADO HUB"
    iniciado_em      TEXT NOT NULL,
    atualizado_em    TEXT NOT NULL
  );
  CREATE INDEX despachos_estado ON despachos(estado);

  CREATE TABLE historico (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ferramenta   TEXT NOT NULL,
    task_id      TEXT NOT NULL,
    titulo       TEXT,
    app          TEXT,
    status_final TEXT NOT NULL,               -- concluido | bloqueado | precisa_revisao | interrompido
    resumo       TEXT,
    branch       TEXT,
    criado_em    TEXT NOT NULL
  );

  CREATE TABLE meta (
    chave  TEXT PRIMARY KEY,
    valor  TEXT
  );
  `,
  // 2 — resumo com seleção (Fase 4)
  `
  CREATE TABLE resumos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    data       TEXT NOT NULL,                -- AAAA-MM-DD
    origem     TEXT NOT NULL,                -- agendado | catch_up | manual
    estado     TEXT NOT NULL,                -- aberto | iniciado | nenhuma | substituido
    criado_em  TEXT NOT NULL
  );

  -- Tasks de um resumo; idx é o número mostrado ao usuário e vai no callback_data dos botões.
  CREATE TABLE resumo_itens (
    resumo_id    INTEGER NOT NULL REFERENCES resumos(id),
    idx          INTEGER NOT NULL,
    ferramenta   TEXT NOT NULL,
    task_id      TEXT NOT NULL,
    empresa      TEXT NOT NULL,
    app_sugerido TEXT,                       -- null = projeto não mapeado (sem botão)
    msg_id       INTEGER,                    -- mensagem do Telegram que tem o botão
    selecionada  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (resumo_id, idx)
  );

  ALTER TABLE selecoes ADD COLUMN resumo_id INTEGER;
  ALTER TABLE selecoes ADD COLUMN etapa TEXT;          -- info | destino | escolher_app | alvo | confirmar
  ALTER TABLE selecoes ADD COLUMN msg_pergunta INTEGER; -- mensagem da pergunta atual (para tirar os botões)
  `,
  // 3 — despacho (Fase 5)
  `
  ALTER TABLE selecoes ADD COLUMN anexos TEXT;           -- JSON: caminhos locais de arquivos mandados pelo Telegram
  ALTER TABLE selecoes ADD COLUMN aviso_em TEXT;         -- último aviso de fila/bloqueio (evita repetir)
  ALTER TABLE selecoes ADD COLUMN aviso_motivo TEXT;
  CREATE UNIQUE INDEX fila_selecao ON fila(selecao_id);
  ALTER TABLE despachos ADD COLUMN titulo_terminal TEXT;
  `,
  // 4 — acompanhamento (Fase 6)
  `
  ALTER TABLE despachos ADD COLUMN aviso_motivo TEXT;   -- usuario | limite (com ultimo_aviso_em: no máx. 1 aviso igual a cada 15 min)
  `,
  // 5 — próximos passos depois da conclusão (instrução extra / abrir PR)
  `
  ALTER TABLE despachos ADD COLUMN rodada INTEGER NOT NULL DEFAULT 1;  -- 1 = task original; 2+ = continuações
  ALTER TABLE despachos ADD COLUMN msg_fechamento INTEGER;              -- mensagem com os botões de próximos passos
  ALTER TABLE despachos ADD COLUMN seguimento TEXT;                     -- JSON do próximo passo esperando a sessão (estado seguimento_fila)
  `,
  // 6 — backlog B10–B13: mensagens do chat, projetos visíveis, atividades avulsas, encerramento
  `
  ALTER TABLE tasks_vistas ADD COLUMN descricao TEXT;      -- instruções das atividades avulsas (/nova)
  ALTER TABLE despachos ADD COLUMN encerrado_em TEXT;
  ALTER TABLE resumos ADD COLUMN msg_botoes INTEGER;      -- mensagem do resumo que leva os botões Iniciar/Nenhuma

  -- Mensagens do chat (do bot e do usuário), para o /limpar. O Telegram só apaga mensagens com menos de 48 h.
  CREATE TABLE mensagens (
    msg_id     INTEGER PRIMARY KEY,
    selecao_id INTEGER,
    resumo_id  INTEGER,
    criado_em  TEXT NOT NULL
  );

  -- Projetos conhecidos e se entram na listagem (/projetos). Projeto novo entra ativo.
  CREATE TABLE projetos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ferramenta TEXT NOT NULL,
    projeto_id TEXT NOT NULL,              -- '' = tasks sem projeto
    nome       TEXT,
    ativo      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (ferramenta, projeto_id)
  );
  INSERT OR IGNORE INTO projetos (ferramenta, projeto_id, nome)
    SELECT ferramenta, COALESCE(projeto_id, ''), MAX(projeto_nome) FROM tasks_vistas
    WHERE ferramenta IN ('funifier-pm', 'bnexo') GROUP BY ferramenta, COALESCE(projeto_id, '');
  `,
  // 7 — B15: ambiente sendo montado pelo Telegram
  `
  ALTER TABLE selecoes ADD COLUMN ambiente TEXT;           -- JSON { empresa, nome } enquanto monta um ambiente novo
  `,
  // 8 — lote: tasks complementares num só prompt/sessão. A 1ª task (líder) conduz a conversa e o despacho;
  //     as outras apontam para ela e acompanham o estado dela.
  `
  ALTER TABLE selecoes ADD COLUMN lote_de INTEGER;         -- id da seleção líder (NULL = task sozinha ou líder)
  `,
  // v2: estado e motivo de aviso sem o nome do usuário.
  `
  UPDATE despachos SET estado = 'aguardando_usuario' WHERE estado = 'aguardando_joao';
  UPDATE despachos SET aviso_motivo = 'usuario' WHERE aviso_motivo = 'joao';
  `,
  // B34: empresa (funifier | dac) vira espaço (id do espaço no apps.yaml; '' = ainda não definido).
  //      A migração do apps.yaml cria os espaços "funifier" e "dac", então os valores continuam valendo.
  `
  ALTER TABLE tasks_vistas RENAME COLUMN empresa TO espaco;
  ALTER TABLE resumo_itens RENAME COLUMN empresa TO espaco;
  UPDATE selecoes SET etapa = 'espaco' WHERE etapa = 'empresa';
  UPDATE selecoes SET etapa = 'amb_espaco' WHERE etapa = 'amb_empresa';
  UPDATE selecoes SET ambiente = json_object('espaco', json_extract(ambiente, '$.empresa'), 'nome', json_extract(ambiente, '$.nome'))
    WHERE ambiente IS NOT NULL AND json_extract(ambiente, '$.empresa') IS NOT NULL;
  `,
  // B20: texto de cada mensagem do resumo, para marcar ✅ na linha da task escolhida pelo número (/t3).
  `
  CREATE TABLE resumo_mensagens (
    msg_id    INTEGER PRIMARY KEY,
    resumo_id INTEGER NOT NULL REFERENCES resumos(id),
    texto     TEXT NOT NULL
  );
  `,
];

export type DB = Database.Database;

export function openDb(file = join(CAMINHOS.dados, 'hub.db')): DB {
  mkdirSync(CAMINHOS.dados, { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    log.info('db: migração aplicada', { versao: v + 1 });
  }
}

export function getMeta(db: DB, chave: string): string | undefined {
  return (db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave) as { valor: string } | undefined)?.valor;
}

export function setMeta(db: DB, chave: string, valor: string) {
  db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(
    chave,
    valor,
  );
}

export function contagens(db: DB) {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    fila: n('SELECT COUNT(*) n FROM fila'),
    aguardandoDespacho: n("SELECT COUNT(*) n FROM selecoes WHERE estado = 'aguardando_despacho'"),
    emAndamento: db
      .prepare(
        `SELECT d.id, d.app, d.estado, s.task_id FROM despachos d JOIN selecoes s ON s.id = d.selecao_id WHERE d.estado IN (${sqlLista(ESTADOS_ATIVOS)}) ORDER BY d.id`,
      )
      .all() as { id: number; app: string; estado: string; task_id: string }[],
  };
}
