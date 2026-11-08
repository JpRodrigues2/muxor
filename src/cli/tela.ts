// A conversa do muxor init no terminal (O17): mensagens objetivas, sem omitir detalhes. Cada passo diz o que vai
// acontecer, o que a pessoa faz, como saber que deu certo e, no erro, o próximo passo.
// Links aparecem como texto, com QR code (para o celular) e, no Mac, abrem no navegador quando a pessoa quer.
import * as p from '@clack/prompts';
import { execFile } from 'node:child_process';
import qrcode from 'qrcode-terminal';
import { abertura } from './arte.js';

// Textos da biblioteca em português (as instruções são listas exportadas por ela).
p.SELECT_INSTRUCTIONS.splice(0, p.SELECT_INSTRUCTIONS.length, '↑/↓ para mover', 'Enter: confirma');
p.MULTISELECT_INSTRUCTIONS.splice(0, p.MULTISELECT_INSTRUCTIONS.length, '↑/↓ para mover', 'Espaço: marca', 'Enter: confirma');
p.updateSettings({ messages: { cancel: 'Cancelado', error: 'Algo deu errado' } });

// Ctrl+C ou Esc em qualquer pergunta: para sem estragar nada; o progresso fica salvo.
export class Parou extends Error {
  constructor() {
    super('parou');
  }
}

function valor<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) throw new Parou();
  return v as Exclude<T, symbol>;
}

export const tela = {
  abertura(titulo: string) {
    // O estagiário e o nome em caracteres, só num terminal de verdade (não em log nem no --json). Vindo do
    // instalador do site, o desenho já apareceu no começo (MUXOR_SEM_ABERTURA): não repete.
    if (process.stdout.isTTY && !process.env.MUXOR_SEM_ABERTURA) process.stdout.write(abertura() + '\n');
    p.intro(` ${titulo} `);
  },
  fim(texto: string) {
    p.outro(texto);
  },
  passo(n: number, total: number, titulo: string) {
    p.log.step(`Passo ${n} de ${total} · ${titulo}`);
  },
  info: (t: string) => p.log.info(t),
  ok: (t: string) => p.log.success(t),
  aviso: (t: string) => p.log.warn(t),
  erro: (t: string) => p.log.error(t),
  nota: (texto: string, titulo?: string) => p.note(texto, titulo),

  async texto(pergunta: string, o: { padrao?: string; exemplo?: string; validar?: (v: string) => string | undefined } = {}) {
    return valor(
      await p.text({
        message: pergunta,
        placeholder: o.exemplo,
        initialValue: o.padrao,
        validate: (v) => (o.validar ? o.validar((v ?? '').trim()) : (v ?? '').trim() ? undefined : 'Preencha este campo.'),
      }),
    ).trim();
  },
  // Segredo: não aparece na tela nem fica no histórico do terminal.
  async segredo(pergunta: string, validar?: (v: string) => string | undefined) {
    return valor(await p.password({ message: pergunta, validate: (v) => (validar ? validar((v ?? '').trim()) : (v ?? '').trim() ? undefined : 'Cole o valor.') })).trim();
  },
  async sim(pergunta: string, padrao = true) {
    return valor(await p.confirm({ message: pergunta, initialValue: padrao }));
  },
  async escolher<T extends string>(pergunta: string, opcoes: { valor: T; rotulo: string; dica?: string }[], padrao?: T) {
    return valor(await p.select({ message: pergunta, options: opcoes.map((o) => ({ value: o.valor, label: o.rotulo, hint: o.dica })) as never, initialValue: padrao })) as T;
  },
  async varios<T extends string>(pergunta: string, opcoes: { valor: T; rotulo: string; dica?: string }[], obrigatorio = false) {
    return valor(
      await p.multiselect({ message: pergunta, options: opcoes.map((o) => ({ value: o.valor, label: o.rotulo, hint: o.dica })) as never, required: obrigatorio }),
    ) as T[];
  },
  async enter(texto: string) {
    valor(await p.text({ message: texto, placeholder: 'aperte Enter', defaultValue: 'ok' }));
  },

  // Link com QR code (para abrir no celular) e, se a pessoa quiser, abre no navegador do Mac.
  async link(url: string, rotulo: string, o: { qr?: boolean; abrir?: boolean } = {}) {
    let qr = '';
    if (o.qr) qrcode.generate(url, { small: true }, (s) => (qr = s));
    p.note(`${url}${qr ? `\n\n${qr}` : ''}`, rotulo);
    if (o.abrir && process.platform === 'darwin') execFile('open', [url], () => {});
  },

  async esperando<T>(texto: string, fn: () => Promise<T>, fim = (_: T) => texto.replace(/…$/, '')) {
    const s = p.spinner();
    s.start(texto);
    try {
      const r = await fn();
      s.stop(fim(r));
      return r;
    } catch (e) {
      s.error(`${texto.replace(/…$/, '')}: falhou`);
      throw e;
    }
  },
};
