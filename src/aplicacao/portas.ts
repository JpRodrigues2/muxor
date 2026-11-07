// Portas: o que o hub precisa do mundo de fora, sem saber quem atende.
// Adaptadores em src/adaptadores/; quem escolhe qual usar é só o main.ts.
// A porta das ferramentas de gestão já existia: PmAdapter (src/pm/types.ts).
import type { Despacho, EstadoDespacho, ResultadoHub, Seguimento } from '../dominio/despacho.js';
import type { Selecao, TaskVista } from '../dominio/selecao.js';
import type { App, Catalogo } from '../config.js';

// ─────────────── Executor: onde as sessões do Claude rodam (Orca hoje) ───────────────

export class ErroExecutor extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ErroExecutor';
  }
}

export interface TerminalExecutor {
  handle: string;
  title: string;
  agentIdentity: string | null; // "claude" quando há um Claude Code rodando
  worktreePath: string;
  connected: boolean;
  writable: boolean;
  lastOutputAt?: number;
  tabId?: string;
  leafId?: string;
}

// Estado estruturado de um agente, como o executor informa (sem ler a tela).
export interface AgenteExecutor {
  estado: string; // working | done | waiting | …
  monitorando?: boolean; // turno acabou, mas há shell em segundo plano que vai acordar o Claude
  esperaHumano?: boolean; // parado numa pergunta ou permissão que só a pessoa responde
  pergunta?: string; // o que está perguntando, quando esperaHumano
  ultimaMensagem?: string; // última resposta do Claude, em markdown (sem as quebras do terminal)
}

export interface StatusExecutor {
  ok: boolean;
  versao?: string;
  estado?: string;
}

export type StatusWorktree = 'todo' | 'in-progress' | 'in-review' | 'completed';

export interface Executor {
  status(): Promise<StatusExecutor>;
  listRepos(): Promise<{ id: string; path: string; displayName: string }[]>;
  addRepo(pasta: string): Promise<unknown>;
  listTerminals(pasta: string): Promise<TerminalExecutor[]>;
  // Estado dos agentes por pane ("tabId:leafId"), pelos hooks do Claude Code no executor (I2).
  agentStates(): Promise<Map<string, AgenteExecutor>>;
  createTerminal(pasta: string, comando: string, titulo?: string): Promise<string>;
  readScreen(handle: string, linhas?: number): Promise<string[]>;
  send(handle: string, linha: string): Promise<unknown>;
  // true se o TUI ficou ocioso dentro do prazo; false se estourou o timeout.
  waitIdle(handle: string, timeoutMs: number): Promise<boolean>;
  setWorktreeStatus(pasta: string, status: StatusWorktree, comentario?: string): Promise<unknown>;
}

// ─────────────── Cofre: credenciais das gamificações (D-A14) ───────────────

export interface Credencial {
  api_key: string;
  secret: string;
}

export interface Cofre {
  obter(id: string): Promise<Credencial | null>;
  salvar(id: string, c: Credencial): Promise<void>;
  remover(id: string): Promise<void>;
  ids(): Promise<string[]>; // nunca devolve valores
}

// ─────────────── Confirmador: pergunta ao usuário antes de uma ação arriscada do broker ───────────────

export interface Confirmador {
  // true só com um "sim" explícito; recusa, tempo esgotado ou falha de envio = false.
  confirmar(pergunta: string): Promise<boolean>;
}

// ─────────────── Notificador: o chat com o usuário (Telegram hoje) ───────────────

export interface Botao {
  texto: string;
  dado: string; // vai de volta no toque (callback_data: até 64 bytes)
}
export type Teclado = Botao[][]; // linhas de botões

export interface Notificador {
  // Mensagem em HTML (padrão do msg.ts). Devolve o id da mensagem, ou null se o envio falhou (já registrado no log).
  enviar(html: string, teclado?: Teclado): Promise<number | null>;
  // Troca os botões de uma mensagem; sem teclado, tira. Falha é ignorada (mensagem antiga ou apagada).
  botoes(msgId: number, teclado?: Teclado): Promise<void>;
  // Troca o texto (e os botões) de uma mensagem já enviada. Falha é ignorada.
  editar(msgId: number, html: string, teclado?: Teclado): Promise<void>;
}

// ─────────────── Repositórios: todo o acesso ao banco mora em src/adaptadores/persistencia/ ───────────────


export interface RepositorioDespachos {
  enfileirar(selecaoId: number): string | null; // app da seleção; null = seleção não existe
  appsComTrabalho(): string[]; // com task na fila ou continuação esperando a sessão
  temAtivoNoApp(app: string): boolean;
  seguimentoNaFila(app: string): Despacho | undefined;
  proximoDaFila(app: string): { filaId: number; selecaoId: number } | undefined;
  // Saiu da fila e foi para a sessão: cria o despacho e marca o lote como despachado.
  iniciar(d: { filaId: number; selecaoId: number; app: string; pasta: string; handle: string; tituloTerminal: string; arquivo: string }): number;
  ativos(): number[];
  obter(id: number): Despacho | undefined;
  mudarEstado(id: number, estado: EstadoDespacho, limparAviso: boolean): void;
  ultimoAviso(id: number): { motivo: string | null; em: string | null };
  registrarAviso(id: number, motivo: string): void;
  trocarTerminal(id: number, handle: string): void;
  interromper(id: number, selecaoId: number): void; // + histórico de cada task do lote
  concluir(id: number, selecaoId: number, r: ResultadoHub): void; // + histórico de cada task do lote
  guardarMsgFechamento(id: number, msgId: number | null): void;
  concluidosRecentes(limite: number): Despacho[];
  branchesDoHistorico(ferramenta: string, taskId: string): string[]; // mais recente primeiro
  encerrar(id: number, selecaoId: number): void;
  pedirSeguimento(id: number, seg: Seguimento): void; // só se estiver concluído
  desistirSeguimento(id: number): void; // volta para concluído
  iniciarSeguimento(d: { id: number; selecaoId: number; rodada: number; arquivo: string; handle: string; tituloTerminal: string }): void;
}

export interface RepositorioSelecoes {
  obter(id: number): Selecao | undefined;
  lote(s: Selecao): Selecao[]; // a task e, se lidera um lote, as outras na ordem em que foram marcadas
  task(ferramenta: string, taskId: string): TaskVista | undefined;
  registrarAviso(id: number, motivo: string): void;
  // Configuração pela conversa (uma task por vez: a líder mais antiga ainda coletando).
  ativa(): Selecao | undefined;
  coletando(): number; // quantas faltam configurar
  emAndamento(ferramenta: string, taskId: string): boolean;
  criar(s: { ferramenta: string; taskId: string; dataResumo: string; app: string | null; etapa: string; resumoId?: number }): number;
  // Muda campos da seleção; o estado da líder vale para o lote todo.
  atualizar(id: number, campos: Partial<Omit<Selecao, 'id'>>): void;
  // Atividade avulsa (/nova): a "task" é o texto do usuário.
  registrarAvulsa(taskId: string, titulo: string, descricao: string | null): void;
  definirInstrucoes(ferramenta: string, taskId: string, titulo: string, descricao: string): void;
  definirEspaco(ferramenta: string, taskId: string, espaco: string): void;
}

export interface ItemResumo {
  idx: number; // número mostrado ao usuário
  ferramenta: string;
  task_id: string;
  espaco: string; // espaço do app sugerido ('' = sem app)
  app_sugerido: string | null;
}

export interface RepositorioResumos {
  abrir(data: string, origem: string): number; // o resumo aberto anterior vira "substituido"
  adicionarItem(resumoId: number, item: ItemResumo, msgId: number | null): void;
  definirMsgBotoes(resumoId: number, msgId: number | null): void;
  fechar(resumoId: number, estado: 'iniciado' | 'nenhuma'): void;
  aberto(resumoId: number): boolean;
  // Marca/desmarca e devolve a mensagem do item com os itens dela (para redesenhar os botões).
  alternar(resumoId: number, idx: number): { msgId: number; marcada: boolean; itens: { idx: number; titulo: string; selecionada: boolean }[] } | null;
  msgBotoes(resumoId: number): number | null;
  marcados(resumoId: number): ItemResumo[];
  mensagens(resumoId: number): number[];
  appSugerido(resumoId: number | null, taskId: string): string | null;
  // Texto de cada mensagem do resumo (B20): para redesenhar a linha marcada.
  guardarTexto(resumoId: number, msgId: number, texto: string): void;
  texto(msgId: number): string | null;
  ultimoAberto(): number | null;
}

// Valores soltos que sobrevivem a reinícios (tabela meta).
export interface Memoria {
  obter(chave: string): string | undefined;
  guardar(chave: string, valor: string): void;
}

// ─────────────── Git dos projetos (leitura) ───────────────

export interface GitProjetos {
  branchesRemotas(pasta: string): Promise<string[]>; // de origin, sem o prefixo
  remotoOrigin(pasta: string): Promise<string | null>; // sem credenciais embutidas
  clonar(url: string, pasta: string): Promise<unknown>;
  prepararPasta(pasta: string): Promise<void>; // pasta com git só local (o Orca exige repositório)
}

// ─────────────── Catálogo de apps (apps.yaml) ───────────────

export interface CatalogoApps {
  atual(): Catalogo; // relido a cada uso: pega edições sem reiniciar
  adicionarApp(a: { app: string; espaco: string; ferramenta: App['ferramenta']; pasta: string; projeto: string | null }): void;
  ligarProjeto(app: string, projeto: string, ferramenta?: App['ferramenta']): void;
}
