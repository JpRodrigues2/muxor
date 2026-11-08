import { describe, expect, it } from 'vitest';
import { JiraAdapter, type FetchJira } from '../../src/pm/jira.js';
import { EscritaBloqueadaError } from '../../src/pm/types.js';

const issue = (key: string, cat: string, extra: Record<string, unknown> = {}) => ({
  id: key,
  key,
  fields: { summary: `Task ${key}`, status: { name: cat === 'done' ? 'Feito' : 'A fazer', statusCategory: { key: cat } }, project: { id: '10', key: 'LAB', name: 'Laboratório' }, duedate: null, ...extra },
});

function jiraFalso(rotas: Record<string, unknown>) {
  const chamadas: { url: string; metodo: string; corpo?: unknown; auth?: string }[] = [];
  const buscar: FetchJira = async (url, init) => {
    const caminho = url.replace('https://lab.atlassian.net/rest/api/3', '');
    chamadas.push({ url: caminho, metodo: init?.method ?? 'GET', corpo: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>).Authorization });
    const chave = Object.keys(rotas).find((k) => caminho.startsWith(k));
    if (!chave) return new Response('não', { status: 404 });
    const r = rotas[chave];
    return r === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(r), { status: 200 });
  };
  return { buscar, chamadas };
}

const env = (o = {}) => ({
  JIRA_URL: 'https://lab.atlassian.net/',
  JIRA_EMAIL: 'jp@x.com',
  JIRA_API_TOKEN: 'token-de-teste-123',
  TZ_HUB: 'America/Sao_Paulo',
  HUB_ESCRITA_PM: true,
  HUB_ESCRITA_PM_SOMENTE: null,
  HUB_COMENTARIOS_PM: false,
  ...o,
});

describe('Jira (adaptador)', () => {
  it('lista as tasks da pessoa, com paginação, link e categoria', async () => {
    let n = 0;
    const f = jiraFalso({});
    const buscar: FetchJira = async (url, init) => {
      await f.buscar(url, init);
      n++;
      return new Response(JSON.stringify(n === 1 ? { issues: [issue('LAB-1', 'new')], nextPageToken: 'p2' } : { issues: [issue('LAB-2', 'indeterminate')] }));
    };
    const tasks = await new JiraAdapter(env(), buscar).listMyTasks();
    expect(tasks.map((t) => [t.id, t.categoria, t.link])).toEqual([
      ['LAB-1', 'pendente', 'https://lab.atlassian.net/browse/LAB-1'],
      ['LAB-2', 'em_progresso', 'https://lab.atlassian.net/browse/LAB-2'],
    ]);
    expect(f.chamadas[0].url).toMatch(/assignee\+%3D\+currentUser/);
    expect(f.chamadas[1].url).toMatch(/nextPageToken=p2/);
    expect(f.chamadas[0].auth).toBe(`Basic ${Buffer.from('jp@x.com:token-de-teste-123').toString('base64')}`);
  });

  it('detalhe: descrição e comentários em texto, imagens com endereço completo', async () => {
    const f = jiraFalso({
      '/issue/LAB-1?': {
        ...issue('LAB-1', 'new'),
        renderedFields: { description: '<p>Fazer o ranking</p><img src="/secure/attachment/1/a.png">', comment: { comments: [{ author: { displayName: 'Ana' }, created: '2026-11-01T10:00:00Z', body: '<p>ok</p>' }] } },
      },
    });
    const d = await new JiraAdapter(env(), f.buscar).getTask('LAB-1');
    expect(d.descricao).toMatch(/Fazer o ranking/);
    expect(d.comentarios).toEqual([{ autor: 'Ana', data: '2026-11-01T10:00:00Z', texto: 'ok' }]);
    expect(d.imagens).toEqual(['https://lab.atlassian.net/secure/attachment/1/a.png']);
  });

  it('status pela categoria do fluxo do projeto; nunca "em revisão"', async () => {
    const f = jiraFalso({
      '/issue/LAB-1/transitions': { transitions: [{ id: '11', to: { statusCategory: { key: 'new' } } }, { id: '21', to: { statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { statusCategory: { key: 'done' } } }] },
    });
    const j = new JiraAdapter(env(), f.buscar);
    await j.setStatus('LAB-1', 'em_progresso');
    expect(f.chamadas.at(-1)).toMatchObject({ metodo: 'POST', corpo: { transition: { id: '21' } } });
    await expect(j.setStatus('LAB-1', 'em_revisao')).rejects.toThrow(/não muda/);
  });

  it('escrita bloqueada e comentário bloqueado por padrão (B02)', async () => {
    const f = jiraFalso({});
    await expect(new JiraAdapter(env({ HUB_ESCRITA_PM: false }), f.buscar).setStatus('LAB-1', 'concluida')).rejects.toBeInstanceOf(EscritaBloqueadaError);
    await expect(new JiraAdapter(env(), f.buscar).comment('LAB-1', 'oi')).rejects.toBeInstanceOf(EscritaBloqueadaError);
    expect(f.chamadas).toEqual([]);
  });

  it('credencial recusada vira mensagem clara', async () => {
    const buscar: FetchJira = async () => new Response('', { status: 401 });
    await expect(new JiraAdapter(env(), buscar).ping()).rejects.toThrow('o e-mail ou o API token não foram aceitos');
    const semRede = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new JiraAdapter(env(), semRede).ping()).rejects.toThrow(/não achei o Jira em .+\. Confira o endereço/);
  });
});
