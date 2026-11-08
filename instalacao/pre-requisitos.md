# Pré-requisitos

**Você não precisa instalar nada antes.** O instalador (`curl -fsSL https://muxor.com.br/install | bash`) e o
`muxor init` conferem cada programa, mostram a lista do que falta e instalam depois do seu "sim". O que o Muxor instalou
fica anotado, e o `muxor desinstalar` oferece remover só isso.

| Programa | Para quê | Quem instala | Como conferir |
|---|---|---|---|
| **Homebrew** | Instalador de programas do Mac | O instalador do site (pede a senha do Mac) | `brew --version` |
| **git** (Command Line Tools da Apple) | Os repositórios | Vem com o Homebrew; se faltar, abre uma janela da Apple: clique em Instalar | `git --version` |
| **Node 22 ou mais novo** | O Muxor roda nele | O instalador do site (`brew install node`) | `node --version` |
| **GitHub CLI (gh)** | Login do GitHub de cada espaço, sem chave SSH | O `muxor init` (`brew install gh`) | `gh --version` |
| **Claude Code** | Quem faz as tasks | O `muxor init` (instalador oficial da Anthropic); depois ele abre o login no navegador | `claude --version` |
| **Orca 1.4.246 ou mais novo** | Roda as sessões do Claude e mostra no celular | O `muxor init` (release oficial do GitHub, com a assinatura e a notarização da Apple conferidas) | Abre normalmente |
| **Tailscale** | Abrir no celular o front-end que roda no Mac, só nos seus aparelhos | O `muxor init` (pede a senha do Mac: instala uma VPN) | Ícone na barra de menus |
| **Amphetamine** | Manter o Mac acordado com a tampa fechada (o serviço do Muxor já impede o Mac de dormir com a tampa aberta) | O `muxor init` abre a página dele na App Store (grátis): você clica em Obter | Ícone de pílula na barra de menus |
| **ngrok** (opcional) | Link público do seu front, para mostrar a outra pessoa | O `muxor init`, se você quiser | `ngrok version` |

**No celular** (o `muxor init` mostra um QR code para a página [muxor.com.br/celular](https://muxor.com.br/celular)):
Telegram, Orca e Tailscale, pela App Store ou Google Play.

**O que só você pode fazer** (o `muxor init` pede na hora e confere depois):
- Digitar a senha do Mac (Homebrew e Tailscale).
- Entrar no Claude Code com a sua conta.
- Permitir a VPN do Tailscale e entrar numa conta dele (no Mac e no celular, a mesma).
- Abrir o Orca a primeira vez (o Mac pergunta se quer abrir um app baixado da internet: Abrir).
- Criar o bot do Telegram e as contas do GitHub, do ngrok e das ferramentas de gestão.

## Instalar à mão

Se preferir instalar você mesmo (ou o instalador falhar num item):

| Programa | Comando |
|---|---|
| Homebrew | o comando do site [brew.sh](https://brew.sh) |
| Node | `brew install node` |
| GitHub CLI | `brew install gh` |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Orca | baixe em [onorca.dev](https://onorca.dev) e arraste para Aplicativos |
| Tailscale | `brew install --cask tailscale-app` (ou [tailscale.com/download](https://tailscale.com/download)) |
| ngrok | `brew install --cask ngrok` |

Notas:
- **Não precisa de chave SSH.** O Muxor usa o login do GitHub pelo navegador, uma conta para cada espaço.
- **O `gh` e o Claude Code que você já usa não mudam:** o Muxor guarda os logins dele à parte, em `~/.muxor`.
- Se o Mac pedir permissão para o Terminal ou o Orca acessar pastas, aceite.

Depois, siga o [modo local](modo-local.md).
