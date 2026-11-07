// O que os casos de uso do despacho recebem (montado no main.ts) e o apoio comum a eles:
// títulos das tasks, lote, status na ferramenta de gestão e avisos sem repetição.
import type { App, Env } from '../../config.js';
import { FERRAMENTA_REAL, NOME_FERRAMENTA, type Selecao } from '../../dominio/selecao.js';
import { errInfo, log } from '../../logger.js';
import { ICONE, curto, esc } from '../../msg.js';
import type { PmAdapter, TaskDetalhe } from '../../pm/types.js';
import type { Botao, Cofre, Executor, GitProjetos, Memoria, Notificador, RepositorioDespachos, RepositorioSelecoes } from '../portas.js';

export interface DepsDespacho {
  env: Pick<Env, 'HUB_BROKER' | 'HUB_CLAUDE_PERMISSAO' | 'HUB_CONFIAR_PASTA_CMD'>;
  despachos: RepositorioDespachos;
  selecoes: RepositorioSelecoes;
  memoria: Memoria;
  executor: Executor;
  notificador: Notificador;
  cofre: Cofre;
  gestao: PmAdapter[];
  git: GitProjetos;
  apps: () => App[]; // catálogo atual (o apps.yaml pode mudar com o hub rodando)
  dormir?: (ms: number) => Promise<void>; // os testes trocam por uma espera curta
}

export const dormirDe = (d: DepsDespacho) => d.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

export const botao = (texto: string, dado: string): Botao => ({ texto, dado });

const REPETIR_AVISO_MS = 30 * 60_000; // avisos de fila (antes do despacho)

export class Tasks {
  constructor(private d: DepsDespacho) {}

  lote(sel: Selecao) {
    return this.d.selecoes.lote(sel);
  }

  reais(sel: Selecao) {
    return this.lote(sel).filter((s) => FERRAMENTA_REAL.has(s.ferramenta));
  }

  titulo(sel: Selecao) {
    return this.d.selecoes.task(sel.ferramenta, sel.task_id)?.titulo ?? sel.task_id;
  }

  link(sel: Selecao) {
    return this.d.selecoes.task(sel.ferramenta, sel.task_id)?.link ?? null;
  }

  // Lote vira "📦 Lote de N: … + …".
  tituloDe(sel: Selecao) {
    const lote = this.lote(sel);
    return lote.length > 1 ? `📦 Lote de ${lote.length}: ${lote.map((s) => this.titulo(s)).join(' + ')}` : this.titulo(sel);
  }

  // Título das mensagens: curto e com link quando houver.
  tituloHtml(sel: Selecao) {
    const t = esc(curto(this.tituloDe(sel)));
    if (this.lote(sel).length > 1) return t;
    const link = this.link(sel);
    return link ? `<a href="${esc(link)}">${t}</a>` : t;
  }

  // Muda o status na ferramenta de gestão (de cada task do lote). Devolve um trecho para o contexto da mensagem
  // (null = sem ferramenta). Só status, nunca comentário.
  async moverStatus(sel: Selecao, status: 'em_progresso' | 'concluida'): Promise<string | null> {
    const reais = this.reais(sel);
    if (!reais.length) return null;
    const rotulo = status === 'concluida' ? 'concluída' : 'em progresso';
    const ok: string[] = [];
    const falhas: string[] = [];
    for (const s of reais) {
      const ferramenta = NOME_FERRAMENTA[s.ferramenta];
      try {
        const adapter = this.d.gestao.find((a) => a.nome === s.ferramenta);
        if (!adapter) throw new Error(`sem adaptador para ${s.ferramenta}`);
        await adapter.setStatus(s.task_id, status);
        log.info('ferramenta de gestão: status', { selecaoId: s.id, status });
        ok.push(ferramenta);
      } catch (e) {
        log.warn('ferramenta de gestão: falha ao mudar status', { selecaoId: s.id, status, ...errInfo(e) });
        const bloqueada = (e as Error).name === 'EscritaBloqueadaError';
        const quem = reais.length > 1 ? `${esc(curto(this.tituloDe(s), 30))} ` : '';
        falhas.push(`${ICONE.aviso} ${quem}${ferramenta} não mudou para ${rotulo} (${bloqueada ? 'escrita desligada' : esc(curto((e as Error).message, 80))})`);
      }
    }
    const ferramentas = [...new Set(ok)].join('/');
    const feito = ok.length ? `${ferramentas}: ${reais.length > 1 ? `${ok.length} ${status === 'concluida' ? 'concluídas' : 'em progresso'}` : rotulo}` : null;
    return [feito, ...falhas].filter(Boolean).join(' · ');
  }

  async detalhe(sel: Selecao): Promise<TaskDetalhe> {
    if (!FERRAMENTA_REAL.has(sel.ferramenta)) {
      // Atividade avulsa (/nova) ou task fictícia: o texto do usuário é a descrição.
      const v = this.d.selecoes.task(sel.ferramenta, sel.task_id);
      const titulo = v?.titulo ?? sel.task_id;
      return {
        ferramenta: 'bnexo',
        id: sel.task_id,
        titulo,
        projetoId: null,
        projetoNome: null,
        status: sel.ferramenta,
        categoria: 'em_progresso',
        prazo: null,
        link: null,
        descricao: v?.descricao ?? titulo,
        comentarios: [],
        imagens: [],
      };
    }
    const adapter = this.d.gestao.find((a) => a.nome === sel.ferramenta);
    if (!adapter) throw new Error(`sem adaptador para ${sel.ferramenta}`);
    return adapter.getTask(sel.task_id);
  }

  // Aviso de fila/bloqueio de uma seleção: o mesmo motivo só repete depois de 30 min.
  async avisar(sel: Selecao, motivo: string, html: string) {
    const recente = sel.aviso_em && Date.now() - Date.parse(sel.aviso_em) < REPETIR_AVISO_MS;
    if (sel.aviso_motivo === motivo && recente) return;
    this.d.selecoes.registrarAviso(sel.id, motivo);
    sel.aviso_em = new Date().toISOString();
    sel.aviso_motivo = motivo;
    log.info('despacho: aviso', { selecaoId: sel.id, motivo });
    await this.d.notificador.enviar(html);
  }
}

// runs/12.md em vez do caminho absoluto, para caber na mensagem.
export function relativo(arquivo: string) {
  const i = arquivo.lastIndexOf('/runs/');
  return i >= 0 ? arquivo.slice(i + 1) : arquivo;
}
