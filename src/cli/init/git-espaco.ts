// Conta do GitHub por espaço (O4, O5, O8), sem chave SSH e sem mexer na configuração global do git do usuário além
// de UMA linha includeIf por espaço (registrada para o muxor desinstalar):
//   ~/.gitconfig:          [includeIf "gitdir:<pasta do espaço>/"] path = ~/.muxor/git/<id>.gitconfig
//   ~/.muxor/git/<id>.gitconfig: nome, e-mail e o gh daquele espaço como credencial do HTTPS do GitHub
// Assim, dentro da pasta do espaço, commit, push e clone usam a conta certa; fora dela, nada muda.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { rodar } from '../diagnostico.js';

export interface ContaGit {
  nome: string;
  email: string;
  usuario: string; // login do GitHub do espaço: vence o credential.https://github.com.username global (ex.: a conta pessoal)
  gh: string; // caminho do executável gh
  ghConfig: string; // GH_CONFIG_DIR do espaço
}

const aspas = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function conteudoGitconfig(c: ContaGit) {
  return [
    '# Gerado pelo muxor init: conta do GitHub deste espaço. O muxor desinstalar apaga.',
    '[user]',
    `\tname = ${aspas(c.nome)}`,
    `\temail = ${aspas(c.email)}`,
    '[credential "https://github.com"]',
    `\tusername = ${aspas(c.usuario)}`,
    '\thelper =',
    `\thelper = ${aspas(`!GH_CONFIG_DIR='${c.ghConfig}' '${c.gh}' auth git-credential`)}`,
    '',
  ].join('\n');
}

// A chave do includeIf: "gitdir:" com a pasta terminada em "/" vale para todo repositório dentro dela.
export const chaveInclude = (pasta: string) => `includeIf.gitdir:${pasta.replace(/\/+$/, '')}/.path`;

export async function aplicarContaGit(arquivo: string, pastaEspaco: string, c: ContaGit) {
  mkdirSync(dirname(arquivo), { recursive: true, mode: 0o700 });
  writeFileSync(arquivo, conteudoGitconfig(c), { mode: 0o600 });
  // O git compara com o caminho real do repositório: uma pasta acessada por atalho (symlink) não casaria.
  const chave = chaveInclude(realpathSync(pastaEspaco));
  const atual = await rodar('git', ['config', '--global', '--get-all', chave]);
  if (!atual.ok || !atual.saida.split('\n').includes(arquivo)) {
    const r = await rodar('git', ['config', '--global', '--add', chave, arquivo]);
    if (!r.ok) throw new Error(`não consegui gravar no ~/.gitconfig: ${r.saida}`);
  }
  return { chave, valor: arquivo };
}

export async function removerContaGit(chave: string, valor: string) {
  // --fixed-value: só a linha que o Muxor pôs, mesmo que haja outras com a mesma chave.
  await rodar('git', ['config', '--global', '--fixed-value', '--unset-all', chave, valor]);
}
