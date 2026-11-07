import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CofreArquivoCifrado } from '../../src/adaptadores/cofre/arquivo-cifrado.js';
import { CofreMemoria } from '../../src/adaptadores/cofre/memoria.js';
import { migrarCofreAntigo } from '../../src/segredos.js';

const CRED = { api_key: 'VALOR-DE-TESTE-123', secret: 'SEGREDO-DE-TESTE-456' };
const pasta = () => mkdtempSync(join(tmpdir(), 'hub-cofre-'));

describe('CofreArquivoCifrado', () => {
  it('grava e lê de volta', async () => {
    const arq = join(pasta(), 'cofre.enc');
    const chave = randomBytes(32);
    await new CofreArquivoCifrado(arq, chave).salvar('teste-dev', CRED);
    const outro = new CofreArquivoCifrado(arq, chave); // outro processo, mesma chave
    expect(await outro.obter('teste-dev')).toEqual(CRED);
    expect(await outro.ids()).toEqual(['teste-dev']);
    expect(await outro.obter('nao-existe')).toBeNull();
  });

  it('o valor não aparece em texto puro no disco', async () => {
    const arq = join(pasta(), 'cofre.enc');
    await new CofreArquivoCifrado(arq, randomBytes(32)).salvar('teste-dev', CRED);
    const bruto = readFileSync(arq, 'utf8');
    expect(bruto).not.toContain(CRED.api_key);
    expect(bruto).not.toContain(CRED.secret);
    expect(JSON.parse(bruto)).toMatchObject({ versao: 1, alg: 'AES-256-GCM' });
  });

  it('cada gravação usa um nonce novo', async () => {
    const arq = join(pasta(), 'cofre.enc');
    const c = new CofreArquivoCifrado(arq, randomBytes(32));
    await c.salvar('a', CRED);
    const n1 = JSON.parse(readFileSync(arq, 'utf8')).nonce;
    await c.salvar('a', CRED);
    expect(JSON.parse(readFileSync(arq, 'utf8')).nonce).not.toBe(n1);
  });

  it('chave errada não abre', async () => {
    const arq = join(pasta(), 'cofre.enc');
    await new CofreArquivoCifrado(arq, randomBytes(32)).salvar('teste-dev', CRED);
    await expect(new CofreArquivoCifrado(arq, randomBytes(32)).obter('teste-dev')).rejects.toThrow(/não abriu/);
  });

  it('arquivo alterado em 1 byte não abre', async () => {
    const arq = join(pasta(), 'cofre.enc');
    const chave = randomBytes(32);
    await new CofreArquivoCifrado(arq, chave).salvar('teste-dev', CRED);
    const e = JSON.parse(readFileSync(arq, 'utf8'));
    const dados = Buffer.from(e.dados, 'base64');
    dados[0] ^= 1;
    writeFileSync(arq, JSON.stringify({ ...e, dados: dados.toString('base64') }));
    await expect(new CofreArquivoCifrado(arq, chave).obter('teste-dev')).rejects.toThrow(/não abriu/);
  });

  it('remove e recusa chave de tamanho errado', async () => {
    const arq = join(pasta(), 'cofre.enc');
    const c = new CofreArquivoCifrado(arq, randomBytes(32));
    await c.salvar('a', CRED);
    await c.remover('a');
    expect(await c.ids()).toEqual([]);
    expect(() => new CofreArquivoCifrado(arq, randomBytes(16))).toThrow(/32 bytes/);
  });

  it('doSystemd exige o hub.service', () => {
    const antes = process.env.CREDENTIALS_DIRECTORY;
    delete process.env.CREDENTIALS_DIRECTORY;
    expect(() => CofreArquivoCifrado.doSystemd('/tmp/x')).toThrow(/CREDENTIALS_DIRECTORY/);
    if (antes) process.env.CREDENTIALS_DIRECTORY = antes;
  });
});

describe('migrarCofreAntigo', () => {
  it('leva o arquivo em texto puro para o cofre e apaga o arquivo', async () => {
    const antigo = join(pasta(), 'gamificacoes.json');
    writeFileSync(antigo, JSON.stringify({ 'teste-dev': CRED, 'teste-prod': CRED }));
    const cofre = new CofreMemoria();
    expect(await migrarCofreAntigo(cofre, antigo)).toBe(2);
    expect(await cofre.obter('teste-prod')).toEqual(CRED);
    expect(existsSync(antigo)).toBe(false);
  });

  it('sem arquivo antigo, não faz nada', async () => {
    expect(await migrarCofreAntigo(new CofreMemoria(), join(pasta(), 'nada.json'))).toBe(0);
  });
});
