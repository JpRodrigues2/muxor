// Padrão das mensagens do Telegram: título e descrição, sempre.
//
//   <ícone> <b>Título</b>          ← o assunto, curto
//   contexto · contexto             ← a descrição, em texto normal: fatos curtos separados por ·
//   rodapé                          ← (opcional) o que fazer agora, numa frase
//
//   corpo                          ← só quando precisa: listas, código, campos
//
// Exemplo:  📊 <b>Muxor online</b>
//           hub-cloud · versão 9b493fb · broker ligado · nada rodando
//
// Ícone só quando diz algo num relance (estado: ok, falha, alerta, espera você). Assunto não leva ícone ('').
import { escapeHtml } from './resumo.js';

export const ICONE = {
  lista: '', // lista de tasks
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
  sessao: '', // sessão do Claude aberta pelo hub
  anexo: '',
  projetos: '',
  regras: '',
  limpar: '',
  status: '📊',
  cancelado: '✖️',
} as const;

type Linha = string | null | undefined | false;

export function cartao(o: { icone?: string; titulo: string; contexto?: Linha[]; corpo?: Linha[]; rodape?: Linha }): string {
  const cabeca = [`${o.icone ? `${o.icone} ` : ''}<b>${o.titulo}</b>`];
  const ctx = (o.contexto ?? []).filter(Boolean) as string[];
  if (ctx.length) cabeca.push(ctx.join(' · '));
  if (o.rodape) cabeca.push(o.rodape);
  const partes = [cabeca.join('\n')];
  const corpo = (o.corpo ?? []).filter((l) => l !== null && l !== undefined && l !== false) as string[];
  if (corpo.length) partes.push(corpo.join('\n').replace(/^\n+|\n+$/g, ''));
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
