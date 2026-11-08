// Logs em <logs>/hub-AAAA-MM-DD.log (JSON por linha) + console, sempre sem segredos.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAMINHOS } from './caminhos.js';
import { redact } from './redigir.js';

export { redact };

const LOG_DIR = CAMINHOS.logs;
mkdirSync(LOG_DIR, { recursive: true });

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const now = new Date();
  const line = redact(
    JSON.stringify({
      ts: now.toISOString(),
      level,
      msg,
      ...(data ?? {}),
    }),
  );
  appendFileSync(join(LOG_DIR, `hub-${now.toISOString().slice(0, 10)}.log`), line + '\n');
  // HUB_LOG_SILENCIOSO: o comando `hub` escreve só no arquivo, para a saída do terminal ficar limpa.
  if (process.env.HUB_LOG_SILENCIOSO) return;
  if (level !== 'debug' || process.env.HUB_DEBUG) (level === 'error' ? console.error : console.log)(line);
}

export function errInfo(e: unknown) {
  return e instanceof Error ? { error: e.message, name: e.name } : { error: String(e) };
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};
