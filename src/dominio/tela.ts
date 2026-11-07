// Estado da sessão do Claude Code: funções puras, sem Orca nem banco (domínio).
// Fonte principal: o estado estruturado do agente no Orca (hooks do Claude Code, I2). A tela fica como reserva:
// para o limite de uso (o Orca não informa), diálogos antes dos hooks (confiança na pasta) e Orca sem os campos.
// Os testes em tests/dominio/tela.test.ts são a referência, com capturas reais do servidor (T3b).

export type EstadoSessao = 'ocioso' | 'ocupado' | 'aguardando' | 'limite';

// O que o domínio usa do estado do agente (AgenteExecutor, em src/aplicacao/portas.ts).
export interface SinaisAgente {
  estado: string;
  monitorando?: boolean;
  esperaHumano?: boolean;
}

// `paraEnviar`: na hora de mandar uma task, shell em segundo plano (ex.: servidor de dev) não conta como ocupado —
// a caixa de entrada aceita mensagem. No acompanhamento conta, porque o Claude volta a trabalhar quando o shell termina.
export function classificarTela(telaInteira: string, agente?: SinaisAgente, paraEnviar = false): EstadoSessao {
  // Os sinais (spinner, diálogos, limite, rodapé) ficam no fim da tela; o meio é conversa e pode citar qualquer texto.
  const tela = telaInteira
    .split('\n')
    .filter((l) => l.trim())
    .slice(-14)
    .join('\n');
  // Mensagem do Claude Code no começo da linha (ex.: "Claude usage limit reached…", "5-hour limit reached ∙ resets 3pm").
  if (/^[\s⎿●⏺]*(Claude )?(AI )?(usage limit reached|(5-hour|weekly|Opus) limit reached|You'?ve hit your (usage )?limit)/im.test(tela))
    return 'limite';
  // Diálogo explícito (pergunta/permissão/confiança na pasta) tem prioridade sobre "working".
  if (/Do you want to|Would you like to|Esc to cancel|Enter to (select|confirm)|trust the files|Yes, proceed|\(y\/n\)/i.test(tela))
    return 'aguardando';
  if (agente) {
    if (agente.esperaHumano || agente.estado === 'waiting') return 'aguardando';
    if (agente.estado === 'working') return agente.monitorando && paraEnviar ? 'ocioso' : 'ocupado';
    if (agente.estado === 'done') return 'ocioso';
    // estado desconhecido: decide pela tela
  }
  // Sem o estado do agente: pela tela. Trabalhando = spinner ou comando em segundo plano que vai acordar o Claude.
  if (/esc to interrupt/i.test(tela)) return 'ocupado';
  if (!paraEnviar && /\d+ shells? still running|· \d+ shells?\b/i.test(tela)) return 'ocupado';
  // Ocioso = caixa de entrada do Claude Code (❯ entre linhas ────). Só "❯" pode ser o prompt do zsh.
  if (/^\s*❯/m.test(tela) && /─{10,}/.test(tela)) return 'ocioso';
  return 'ocupado'; // desconhecido: conservador, não envia
}

// Lê o bloco da tela ou da última mensagem do Claude (markdown, vinda do Orca). Na tela o Claude renderiza o
// markdown: "### RESULTADO HUB" aparece só como "RESULTADO HUB".
export function extrairResultado(tela: string, tag: string): Record<string, string> | null {
  const linhas = tela.split('\n');
  let inicio = -1;
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (/^[\s│⎿●⏺#]*RESULTADO HUB\s*$/.test(linhas[i])) {
      inicio = i;
      break;
    }
  }
  if (inicio < 0) return null;
  const campos: Record<string, string> = {};
  let atual: string | null = null;
  for (const bruta of linhas.slice(inicio + 1)) {
    const linha = bruta.replace(/^[\s│⎿●⏺]+/, '').trimEnd();
    if (!linha || /^([─✻❯]|```)/.test(linha)) break; // fim do bloco: linha vazia, caixa de entrada, rodapé ou fim do ```
    const m = linha.match(/^(task|status|resumo|arquivos|branch|pendencias|pendências):\s*(.*)$/i);
    if (m) {
      atual = m[1].toLowerCase().replace('pendências', 'pendencias');
      campos[atual] = m[2].trim();
    } else if (atual) campos[atual] += ' ' + linha.trim(); // continuação de linha quebrada pelo terminal
  }
  // Ignora o próprio enunciado do formato ("concluido | bloqueado | …").
  if (!/^(concluido|bloqueado|precisa_revisao)$/.test(campos.status ?? '')) return null;
  // Só vale o bloco desta task/rodada (a tela pode ainda mostrar o resultado de uma task ou rodada anterior).
  if (campos.task?.replace(/\s/g, '') !== `#${tag}`) return null;
  return campos;
}

// Últimas linhas úteis da tela (sem a caixa de entrada e o rodapé do Claude Code).
export function ultimasLinhas(tela: string, n = 14) {
  return tela
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^[─━]{5,}/.test(l.trim()) && !/^\s*⏵⏵|for shortcuts|shift\+tab/.test(l))
    .slice(-n)
    .map((l) => (l.length > 110 ? l.slice(0, 109) + '…' : l))
    .join('\n');
}
