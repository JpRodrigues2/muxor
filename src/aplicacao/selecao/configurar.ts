// Caso de uso: configurar a task pela conversa até "aguardando_despacho". Uma task por vez.
//
// callback_data  s:<selecao>:<acao>[:arg]  pular, ok, outro, esp:<espaço>, app:<nome>, g:<i>, gok, gnova, gsem,
//                                          amb:existente|novo, aesp:<espaço>, agit:url|pasta, desp, reset, cancel
//
// Task de ferramenta: info → destino → (alvo) → confirmar
// Atividade avulsa (/nova, B13): instrucoes → info → espaco → escolher_app → (alvo) → confirmar
// (alvo) só quando o app usa gamificações da Funifier.
// Lote: a líder passa pela conversa uma vez pelo lote todo; as outras têm lote_de = líder e acompanham o estado dela.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { CAMINHOS } from '../../caminhos.js';
import { espacoDe, nomeEspaco, type App, type Catalogo, type Gamificacao } from '../../config.js';
import { acaoValida, type Selecao } from '../../dominio/selecao.js';
import { log } from '../../logger.js';
import { vincular } from '../../mensagens.js';
import { ICONE, campo, cartao, curto, esc } from '../../msg.js';
import { dataLocal } from '../../pm/types.js';
import { dirAnexos } from '../../prompt.js';
import type { Teclado } from '../portas.js';
import { Ambientes, pastaAmbiente } from './ambiente.js';
import { cancelarTask, Conversa, type DepsSelecao } from './contexto.js';

// Título de uma atividade avulsa: a primeira linha das instruções.
function tituloDe(instrucoes: string) {
  const l = instrucoes.split('\n')[0].trim();
  return l.length > 80 ? l.slice(0, 79) + '…' : l;
}

// Avulsa escolhe espaço e app; task de ferramenta já tem app sugerido.
function depoisDaInfo(s: { ferramenta: string }) {
  return s.ferramenta === 'avulsa' ? 'espaco' : 'destino';
}

// Depois de escolher o app: o alvo (gamificações) só se o app usa a Funifier.
const depoisDoApp = (app: App | undefined) => (app?.gamificacao ? 'alvo' : 'confirmar');

// Durante a etapa "alvo", selecoes.gamificacoes guarda os NOMES marcados; na confirmação, os objetos completos.
function gamifsMarcadas(s: Selecao, gamifs: Gamificacao[]): Set<string> {
  if (s.gamificacoes === null) return new Set(gamifs.filter((g) => g.padrao).map((g) => g.nome));
  const v = JSON.parse(s.gamificacoes) as (string | Gamificacao)[];
  return new Set(v.map((x) => (typeof x === 'string' ? x : x.nome)));
}

// Arquivo mandado pelo usuário; o chat só baixa se a etapa aceitar anexo.
export interface Anexo {
  nome: string; // nome sugerido (do documento, ou foto-<id>.jpg)
  baixar: () => Promise<{ conteudo: Uint8Array; caminhoRemoto: string }>;
}

export class ConfigurarSelecao {
  // Chamado quando o usuário toca em "Despachar" (ligado ao Despachar no main.ts).
  onDespachar: (selecaoId: number) => void = () => {};
  // Cadastro de gamificação a partir da etapa "alvo" (ligado no telegram.ts).
  cadastrarGamificacao?: (app: string, selecaoId: number) => Promise<void>;
  private conversa: Conversa;
  private ambientes: Ambientes;

  constructor(private d: DepsSelecao) {
    this.conversa = new Conversa(d);
    this.ambientes = new Ambientes(d, this.conversa, () => this.proximaPergunta());
  }

  private atualizar(id: number, campos: Partial<Omit<Selecao, 'id'>>) {
    this.d.selecoes.atualizar(id, campos);
  }

  // /nova [instruções]: atividade avulsa (B13), sem task em ferramenta de gestão.
  async criarAvulsa(texto: string) {
    const taskId = `avulsa-${Date.now()}`;
    const instr = texto.trim();
    this.d.selecoes.registrarAvulsa(taskId, instr ? tituloDe(instr) : 'Atividade avulsa', instr || null);
    this.d.selecoes.criar({ ferramenta: 'avulsa', taskId, dataResumo: dataLocal(new Date(), this.d.env.TZ_HUB), app: null, etapa: instr ? 'info' : 'instrucoes' });
    await this.proximaPergunta();
  }

  async proximaPergunta(): Promise<void> {
    const s = this.d.selecoes.ativa();
    if (!s) return;
    vincular({ selecaoId: s.id });
    const cat = this.d.catalogo.atual();
    const app = cat.apps.find((a) => a.app === s.app);
    const b = (texto: string, acao: string) => ({ texto, dado: `s:${s.id}:${acao}` });
    const perguntar = (pergunta: string, o: { corpo?: (string | null)[]; rodape?: string; teclado?: Teclado } = {}) =>
      this.conversa.perguntar(s, pergunta, o);

    switch (s.etapa) {
      case 'instrucoes':
        return perguntar('O que o Claude deve fazer?', { rodape: 'Mande em texto. A primeira linha vira o título.', teclado: [cancelarTask(s.id)] });

      case 'espaco': {
        if (cat.espacos.length === 1) {
          this.d.selecoes.definirEspaco(s.ferramenta, s.task_id, cat.espacos[0].id);
          this.atualizar(s.id, { etapa: 'escolher_app', app: null });
          return this.proximaPergunta();
        }
        if (!cat.espacos.length) return perguntar('Nenhum espaço configurado', { rodape: 'Rode muxor init no Mac.', teclado: [cancelarTask(s.id)] });
        return perguntar('Em qual espaço?', { teclado: [...this.botoesEspacos(cat, b, 'esp'), cancelarTask(s.id)] });
      }

      case 'info':
        return perguntar('Algo a acrescentar?', {
          rodape: 'Mande texto, prints ou arquivos. O texto encerra a etapa.',
          teclado: [[b('⏭️ Pular', 'pular')], cancelarTask(s.id)],
        });

      case 'destino': {
        if (!app) {
          this.atualizar(s.id, { etapa: s.ferramenta === 'avulsa' || s.ferramenta === 'teste' ? 'escolher_app' : 'ambiente' });
          return this.proximaPergunta();
        }
        const outrosApps = [
          ...new Set(
            this.conversa
              .membros(s)
              .map((m) => this.d.resumos.appSugerido(m.resumo_id, m.task_id))
              .filter((a): a is string => !!a && a !== app.app),
          ),
        ];
        return perguntar(`Rodar em ${esc(app.app)}?`, {
          corpo: [
            `<code>${esc(app.pasta)}</code>`,
            ...(await this.avisosApp(app)),
            outrosApps.length ? `${ICONE.aviso} o lote tem tasks de ${outrosApps.map(esc).join(', ')}; ele roda num app só` : null,
          ],
          teclado: [[b('✔️ Sim', 'ok'), b('Escolher outro', 'outro')], cancelarTask(s.id)],
        });
      }

      case 'ambiente':
        return perguntar('Em qual pasta este projeto roda?', {
          corpo: ['Escolha uma vez: as próximas tasks do projeto já vêm com ela.'],
          teclado: [
            [b('📁 Projeto do Muxor', 'amb:existente')],
            [b('🐋 Projeto do Orca', 'amb:orca')],
            [b('🆕 Pasta nova', 'amb:novo')],
            cancelarTask(s.id),
          ],
        });

      case 'escolher_orca': {
        // Os projetos do Orca que ainda não estão no Muxor; a lista fica guardada para o botão apontar pelo número.
        const noMuxor = new Set(cat.apps.map((a) => a.pasta));
        const repos = (await this.d.executor.listRepos().catch(() => [])).filter((r) => !noMuxor.has(r.path));
        if (!repos.length) {
          this.atualizar(s.id, { etapa: 'ambiente' });
          await this.d.notificador.enviar(cartao({ icone: ICONE.aviso, titulo: 'Nenhum projeto do Orca fora do Muxor', contexto: ['escolha outra opção'] }));
          return this.proximaPergunta();
        }
        this.atualizar(s.id, { ambiente: JSON.stringify({ orca: repos.slice(0, 30).map((r) => r.path) }) });
        return perguntar('Qual projeto do Orca?', {
          teclado: [...repos.slice(0, 30).map((r, i) => [b(r.displayName || r.path.split('/').at(-1)!, `orca:${i}`)]), cancelarTask(s.id)],
        });
      }

      case 'amb_espaco': {
        if (cat.espacos.length === 1) {
          this.atualizar(s.id, { etapa: 'amb_nome', ambiente: JSON.stringify({ espaco: cat.espacos[0].id }) });
          return this.proximaPergunta();
        }
        if (!cat.espacos.length) return perguntar('Nenhum espaço configurado', { rodape: 'Rode muxor init no Mac.', teclado: [cancelarTask(s.id)] });
        return perguntar('Em qual espaço criar a pasta?', {
          corpo: cat.espacos.map((e) => `${esc(nomeEspaco(e))}: <code>${esc(e.pasta)}</code>`),
          teclado: [...this.botoesEspacos(cat, b, 'aesp'), cancelarTask(s.id)],
        });
      }

      case 'amb_nome':
        return perguntar('Nome do diretório?', {
          rodape: 'Minúsculas, números e -. Ex.: app-pedidos',
          teclado: [cancelarTask(s.id)],
        });

      case 'amb_git': {
        const amb = JSON.parse(s.ambiente ?? '{}') as { espaco: string; nome: string };
        return perguntar('Tem URL do Git para clonar?', {
          corpo: [campo('Pasta', `<code>${esc(pastaAmbiente(cat, amb))}</code>`)],
          rodape: 'Sem URL, crio uma pasta vazia.',
          teclado: [[b('🔗 Tenho a URL', 'agit:url'), b('📁 Só criar a pasta', 'agit:pasta')], cancelarTask(s.id)],
        });
      }

      case 'amb_url':
        return perguntar('Qual a URL do Git?', { rodape: 'HTTPS ou SSH.', teclado: [cancelarTask(s.id)] });

      case 'escolher_app': {
        const apps = cat.apps.filter((a) => this.appServe(s, a));
        const linhas: Teclado = [];
        apps.forEach((a, i) => {
          if (i % 2 === 0) linhas.push([]);
          linhas.at(-1)!.push(b(a.app === s.app ? `• ${a.app}` : a.app, `app:${a.app}`));
        });
        const espaco = s.ferramenta === 'avulsa' ? espacoDe(cat, this.conversa.task(s).espaco) : undefined;
        return perguntar(espaco ? `Em qual app de ${esc(nomeEspaco(espaco))}?` : 'Em qual app?', { teclado: [...linhas, cancelarTask(s.id)] });
      }

      case 'alvo': {
        const gamifs = app?.gamificacoes ?? [];
        if (!gamifs.length) {
          return perguntar(`${esc(app?.app ?? '?')} não tem gamificação vinculada`, {
            corpo: ['A sessão vai usar a gamificação que já conhece. Cadastrar uma agora ou seguir assim?'],
            teclado: [[b('➕ Cadastrar gamificação', 'gnova')], [b('⚠️ Seguir sem gamificação', 'gsem')], cancelarTask(s.id)],
          });
        }
        return perguntar('Quais gamificações podem ser alteradas?', {
          corpo: gamifs.map((g) => `${esc(g.nome)} · conta ${esc(g.conta)} · <code>${esc(g.servidor)}</code>${g.credencial ? ' · 🔑' : ''}`),
          rodape: 'Marque pelo menos uma.',
          teclado: this.tecladoAlvo(s, gamifs),
        });
      }

      case 'confirmar':
        return perguntar('Confirma o despacho?', {
          corpo: this.resumoConfirmacao(s, cat),
          teclado: [[b('▶️ Despachar', 'desp')], [b('↩️ Recomeçar', 'reset'), b('✖️ Cancelar', 'cancel')]],
        });
    }
  }

  // Apps que servem para a task: avulsa, os do espaço escolhido; task de teste, o sandbox; task de ferramenta,
  // os ligados à mesma ferramenta e os ainda sem ferramenta (trazidos para o hub sem de-para).
  private appServe(s: Selecao, a: App) {
    if (s.ferramenta === 'avulsa') return a.espaco === this.conversa.task(s).espaco;
    if (s.ferramenta === 'teste') return a.ferramenta === 'teste';
    return a.ferramenta === s.ferramenta || a.ferramenta === 'nenhuma';
  }

  private botoesEspacos(cat: Catalogo, b: (texto: string, acao: string) => Teclado[number][number], acao: string): Teclado {
    const linhas: Teclado = [];
    cat.espacos.forEach((e, i) => {
      if (i % 2 === 0) linhas.push([]);
      linhas.at(-1)!.push(b(nomeEspaco(e), `${acao}:${e.id}`));
    });
    return linhas;
  }

  private async avisosApp(app: App): Promise<string[]> {
    const avisos: string[] = [];
    if (!existsSync(app.pasta)) avisos.push(`${ICONE.aviso} pasta não existe`);
    try {
      const repos = await this.d.executor.listRepos();
      if (!repos.some((r) => r.path === app.pasta)) avisos.push(`${ICONE.aviso} não está aberto no Orca`);
    } catch {
      avisos.push(`${ICONE.aviso} Orca inacessível agora`);
    }
    return avisos;
  }

  private resumoConfirmacao(s: Selecao, cat: Catalogo): string[] {
    const t = this.conversa.task(s);
    const app = cat.apps.find((a) => a.app === s.app);
    const anexos = JSON.parse(s.anexos ?? '[]') as string[];
    const linhas = [campo('App', `${esc(app?.app ?? '?')} · <code>${esc(app?.pasta ?? '?')}</code>`)];
    const membros = this.conversa.membros(s);
    if (membros.length)
      linhas.push(campo(`Lote de ${membros.length + 1}`, '\n' + [s, ...membros].map((m, i) => `${i + 1}. ${esc(curto(this.conversa.task(m).titulo, 70))}`).join('\n')));
    if (s.ferramenta === 'avulsa' && t.descricao) linhas.push(campo('Instruções', `\n<blockquote>${esc(t.descricao)}</blockquote>`));
    linhas.push(campo('Info extra', s.info_extra ? `\n<blockquote>${esc(s.info_extra)}</blockquote>` : 'nenhuma'));
    if (anexos.length) linhas.push(campo('Anexos', String(anexos.length)));
    if (app?.gamificacao) {
      const gs = JSON.parse(s.gamificacoes ?? '[]') as Gamificacao[];
      linhas.push(
        gs.length
          ? campo('Gamificações', gs.map((g) => `${esc(g.nome)} (${esc(g.conta)})`).join(', '))
          : `${ICONE.aviso} <b>Sem gamificação vinculada</b> — a sessão decide o alvo`,
      );
    }
    return linhas;
  }

  // Foto/arquivo do usuário nas etapas de instruções e informação extra: salva em runs/<selecao>/ e referencia no prompt.
  async onAnexo(anexo: Anexo, legenda: string | undefined): Promise<boolean> {
    const s = this.d.selecoes.ativa();
    if (!s || (s.etapa !== 'info' && s.etapa !== 'instrucoes')) return false;
    vincular({ selecaoId: s.id });
    const { conteudo, caminhoRemoto } = await anexo.baixar();
    const anexos = JSON.parse(s.anexos ?? '[]') as string[];
    const dir = dirAnexos(s.id);
    mkdirSync(dir, { recursive: true });
    const ext = extname(anexo.nome) || extname(caminhoRemoto) || '.bin';
    const base = anexo.nome.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40) || 'anexo';
    const arq = join(dir, `usuario-${anexos.length + 1}-${base}${ext}`);
    writeFileSync(arq, conteudo);
    anexos.push(arq);
    const info = legenda?.trim() ? [s.info_extra, legenda.trim()].filter(Boolean).join('\n\n') : s.info_extra;
    this.atualizar(s.id, { anexos: JSON.stringify(anexos), info_extra: info });
    log.info('anexo salvo', { selecao: s.id, arquivo: arq });
    await this.d.notificador.enviar(`${ICONE.anexo} Anexo ${anexos.length} salvo.`);
    return true;
  }

  // Texto livre do usuário: vale nas etapas que esperam texto (instruções, informação extra, nome e URL do ambiente).
  async onTexto(texto: string): Promise<boolean> {
    const s = this.d.selecoes.ativa();
    if (s?.etapa === 'amb_nome' || s?.etapa === 'amb_url') {
      vincular({ selecaoId: s.id });
      return this.ambientes.onTexto(s, texto.trim());
    }
    if (!s || (s.etapa !== 'info' && s.etapa !== 'instrucoes')) return false;
    vincular({ selecaoId: s.id });
    if (s.etapa === 'instrucoes') {
      this.d.selecoes.definirInstrucoes(s.ferramenta, s.task_id, tituloDe(texto.trim()), texto.trim());
      this.atualizar(s.id, { etapa: 'info' });
      await this.proximaPergunta();
      return true;
    }
    this.atualizar(s.id, { info_extra: [s.info_extra, texto.trim()].filter(Boolean).join('\n\n'), etapa: depoisDaInfo(s) });
    await this.proximaPergunta();
    return true;
  }

  // Retorna o texto para a resposta do toque no botão.
  async onAcao(selId: number, acao: string, arg: string | undefined): Promise<string> {
    const s = this.d.selecoes.obter(selId);
    if (s) vincular({ selecaoId: s.id });
    if (!s || s.estado !== 'coletando' || this.d.selecoes.ativa()?.id !== s.id) return 'Essa pergunta já foi respondida.';
    if (!acaoValida(s.etapa, acao)) return 'Essa pergunta já foi respondida.';
    const cat = this.d.catalogo.atual();
    const tirarBotoes = () => (s.msg_pergunta ? this.d.notificador.botoes(s.msg_pergunta) : Promise.resolve());

    switch (acao) {
      case 'cancel':
        this.atualizar(s.id, { estado: 'cancelada', etapa: null });
        await tirarBotoes();
        await this.d.notificador.enviar(cartao({ icone: ICONE.cancelado, titulo: 'Task cancelada', contexto: this.conversa.contexto(s) }));
        break;
      case 'pular':
        this.atualizar(s.id, { etapa: depoisDaInfo(s) });
        break;
      case 'esp':
        if (!arg || !espacoDe(cat, arg)) return 'Espaço inválido.';
        this.d.selecoes.definirEspaco(s.ferramenta, s.task_id, arg);
        this.atualizar(s.id, { etapa: 'escolher_app', app: null });
        break;
      case 'ok':
        this.atualizar(s.id, { etapa: depoisDoApp(cat.apps.find((a) => a.app === s.app)), gamificacoes: null });
        break;
      case 'outro':
        this.atualizar(s.id, { etapa: 'escolher_app' });
        break;
      case 'app': {
        const app = cat.apps.find((a) => a.app === arg);
        if (!app || !this.appServe(s, app)) return 'App inválido.';
        if (s.ferramenta !== 'avulsa' && (s.ferramenta === 'teste') !== (app.ferramenta === 'teste')) return 'Task de teste só roda no sandbox (e vice-versa).';
        this.atualizar(s.id, { app: app.app, etapa: depoisDoApp(app), gamificacoes: null });
        await this.ambientes.ligarSeSemApp(s, app);
        break;
      }
      case 'amb':
        this.atualizar(s.id, { etapa: arg === 'novo' ? 'amb_espaco' : arg === 'orca' ? 'escolher_orca' : 'escolher_app' });
        break;
      case 'orca': {
        const pasta = (JSON.parse(s.ambiente ?? '{}') as { orca?: string[] }).orca?.[Number(arg)];
        if (!pasta) return 'Projeto inválido.';
        await tirarBotoes();
        return (await this.ambientes.trazerDoOrca(s, pasta)) ? 'Projeto ligado' : 'Não deu certo';
      }
      case 'aesp':
        if (!arg || !espacoDe(cat, arg)) return 'Espaço inválido.';
        this.atualizar(s.id, { etapa: 'amb_nome', ambiente: JSON.stringify({ espaco: arg }) });
        break;
      case 'agit':
        if (arg === 'url') this.atualizar(s.id, { etapa: 'amb_url' });
        else {
          await tirarBotoes();
          return (await this.ambientes.criar(s, null)) ? 'Ambiente pronto' : 'Não deu certo';
        }
        break;
      case 'gnova':
        if (!this.cadastrarGamificacao || !s.app) return 'Cadastro indisponível.';
        await tirarBotoes();
        await this.cadastrarGamificacao(s.app, s.id);
        return 'Nova gamificação';
      case 'gsem':
        this.atualizar(s.id, { gamificacoes: '[]', etapa: 'confirmar' });
        break;
      case 'g': {
        const gamifs = cat.apps.find((a) => a.app === s.app)?.gamificacoes ?? [];
        const g = gamifs[Number(arg)];
        if (!g) return 'Gamificação inválida.';
        const marcadas = gamifsMarcadas(s, gamifs);
        if (marcadas.has(g.nome)) marcadas.delete(g.nome);
        else marcadas.add(g.nome);
        const gamificacoes = JSON.stringify([...marcadas]);
        this.atualizar(s.id, { gamificacoes });
        if (s.msg_pergunta) await this.d.notificador.botoes(s.msg_pergunta, this.tecladoAlvo({ ...s, gamificacoes }, gamifs));
        return `${marcadas.has(g.nome) ? '✅' : '⬜'} ${g.nome}`;
      }
      case 'gok': {
        const gamifs = cat.apps.find((a) => a.app === s.app)?.gamificacoes ?? [];
        const marcadas = gamifsMarcadas(s, gamifs);
        const escolhidas = gamifs.filter((g) => marcadas.has(g.nome));
        if (!escolhidas.length) return 'Marque pelo menos uma gamificação.';
        this.atualizar(s.id, { gamificacoes: JSON.stringify(escolhidas), etapa: 'confirmar' });
        break;
      }
      case 'reset':
        this.atualizar(s.id, { etapa: 'info', info_extra: null, gamificacoes: null, anexos: null, ...(s.ferramenta === 'avulsa' ? { app: null } : {}) });
        break;
      case 'desp':
        this.atualizar(s.id, { estado: 'aguardando_despacho', etapa: null });
        await tirarBotoes();
        log.info('selecao aguardando despacho', { selecao: s.id, app: s.app, ferramenta: s.ferramenta });
        this.onDespachar(s.id);
        break;
    }
    await this.proximaPergunta();
    return 'Ok';
  }

  private tecladoAlvo(s: Selecao, gamifs: Gamificacao[]): Teclado {
    const marcadas = gamifsMarcadas(s, gamifs);
    return [
      ...gamifs.map((g, i) => [{ texto: `${marcadas.has(g.nome) ? '✅' : '⬜'} ${g.nome} — ${g.conta}`, dado: `s:${s.id}:g:${i}` }]),
      [
        { texto: '➡️ Continuar', dado: `s:${s.id}:gok` },
        { texto: '➕ Nova', dado: `s:${s.id}:gnova` },
      ],
      cancelarTask(s.id),
    ];
  }
}
