// muxor init (modo local): os passos em ordem, retomando do primeiro que falta. O progresso fica em ~/.muxor/instalacao.json.
import { lerEstado, type Estado } from '../estado.js';
import type { Casa } from '../casa.js';
import { Parou, tela } from '../tela.js';
import { criarCtx, type Ctx } from './contexto.js';
import * as passos from './passos.js';

interface Passo {
  id: string;
  titulo: string;
  rodar: (ctx: Ctx) => Promise<unknown>;
  sempre?: boolean; // confere toda vez (é rápido e as coisas mudam)
}

const PASSOS: Passo[] = [
  { id: 'pre', titulo: 'Pré-requisitos', rodar: () => passos.preRequisitos(), sempre: true },
  { id: 'modo', titulo: 'Onde o Muxor roda', rodar: (c) => passos.escolherModo(c) },
  { id: 'ferramentas', titulo: 'Ferramentas de gestão', rodar: async (c) => (c.estado.passos.ferramentasOk = JSON.stringify(await passos.ferramentas(c))) },
  { id: 'espacos', titulo: 'Espaços e contas do GitHub', rodar: (c) => passos.espacos(c) },
  { id: 'existentes', titulo: 'Projetos que você já tem no Orca', rodar: (c) => passos.existentes(c) },
  { id: 'repositorios', titulo: 'Repositórios', rodar: (c) => passos.repositorios(c) },
  { id: 'depara', titulo: 'Projetos → pastas', rodar: (c) => passos.dePara(c) },
  { id: 'telegram', titulo: 'Bot do Telegram', rodar: (c) => passos.telegram(c) },
  { id: 'orca', titulo: 'Orca e celular', rodar: () => passos.orca() },
  { id: 'servico', titulo: 'Hub como serviço', rodar: (c) => passos.servico(c) },
  { id: 'teste', titulo: 'Teste de ponta a ponta', rodar: () => passos.teste() },
];

export async function init(casa: Casa, refazer?: string) {
  const estado: Estado = lerEstado(casa.estado);
  if (refazer) {
    if (!PASSOS.some((p) => p.id === refazer)) {
      tela.erro(`Passo desconhecido: ${refazer}. Passos: ${PASSOS.map((p) => p.id).join(', ')}`);
      return 2;
    }
    for (const p of PASSOS.slice(PASSOS.findIndex((p) => p.id === refazer))) delete estado.passos[p.id];
  }
  const ctx = criarCtx(casa, estado);
  tela.abertura('Muxor · configuração');
  const feitos = PASSOS.filter((p) => estado.passos[p.id] && !p.sempre).length;
  if (feitos) tela.info(`Continuando de onde parou: ${feitos} de ${PASSOS.length} passos já feitos. (Para refazer um passo: ./muxor init --refazer <passo>)`);
  try {
    for (const [i, p] of PASSOS.entries()) {
      if (estado.passos[p.id] && !p.sempre) {
        tela.ok(`Passo ${i + 1} de ${PASSOS.length} · ${p.titulo}: já feito`);
        continue;
      }
      tela.passo(i + 1, PASSOS.length, p.titulo);
      await p.rodar(ctx);
      estado.passos[p.id] = new Date().toISOString();
      ctx.salvar();
    }
  } catch (e) {
    if (e instanceof Parou) {
      tela.fim('Parei aqui. Rode `./muxor init` de novo para continuar de onde parou.');
      return 1;
    }
    if (e instanceof passos.Interrompido) {
      tela.fim('Rode `./muxor init` de novo quando resolver: eu continuo deste passo.');
      return 1;
    }
    tela.erro(`Erro inesperado: ${(e as Error).message}`);
    tela.fim('Rode `./muxor diagnostico` para ver o que falta, e `./muxor init` de novo para continuar.');
    return 1;
  }
  passos.resumoFinal(JSON.parse(estado.passos.ferramentasOk ?? '[]'));
  tela.fim('Hub configurado. Bom trabalho!');
  return 0;
}
