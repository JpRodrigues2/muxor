// muxor desinstalar: desfaz o que o muxor init fez neste Mac, a partir do registro em ~/.muxor/instalacao.json, e deixa o
// computador como estava. Não toca no que já existia (Claude Code, Orca, git, gh e as contas da pessoa).
// O que só a pessoa pode desfazer (apagar o bot, tirar projetos do Orca) é listado no fim.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Casa } from './casa.js';
import { rodar } from './diagnostico.js';
import { lerEstado, salvarEstado } from './estado.js';
import { removerContaGit } from './init/git-espaco.js';
import { brew, ORCA_APP, PROGRAMAS, type IdPrograma } from './init/programas.js';
import { pararServico } from './init/servico-mac.js';
import { Parou, tela } from './tela.js';

type Programa = { tipo: 'programa'; id: string; como: string };
const nomeDe = (id: string) => (id === 'node' ? 'Node.js' : id === 'homebrew' ? 'Homebrew' : (PROGRAMAS[id as IdPrograma]?.nome ?? id));

// Tira um programa que o Muxor instalou (O19). O Homebrew não sai sozinho: outros programas podem depender dele.
async function removerPrograma(a: Programa) {
  if (a.como === 'brew') return rodar(brew(), ['uninstall', a.id], 120_000);
  if (a.como === 'brew-cask') return rodar(brew(), ['uninstall', '--cask', a.id === 'tailscale' ? 'tailscale-app' : a.id], 120_000);
  if (a.como === 'release-orca') {
    if ((await rodar('/usr/bin/pgrep', ['-x', 'Orca'])).ok) return { ok: false, saida: 'feche o Orca antes' };
    rmSync(ORCA_APP, { recursive: true, force: true });
    return { ok: true, saida: '' };
  }
  if (a.como === 'script-claude') {
    // O instalador do Claude Code põe o programa em ~/.local/share/claude e o atalho em ~/.local/bin. ~/.claude
    // (configuração e histórico) fica.
    rmSync(join(homedir(), '.local', 'bin', 'claude'), { force: true });
    rmSync(join(homedir(), '.local', 'share', 'claude'), { recursive: true, force: true });
    return { ok: true, saida: '' };
  }
  return { ok: false, saida: 'remova à mão' };
}

export function tirarLinha(arquivo: string, linha: string) {
  if (!existsSync(arquivo)) return;
  const antes = readFileSync(arquivo, 'utf8');
  // O instalador põe uma linha em branco antes da dele: sai junto.
  const linhas = antes.split('\n');
  const fora = new Set<number>();
  linhas.forEach((l, i) => {
    if (l !== linha) return;
    fora.add(i);
    if (i > 0 && linhas[i - 1] === '') fora.add(i - 1);
  });
  const depois = linhas.filter((_, i) => !fora.has(i)).join('\n');
  if (depois !== antes) writeFileSync(arquivo, depois);
}

// Apaga todos os itens do Keychain do serviço do Muxor (credenciais das gamificações).
async function limparKeychain(servico: string) {
  for (let i = 0; i < 200; i++) {
    const r = await rodar('/usr/bin/security', ['delete-generic-password', '-s', servico]);
    if (!r.ok) break;
  }
}

export async function desinstalar(casa: Casa) {
  if (!existsSync(casa.raiz)) {
    tela.info(`Não há instalação do Muxor neste usuário (${casa.raiz} não existe).`);
    return 0;
  }
  const estado = lerEstado(casa.estado);
  const alt = estado.alteracoes;
  tela.abertura('Muxor · desinstalar');
  const pastas = alt.filter((a) => a.tipo === 'pasta');
  const programas = alt.filter((a): a is Programa => a.tipo === 'programa' && a.como !== 'script-homebrew');
  const homebrew = alt.some((a) => a.tipo === 'programa' && a.como === 'script-homebrew');
  tela.nota(
    [
      'Vou desfazer:',
      ...alt.filter((a) => a.tipo === 'launchagent').map(() => '  • o serviço do Muxor (LaunchAgent)'),
      ...alt.filter((a) => a.tipo === 'gitconfig').map((a) => `  • a linha do Muxor no ~/.gitconfig (${a.tipo === 'gitconfig' ? a.chave.replace('includeIf.gitdir:', '').replace(/\.path$/, '') : ''})`),
      ...alt.filter((a) => a.tipo === 'keychain').map(() => '  • as credenciais do Muxor no Keychain (gamificações)'),
      ...alt.filter((a) => a.tipo === 'atalho' || a.tipo === 'linha-shell').slice(0, 1).map(() => '  • o comando muxor e a linha do PATH que o instalador pôs no ~/.zprofile'),
      `  • a pasta ${casa.raiz} (o Muxor, a configuração, o banco, os logins do Muxor e do GitHub dos espaços)`,
      ...(programas.length ? ['', 'Programas que o Muxor instalou (pergunto um por um):', ...programas.map((a) => `  • ${nomeDe(a.id)}`)] : []),
      ...(pastas.length ? ['', 'Pastas que o Muxor criou (pergunto uma por uma antes de apagar):', ...pastas.map((a) => `  • ${a.tipo === 'pasta' ? a.caminho : ''}`)] : []),
      '',
      'Não mexo no que você já tinha antes do Muxor (programas, contas e configurações).',
    ].join('\n'),
    'Desinstalar',
  );
  try {
    if (!(await tela.sim('Desinstalar o Muxor deste usuário?', false))) {
      tela.fim('Nada foi alterado.');
      return 0;
    }
    for (const a of alt) {
      if (a.tipo === 'launchagent') {
        await pararServico();
        rmSync(a.plist, { force: true });
        tela.ok('Serviço do Muxor removido.');
      } else if (a.tipo === 'gitconfig') {
        await removerContaGit(a.chave, a.valor);
        tela.ok(`~/.gitconfig: tirei ${a.chave}.`);
      } else if (a.tipo === 'keychain') {
        await limparKeychain(a.servico);
        tela.ok('Keychain: credenciais do Muxor apagadas.');
      } else if (a.tipo === 'linha-shell') {
        tirarLinha(a.arquivo, a.linha);
        tela.ok(`${a.arquivo}: tirei a linha do Muxor.`);
      } else if (a.tipo === 'atalho') {
        rmSync(a.caminho, { force: true });
        tela.ok(`Tirei o comando ${a.caminho}.`);
      }
    }
    for (const a of programas) {
      if (!(await tela.sim(`Remover também o ${nomeDe(a.id)}? (o Muxor instalou; diga não se você passou a usar)`, false))) continue;
      const r = await removerPrograma(a);
      if (r.ok) tela.ok(`${nomeDe(a.id)} removido.`);
      else tela.aviso(`${nomeDe(a.id)}: não removi (${r.saida.split('\n')[0]}).`);
    }
    for (const a of pastas) {
      if (a.tipo !== 'pasta' || !existsSync(a.caminho)) continue;
      const itens = readdirSync(a.caminho).filter((n) => n !== '.git' && n !== '.DS_Store');
      const aviso = itens.length ? ` (tem ${itens.length} item(ns) dentro, inclusive repositórios clonados)` : ' (vazia)';
      if (await tela.sim(`Apagar ${a.caminho}${aviso}?`, false)) {
        rmSync(a.caminho, { recursive: true, force: true });
        tela.ok(`Apaguei ${a.caminho}.`);
      }
    }
    rmSync(casa.raiz, { recursive: true, force: true });
    tela.ok(`Apaguei ${casa.raiz}.`);
  } catch (e) {
    if (e instanceof Parou) {
      salvarEstado(casa.estado, estado);
      tela.fim('Parei no meio. Rode `muxor desinstalar` de novo para terminar.');
      return 1;
    }
    throw e;
  }
  const bots = alt.flatMap((a) => (a.tipo === 'telegram-bot' ? [a.usuario] : []));
  tela.nota(
    [
      ...(bots.length ? [`• Telegram: apague o bot no BotFather (/deletebot → @${bots.join(', @')}).`] : []),
      ...(homebrew ? ['• Homebrew: o Muxor instalou, mas outros programas podem usar. Para tirar: https://github.com/Homebrew/install#uninstall-homebrew'] : []),
      '• Orca: os projetos que o Muxor abriu continuam na barra lateral; tire os que quiser (botão direito → Remove).',
      '• Orca no celular: se pareou, remova o aparelho nas configurações do Orca.',
      '• GitHub: os logins dos espaços eram só do Muxor e já foram apagados; se quiser, revogue o "GitHub CLI" em github.com/settings/applications.',
    ].join('\n'),
    'Falta você',
  );
  tela.fim('Muxor desinstalado deste usuário.');
  return 0;
}
