# Pré-requisitos

O que instalar antes do `muxor init`. O próprio `muxor init` confere cada item e diz o que falta.
Para cada um: como instalar e como conferir que deu certo (o comando de conferir roda no app **Terminal**).

| Programa | Como instalar | Como conferir |
|---|---|---|
| **Homebrew** (instalador de programas do Mac) | Cole no Terminal o comando do site [brew.sh](https://brew.sh) | `brew --version` |
| **Node 22 ou mais novo** | `brew install node@22` e siga a instrução que ele mostrar para pôr no PATH (ou o instalador de [nodejs.org](https://nodejs.org)) | `node --version` mostra `v22` ou mais |
| **git** | Já vem no Mac. Se pedir, aceite instalar as "Command Line Tools" (ou `xcode-select --install`) | `git --version` |
| **GitHub CLI (gh)** | `brew install gh` | `gh --version` |
| **Claude Code** | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude --version`; depois rode `claude` uma vez e entre com a sua conta |
| **Orca** (app para Mac) | Baixe em [onorca.dev](https://onorca.dev) ou em [github.com/stablyai/orca/releases](https://github.com/stablyai/orca/releases) e arraste para Aplicativos | Abre normalmente |
| **Telegram** (celular) | App Store ou Google Play | — |
| **Orca no celular** (opcional) | App Store ou Google Play: "Orca" | — |

Notas:
- **Não precisa de chave SSH.** O Muxor usa o login do GitHub pelo navegador, uma conta para cada espaço.
- **O `gh` e o Claude Code que você já usa não mudam:** o Muxor guarda os logins dele à parte, em `~/.muxor`.
- Se o Mac pedir permissão para o Terminal ou o Orca acessar pastas, aceite.

Com tudo instalado, siga para o [modo local](modo-local.md).
