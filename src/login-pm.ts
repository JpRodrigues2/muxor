// /pm_login: login do Funifier PM pelo celular, para quando o hub roda no servidor.
// 1. O bot manda o link de login. 2. O usuário entra no celular e cai numa página de erro em localhost:53682.
// 3. Cola aqui o endereço dessa página; o hub troca o code pelo token. A mensagem colada é apagada.
import type { Api } from 'grammy';
import { errInfo, log } from './logger.js';
import { ICONE, cartao, esc } from './msg.js';
import { acharEnderecoRetorno, concluirLoginPm, extrairCodigoOAuth, iniciarLoginPm } from './pm/mcp-client.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export class LoginPm {
  constructor(
    private api: Api,
    private chatId: number,
  ) {}

  async comando() {
    try {
      const link = await iniciarLoginPm();
      if (!link) {
        await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.ok, titulo: 'Funifier PM já está conectado' }), HTML);
        return;
      }
      await this.api.sendMessage(
        this.chatId,
        cartao({
          icone: ICONE.pergunta,
          titulo: 'Login no Funifier PM',
          corpo: [
            `1. <a href="${esc(link)}">Abra este link</a> <b>no Safari ou no Chrome</b>, não no navegador do Telegram (nele o login não completa). Na tela que abrir, toque em ⋯ → Abrir no navegador.`,
            '2. No fim, o navegador mostra uma página de erro em <code>localhost:53682</code>. É normal.',
            '3. Copie o endereço dessa página e cole aqui.',
          ],
          rodape: 'Vale por poucos minutos. Apago a sua mensagem ao ler.',
        }),
        HTML,
      );
    } catch (e) {
      log.warn('pm_login: falha ao iniciar', errInfo(e));
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.falha, titulo: 'Não consegui iniciar o login', corpo: [esc((e as Error).message)] }), HTML);
    }
  }

  // true se a mensagem tinha o endereço de retorno do login (consumida aqui). Exige localhost:53682/callback,
  // para nunca confundir com texto de outra conversa.
  async onTexto(texto: string, msgId: number): Promise<boolean> {
    const endereco = acharEnderecoRetorno(texto);
    if (!endereco) return false;
    await this.api.deleteMessage(this.chatId, msgId).catch(() => {});
    let codigo: string | null;
    try {
      codigo = extrairCodigoOAuth(endereco);
      if (!codigo) throw new Error('o endereço não tem o code');
    } catch (e) {
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.falha, titulo: 'Login recusado', corpo: [esc((e as Error).message)] }), HTML);
      return true;
    }
    try {
      await concluirLoginPm(codigo);
      log.info('pm_login: concluído');
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.ok, titulo: 'Funifier PM conectado' }), HTML);
    } catch (e) {
      log.warn('pm_login: falha ao concluir', errInfo(e));
      await this.api.sendMessage(
        this.chatId,
        cartao({ icone: ICONE.falha, titulo: 'O login não completou', corpo: [esc((e as Error).message)], rodape: 'Mande /pm_login para tentar de novo.' }),
        HTML,
      );
    }
    return true;
  }
}
