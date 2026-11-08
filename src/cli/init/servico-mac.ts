// O Muxor como serviço no Mac (LaunchAgent): sobe sozinho quando a pessoa entra no Mac e volta se cair.
// Roda o código desta pasta (sem build) com os dados em ~/.muxor.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { rodar } from '../diagnostico.js';

export const ROTULO = 'br.com.muxor';
export const plistDoServico = () => join(homedir(), 'Library', 'LaunchAgents', `${ROTULO}.plist`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// O Muxor roda dentro do caffeinate (vem no macOS): enquanto ele está ligado, o Mac não dorme por inatividade, e
// as tasks continuam com a tela apagada. Com a tampa fechada, quem segura é o Amphetamine (passo 1).
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
    <string>/usr/bin/caffeinate</string>
    <string>-is</string>
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
  // O bootout devolve antes de o macOS terminar de descarregar; o bootstrap logo em seguida falha com
  // "Bootstrap failed: 5: Input/output error". Tenta algumas vezes, com uma pausa.
  let r = { ok: false, saida: '' };
  for (let i = 0; i < 6 && !r.ok; i++) {
    if (i) await new Promise((ok) => setTimeout(ok, 1500));
    r = await rodar('launchctl', ['bootstrap', alvo(), plist]);
  }
  if (!r.ok) throw new Error(`launchctl não subiu o serviço: ${r.saida}`);
  return plist;
}

export async function pararServico() {
  if (!existsSync(plistDoServico())) return;
  await rodar('launchctl', ['bootout', `${alvo()}/${ROTULO}`]);
  // Espera o serviço sair de fato (até 10 s): enquanto "launchctl print" acha o serviço, ele ainda está carregado.
  for (let i = 0; i < 20 && (await rodar('launchctl', ['print', `${alvo()}/${ROTULO}`])).ok; i++) await new Promise((ok) => setTimeout(ok, 500));
}

export async function servicoRodando() {
  const r = await rodar('launchctl', ['print', `${alvo()}/${ROTULO}`]);
  return r.ok && /state = running/.test(r.saida);
}
