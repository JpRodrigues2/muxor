// Caso de uso: ambiente para task de projeto sem app (B15).
//   destino → ambiente → existente (escolher_app, liga o projeto ao app)
//   ou novo: amb_espaco → amb_nome → amb_git → (amb_url) → cria a pasta/clona, adiciona ao Orca e ao apps.yaml.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { espacoDe, type App, type Catalogo } from '../../config.js';
import { FERRAMENTA_REAL, type Selecao } from '../../dominio/selecao.js';
import { errInfo, log } from '../../logger.js';
import { ICONE, cartao, esc } from '../../msg.js';
import type { Conversa, DepsSelecao } from './contexto.js';

// A pasta nova fica dentro da pasta do espaço escolhido.
export function pastaAmbiente(cat: Catalogo, a: { espaco?: string; nome?: string }) {
  const e = a.espaco ? espacoDe(cat, a.espaco) : undefined;
  if (!e) throw new Error(`espaço "${a.espaco ?? ''}" não existe no apps.yaml`);
  return join(e.pasta, a.nome ?? '');
}

export class Ambientes {
  constructor(
    private d: DepsSelecao,
    private conversa: Conversa,
    // Depois de cada passo, a conversa segue para a próxima pergunta.
    private continuar: () => Promise<void>,
  ) {}

  // Texto nas etapas amb_nome e amb_url.
  async onTexto(s: Selecao, t: string): Promise<boolean> {
    if (s.etapa === 'amb_nome') {
      const nome = t.toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{1,59}$/.test(nome)) return this.conversa.aviso('Nome inválido', 'Use minúsculas, números, - _ e . (ex.: bb-joga-junto).');
      if (this.d.catalogo.atual().apps.some((a) => a.app === nome))
        return this.conversa.aviso(`Já existe o app ${esc(nome)}`, 'Escolha outro nome, ou cancele e use "app existente".');
      const amb = { ...(JSON.parse(s.ambiente ?? '{}') as object), nome };
      this.d.selecoes.atualizar(s.id, { ambiente: JSON.stringify(amb), etapa: 'amb_git' });
      await this.continuar();
      return true;
    }
    // amb_url
    if (t.startsWith('-') || !/^(https?:\/\/\S+|ssh:\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/.test(t))
      return this.conversa.aviso('URL inválida', 'Ex.: https://github.com/org/repo.git ou git@github.com:org/repo.git');
    if (s.msg_pergunta) await this.d.notificador.botoes(s.msg_pergunta);
    await this.criar(s, t);
    return true;
  }

  // Cria a pasta (ou clona), adiciona ao Orca e grava o app no apps.yaml ligado ao projeto da task.
  async criar(s: Selecao, url: string | null): Promise<boolean> {
    const { notificador, git, executor, catalogo, selecoes } = this.d;
    const amb = JSON.parse(s.ambiente ?? '{}') as { espaco: string; nome: string };
    const pasta = pastaAmbiente(catalogo.atual(), amb);
    const t = this.conversa.task(s);
    await notificador.enviar(
      cartao({ icone: ICONE.fila, titulo: url ? `Clonando ${esc(amb.nome)}` : `Criando ${esc(amb.nome)}`, contexto: [`<code>${esc(pasta)}</code>`] }),
    );
    try {
      if (existsSync(pasta) && url) throw new Error('a pasta já existe; escolha "Só criar a pasta" para usar a que está lá, ou outro nome');
      if (url) {
        mkdirSync(dirname(pasta), { recursive: true });
        await git.clonar(url, pasta);
      } else await git.prepararPasta(pasta);
      await executor.addRepo(pasta);
      catalogo.adicionarApp({ app: amb.nome, espaco: amb.espaco, ferramenta: s.ferramenta as App['ferramenta'], pasta: amb.nome, projeto: t.projeto_id });
    } catch (e) {
      log.warn('ambiente: falha', { selecao: s.id, pasta, ...errInfo(e) });
      await notificador.enviar(
        cartao({ icone: ICONE.falha, titulo: `Não consegui montar ${esc(amb.nome)}`, contexto: this.conversa.contexto(s), corpo: [esc((e as Error).message)] }),
      );
      selecoes.atualizar(s.id, { etapa: 'amb_git' });
      await this.continuar();
      return false;
    }
    log.info('ambiente: criado', { selecao: s.id, app: amb.nome, pasta, clonado: !!url });
    const novo = catalogo.atual().apps.find((a) => a.app === amb.nome);
    selecoes.atualizar(s.id, { app: amb.nome, ambiente: null, etapa: novo?.gamificacao ? 'alvo' : 'confirmar', gamificacoes: null });
    await notificador.enviar(
      cartao({
        icone: ICONE.ok,
        titulo: `Ambiente ${esc(amb.nome)} pronto`,
        contexto: [url ? 'clonado' : 'pasta criada', 'no Orca', 'no apps.yaml'],
        rodape: t.projeto_nome ? `As próximas tasks de ${esc(t.projeto_nome)} já vêm com este app.` : undefined,
      }),
    );
    await this.continuar();
    return true;
  }

  // App escolhido para uma task cujo projeto ainda não tem app: liga o projeto a ele no apps.yaml.
  async ligarSeSemApp(s: Selecao, app: App) {
    const t = this.conversa.task(s);
    if (!t.projeto_id || !FERRAMENTA_REAL.has(s.ferramenta) || (app.ferramenta !== s.ferramenta && app.ferramenta !== 'nenhuma')) return;
    if (this.d.catalogo.atual().apps.some((a) => a.ferramenta === s.ferramenta && a.projetos_na_ferramenta.includes(t.projeto_id!))) return;
    try {
      this.d.catalogo.ligarProjeto(app.app, t.projeto_id, s.ferramenta as App['ferramenta']);
      log.info('ambiente: projeto ligado', { app: app.app, projeto: t.projeto_id });
      await this.d.notificador.enviar(
        cartao({ icone: ICONE.ok, titulo: `${esc(t.projeto_nome ?? t.projeto_id)} ligado a ${esc(app.app)}`, rodape: 'As próximas tasks desse projeto já vêm com este app.' }),
      );
    } catch (e) {
      log.warn('ambiente: falha ao ligar projeto', { app: app.app, ...errInfo(e) });
    }
  }
}
