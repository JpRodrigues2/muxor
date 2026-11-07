import { describe, expect, it } from 'vitest';
import { baterCoracao } from '../../src/heartbeat.js';

function buscarFalso(resposta: Response | Error = new Response('OK')) {
  const chamadas: string[] = [];
  const buscar = (async (url: string | URL | Request) => {
    chamadas.push(String(url));
    if (resposta instanceof Error) throw resposta;
    return resposta;
  }) as typeof fetch;
  return { buscar, chamadas };
}

const URL_HC = 'https://hc-ping.com/abc';

describe('heartbeat', () => {
  it('Orca no ar: ping no endereço', async () => {
    const f = buscarFalso();
    expect(await baterCoracao(URL_HC, { status: async () => ({ ok: true }) }, f.buscar)).toBe(true);
    expect(f.chamadas).toEqual([URL_HC]);
  });

  it('Orca fora do ar (ou status falhando): ping em /fail', async () => {
    const f = buscarFalso();
    await baterCoracao(URL_HC + '/', { status: async () => ({ ok: false }) }, f.buscar);
    await baterCoracao(URL_HC, { status: async () => Promise.reject(new Error('sem Orca')) }, f.buscar);
    expect(f.chamadas).toEqual([URL_HC + '/fail', URL_HC + '/fail']);
  });

  it('falha de rede não derruba o hub', async () => {
    const f = buscarFalso(new Error('sem rede'));
    await expect(baterCoracao(URL_HC, { status: async () => ({ ok: true }) }, f.buscar)).resolves.toBe(true);
  });
});
