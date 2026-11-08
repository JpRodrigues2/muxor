// Projetos que entram na listagem (B12). Projeto novo entra ativo; o usuário desliga pelo /projetos.
//
// callback_data  p:<id>  alterna ✅/⬜ de um projeto (id da tabela projetos)
import { InlineKeyboard, type Api } from 'grammy';
import type { DB } from './db.js';
import { ICONE, cartao } from './msg.js';
import type { Task } from './pm/types.js';

const FERRAMENTA: Record<string, string> = { 'funifier-pm': 'Funifier PM', bnexo: 'Bnexo' };
const RECENTE_DIAS = 30; // só lista projetos com task vista nos últimos 30 dias

interface Projeto {
  id: number;
  ferramenta: string;
  projeto_id: string;
  nome: string | null;
  ativo: number;
}

export function registrarProjetos(db: DB, tasks: Task[]) {
  const stmt = db.prepare(`
    INSERT INTO projetos (ferramenta, projeto_id, nome) VALUES (?, ?, ?)
    ON CONFLICT (ferramenta, projeto_id) DO UPDATE SET nome = COALESCE(excluded.nome, projetos.nome)`);
  db.transaction(() => tasks.forEach((t) => stmt.run(t.ferramenta, t.projetoId ?? '', t.projetoNome)))();
}

// Separa as tasks de projetos desligados.
export function filtrarPorProjeto(db: DB, tasks: Task[]) {
  const inativos = new Set(
    (db.prepare('SELECT ferramenta, projeto_id FROM projetos WHERE ativo = 0').all() as Projeto[]).map((p) => `${p.ferramenta}:${p.projeto_id}`),
  );
  const visiveis: Task[] = [];
  const ocultas: Task[] = [];
  for (const t of tasks) (inativos.has(`${t.ferramenta}:${t.projetoId ?? ''}`) ? ocultas : visiveis).push(t);
  const projetosOcultos = new Set(ocultas.map((t) => `${t.ferramenta}:${t.projetoId ?? ''}`)).size;
  return { visiveis, ocultas, projetosOcultos };
}

export class Projetos {
  constructor(
    private db: DB,
    private api: Api,
    private chatId: number,
  ) {}

  private listar(): Projeto[] {
    const desde = new Date(Date.now() - RECENTE_DIAS * 86400_000).toISOString();
    return this.db
      .prepare(
        `SELECT p.* FROM projetos p WHERE p.ativo = 0 OR EXISTS (
           SELECT 1 FROM tasks_vistas t WHERE t.ferramenta = p.ferramenta AND COALESCE(t.projeto_id, '') = p.projeto_id AND t.ultima_vez > ?)
         ORDER BY p.ferramenta, LOWER(COALESCE(p.nome, p.projeto_id))`,
      )
      .all(desde) as Projeto[];
  }

  private teclado(ps: Projeto[]) {
    const kb = new InlineKeyboard();
    for (const p of ps) {
      const nome = p.projeto_id ? (p.nome ?? p.projeto_id) : 'sem projeto';
      const curto = nome.length > 40 ? nome.slice(0, 39) + '…' : nome;
      kb.text(`${p.ativo ? '✅' : '⬜'} ${curto} · ${FERRAMENTA[p.ferramenta] ?? p.ferramenta}`, `p:${p.id}`).row();
    }
    return kb;
  }

  async comando() {
    const ps = this.listar();
    if (!ps.length) {
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.projetos, titulo: 'Nenhum projeto conhecido', rodape: 'Rode /tarefas primeiro.' }), {
        parse_mode: 'HTML',
      });
      return;
    }
    await this.api.sendMessage(
      this.chatId,
      cartao({
        icone: ICONE.projetos,
        titulo: 'Projetos na listagem',
        rodape: 'Toque para ligar ou desligar. Desligado some do /tarefas.',
      }),
      { parse_mode: 'HTML', reply_markup: this.teclado(ps) },
    );
  }

  async alternar(id: number, msgId: number): Promise<string> {
    const p = this.db.prepare('SELECT * FROM projetos WHERE id = ?').get(id) as Projeto | undefined;
    if (!p) return 'Projeto não encontrado.';
    this.db.prepare('UPDATE projetos SET ativo = 1 - ativo WHERE id = ?').run(id);
    await this.api.editMessageReplyMarkup(this.chatId, msgId, { reply_markup: this.teclado(this.listar()) }).catch(() => {});
    return `${p.ativo ? '⬜ Desligado' : '✅ Ligado'}: ${p.nome ?? 'sem projeto'}`;
  }
}
