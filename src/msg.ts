// Padrão visual das mensagens do Telegram (B14). Toda mensagem do hub segue o mesmo esqueleto:
//
//   <ícone> <b>Título</b>          ← o assunto: a task, ou a pergunta que espera resposta
//   <i>contexto · contexto</i>      ← a que se refere: app, ferramenta, estado
//
//   corpo                          ← texto normal; campos como "<b>Rótulo:</b> valor"
//
//   <i>rodapé</i>                   ← o que fazer agora / observação
//
// Um ícone só, no título, e sempre com o mesmo significado (ver ICONE). Nada de ícone decorativo.
import { escapeHtml } from './resumo.js';

export const ICONE = {
  lista: '📋', // lista de tasks
  pergunta: '❓', // espera uma resposta sua (botão ou texto)
  fila: '⏳', // na fila / esperando a sessão
  rodando: '▶️', // começou a rodar no Claude
  voce: '🙋', // precisa de você no Orca
  pausa: '⏸️', // pausada por limite de uso
  ok: '✅', // concluída / feito
  revisao: '🔍', // concluída, mas precisa da sua revisão
  bloqueado: '⛔', // a sessão parou bloqueada
  falha: '❌', // interrompida / deu errado
  aviso: '⚠️', // algo não saiu como esperado, mas o fluxo segue
  pr: '🔀', // pull request
  sessao: '🖥️', // sessão do Claude aberta pelo hub
  anexo: '📎',
  projetos: '📂',
  regras: '📄',
  limpar: '🧹',
  status: '📊',
  cancelado: '✖️',
} as const;

type Linha = string | null | undefined | false;

export function cartao(o: { icone?: string; titulo: string; contexto?: Linha[]; corpo?: Linha[]; rodape?: Linha }): string {
  const partes: string[] = [`${o.icone ? `${o.icone} ` : ''}<b>${o.titulo}</b>`];
  const ctx = (o.contexto ?? []).filter(Boolean) as string[];
  if (ctx.length) partes[0] += `\n<i>${ctx.join(' · ')}</i>`;
  const corpo = (o.corpo ?? []).filter((l) => l !== null && l !== undefined && l !== false) as string[];
  if (corpo.length) partes.push(corpo.join('\n').replace(/^\n+|\n+$/g, ''));
  if (o.rodape) partes.push(`<i>${o.rodape}</i>`);
  return partes.join('\n\n');
}

export function campo(rotulo: string, valor: string) {
  return `<b>${rotulo}:</b> ${valor}`;
}

export const esc = escapeHtml;

// Título curto para caber numa linha do celular.
export function curto(s: string, max = 70) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
