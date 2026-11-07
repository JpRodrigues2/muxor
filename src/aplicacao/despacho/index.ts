// Monta os casos de uso do despacho e liga uns aos outros:
//   Despachar (fila → sessão) → Monitor (sessão → resultado) → ProximosPassos (instrução, PR, encerrar) → Despachar
import { Tasks, type DepsDespacho } from './contexto.js';
import { Despachar } from './despachar.js';
import { Monitor } from './monitorar.js';
import { ProximosPassos } from './proximos-passos.js';
import { Sessoes } from './sessoes.js';

export type { DepsDespacho } from './contexto.js';

export function criarDespacho(deps: DepsDespacho) {
  const tasks = new Tasks(deps);
  const sessoes = new Sessoes(deps, tasks);
  const monitor = new Monitor(deps, tasks, sessoes);
  const despachar = new Despachar(deps, tasks, sessoes, monitor);
  monitor.aoLiberar = () => void despachar.processar();
  const proximos = new ProximosPassos(deps, tasks, () => void despachar.processar());
  return { despachar, monitor, proximos };
}

export type CasosDespacho = ReturnType<typeof criarDespacho>;
