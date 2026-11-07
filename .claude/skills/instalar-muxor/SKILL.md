---
name: instalar-muxor
description: Instalar, configurar, desinstalar ou tirar dúvidas de uso do Muxor (muxor init, Telegram, espaços do GitHub, ferramentas de gestão, Orca, celular, heartbeat). Use quando a pessoa pedir ajuda com a instalação ou com o uso do Muxor.
---

# Instalar e usar o Muxor

Responda só com o que está em `instalacao/` e na saída de `./muxor diagnostico --json`. Não abra `docs/`, `src/`,
`tests/`, `deploy/` nem `scripts/`: são para quem desenvolve o Muxor.

| A pessoa quer | Leia |
|---|---|
| Começar do zero | `instalacao/README.md`, depois `instalacao/pre-requisitos.md` e `instalacao/modo-local.md` |
| Instalar num servidor | `instalacao/modo-servidor.md` |
| Saber o que falta ou o que deu errado | Rode `./muxor diagnostico --json` e siga o `proximo` de cada item; depois `instalacao/dicas.md` |
| Trazer repositórios | `instalacao/prompts/clonar-repositorios.md` |
| Outra conta do GitHub | `./muxor adicionar github-workspace` (`instalacao/modo-local.md`) |
| Trazer projetos que já estão no Orca | `./muxor adicionar projeto` (`instalacao/dicas.md`) |
| Aviso se o Muxor cair | `instalacao/heartbeat.md` |
| Remover o Muxor | `instalacao/desinstalar.md` |

Regras:
- Os comandos rodam de dentro da pasta do Muxor (`./muxor …`).
- Segredos a pessoa digita no `./muxor init`, nunca no chat. Não leia nem mostre `~/.muxor/dados/.env`.
- Não mude à mão `~/.gitconfig`, `~/.claude` nem o Keychain: o `./muxor init` configura e o `./muxor desinstalar` desfaz.
