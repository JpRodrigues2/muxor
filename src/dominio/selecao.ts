// Máquina de estados da seleção (domínio): em cada etapa da conversa, quais botões ainda valem.
// Botão de uma pergunta já respondida (mensagem antiga no chat) cai fora daqui e é recusado.

export const ACOES_POR_ETAPA = {
  instrucoes: ['cancel'],
  espaco: ['esp', 'cancel'],
  info: ['pular', 'cancel'],
  destino: ['ok', 'outro', 'cancel'],
  escolher_app: ['app', 'cancel'],
  escolher_pasta: ['pasta', 'cancel'],
  alvo: ['g', 'gok', 'gnova', 'gsem', 'cancel'],
  ambiente: ['amb', 'cancel'],
  amb_espaco: ['aesp', 'cancel'],
  amb_nome: ['cancel'],
  amb_git: ['agit', 'cancel'],
  amb_url: ['cancel'],
  confirmar: ['desp', 'reset', 'cancel'],
} as const satisfies Record<string, readonly string[]>;

export type EtapaSelecao = keyof typeof ACOES_POR_ETAPA;

export function acaoValida(etapa: string | null | undefined, acao: string): boolean {
  const acoes: readonly string[] | undefined = ACOES_POR_ETAPA[(etapa ?? '') as EtapaSelecao];
  return acoes?.includes(acao) ?? false;
}

// Linha da tabela selecoes (nomes iguais às colunas).
export interface Selecao {
  id: number;
  ferramenta: string; // funifier-pm | bnexo | avulsa | teste
  task_id: string;
  resumo_id: number | null;
  info_extra: string | null;
  app: string | null;
  gamificacoes: string | null; // JSON: nomes marcados (etapa alvo) ou as gamificações escolhidas
  estado: string;
  etapa: string | null;
  msg_pergunta: number | null;
  anexos: string | null; // JSON: arquivos mandados pelo Telegram
  aviso_em: string | null;
  aviso_motivo: string | null;
  ambiente: string | null; // JSON { espaco, nome } enquanto monta um ambiente novo; { pastas: [...] } ao escolher um projeto do computador
  lote_de: number | null; // id da líder do lote
}

// O que o hub guardou da task na ferramenta de gestão (tabela tasks_vistas).
export interface TaskVista {
  titulo: string;
  descricao?: string | null;
  projeto_nome: string | null;
  projeto_id: string | null;
  link: string | null;
  espaco: string; // id do espaço escolhido (avulsa); '' = ainda não definido
  prazo: string | null;
}

// Ferramentas de gestão reais (avulsa e teste não têm task para atualizar).
export const FERRAMENTA_REAL = new Set(['funifier-pm', 'bnexo', 'jira']);
export const NOME_FERRAMENTA: Record<string, string> = { 'funifier-pm': 'Funifier PM', bnexo: 'Bnexo', jira: 'Jira' };
