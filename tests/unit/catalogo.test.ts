// Catálogo com espaços (B34): migração do formato antigo (empresa funifier/dac) e o que o app herda do espaço.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = mkdtempSync(join(tmpdir(), 'hub-catalogo-'));
process.env.HUB_DADOS_DIR = join(raiz, 'dados');
process.env.HUB_APPS_FILE = join(raiz, 'apps.yaml');
process.env.HUB_REPOS_DIR = join(raiz, 'repos');
const { desligarProjeto, ligarProjeto, loadCatalogo, migrarCatalogo } = await import('../../src/config.js');
const { fontesDeRegras } = await import('../../src/regras.js');

const APPS = process.env.HUB_APPS_FILE;
const repos = process.env.HUB_REPOS_DIR;

const ANTIGO = `# catálogo do servidor
apps:
  - app: meu-app
    empresa: funifier # comentário do usuário
    ferramenta: funifier-pm
    projetos_na_ferramenta: [p1]
    pasta: FUNIFIER/meu-app
  - app: vista
    empresa: dac
    ferramenta: bnexo
    pasta: ${join(repos, 'DAC', 'vista')}
  - app: sandbox
    empresa: dac
    ferramenta: teste
    pasta: sandbox
`;

describe('catálogo com espaços (B34)', () => {
  it('formato antigo: loadCatalogo recusa até migrar', () => {
    writeFileSync(APPS, ANTIGO);
    expect(() => loadCatalogo()).toThrow(/formato antigo/);
  });

  it('migra: empresa vira espaço, pasta fica relativa ao espaço, comentários e histórico preservados', () => {
    expect(migrarCatalogo()).toBe(true);
    const yaml = readFileSync(APPS, 'utf8');
    expect(yaml.indexOf('espacos:')).toBeLessThan(yaml.indexOf('apps:'));
    expect(yaml).toMatch(/comentário do usuário/);
    expect(yaml).not.toMatch(/empresa:/);
    expect(readdirSync(join(raiz, 'dados', 'apps-historico'))).toHaveLength(1);

    const cat = loadCatalogo();
    expect(cat.espacos.map((e) => e.id)).toEqual(['funifier', 'dac']);
    const app = (n: string) => cat.apps.find((a) => a.app === n)!;
    expect(app('meu-app')).toMatchObject({ espaco: 'funifier', pasta: join(repos, 'FUNIFIER', 'meu-app'), gamificacao: true, regras: 'funifier' });
    expect(app('vista')).toMatchObject({ espaco: 'dac', pasta: join(repos, 'DAC', 'vista'), gamificacao: false, regras: 'dac' });
    // Fora da pasta do espaço: fica absoluta.
    expect(app('sandbox').pasta).toBe(join(repos, 'sandbox'));
    expect(yaml).toMatch(/pasta: meu-app/);
  });

  it('migrar de novo não faz nada', () => {
    expect(migrarCatalogo()).toBe(false);
    expect(readdirSync(join(raiz, 'dados', 'apps-historico'))).toHaveLength(1);
  });

  it('regras (O14): do espaço por padrão, própria do projeto, ou nenhuma', () => {
    writeFileSync(
      APPS,
      `espacos:
  - { id: funifier, nome: Funifier, pasta: FUNIFIER, gamificacao: true }
  - { id: pessoal, pasta: /tmp/pessoal, regras: nenhuma }
apps:
  - { app: a, espaco: funifier, ferramenta: funifier-pm, pasta: a }
  - { app: b, espaco: funifier, ferramenta: funifier-pm, pasta: b, regras: nenhuma, gamificacao: false }
  - { app: lab, espaco: pessoal, ferramenta: bnexo, pasta: lab, regras: laboratorio }
  - { app: c, espaco: pessoal, ferramenta: bnexo, pasta: c }
`,
    );
    const cat = loadCatalogo();
    const app = (n: string) => cat.apps.find((x) => x.app === n)!;
    expect(app('a')).toMatchObject({ regras: 'funifier', gamificacao: true });
    expect(app('b')).toMatchObject({ regras: null, gamificacao: false });
    expect(app('lab')).toMatchObject({ regras: 'laboratorio', pasta: '/tmp/pessoal/lab' });
    expect(app('c').regras).toBeNull();
    expect(fontesDeRegras(cat)).toEqual([
      { nome: 'funifier', titulo: 'Funifier' },
      { nome: 'laboratorio', titulo: 'lab' },
    ]);
  });

  it('projeto trazido sem ferramenta adota a do primeiro projeto ligado a ele', () => {
    writeFileSync(APPS, 'espacos:\n  - { id: pessoal, pasta: /tmp/p }\napps:\n  - { app: lab, espaco: pessoal, ferramenta: nenhuma, pasta: /tmp/lab }\n');
    ligarProjeto('lab', 'LAB', 'jira');
    expect(loadCatalogo().apps[0]).toMatchObject({ ferramenta: 'jira', projetos_na_ferramenta: ['LAB'] });
    ligarProjeto('lab', 'OUTRO', 'bnexo'); // já tem ferramenta: só acrescenta o projeto
    expect(loadCatalogo().apps[0]).toMatchObject({ ferramenta: 'jira', projetos_na_ferramenta: ['LAB', 'OUTRO'] });
  });

  it('desligar tira o projeto da pasta (para religar em outra) e não mexe nos outros', () => {
    writeFileSync(
      APPS,
      'espacos:\n  - { id: pessoal, pasta: /tmp/p }\napps:\n  - { app: a, espaco: pessoal, ferramenta: jira, pasta: /tmp/a, projetos_na_ferramenta: [X, Y] }\n  - { app: b, espaco: pessoal, ferramenta: jira, pasta: /tmp/b }\n',
    );
    desligarProjeto('jira', 'X');
    ligarProjeto('b', 'X', 'jira');
    const [a, b] = loadCatalogo().apps;
    expect(a.projetos_na_ferramenta).toEqual(['Y']);
    expect(b.projetos_na_ferramenta).toEqual(['X']);
    desligarProjeto('jira', 'NAO-EXISTE'); // sem efeito
    expect(loadCatalogo().apps[0].projetos_na_ferramenta).toEqual(['Y']);
  });

  it('app com espaço que não existe: erro claro', () => {
    writeFileSync(APPS, 'espacos: []\napps:\n  - { app: a, espaco: sumiu, ferramenta: bnexo, pasta: a }\n');
    expect(() => loadCatalogo()).toThrow(/espaço "sumiu", que não existe/);
  });

  it('sem apps.yaml: catálogo vazio', () => {
    writeFileSync(APPS, 'apps: []\n');
    expect(loadCatalogo()).toMatchObject({ espacos: [], apps: [] });
    expect(existsSync(APPS)).toBe(true);
  });
});
