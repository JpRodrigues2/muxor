// O que todo passo do muxor init recebe: onde o Muxor mora, o progresso, e como gravar o .env.
// Carregado só depois de HUB_DADOS_DIR e DOTENV_CONFIG_PATH apontarem para ~/.muxor (os módulos do Muxor leem ao carregar).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../caminhos.js';
import type { Env } from '../../config.js';
import type { Casa } from '../casa.js';
import { gravarEnv, lerEnvArquivo } from '../envfile.js';
import { registrar, salvarEstado, type Alteracao, type Estado } from '../estado.js';

export interface Ctx {
  casa: Casa;
  estado: Estado;
  repo: string; // pasta do código do Muxor
  salvar(): void;
  registrar(a: Alteracao): void;
  // Grava no .env e no processo (os adaptadores leem do processo).
  definirEnv(v: Record<string, string | null>): void;
  // Env mínimo para os adaptadores antes do .env estar completo (sem o Telegram).
  envParcial(): Env;
}

export function criarCtx(casa: Casa, estado: Estado): Ctx {
  return {
    casa,
    estado,
    repo: ROOT,
    salvar: () => salvarEstado(casa.estado, estado),
    registrar(a) {
      registrar(estado, a);
      salvarEstado(casa.estado, estado);
    },
    definirEnv(v) {
      gravarEnv(casa.env, v);
      for (const [k, val] of Object.entries(v)) {
        if (val === null) delete process.env[k];
        else process.env[k] = val;
      }
    },
    envParcial() {
      const e = lerEnvArquivo(casa.env);
      return {
        TZ_HUB: e.TZ_HUB ?? 'America/Sao_Paulo',
        HUB_ESCRITA_PM: false,
        HUB_ESCRITA_PM_SOMENTE: null,
        HUB_COMENTARIOS_PM: false,
        ...e,
      } as unknown as Env;
    },
  };
}

// Modelo de regras de trabalho para um espaço novo (regras/modelo.md do repositório).
export const MODELO_REGRAS = join(ROOT, 'regras', 'modelo.md');
export const temModeloRegras = () => existsSync(MODELO_REGRAS);
