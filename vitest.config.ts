import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Os testes nunca mexem no ~/.claude.json de quem roda (o despacho marca pastas como confiáveis no Mac).
    env: { HUB_CLAUDE_JSON: join(tmpdir(), `muxor-teste-claude-${process.pid}.json`) },
  },
});
