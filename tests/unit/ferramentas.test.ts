import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = mkdtempSync(join(tmpdir(), 'muxor-ferramentas-'));
process.env.HUB_DADOS_DIR = join(raiz, 'dados');
const { openDb } = await import('../../src/db.js');
const { Ferramentas, ferramentasVisiveis } = await import('../../src/ferramentas.js');

describe('ferramentas na listagem (/ferramentas)', () => {
  it('desligar tira a ferramenta da busca sem desconectar; ligar de novo devolve', async () => {
    const db = openDb();
    const adapters = [{ nome: 'jira' }, { nome: 'bnexo' }] as never[];
    const editados: unknown[] = [];
    const api = { sendMessage: async () => ({}), editMessageReplyMarkup: async (...a: unknown[]) => editados.push(a) } as never;
    const f = new Ferramentas(db, api, 1, adapters);
    expect(ferramentasVisiveis(db, adapters).map((a: { nome: string }) => a.nome)).toEqual(['jira', 'bnexo']);
    expect(await f.alternar('jira', 10)).toBe('Desligada: Jira');
    expect(ferramentasVisiveis(db, adapters).map((a: { nome: string }) => a.nome)).toEqual(['bnexo']);
    expect(editados).toHaveLength(1);
    expect(await f.alternar('jira', 10)).toBe('Ligada: Jira');
    expect(ferramentasVisiveis(db, adapters)).toHaveLength(2);
    expect(await f.alternar('trello', 10)).toBe('Ferramenta não encontrada.');
    db.close();
  });
});
