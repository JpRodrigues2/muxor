// Política do broker (gateway MCP entre a sessão do Claude e a Funifier): o que a sessão pode fazer, sem I/O.
// Desenho em docs/seguranca.md (C3).

export type Classe = 'leitura' | 'escrita' | 'destrutiva';
export type Decisao = 'permitir' | 'confirmar' | 'negar';

// O funifier-mcp marca o save como destrutivo (sobrescreve o registro), mas salvar é o trabalho normal da task.
const RECLASSIFICADAS: Record<string, Classe> = { funifier_save: 'escrita' };

// Anotações do MCP. Pela especificação, sem readOnlyHint a ferramenta pode escrever, e sem destructiveHint
// ela pode destruir: na dúvida, a classe mais restrita.
export function classificar(anotacoes?: { readOnlyHint?: boolean; destructiveHint?: boolean }, nome?: string): Classe {
  if (nome && RECLASSIFICADAS[nome]) return RECLASSIFICADAS[nome];
  if (anotacoes?.readOnlyHint === true) return 'leitura';
  if (anotacoes?.destructiveHint === false) return 'escrita';
  return 'destrutiva';
}

// Leitura sempre passa; escrita passa em dev e confirma em produção; destrutiva sempre confirma no Telegram.
// "negar" fica para o que nunca passa (ex.: funifier_connect, tratado à parte).
export function decidir(classe: Classe, producao: boolean): Decisao {
  if (classe === 'leitura') return 'permitir';
  if (classe === 'escrita') return producao ? 'confirmar' : 'permitir';
  return 'confirmar';
}

export function ehProducao(g: { nome: string; ambiente?: 'dev' | 'producao' }): boolean {
  return g.ambiente ? g.ambiente === 'producao' : /^prod/i.test(g.nome);
}

// Como a sessão chama uma gamificação: "<app>/<nome>", ex.: "meu-app/dev".
export const idGamificacao = (app: string, nome: string) => `${app}/${nome}`;

// A sessão nunca recebe a ferramenta que pede a chave como argumento (a chave entraria no histórico).
export const FERRAMENTAS_BLOQUEADAS = new Set(['funifier_connect']);
