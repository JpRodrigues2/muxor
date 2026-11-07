// Telas de exemplo do Claude Code (como o `orca terminal read` devolve). Ao capturar telas reais no servidor (T3c),
// acrescente aqui e nos testes: são a referência do classificarTela.
const CAIXA = ['─'.repeat(60), '❯ ', '─'.repeat(60), '  ⏵⏵ auto mode on (shift+tab to cycle)'];

export const TELAS = {
  ocioso: ['⏺ Pronto, terminei a alteração.', '', ...CAIXA].join('\n'),
  ocupado: ['⏺ Vou rodar os testes.', '', '✻ Thinking… (12s · ↑ 1.2k tokens · esc to interrupt)', '', ...CAIXA].join('\n'),
  permissao: [
    '⏺ Bash(npm test)',
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. No, and tell Claude what to do differently (esc)',
    '',
    ' Esc to cancel',
  ].join('\n'),
  limite: ['⏺ Analisando o arquivo…', '', '  ⎿  Claude usage limit reached. Your limit will reset at 3pm.', '', ...CAIXA].join('\n'),
  limite5h: ['5-hour limit reached ∙ resets 3pm', '', ...CAIXA].join('\n'),
  shellRodando: ['⏺ Servidor de dev no ar em http://localhost:5173', '', ...CAIXA.slice(0, 3), '  ⏵⏵ auto mode on · 1 shell still running'].join('\n'),
  zsh: ['joao@mac HUB % ls', 'src  tests', '❯ '].join('\n'),
  vazia: '',
};

export function blocoResultado(tag: string, status = 'concluido') {
  return [
    '⏺ RESULTADO HUB',
    `  task: #${tag}`,
    `  status: ${status}`,
    '  resumo: Ajustei o ranking e os testes',
    '  passam.',
    '  arquivos: src/ranking.ts',
    '  branch: feat/ranking',
    '  pendencias: nenhuma',
    '',
    ...CAIXA,
  ].join('\n');
}
