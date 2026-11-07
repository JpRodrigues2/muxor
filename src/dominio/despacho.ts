// Máquina de estados do despacho (domínio): estados, transições permitidas e a tag do bloco de resultado.
//
//   em_execucao ⇄ aguardando_usuario ⇄ pausado_limite      (acompanhamento pela tela)
//        └──────────────┴──────────────┴──▶ concluido ──▶ encerrado
//        └──────────────┴──────────────┴──▶ interrompido      ▲
//                                    concluido ⇄ seguimento_fila ──▶ em_execucao (rodada N+1)

export const ESTADOS_DESPACHO = [
  'em_execucao',
  'aguardando_usuario',
  'pausado_limite',
  'concluido',
  'seguimento_fila',
  'encerrado',
  'interrompido',
] as const;
export type EstadoDespacho = (typeof ESTADOS_DESPACHO)[number];

// Ativo = a sessão está ocupada com a task: o app não recebe outra.
export const ESTADOS_ATIVOS = ['em_execucao', 'aguardando_usuario', 'pausado_limite'] as const satisfies readonly EstadoDespacho[];

const ATIVO_PARA: EstadoDespacho[] = ['em_execucao', 'aguardando_usuario', 'pausado_limite', 'concluido', 'interrompido'];

export const TRANSICOES: Record<EstadoDespacho, readonly EstadoDespacho[]> = {
  em_execucao: ATIVO_PARA,
  aguardando_usuario: ATIVO_PARA,
  pausado_limite: ATIVO_PARA,
  concluido: ['seguimento_fila', 'encerrado'],
  seguimento_fila: ['em_execucao', 'concluido'],
  encerrado: [],
  interrompido: [],
};

export function podeTransicionar(de: string, para: EstadoDespacho): boolean {
  return de === para || (TRANSICOES[de as EstadoDespacho]?.includes(para) ?? false);
}

export function ativo(estado: string): boolean {
  return (ESTADOS_ATIVOS as readonly string[]).includes(estado);
}

// Lista de constantes para `IN (...)` no SQL. Só para valores do próprio código, nunca entrada do usuário.
export function sqlLista(valores: readonly string[]) {
  return valores.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
}

// Rodada 1 usa "#12"; continuações usam "#12.2", "#12.3"… (a tela ainda mostra o bloco da rodada anterior).
export function tagRodada(selecaoId: number, rodada: number) {
  return rodada > 1 ? `${selecaoId}.${rodada}` : String(selecaoId);
}

// Linha da tabela despachos (o banco é a fonte; nomes iguais às colunas).
export interface Despacho {
  id: number;
  selecao_id: number;
  app: string;
  pasta: string;
  terminal_handle: string | null;
  titulo_terminal: string | null;
  run_file: string;
  estado: string;
  rodada: number;
  resultado: string | null; // JSON do bloco "### RESULTADO HUB"
  msg_fechamento: number | null;
  seguimento: string | null; // JSON do Seguimento esperando a sessão
}

// Bloco "### RESULTADO HUB" lido da tela: status, resumo, arquivos, branch, pendencias.
export type ResultadoHub = Record<string, string>;

// Próximo passo pedido pelo usuário depois da conclusão.
export interface Seguimento {
  tipo: 'instrucao' | 'pr';
  instrucao?: string;
  base?: string;
  remoto?: string | null;
  branch: string | null;
  novaBranch?: string;
}

// Branch de trabalho da task: a primeira citada (resultado atual, depois o histórico) que não seja URL de PR.
export function branchDeTrabalho(citadas: (string | null | undefined)[]): string | null {
  for (const b of citadas) {
    const nome = (b ?? '').split(/[\s,()]+/).find((t) => t && !t.includes('://') && /^[\w./-]+$/.test(t) && !t.startsWith('-'));
    if (nome) return nome;
  }
  return null;
}

// Nome de branch digitado pelo usuário (vai para o prompt e para o git).
export function nomeBranchValido(n: string) {
  return /^[\w./-]{1,100}$/.test(n) && !n.startsWith('-') && !n.includes('..');
}
