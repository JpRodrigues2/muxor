// Telegram no muxor init: confere o token do bot e descobre o chat do dono pelo /start, antes do serviço subir
// (com o Muxor rodando, o getUpdates daria conflito). O token nunca vai para a tela nem para log.
export type BuscarTg = (url: string, init?: RequestInit) => Promise<Response>;

const api = (token: string, metodo: string) => `https://api.telegram.org/bot${token}/${metodo}`;

export async function conferirBot(token: string, buscar: BuscarTg = fetch): Promise<{ usuario: string; nome: string }> {
  const r = (await (await buscar(api(token, 'getMe'), { signal: AbortSignal.timeout(15_000) })).json()) as { ok: boolean; result?: { username: string; first_name: string } };
  if (!r.ok || !r.result) throw new Error('o Telegram recusou o token: confira se copiou inteiro (formato 123456789:ABC…)');
  return { usuario: r.result.username, nome: r.result.first_name };
}

export interface Dono {
  chatId: number;
  nome: string;
}

// Espera alguém mandar /start (ou qualquer mensagem) para o bot numa conversa privada. Devolve quem foi.
export async function esperarDono(token: string, limiteMs = 5 * 60_000, buscar: BuscarTg = fetch): Promise<Dono> {
  const fim = Date.now() + limiteMs;
  let offset = 0;
  while (Date.now() < fim) {
    const q = new URLSearchParams({ timeout: '20', offset: String(offset), allowed_updates: JSON.stringify(['message']) });
    const r = (await (await buscar(`${api(token, 'getUpdates')}?${q}`, { signal: AbortSignal.timeout(30_000) })).json()) as {
      ok: boolean;
      result: { update_id: number; message?: { chat: { id: number; type: string; first_name?: string } } }[];
    };
    for (const u of r.result ?? []) {
      offset = u.update_id + 1;
      const c = u.message?.chat;
      if (c?.type === 'private') {
        // Confirma a leitura, para o Muxor não processar este /start de novo quando subir.
        await buscar(`${api(token, 'getUpdates')}?offset=${offset}&timeout=0`).catch(() => {});
        return { chatId: c.id, nome: c.first_name ?? 'você' };
      }
    }
  }
  throw new Error('não chegou nenhuma mensagem no bot em 5 minutos');
}

export async function mandar(token: string, chatId: number, texto: string, buscar: BuscarTg = fetch) {
  await buscar(api(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto }),
  });
}
