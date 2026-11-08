// Regras de trabalho (B08, O14): um arquivo regras/<nome>.md por espaço (padrão: o id do espaço) e, se o projeto
// quiser, um próprio; "nenhuma" desliga. Vão em todo prompt do projeto.
// O usuário vê e edita pelo Telegram (/regras) trocando o texto inteiro; a versão anterior vai para <dados>/regras-historico/.
// Sem arquivo na pasta de regras configurada (servidor novo), valem as regras padrão do código.
//
// callback_data  g:<nome>:ver | edit | ok | no
import { InlineKeyboard, type Api } from 'grammy';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMINHOS, regrasPadrao } from './caminhos.js';
import { loadCatalogo, nomeEspaco, type Catalogo } from './config.js';
import { getMeta, setMeta, type DB } from './db.js';
import { log } from './logger.js';
import { ICONE, cartao } from './msg.js';
import { escapeHtml } from './resumo.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export const REGRAS_DIR = CAMINHOS.regras;
const arquivo = (nome: string) => join(REGRAS_DIR, `${nome}.md`);

// Os arquivos de regras em uso: o de cada espaço (que não seja "nenhuma") e os próprios de projetos.
export function fontesDeRegras(cat: Catalogo): { nome: string; titulo: string }[] {
  const fontes = new Map<string, string>();
  for (const e of cat.espacos) {
    const nome = e.regras ?? e.id;
    if (nome !== 'nenhuma') fontes.set(nome, nomeEspaco(e));
  }
  for (const a of cat.apps) if (a.regras && !fontes.has(a.regras)) fontes.set(a.regras, a.app);
  return [...fontes].map(([nome, titulo]) => ({ nome, titulo }));
}

export function lerRegras(nome: string): string {
  const f = existsSync(arquivo(nome)) ? arquivo(nome) : regrasPadrao(`${nome}.md`);
  return f ? readFileSync(f, 'utf8').trim() : '';
}

// Corpo das regras para o prompt (sem o título "# Regras de trabalho — X" do arquivo). null = projeto sem regras.
export function regrasParaPrompt(nome: string | null): string {
  return nome ? lerRegras(nome).replace(/^#[^\n]*\n+/, '').trim() : '';
}

// O Telegram (sem Premium) não preserva Markdown: o usuário vê e manda texto simples, uma regra por linha.
// desformatar() gera o que o bot mostra; formatar() devolve o Markdown que vai para o arquivo e para o prompt.
export function desformatar(md: string): string {
  return md
    .split('\n')
    .filter((l) => !/^#\s/.test(l.trim()))
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').replace(/`/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Nomes de arquivo, flags e cabeçalhos de commit viram `código`.
const CODIGO = /(?<![`\w])((?:[\w-]+\/)*[\w-]+\.(?:md|ts|tsx|js|json|ya?ml|env|sh)|Co-Authored-By|--[a-z][\w-]*)(?![`\w])/g;

export function formatar(titulo: string, texto: string): string {
  const linhas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i) => !(i === 0 && /^#?\s*regras de trabalho/i.test(l))) // título copiado junto
    .map((l) => {
      if (!l) return '';
      if (/^#{1,6}\s/.test(l)) return l; // subtítulo que o usuário escreveu em Markdown
      const corpo = l.replace(/^([-*•]|\d+[.)])\s+/, '');
      return `- ${corpo.includes('`') ? corpo : corpo.replace(CODIGO, '`$1`')}`;
    });
  return [`# Regras de trabalho — ${titulo}`, '', ...linhas].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function salvarRegras(nome: string, titulo: string, texto: string) {
  const f = arquivo(nome);
  if (existsSync(f)) {
    const hist = join(CAMINHOS.dados, 'regras-historico');
    mkdirSync(hist, { recursive: true });
    copyFileSync(f, join(hist, `${nome}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`));
  }
  mkdirSync(REGRAS_DIR, { recursive: true });
  writeFileSync(f, formatar(titulo, texto) + '\n');
  log.info('regras: atualizadas', { regras: nome, caracteres: texto.length });
}

interface Conversa {
  nome: string;
  etapa: 'texto' | 'confirmar';
  texto?: string;
  msgId?: number;
}

export class Regras {
  constructor(
    private db: DB,
    private api: Api,
    private chatId: number,
  ) {}

  private conversa(): Conversa | null {
    const v = getMeta(this.db, 'regras_conversa');
    return v ? (JSON.parse(v) as Conversa) : null;
  }

  private async setConversa(c: Conversa | null) {
    const atual = this.conversa();
    if (atual?.msgId && atual.msgId !== c?.msgId) await this.api.editMessageReplyMarkup(this.chatId, atual.msgId).catch(() => {});
    setMeta(this.db, 'regras_conversa', c ? JSON.stringify(c) : '');
  }

  async comando() {
    const fontes = fontesDeRegras(loadCatalogo());
    if (!fontes.length) {
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.regras, titulo: 'Nenhuma regra de trabalho', rodape: 'Os espaços e projetos estão sem regras.' }), HTML);
      return;
    }
    const kb = new InlineKeyboard();
    fontes.forEach((f, i) => {
      if (i && i % 2 === 0) kb.row();
      kb.text(`📄 ${f.titulo}`, `g:${f.nome}:ver`);
    });
    await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.regras, titulo: 'Regras de trabalho', rodape: 'Vão em todo pedido ao Claude. Qual quer ver?' }), {
      ...HTML,
      reply_markup: kb,
    });
  }

  async onBotao(nome: string, acao: string, msgId: number): Promise<string> {
    const fonte = fontesDeRegras(loadCatalogo()).find((f) => f.nome === nome);
    if (!fonte) return 'Regras inválidas.';
    const e = nome;
    const conv = this.conversa();

    if (acao === 'ver') {
      const texto = desformatar(lerRegras(e)) || '(vazio)';
      await this.api.sendMessage(
        this.chatId,
        cartao({ icone: ICONE.regras, titulo: `Regras · ${fonte.titulo}`, corpo: [`<pre>${escapeHtml(texto)}</pre>`], rodape: 'Uma regra por linha. Toque no texto para copiar; a formatação eu aplico ao salvar.' }),
        { ...HTML, reply_markup: new InlineKeyboard().text('✏️ Editar', `g:${e}:edit`) },
      );
      return fonte.titulo;
    }
    if (acao === 'edit') {
      await this.api.editMessageReplyMarkup(this.chatId, msgId).catch(() => {});
      const m = await this.api.sendMessage(
        this.chatId,
        cartao({ icone: ICONE.pergunta, titulo: `Novo texto das regras · ${fonte.titulo}`, rodape: 'Copie o texto acima, altere o que quiser e mande de volta inteiro, uma regra por linha.' }),
        { ...HTML, reply_markup: new InlineKeyboard().text('✖ Cancelar', `g:${e}:no`) },
      );
      await this.setConversa({ nome: e, etapa: 'texto', msgId: m.message_id });
      return 'Mande o texto';
    }
    if (!conv || conv.nome !== e || conv.msgId !== msgId) return 'Essa pergunta já foi respondida.';
    if (acao === 'no') {
      await this.setConversa(null);
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.cancelado, titulo: 'Regras mantidas' }), HTML);
      return 'Cancelado';
    }
    if (acao === 'ok' && conv.etapa === 'confirmar' && conv.texto) {
      salvarRegras(e, fonte.titulo, conv.texto);
      await this.setConversa(null);
      await this.api.sendMessage(
        this.chatId,
        cartao({ icone: ICONE.ok, titulo: `Regras salvas · ${fonte.titulo}`, rodape: 'Valem a partir da próxima task despachada.' }),
        HTML,
      );
      return 'Salvo';
    }
    return 'Essa pergunta já foi respondida.';
  }

  async onTexto(texto: string): Promise<boolean> {
    const conv = this.conversa();
    if (!conv) return false;
    if (conv.etapa === 'confirmar') {
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.aviso, titulo: 'Use Salvar ou Cancelar', rodape: 'Na mensagem das regras.' }), HTML);
      return true;
    }
    const t = texto.trim();
    if (t.length < 10) {
      await this.api.sendMessage(this.chatId, cartao({ icone: ICONE.aviso, titulo: 'Texto muito curto', rodape: 'Mande as regras completas, ou toque em Cancelar.' }), HTML);
      return true;
    }
    const m = await this.api.sendMessage(
      this.chatId,
      cartao({
        icone: ICONE.pergunta,
        titulo: `Salvar as regras · ${fontesDeRegras(loadCatalogo()).find((f) => f.nome === conv.nome)?.titulo ?? conv.nome}?`,
        contexto: [`${t.split('\n').length} linhas`],
        rodape: 'A versão atual fica guardada no histórico.',
      }),
      { ...HTML, reply_markup: new InlineKeyboard().text('✔ Salvar', `g:${conv.nome}:ok`).text('✖ Cancelar', `g:${conv.nome}:no`) },
    );
    await this.setConversa({ nome: conv.nome, etapa: 'confirmar', texto: t, msgId: m.message_id });
    return true;
  }
}
