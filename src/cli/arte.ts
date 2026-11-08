// A abertura do muxor no terminal: o estagiário em caracteres à esquerda e o nome à direita, como as ferramentas de
// terminal costumam fazer. Cor de 24 bits onde o terminal suporta; senão, as 256 cores do xterm (Terminal do macOS).
import { ARTE } from './arte-dados.js';

const NOME = [
  '███╗   ███╗██╗   ██╗██╗  ██╗ ██████╗ ██████╗ ',
  '████╗ ████║██║   ██║╚██╗██╔╝██╔═══██╗██╔══██╗',
  '██╔████╔██║██║   ██║ ╚███╔╝ ██║   ██║██████╔╝',
  '██║╚██╔╝██║██║   ██║ ██╔██╗ ██║   ██║██╔══██╗',
  '██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗╚██████╔╝██║  ██║',
  '╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝',
];
const LIMAO = 'faf92a'; // o amarelo do personagem
const CINZA = '8f949c';

const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));

// Cor mais próxima no cubo 6x6x6 (ou na rampa de cinzas) das 256 cores do xterm.
export function cor256(h: string) {
  const [r, g, b] = rgb(h);
  const passo = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12) {
    const cinza = Math.round(((r + g + b) / 3 - 8) / 10);
    if (cinza >= 0 && cinza <= 23) return 232 + cinza;
  }
  return 16 + 36 * passo(r) + 6 * passo(g) + passo(b);
}

export function suportaCorReal(env = process.env) {
  return /truecolor|24bit/i.test(env.COLORTERM ?? '') || /iTerm|ghostty|vscode|WezTerm/i.test(env.TERM_PROGRAM ?? '');
}

const fg = (h: string, real: boolean) => (real ? `\x1b[38;2;${rgb(h).join(';')}m` : `\x1b[38;5;${cor256(h)}m`);
const bg = (h: string, real: boolean) => (real ? `\x1b[48;2;${rgb(h).join(';')}m` : `\x1b[48;5;${cor256(h)}m`);
const FIM = '\x1b[0m';

export function linhasArte(real: boolean): string[] {
  return ARTE.map((linha) =>
    linha
      .split(' ')
      .map((c) => {
        if (c === '.') return ' ';
        const topo = c.startsWith('-') ? null : c.slice(0, 6);
        const resto = topo ? c.slice(6) : c.slice(1);
        const base = resto === '-' ? null : resto;
        if (topo && base) return `${fg(topo, real)}${bg(base, real)}▀${FIM}`;
        if (topo) return `${fg(topo, real)}▀${FIM}`;
        return `${fg(base!, real)}▄${FIM}`;
      })
      .join(''),
  );
}

// O nome em letras grandes e a frase embaixo. O estagiário em pixel art (linhasArte) fica guardado para quando
// tivermos um desenho bom: comArte põe ele à esquerda do nome (só em terminal com 80 colunas ou mais).
export function abertura(o: { colunas?: number; real?: boolean; subtitulo?: string; comArte?: boolean } = {}): string {
  const colunas = o.colunas ?? process.stdout.columns ?? 80;
  const real = o.real ?? suportaCorReal();
  const nome = NOME.map((l) => `${fg(LIMAO, real)}${l}${FIM}`);
  const sub = (o.subtitulo ?? 'o estagiário que despacha suas tasks para o Claude Code').split('\n').map((l) => `${fg(CINZA, real)}${l}${FIM}`);
  if (!o.comArte || colunas < 80) return ['', ...nome, '', ...sub, ''].join('\n');
  const arte = linhasArte(real);
  const direita = [...nome, '', ...sub];
  const topo = Math.max(0, Math.floor((arte.length - direita.length) / 2));
  return ['', ...arte.map((l, i) => `${l}   ${direita[i - topo] ?? ''}`), ''].join('\n');
}
