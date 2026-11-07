import { afterEach, describe, expect, it } from 'vitest';
import { redact } from '../../src/logger.js';
import { atrasada, escritaPermitida, extrairImagens, htmlParaTexto, prazoIso } from '../../src/pm/types.js';
import { dividirMensagem, escapeHtml } from '../../src/resumo.js';
import { desformatar, formatar } from '../../src/regras.js';

describe('redact (logs sem segredos)', () => {
  afterEach(() => {
    delete process.env.TESTE_API_SECRET;
  });

  it('esconde valores de variáveis de ambiente secretas', () => {
    process.env.TESTE_API_SECRET = 'segredo-super-longo-123';
    expect(redact('chave=segredo-super-longo-123')).toBe('chave=[REDACTED]');
  });

  it('esconde token de bot do Telegram, token MCP e Bearer', () => {
    const bot = '123456789:' + 'A'.repeat(35);
    const mcp = 'mcp_' + 'a'.repeat(32);
    const out = redact(`${bot} ${mcp} Bearer abc.def`);
    expect(out).not.toContain(bot);
    expect(out).not.toContain(mcp);
    expect(out).not.toContain('abc.def');
  });
});

describe('ferramentas de gestão', () => {
  it('escrita bloqueada por padrão e liberada só para as tasks da lista', () => {
    expect(escritaPermitida({ HUB_ESCRITA_PM: false, HUB_ESCRITA_PM_SOMENTE: null }, 't1')).toBe(false);
    expect(escritaPermitida({ HUB_ESCRITA_PM: true, HUB_ESCRITA_PM_SOMENTE: ['t1'] }, 't2')).toBe(false);
    expect(escritaPermitida({ HUB_ESCRITA_PM: true, HUB_ESCRITA_PM_SOMENTE: ['t1'] }, 't1')).toBe(true);
  });

  it('prazo inválido vira null; atrasada compara o dia no fuso', () => {
    expect(prazoIso('No deadline')).toBeNull();
    const agora = new Date('2026-11-02T12:00:00Z');
    expect(atrasada('2026-11-01T12:00:00Z', 'America/Sao_Paulo', agora)).toBe(true);
    expect(atrasada('2026-11-02T23:00:00Z', 'America/Sao_Paulo', agora)).toBe(false);
  });

  it('HTML da descrição vira texto, com as imagens listadas', () => {
    const html = '<p>Olá &amp; bem-vindo</p><ul><li>um</li></ul><img src="https://x/a.png">';
    expect(extrairImagens(html)).toEqual(['https://x/a.png']);
    expect(htmlParaTexto(html)).toBe('Olá & bem-vindo\n- um\n\n[imagem: https://x/a.png]');
  });
});

describe('Telegram', () => {
  it('escapeHtml', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('dividirMensagem respeita o limite e não perde linhas', () => {
    const texto = Array.from({ length: 100 }, (_, i) => `linha ${i} ${'x'.repeat(80)}`).join('\n');
    const partes = dividirMensagem(texto, 1000);
    expect(partes.every((p) => p.length <= 1000)).toBe(true);
    expect(partes.join('\n')).toBe(texto);
  });
});

describe('regras de trabalho', () => {
  it('formatar e desformatar são inversos no conteúdo', () => {
    const texto = 'Rode os testes antes do commit\nNunca altere o apps.yaml';
    const md = formatar('Funifier', texto);
    expect(md).toContain('# Regras de trabalho — Funifier');
    expect(md).toContain('`apps.yaml`');
    expect(desformatar(md)).toBe(texto);
  });
});
