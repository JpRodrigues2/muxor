// Cadastro de gamificações pelo Telegram (B15): /gamificacoes, ou o botão "➕ Nova gamificação" ao despachar.
// Pergunta nome → servidor → conta → API key → secret. As mensagens com credenciais são apagadas assim que lidas
// e as credenciais vão para o Cofre (porta); no apps.yaml fica só o id.
//
// callback_data  m:ver:<app> | m:add:<app> | m:srv:<i> | m:sem | m:rm:<app>:<i> | m:rmok:<app>:<i> | m:no
import { InlineKeyboard, type Api } from 'grammy';
import { adicionarGamificacao, loadCatalogo, removerGamificacao } from './config.js';
import { getMeta, setMeta, type DB } from './db.js';
import { log } from './logger.js';
import { ICONE, campo, cartao, esc } from './msg.js';
import type { Cofre } from './aplicacao/portas.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };
// Sugestões de servidor: os já usados no apps.yaml, mais o servidor padrão da Funifier.
const SERVIDORES_BASE = ['service2.funifier.com'];

interface Conversa {
  app: string;
  etapa: 'nome' | 'servidor' | 'conta' | 'api_key' | 'secret';
  nome?: string;
  servidor?: string;
  conta?: string;
  api_key?: string;
  servidores?: string[];
  msgId?: number;
  selecaoId?: number; // veio da etapa de gamificação de uma task: volta para ela no fim
}

const PERGUNTA: Record<Conversa['etapa'], { titulo: string; rodape: string }> = {
  nome: { titulo: 'Nome da gamificação?', rodape: 'Ex.: eTIP, Finges.' },
  servidor: { titulo: 'Qual o servidor?', rodape: 'Toque numa opção ou escreva o endereço.' },
  conta: { titulo: 'Qual a conta?', rodape: 'Como aparece no painel da Funifier.' },
  api_key: { titulo: 'API key?', rodape: 'Apago sua mensagem assim que ler. Sem credenciais: toque em Pular.' },
  secret: { titulo: 'Secret?', rodape: 'Apago sua mensagem assim que ler.' },
};

export class Gamificacoes {
  // Chamado quando um cadastro iniciado na etapa de gamificação de uma task termina (redesenha a pergunta).
  onConcluido: (selecaoId: number) => Promise<void> = async () => {};

  constructor(
    private db: DB,
    private api: Api,
    private chatId: number,
    private cofre: Cofre,
  ) {}

  private conversa(): Conversa | null {
    const v = getMeta(this.db, 'gamif_conversa');
    return v ? (JSON.parse(v) as Conversa) : null;
  }

  private async setConversa(c: Conversa | null) {
    const atual = this.conversa();
    if (atual?.msgId && atual.msgId !== c?.msgId) await this.api.editMessageReplyMarkup(this.chatId, atual.msgId).catch(() => {});
    setMeta(this.db, 'gamif_conversa', c ? JSON.stringify(c) : '');
  }

  async comando() {
    const apps = loadCatalogo().apps.filter((a) => a.gamificacao);
    const kb = new InlineKeyboard();
    apps.forEach((a, i) => {
      kb.text(`${a.app} (${a.gamificacoes?.length ?? 0})`, `m:ver:${a.app}`);
      if (i % 2 === 1) kb.row();
    });
    await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.lista, titulo: 'Gamificações por app', rodape: 'Escolha o app.' }), {
      ...HTML,
      reply_markup: kb,
    });
  }

  private async mostrarApp(nomeApp: string) {
    const app = loadCatalogo().apps.find((a) => a.app === nomeApp);
    if (!app) return;
    const gs = app.gamificacoes ?? [];
    const comChave = new Set(await this.cofre.ids());
    const kb = new InlineKeyboard().text('➕ Adicionar', `m:add:${app.app}`).row();
    gs.forEach((g, i) => kb.text(`🗑️ ${g.nome}`, `m:rm:${app.app}:${i}`).row());
    await this.api.sendMessage(
      this.chatId,
      cartao({
        icone: ICONE.lista,
        titulo: esc(app.app),
        contexto: [`${gs.length} gamificação(ões)`],
        corpo: gs.length
          ? gs.map((g) => `${esc(g.nome)} · ${esc(g.conta)} · <code>${esc(g.servidor)}</code>${g.credencial && comChave.has(g.credencial) ? ' · 🔑' : ''}`)
          : ['Nenhuma cadastrada.'],
        rodape: gs.length ? '🔑 = credenciais guardadas no cofre.' : undefined,
      }),
      { ...HTML, reply_markup: kb },
    );
  }

  // Começa um cadastro (também usado pela etapa de gamificação do fluxo).
  async iniciar(app: string, selecaoId?: number) {
    const servidores = [
      ...new Set([...loadCatalogo().apps.flatMap((a) => (a.gamificacoes ?? []).map((g) => g.servidor)), ...SERVIDORES_BASE]),
    ].slice(0, 6);
    await this.perguntar({ app, etapa: 'nome', servidores, selecaoId });
  }

  private async perguntar(c: Conversa) {
    const p = PERGUNTA[c.etapa];
    const kb = new InlineKeyboard();
    if (c.etapa === 'servidor') (c.servidores ?? []).forEach((sv, i) => kb.text(sv, `m:srv:${i}`).row());
    if (c.etapa === 'api_key') kb.text('⏭️ Pular credenciais', 'm:sem');
    kb.row().text('✖️ Cancelar', 'm:no');
    const m = await this.api.sendMessage(
      this.chatId,
      cartao({
        icone: ICONE.pergunta,
        titulo: p.titulo,
        contexto: [`nova gamificação · ${esc(c.app)}`, c.nome ? esc(c.nome) : null],
        rodape: p.rodape,
      }),
      { ...HTML, reply_markup: kb },
    );
    await this.setConversa({ ...c, msgId: m.message_id });
  }

  async onBotao(acao: string, a: string | undefined, b: string | undefined, msgId: number): Promise<string> {
    if (acao === 'ver' && a) {
      await this.mostrarApp(a);
      return a;
    }
    if (acao === 'add' && a) {
      await this.iniciar(a);
      return 'Nova gamificação';
    }
    if (acao === 'rm' && a) {
      const g = loadCatalogo().apps.find((x) => x.app === a)?.gamificacoes?.[Number(b)];
      if (!g) return 'Gamificação não encontrada.';
      await this.api.sendMessage(
        this.chatId,
        cartao({ icone: ICONE.pergunta, titulo: `Remover ${esc(g.nome)}?`, contexto: [esc(a)], rodape: 'As credenciais dela saem do cofre.' }),
        { ...HTML, reply_markup: new InlineKeyboard().text('🗑️ Remover', `m:rmok:${a}:${b}`).text('✖️ Cancelar', 'm:no') },
      );
      return 'Confirmar remoção';
    }
    if (acao === 'rmok' && a) {
      const g = loadCatalogo().apps.find((x) => x.app === a)?.gamificacoes?.[Number(b)];
      if (!g) return 'Gamificação não encontrada.';
      removerGamificacao(a, Number(b));
      if (g.credencial) await this.cofre.remover(g.credencial);
      await this.api.editMessageReplyMarkup(this.chatId, msgId).catch(() => {});
      log.info('gamificação removida', { app: a, nome: g.nome });
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.ok, titulo: `${esc(g.nome)} removida`, contexto: [esc(a)] }), HTML);
      return 'Removida';
    }

    const c = this.conversa();
    if (acao === 'no') {
      await this.api.editMessageReplyMarkup(this.chatId, msgId).catch(() => {});
      if (c?.msgId === msgId) {
        await this.setConversa(null);
        if (c.selecaoId) await this.onConcluido(c.selecaoId);
      }
      return 'Cancelado';
    }
    if (!c || c.msgId !== msgId) return 'Essa pergunta já foi respondida.';
    if (acao === 'srv' && c.etapa === 'servidor') {
      const sv = c.servidores?.[Number(a)];
      if (!sv) return 'Opção inválida.';
      await this.perguntar({ ...c, servidor: sv, etapa: 'conta' });
      return sv;
    }
    if (acao === 'sem' && c.etapa === 'api_key') {
      await this.salvar(c, null);
      return 'Salvo sem credenciais';
    }
    return 'Essa pergunta já foi respondida.';
  }

  // Texto do usuário. msgId é apagado quando for credencial.
  async onTexto(texto: string, msgId: number): Promise<boolean> {
    const c = this.conversa();
    if (!c) return false;
    const t = texto.trim();
    if (c.etapa === 'api_key' || c.etapa === 'secret') await this.api.deleteMessage(this.chatId, msgId).catch(() => {});
    if (!t) return true;
    switch (c.etapa) {
      case 'nome':
        await this.perguntar({ ...c, nome: t.slice(0, 60), etapa: 'servidor' });
        break;
      case 'servidor':
        if (!/^[\w.-]+(:\d+)?$/.test(t.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))) {
          await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.aviso, titulo: 'Servidor inválido', rodape: 'Ex.: service2.funifier.com' }), HTML);
          break;
        }
        await this.perguntar({ ...c, servidor: t.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), etapa: 'conta' });
        break;
      case 'conta':
        await this.perguntar({ ...c, conta: t.slice(0, 80), etapa: 'api_key' });
        break;
      case 'api_key':
        await this.perguntar({ ...c, api_key: t, etapa: 'secret' });
        break;
      case 'secret':
        await this.salvar(c, { api_key: c.api_key!, secret: t });
        break;
    }
    return true;
  }

  private async salvar(c: Conversa, cred: { api_key: string; secret: string } | null) {
    const id = cred ? `${c.app}-${c.nome!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}` : undefined;
    if (cred && id) await this.cofre.salvar(id, cred);
    adicionarGamificacao(c.app, { nome: c.nome!, servidor: c.servidor!, conta: c.conta!, padrao: false, credencial: id });
    await this.setConversa(null);
    log.info('gamificação cadastrada', { app: c.app, nome: c.nome, comCredencial: !!cred });
    await this.api.sendMessage(
      this.chatId,
      cartao({
        icone: ICONE.ok,
        titulo: `${esc(c.nome!)} cadastrada`,
        contexto: [esc(c.app)],
        corpo: [campo('Servidor', `<code>${esc(c.servidor!)}</code>`), campo('Conta', esc(c.conta!)), campo('Credenciais', cred ? '🔑 guardadas no cofre local' : 'não informadas')],
      }),
      HTML,
    );
    if (c.selecaoId) await this.onConcluido(c.selecaoId);
  }
}
