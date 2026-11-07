// Cofre do servidor: um arquivo cifrado com AES-256-GCM. A chave-mestra (32 bytes) não fica no disco ao lado:
// o systemd-creds a entrega só ao hub.service, em memória ($CREDENTIALS_DIRECTORY/cofre-chave).
// Desenho em docs/seguranca.md (C1) e docs/estudo/etapa-1.md.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Cofre, Credencial } from '../../aplicacao/portas.js';

const AAD = Buffer.from('hub-cofre-v1'); // amarra o conteúdo a este formato

interface Envelope {
  versao: 1;
  alg: 'AES-256-GCM';
  nonce: string;
  tag: string;
  dados: string;
}

export class CofreArquivoCifrado implements Cofre {
  constructor(
    private arquivo: string,
    private chave: Buffer,
  ) {
    if (chave.length !== 32) throw new Error('cofre: a chave-mestra precisa ter 32 bytes');
  }

  // Chave entregue pelo systemd (LoadCredentialEncrypted=cofre-chave:...).
  static doSystemd(arquivo: string, nomeCredencial = 'cofre-chave') {
    const dir = process.env.CREDENTIALS_DIRECTORY;
    if (!dir) throw new Error('cofre: sem $CREDENTIALS_DIRECTORY (o hub precisa rodar pelo hub.service)');
    return new CofreArquivoCifrado(arquivo, readFileSync(join(dir, nomeCredencial)));
  }

  private ler(): Record<string, Credencial> {
    if (!existsSync(this.arquivo)) return {};
    const e = JSON.parse(readFileSync(this.arquivo, 'utf8')) as Envelope;
    if (e.versao !== 1) throw new Error(`cofre: versão ${e.versao} desconhecida`);
    const d = createDecipheriv('aes-256-gcm', this.chave, Buffer.from(e.nonce, 'base64'));
    d.setAAD(AAD);
    d.setAuthTag(Buffer.from(e.tag, 'base64'));
    try {
      return JSON.parse(Buffer.concat([d.update(Buffer.from(e.dados, 'base64')), d.final()]).toString('utf8'));
    } catch {
      throw new Error('cofre: não abriu (chave errada ou arquivo alterado)');
    }
  }

  private gravar(conteudo: Record<string, Credencial>) {
    const nonce = randomBytes(12); // novo a cada gravação
    const c = createCipheriv('aes-256-gcm', this.chave, nonce);
    c.setAAD(AAD);
    const dados = Buffer.concat([c.update(JSON.stringify(conteudo), 'utf8'), c.final()]);
    const e: Envelope = { versao: 1, alg: 'AES-256-GCM', nonce: nonce.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64') };
    mkdirSync(dirname(this.arquivo), { recursive: true, mode: 0o700 });
    const tmp = `${this.arquivo}.tmp`;
    writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 });
    renameSync(tmp, this.arquivo); // troca atômica: nunca fica um cofre pela metade
  }

  async obter(id: string) {
    return this.ler()[id] ?? null;
  }

  async salvar(id: string, c: Credencial) {
    this.gravar({ ...this.ler(), [id]: c });
  }

  async remover(id: string) {
    const d = this.ler();
    if (!(id in d)) return;
    delete d[id];
    this.gravar(d);
  }

  async ids() {
    return Object.keys(this.ler());
  }
}
