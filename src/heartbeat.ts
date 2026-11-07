// Heartbeat (B24): a cada 5 min o hub avisa um serviço externo (Healthchecks.io) que está vivo. Se os pings param
// (VM fora do ar, hub travado), quem avisa o usuário é o serviço externo: quem vigia fica fora da máquina vigiada.
// Orca fora do ar manda /fail, para o aviso chegar mesmo com o hub de pé.
import type { Executor } from './aplicacao/portas.js';
import { errInfo, log } from './logger.js';

export const INTERVALO_HEARTBEAT_MS = 5 * 60_000;

export async function baterCoracao(url: string, executor: Pick<Executor, 'status'>, buscar: typeof fetch = fetch) {
  const orca = await executor.status().catch(() => ({ ok: false }));
  const alvo = orca.ok ? url : `${url.replace(/\/+$/, '')}/fail`;
  try {
    const r = await buscar(alvo, { method: 'POST', body: orca.ok ? 'ok' : 'Orca fora do ar', signal: AbortSignal.timeout(10_000) });
    if (!r.ok) log.warn('heartbeat: resposta inesperada', { status: r.status });
  } catch (e) {
    // Sem o endereço no log: quem tem o endereço consegue mandar pings falsos.
    log.warn('heartbeat: falha no ping', errInfo(e));
  }
  return orca.ok;
}
