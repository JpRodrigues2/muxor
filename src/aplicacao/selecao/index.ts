// Monta os casos de uso da seleção: resumo (marcar tasks) → configurar (conversa por task) → despacho.
import type { DepsSelecao } from './contexto.js';
import { ConfigurarSelecao } from './configurar.js';
import { ResumoDiario } from './resumo-diario.js';

export type { DepsSelecao } from './contexto.js';
export type { Anexo } from './configurar.js';

export function criarSelecao(deps: DepsSelecao) {
  const configurar = new ConfigurarSelecao(deps);
  const resumo = new ResumoDiario(deps, configurar);
  return { configurar, resumo };
}

export type CasosSelecao = ReturnType<typeof criarSelecao>;
