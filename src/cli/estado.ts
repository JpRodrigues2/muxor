// Progresso do muxor init (retoma do passo que falta) e o registro de tudo o que ele mudou FORA de ~/.muxor,
// para o muxor desinstalar desfazer exatamente isso e deixar o computador como estava.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Alteracao =
  | { tipo: 'gitconfig'; chave: string; valor: string } // linha includeIf no ~/.gitconfig
  | { tipo: 'launchagent'; plist: string; rotulo: string }
  | { tipo: 'keychain'; servico: string }
  | { tipo: 'pasta'; caminho: string } // pasta criada pelo muxor init (espaço, projeto sem repositório)
  | { tipo: 'orca-repo'; pasta: string }
  | { tipo: 'telegram-bot'; usuario: string }
  | { tipo: 'programa'; id: string; como: string } // instalado pelo Muxor (O19): o desinstalar oferece remover
  | { tipo: 'linha-shell'; arquivo: string; linha: string } // linha do PATH no ~/.zprofile, pelo install.sh
  | { tipo: 'atalho'; caminho: string }; // ~/.local/bin/muxor

export interface Estado {
  versao: 1;
  modo?: 'local' | 'servidor';
  passos: Record<string, string>; // id do passo → quando terminou
  alteracoes: Alteracao[];
}

export function lerEstado(arquivo: string): Estado {
  if (!existsSync(arquivo)) return { versao: 1, passos: {}, alteracoes: [] };
  return JSON.parse(readFileSync(arquivo, 'utf8')) as Estado;
}

export function salvarEstado(arquivo: string, e: Estado) {
  mkdirSync(dirname(arquivo), { recursive: true, mode: 0o700 });
  writeFileSync(arquivo, JSON.stringify(e, null, 2) + '\n', { mode: 0o600 });
}

export function registrar(e: Estado, a: Alteracao) {
  if (!e.alteracoes.some((x) => JSON.stringify(x) === JSON.stringify(a))) e.alteracoes.push(a);
}
