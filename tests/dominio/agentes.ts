// Linhas "agents" reais do `orca worktree ps --agent-wait --json`, capturadas no servidor (T3b, 06/11/2026,
// Orca 1.4.246, Claude Code em modo auto), só com os campos que o hub usa. Ao trocar de versão do Orca, capture de novo.
const pane = '91b6917a-276e-4b72-b119-cdf46b8375d2:7e186ba7-21c4-4623-bc46-409305e773d0';

export const AGENTES = {
  // Logo depois de abrir, e ocioso entre turnos.
  ocioso: { paneKey: pane, state: 'done', lastAssistantMessage: null, programStatus: { state: 'idle' }, agentWait: null },
  trabalhando: {
    paneKey: pane,
    state: 'working',
    lastAssistantMessage: null,
    programStatus: { state: 'working', message: 'Waiting 25 seconds then printing done' },
    agentWait: null,
  },
  // Turno acabou, mas o Claude deixou um comando em segundo plano e volta quando ele terminar.
  monitorando: {
    paneKey: pane,
    state: 'working',
    workingMode: 'monitoring',
    lastAssistantMessage: 'O comando está rodando em segundo plano, porque o ambiente bloqueou o `sleep` em primeiro plano. Respondo assim que ele terminar.',
    programStatus: { state: 'done' },
    agentWait: null,
  },
  pergunta: {
    paneKey: pane,
    state: 'waiting',
    lastAssistantMessage: null,
    programStatus: { state: 'blocked', kind: 'question', message: 'answer: Você prefere azul ou verde? (Azul · Verde)' },
    agentWait: { source: 'hook', since: 1794005400427 },
  },
  resultado: {
    paneKey: pane,
    state: 'done',
    lastAssistantMessage:
      '### RESULTADO HUB\ntask: #999\nstatus: concluido\nresumo: ' +
      'linha de teste longa '.repeat(60).trim() +
      '\nbranch: teste-t3b\narquivos: a.ts, b.ts\npendencias: nenhuma',
    programStatus: { state: 'done' },
    agentWait: null,
  },
};
