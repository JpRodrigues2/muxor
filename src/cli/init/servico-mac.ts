// O Muxor como serviço no Mac (LaunchAgent): sobe sozinho quando a pessoa entra no Mac e volta se cair.
// Roda o código desta pasta (sem build) com os dados em ~/.muxor.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { rodar } from '../diagnostico.js';

export const ROTULO = 'br.com.muxor';
export const plistDoServico = () => join(homedir(), 'Library', 'LaunchAgents', `${ROTULO}.plist`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function conteudoPlist(o: { node: string; repo: string; ambiente: Record<string, string>; log: string }) {
  const env = Object.entries(o.ambiente)
    .map(([k, v]) => `    <key>${esc(k)}</key><string>${esc(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${ROTULO}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(o.node)}</string>
    <string>${esc(join(o.repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'))}</string>
    <string>${esc(join(o.repo, 'src', 'main.ts'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(o.repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${esc(o.log)}</string>
  <key>StandardErrorPath</key><string>${esc(o.log)}</string>
</dict>
</plist>
`;
}

const alvo = () => `gui/${userInfo().uid}`;

export async function instalarServico(conteudo: string) {
  const plist = plistDoServico();
  mkdirSync(dirname(plist), { recursive: true });
  await pararServico();
  writeFileSync(plist, conteudo);
  const r = await rodar('launchctl', ['bootstrap', alvo(), plist]);
  if (!r.ok) throw new Error(`launchctl não subiu o serviço: ${r.saida}`);
  return plist;
}

export async function pararServico() {
  if (existsSync(plistDoServico())) await rodar('launchctl', ['bootout', `${alvo()}/${ROTULO}`]);
}

export async function servicoRodando() {
  const r = await rodar('launchctl', ['print', `${alvo()}/${ROTULO}`]);
  return r.ok && /state = running/.test(r.saida);
}
