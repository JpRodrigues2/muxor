// Esconder segredos de um texto (logs, erros impressos). Sem depender de caminhos nem de configuração: pode ser
// carregado no começo do comando muxor, antes de ele decidir onde ficam os dados.
const SECRET_ENV = /TOKEN|SECRET|KEY|PASSWORD/i;
const SECRET_PATTERNS = [
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, // token de bot do Telegram
  /\bmcp_[a-f0-9]{32,}\b/g, // token MCP do Bnexo
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/g,
];

function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => SECRET_ENV.test(k) && v && v.length >= 8)
    .map(([, v]) => v as string);
}

export function redact(text: string): string {
  let out = text;
  for (const v of secretValues()) out = out.split(v).join('[REDACTED]');
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[REDACTED]');
  return out;
}
