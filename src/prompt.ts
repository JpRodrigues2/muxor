// Gera runs/<id>.md — o prompt completo da task. Ao terminal vai só uma linha apontando para ele.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { App, Gamificacao } from './config.js';
import { CAMINHOS } from './caminhos.js';
import { regrasParaPrompt } from './regras.js';
import { errInfo, log } from './logger.js';
import type { TaskDetalhe } from './pm/types.js';
import { tagRodada } from './dominio/despacho.js';
import { idGamificacao } from './dominio/broker.js';

export const RUNS_DIR = CAMINHOS.runs;

export function dirAnexos(selecaoId: number) {
  return join(RUNS_DIR, String(selecaoId));
}

// Baixa as imagens da descrição para runs/<id>/; as que falharem ficam só como URL no prompt.
// `prefixo` separa as imagens de cada task de um lote (descricao-t2-1.png).
export async function baixarImagens(selecaoId: number, urls: string[], prefixo = ''): Promise<{ locais: string[]; falhas: string[] }> {
  const locais: string[] = [];
  const falhas: string[] = [];
  const dir = dirAnexos(selecaoId);
  for (const [i, url] of urls.entries()) {
    try {
      if (!/^https?:\/\//.test(url)) throw new Error('URL não http(s)');
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = (res.headers.get('content-type') ?? '').match(/image\/(png|jpe?g|gif|webp)/)?.[1] ?? 'bin';
      mkdirSync(dir, { recursive: true });
      const arq = join(dir, `descricao-${prefixo}${i + 1}.${ext.replace('jpeg', 'jpg')}`);
      writeFileSync(arq, Buffer.from(await res.arrayBuffer()));
      locais.push(arq);
    } catch (e) {
      log.warn('prompt: imagem não baixada', { selecaoId, ...errInfo(e) });
      falhas.push(url);
    }
  }
  return { locais, falhas };
}

export interface TaskDoPrompt {
  task: TaskDetalhe;
  imagens: { locais: string[]; falhas: string[] };
}

export interface DadosPrompt {
  selecaoId: number;
  tasks: TaskDoPrompt[]; // 1 = task sozinha; 2+ = lote (tasks que se complementam)
  avulsa: boolean; // atividade avulsa (/nova): sem ferramenta de gestão
  credenciais: string | null; // runs/<id>/credenciais.json com API key/secret das gamificações autorizadas
  broker?: boolean; // gamificações pelo MCP "hub" (broker): a sessão não recebe credenciais
  infoExtra: string | null;
  app: App;
  gamificacoes: Gamificacao[];
  anexosUsuario: string[];
}

// Prompt da task (ou do lote). Sem nome de branch (a sessão escolhe) e sem apontar para repositório de contexto:
// o contexto é o da própria sessão. As regras de trabalho vêm de regras/<nome>.md (do espaço ou do projeto).
export function escreverPrompt(d: DadosPrompt): string {
  const { app } = d;
  const lote = d.tasks.length > 1;
  const L: string[] = [];

  if (lote) {
    L.push(`# Lote do hub #${d.selecaoId}: ${d.tasks.length} tasks relacionadas`, '');
    L.push(
      'Estas tasks se complementam e foram mandadas juntas de propósito. Leia todas antes de começar, planeje a ordem e faça tudo nesta sessão, numa mesma branch. Se alguma não fizer sentido junto com as outras, pare e me pergunte.',
      '',
    );
    L.push(`- **App:** ${app.app}`, `- **Pasta:** \`${app.pasta}\``, '');
  }

  d.tasks.forEach(({ task, imagens }, i) => {
    const h = lote ? '###' : '##';
    L.push(lote ? `## Task ${i + 1}: ${task.titulo}` : `# Task do hub #${d.selecaoId}: ${task.titulo}`, '');
    L.push(
      d.avulsa
        ? '- **Origem:** atividade avulsa pedida pelo usuário (não está em nenhuma ferramenta de gestão)'
        : `- **Ferramenta:** ${task.ferramenta}${task.projetoNome ? ` — projeto "${task.projetoNome}"` : ''}`,
    );
    if (task.link) L.push(`- **Link:** ${task.link}`);
    if (task.prazo) L.push(`- **Prazo:** ${task.prazo.slice(0, 10)}`);
    if (!lote) L.push(`- **App:** ${app.app}`, `- **Pasta:** \`${app.pasta}\``);
    L.push('');

    L.push(d.avulsa ? `${h} Instruções` : `${h} Descrição`, '', task.descricao.trim() || '_(sem descrição)_', '');

    if (task.comentarios.length) {
      L.push(`${h} Comentários`, '');
      for (const c of task.comentarios) L.push(`**${c.autor}** (${c.data.slice(0, 10)}):`, '', c.texto.trim(), '');
    }

    if (imagens.locais.length || imagens.falhas.length) {
      L.push(`${h} Imagens da descrição`, '', 'Abra e analise cada arquivo abaixo antes de começar — fazem parte da especificação:', '');
      for (const a of imagens.locais) L.push(`- \`${a}\``);
      for (const u of imagens.falhas) L.push(`- ${u} (não consegui baixar; tente abrir a URL)`);
      L.push('');
    }
  });

  if (d.infoExtra) L.push(`## Informação extra do usuário${lote ? ' (vale para o lote)' : ''}`, '', d.infoExtra.trim(), '');

  if (d.anexosUsuario.length) {
    L.push('## Anexos do usuário', '', 'Abra e analise cada arquivo abaixo antes de começar — fazem parte da especificação:', '');
    for (const a of d.anexosUsuario) L.push(`- \`${a}\` (${basename(a)})`);
    L.push('');
  }

  if (app.gamificacao) {
    if (d.gamificacoes.length) {
      L.push('## Gamificações autorizadas', '');
      for (const g of d.gamificacoes)
        L.push(`- **${g.nome}** — servidor \`${g.servidor}\`, conta ${g.conta}${d.broker ? `, id no broker \`${idGamificacao(app.app, g.nome)}\`` : ''}`);
      L.push('', '**Só altere as gamificações listadas aqui. Se a gamificação conectada no seu MCP não for uma delas, pare e avise.**', '');
      if (d.broker) L.push(...blocoBroker());
      else if (d.credenciais) L.push(...blocoCredenciais(d.credenciais));
    } else {
      L.push(
        '## Gamificação',
        '',
        'Nenhuma gamificação foi vinculada a esta task no hub. Use a que esta sessão já conhece e confirme o alvo (servidor, conta, gamificação) antes de qualquer escrita.',
        '',
      );
    }
  }

  L.push(...blocoRegras(app.regras));
  if (lote) L.push('No bloco de encerramento, use um único bloco para o lote e diga no `resumo` o que foi feito em cada task.', '');
  L.push(...blocoEncerramento(String(d.selecaoId)));

  mkdirSync(RUNS_DIR, { recursive: true });
  const arquivo = join(RUNS_DIR, `${d.selecaoId}.md`);
  writeFileSync(arquivo, L.join('\n'));
  return arquivo;
}

function blocoCredenciais(arquivo: string) {
  return [
    `Credenciais (API key e secret) de cada gamificação acima: \`${arquivo}\`.`,
    'Leia esse arquivo só quando precisar acessar ou trocar de gamificação. **Nunca** copie as credenciais para código, commits, PRs, logs ou mensagens.',
    '',
  ];
}

function blocoBroker() {
  return [
    'Acesso às gamificações: só pelas ferramentas do MCP **hub** (`funifier_gamificacoes`, `funifier_ferramentas`, `funifier_chamar`), usando o id do broker. O hub guarda as credenciais; você não as recebe e não deve procurá-las (`funifier.json`, outro MCP da Funifier).',
    'Ação destrutiva e escrita em produção esperam a confirmação do usuário no Telegram: se for negada, não tente outro caminho; explique no encerramento.',
    '',
  ];
}

function blocoRegras(nome: App['regras']) {
  const regras = regrasParaPrompt(nome);
  return regras ? ['## Regras de trabalho', '', regras, ''] : [];
}

function blocoEncerramento(tag: string) {
  return [
    '## Formato obrigatório de encerramento',
    '',
    'Termine a sua última mensagem com este bloco, exatamente neste formato (é por ele que o hub sabe que você terminou):',
    '',
    '```',
    '### RESULTADO HUB',
    `task: #${tag}`,
    'status: concluido | bloqueado | precisa_revisao',
    'resumo: <1 a 3 frases>',
    'arquivos: <lista curta dos arquivos alterados>',
    'branch: <nome da branch em que você trabalhou, ou URL do PR>',
    'pendencias: <o que falta, ou "nenhuma">',
    '```',
    '',
  ];
}

export interface DadosSeguimento {
  selecaoId: number;
  rodada: number;
  titulo: string;
  link: string | null;
  app: App;
  anterior: Record<string, string>;
  branch: string | null; // branch de trabalho informada no resultado anterior (null = não informada)
  tipo: 'instrucao' | 'pr';
  instrucao?: string;
  base?: string;
  remoto?: string | null;
  novaBranch?: string; // nome escolhido pelo usuário no Abrir PR
  credenciais?: string | null;
  broker?: boolean;
}

// Continuação de uma task já concluída: runs/<id>-<rodada>.md.
export function escreverSeguimento(d: DadosSeguimento): string {
  const tag = tagRodada(d.selecaoId, d.rodada);
  const a = d.anterior;
  const branchTxt = d.branch ? `a branch de trabalho desta task (\`${d.branch}\`)` : 'a branch de trabalho desta task';
  const L: string[] = [];
  L.push(`# Task do hub #${tag}: ${d.titulo}`, '');
  L.push(`Continuação da task #${d.selecaoId} (prompt original: \`${join(RUNS_DIR, `${d.selecaoId}.md`)}\`).`, '');
  if (d.link) L.push(`- **Link:** ${d.link}`);
  L.push(`- **App:** ${d.app.app}`, `- **Pasta:** \`${d.app.pasta}\``, '');
  L.push('## Resultado da rodada anterior', '');
  L.push(`- status: ${a.status ?? '-'}`, `- resumo: ${a.resumo ?? '-'}`, `- branch: ${a.branch ?? '-'}`, `- pendências: ${a.pendencias ?? '-'}`, '');

  if (d.tipo === 'instrucao') {
    L.push('## Instrução do usuário', '', (d.instrucao ?? '').trim(), '');
    L.push(`Continue em ${branchTxt}.`, '');
  } else {
    const head = d.novaBranch ?? d.branch;
    L.push('## Abrir pull request', '');
    L.push(`- **Branch base (destino):** \`${d.base}\``, ...(d.remoto ? [`- **Repositório:** ${d.remoto}`] : []), '');
    const passos: string[] = [];
    if (d.novaBranch && d.novaBranch !== d.branch)
      passos.push(`Renomeie ${branchTxt} para \`${d.novaBranch}\` (\`git branch -m\`).`);
    passos.push(
      `Confirme que está em ${head ? `\`${head}\`` : branchTxt} e que o trabalho da task está commitado. Se houver mudanças que não são desta task, pare e me pergunte.`,
      `Faça push da branch para \`origin\` (nunca \`--force\`, nunca na \`${d.base}\`).`,
      `Abra o PR para \`${d.base}\`. No GitHub use \`gh pr create --base ${d.base}\`; em outro serviço use a CLI disponível ou, se não houver, devolva a URL de criação do PR.`,
      `Título: "${d.titulo}". Corpo: o que foi feito, como testar${d.link ? ` e o link da task (${d.link})` : ''}. Sem menção ao Claude ou a IA.`,
      '**Não faça merge.**',
      'Coloque a URL do PR no campo `branch` do bloco de encerramento.',
    );
    passos.forEach((p, i) => L.push(`${i + 1}. ${p}`));
    L.push('');
  }

  if (d.broker && d.app.gamificacoes?.length) L.push(...blocoBroker());
  else if (d.credenciais) L.push(...blocoCredenciais(d.credenciais));
  L.push(...blocoRegras(d.app.regras));
  L.push(...blocoEncerramento(tag));
  mkdirSync(RUNS_DIR, { recursive: true });
  const arquivo = join(RUNS_DIR, `${d.selecaoId}-${d.rodada}.md`);
  writeFileSync(arquivo, L.join('\n'));
  return arquivo;
}

export function linhaDespacho(arquivo: string) {
  return `Leia e execute a task descrita em ${arquivo}.`;
}
