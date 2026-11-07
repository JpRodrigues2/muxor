// O que os casos de uso da seleção recebem (montado no main.ts) e o apoio comum da conversa:
// a task da seleção, o contexto das perguntas e o envio de cada pergunta (uma por vez, com os botões).
import type { Env } from '../../config.js';
import type { Selecao, TaskVista } from '../../dominio/selecao.js';
import { ICONE, cartao, curto, esc } from '../../msg.js';
import type { ResultadoBusca } from '../../resumo.js';
import type { Task } from '../../pm/types.js';
import type { CatalogoApps, Executor, GitProjetos, Memoria, Notificador, RepositorioResumos, RepositorioSelecoes, Teclado } from '../portas.js';

export interface DepsSelecao {
  env: Pick<Env, 'TZ_HUB' | 'RESUMO_HORARIO'>;
  selecoes: RepositorioSelecoes;
  resumos: RepositorioResumos;
  memoria: Memoria;
  executor: Executor;
  notificador: Notificador;
  catalogo: CatalogoApps;
  git: GitProjetos;
  // Busca nas ferramentas de gestão (e registra o que viu); `ferramentas` = quantas foram consultadas.
  buscar: () => Promise<ResultadoBusca>;
  ferramentas: number;
  // Separa as tasks de projetos desligados no /projetos.
  filtrar: (tasks: Task[]) => { visiveis: Task[]; ocultas: Task[]; projetosOcultos: number };
}

export const cancelarTask = (id: number): Teclado[number] => [{ texto: '✖️ Cancelar task', dado: `s:${id}:cancel` }];

export class Conversa {
  constructor(private d: DepsSelecao) {}

  task(s: Selecao): TaskVista {
    return (
      this.d.selecoes.task(s.ferramenta, s.task_id) ?? {
        titulo: s.task_id,
        projeto_nome: null,
        projeto_id: null,
        link: null,
        espaco: '',
        prazo: null,
      }
    );
  }

  // Outras tasks do lote liderado por `s` (vazio = task sozinha).
  membros(s: Selecao): Selecao[] {
    return this.d.selecoes.lote(s).slice(1);
  }

  // Contexto das perguntas: a task (com link), o projeto e quantas faltam configurar.
  contexto(s: Selecao) {
    const t = this.task(s);
    const pendentes = this.d.selecoes.coletando();
    const titulo = esc(curto(t.titulo, 60));
    const membros = this.membros(s);
    return [
      membros.length ? `📦 lote: ${esc(curto(t.titulo, 40))} e mais ${membros.length}` : t.link ? `<a href="${esc(t.link)}">${titulo}</a>` : titulo,
      s.ferramenta === 'avulsa' ? 'avulsa' : t.projeto_nome ? esc(t.projeto_nome) : null,
      pendentes > 1 ? `faltam ${pendentes}` : null,
    ];
  }

  // Toda pergunta: ❓ + a pergunta em negrito, a task em itálico, detalhes e uma dica no rodapé.
  // Os botões da pergunta anterior saem: só a pergunta atual responde.
  async perguntar(s: Selecao, pergunta: string, o: { corpo?: (string | null)[]; rodape?: string; teclado?: Teclado } = {}) {
    if (s.msg_pergunta) await this.d.notificador.botoes(s.msg_pergunta);
    const msgId = await this.d.notificador.enviar(
      cartao({ icone: ICONE.pergunta, titulo: pergunta, contexto: this.contexto(s), corpo: o.corpo, rodape: o.rodape }),
      o.teclado,
    );
    this.d.selecoes.atualizar(s.id, { msg_pergunta: msgId });
  }

  async aviso(titulo: string, rodape: string) {
    await this.d.notificador.enviar(cartao({ icone: ICONE.aviso, titulo, rodape }));
    return true;
  }
}
