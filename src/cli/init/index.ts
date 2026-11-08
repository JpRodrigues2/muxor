// muxor init (modo local): os passos em ordem, retomando do primeiro que falta. O progresso fica em ~/.muxor/instalacao.json.
import { lerEstado, type Estado } from '../estado.js';
import type { Casa } from '../casa.js';
import { Parou, Voltar, tela } from '../tela.js';
import { criarCtx, type Ctx } from './contexto.js';
import * as passos from './passos.js';
import * as preparar from './preparar.js';

interface Passo {
  id: string;
  titulo: string;
  rodar: (ctx: Ctx) => Promise<unknown>;
  sempre?: boolean; // confere toda vez (é rápido e as coisas mudam)
}

// O fim de cada passo fica em instalacao.json; os pré-requisitos conferem toda vez (e instalam o que faltar).
const PASSOS: Passo[] = [
  { id: 'pre', titulo: 'Pré-requisitos', rodar: (c) => preparar.preRequisitos(c), sempre: true },
  { id: 'modo', titulo: 'Onde o Muxor roda', rodar: (c) => passos.escolherModo(c) },
  { id: 'ferramentas', titulo: 'Ferramentas de gestão', rodar: async (c) => (c.estado.passos.ferramentasOk = JSON.stringify(await passos.ferramentas(c))) },
  { id: 'espacos', titulo: 'Espaços e contas do GitHub', rodar: (c) => passos.espacos(c) },
  { id: 'existentes', titulo: 'Projetos que você já tem no Orca', rodar: (c) => passos.existentes(c) },
  { id: 'repositorios', titulo: 'Baixar repositórios', rodar: (c) => passos.repositorios(c) },
  { id: 'depara', titulo: 'Ligar projetos às pastas', rodar: (c) => passos.dePara(c) },
  { id: 'telegram', titulo: 'Bot do Telegram', rodar: (c) => passos.telegram(c) },
  { id: 'orca', titulo: 'Orca e celular', rodar: () => passos.orca() },
  { id: 'front', titulo: 'Front-end no celular', rodar: (c) => preparar.front(c) },
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
  const sair = () => {
    tela.fim('Parei aqui. Rode muxor init para continuar ou voltar a um passo.');
    return 1;
  };
  const ctx = criarCtx(casa, estado);
  tela.abertura('Muxor · configuração');
  tela.botaoVoltar = true;
  const feito = (p: Passo) => !!estado.passos[p.id] && !p.sempre;
  const esquecer = (de: number) => {
    for (const p of PASSOS.slice(de)) delete estado.passos[p.id];
    ctx.salvar();
  };
  let i = 0;
  const feitos = PASSOS.filter(feito).length;
  if (feitos && !refazer) {
    tela.info(`Continuando de onde parou: ${feitos} de ${PASSOS.length} passos já feitos.`);
    // O próximo de verdade: o passo 1 (pré-requisitos) roda sempre e nunca fica "feito", não conta.
    const proximo = PASSOS.findIndex((p) => !p.sempre && !feito(p));
    try {
      const escolha = await tela.escolher(
        'Como quer seguir?',
        [
          { valor: 'seguir', rotulo: proximo < 0 ? 'Conferir tudo de novo' : `Seguir: passo ${proximo + 1} · ${PASSOS[proximo].titulo}` },
          { valor: 'voltar', rotulo: 'Voltar a um passo anterior e refazer dali' },
        ],
        undefined,
        { semVoltar: true },
      );
      if (escolha === 'voltar') {
        const id = await tela.escolher(
          'Refazer a partir de qual passo?',
          // O passo 1 (pré-requisitos) roda sempre: não entra na lista. O cursor começa no último feito.
          PASSOS.slice(0, proximo < 0 ? PASSOS.length : proximo + 1)
            .map((p, n) => ({ p, n }))
            .filter(({ p }) => !p.sempre)
            .map(({ p, n }) => ({ valor: p.id, rotulo: `${n + 1} · ${p.titulo}`, dica: feito(p) ? 'feito' : 'o próximo' })),
          (proximo > 0 ? PASSOS[proximo - 1] : PASSOS[PASSOS.length - 1]).id,
          { semVoltar: true },
        );
        // Esquece dali para frente, mas começa do 0: o passo 1 (conferência dos programas, Amphetamine) roda sempre, e
        // os feitos antes do escolhido são pulados. Antes, pular direto deixava a conferência para trás.
        esquecer(PASSOS.findIndex((p) => p.id === id));
      }
    } catch (e) {
      if (e instanceof Parou) return sair();
      throw e;
    }
  }
  try {
    while (i < PASSOS.length) {
      const p = PASSOS[i];
      if (feito(p)) {
        i++; // já feito (o resumo apareceu no começo)
        continue;
      }
      // Retomando, o passo 1 é só a conferência rápida dos programas: não parece que recomeçou do zero.
      if (p.sempre && feitos) tela.info('Conferindo os programas antes de continuar');
      else tela.passo(i + 1, PASSOS.length, p.titulo, PASSOS.slice(0, i).some((x) => !x.sempre));
      const anterior = PASSOS.slice(0, i).findLastIndex((x) => !x.sempre);
      tela.botaoVoltar = anterior >= 0; // no primeiro passo não há para onde voltar
      try {
        await p.rodar(ctx);
      } catch (e) {
        // "← Voltar" numa lista: direto ao passo anterior (no primeiro, refaz este).
        if (e instanceof Voltar) {
          if (anterior >= 0) {
            i = anterior;
            esquecer(i);
          }
          continue;
        }
        if (!(e instanceof Parou)) throw e;
        // Esc numa pergunta: voltar um passo, refazer este ou sair (o que já foi feito fica salvo).
        const escolha = await tela
          .escolher('Pausado. O que fazer?', [
            ...(anterior >= 0 ? [{ valor: 'voltar', rotulo: `Voltar ao passo ${anterior + 1} · ${PASSOS[anterior].titulo}` }] : []),
            { valor: 'refazer', rotulo: `Refazer o passo ${p.titulo}` },
            { valor: 'sair', rotulo: 'Sair. Para continuar depois, rode muxor init' },
          ], undefined, { semVoltar: true })
          .catch((x) => {
            if (x instanceof Parou) return 'sair';
            throw x;
          });
        if (escolha === 'sair') throw e;
        if (escolha === 'voltar') {
          i = anterior;
          esquecer(i);
        }
        continue;
      }
      estado.passos[p.id] = new Date().toISOString();
      ctx.salvar();
      i++;
    }
  } catch (e) {
    if (e instanceof Parou) return sair();
    if (e instanceof passos.Interrompido) {
      tela.fim('Quando resolver, rode muxor init. Eu continuo deste passo.');
      return 1;
    }
    tela.erro(`Erro inesperado: ${(e as Error).message}`);
    tela.fim('Rode muxor diagnostico para ver o que falta e muxor init para continuar.');
    return 1;
  }
  passos.resumoFinal(JSON.parse(estado.passos.ferramentasOk ?? '[]'));
  tela.fim('Muxor configurado. Mande /tarefas no bot do Telegram para começar.');
  return 0;
}
