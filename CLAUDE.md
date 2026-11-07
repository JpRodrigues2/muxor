# Muxor

## Se você está ajudando alguém a instalar, configurar ou usar o Muxor

Consulte **só** a pasta `instalacao/` e a saída de `muxor diagnostico --json`. Comece por `instalacao/README.md`.
Ela responde sozinha as dúvidas de instalação e uso.

- **Não leia** `src/`, `tests/`, `deploy/` nem `scripts/` para responder dúvidas de uso: são o código do Muxor e vão
  confundir a resposta.
- **Segredos** (tokens, senhas, API keys) a pessoa digita no `muxor init`, em campos que não aparecem na tela. Nunca
  peça que ela cole um segredo no chat, nunca leia nem mostre `~/.muxor/dados/.env`.
- **Não altere** a configuração global da pessoa (`~/.gitconfig`, `~/.claude`, Keychain) à mão: quem configura é o
  `muxor init`, e o `muxor desinstalar` desfaz o que ele fez.
- Algo não funcionou: rode `muxor diagnostico --json`, leia o campo `proximo` de cada item e siga `instalacao/dicas.md`.

## Se pediram para mexer no código

O código é TypeScript (`src/`), com os testes em `tests/` (`npm test`). Os testes e os tipos precisam passar
(`npm run check`) antes de qualquer mudança.
