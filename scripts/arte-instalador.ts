// Copia a abertura (o nome Muxor em letras grandes) para dentro do instalacao/scripts/install.sh, entre as
// marcas "# >>> abertura" e "# <<< abertura". O instalador roda antes de o Muxor ser baixado, então a arte vai
// pronta no próprio script, nas 256 cores (funcionam no Terminal do macOS). Rodar depois de mudar a arte:
//   npx tsx scripts/arte-instalador.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abertura } from '../src/cli/arte.js';

const arq = join(import.meta.dirname, '..', 'instalacao', 'scripts', 'install.sh');
const bash = (texto: string) =>
  texto
    .split('\n')
    .map((l) => `    printf '%b\\n' '${l.replace(/\x1b/g, '\\033')}'`)
    .join('\n');
const sub = 'instalação · o estagiário que despacha suas tasks para o Claude Code';
const bloco = [
  '# >>> abertura (gerado por scripts/arte-instalador.ts; não edite à mão)',
  'mostrar_abertura() {',
  bash(abertura({ colunas: 120, real: false, subtitulo: sub })).replace(/^    /gm, '  '),
  '}',
  '# <<< abertura',
].join('\n');
const atual = readFileSync(arq, 'utf8');
const re = /# >>> abertura[\s\S]*?# <<< abertura/;
if (!re.test(atual)) throw new Error('marcas "# >>> abertura" / "# <<< abertura" não encontradas no install.sh');
writeFileSync(arq, atual.replace(re, bloco));
console.log('install.sh atualizado');
