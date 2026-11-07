#!/bin/bash
# Instalador do Muxor no Mac: curl -fsSL https://muxor.com.br/install | bash
#
# O que faz, nesta ordem (O19, docs/onboarding.md):
#   1. Confere o Homebrew, as Command Line Tools (git) e o Node 22+; instala o que faltar, depois de uma confirmação.
#   2. Baixa o Muxor (repositório público) em ~/.muxor/app e instala as dependências.
#   3. Cria o comando `muxor` (~/.local/bin/muxor) e põe essa pasta no PATH, se faltar.
#   4. Abre o `muxor init`, que confere e instala o resto (GitHub CLI, Claude Code, Orca, Tailscale) e guia a configuração.
# Tudo o que muda fora de ~/.muxor fica anotado para o `muxor desinstalar` desfazer.
# O script inteiro está numa função chamada só na última linha: um download pela metade não roda nada.

set -euo pipefail

principal() {
  local REPO="${MUXOR_REPO:-https://github.com/JpRodrigues2/muxor.git}"
  local CASA="${HUB_HOME:-$HOME/.muxor}"
  local APP="$CASA/app"
  local REGISTRO="$CASA/instalador.txt"
  local BIN="$HOME/.local/bin"
  local PERFIL="$HOME/.zprofile"

  ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
  info() { printf '  \033[36m•\033[0m %s\n' "$*"; }
  falha() {
    printf '\n  \033[31m✖\033[0m %s\n\n' "$*" >&2
    exit 1
  }
  anotar() { mkdir -p "$CASA" && chmod 700 "$CASA" && printf '%s\n' "$1" >>"$REGISTRO"; }
  perguntar() { # perguntar "texto" → 0 para sim (o padrão é sim)
    local r
    printf '\n  %s [S/n] ' "$1"
    read -r r </dev/tty || r=n
    [[ -z "$r" || "$r" =~ ^[sSyY] ]]
  }
  achar_brew() {
    local b
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && echo "$b" && return; done
  }
  node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
  clt_ok() { xcode-select -p >/dev/null 2>&1; }
  linha_no_perfil() { # garante a linha no ~/.zprofile e anota para o desinstalar tirar
    touch "$PERFIL"
    grep -qxF "$1" "$PERFIL" && return
    printf '\n%s\n' "$1" >>"$PERFIL"
    anotar "linha-shell	$PERFIL	$1"
  }

  printf '\n  \033[1;38;5;226mMuxor\033[0m · instalação\n\n'
  [ "$(uname -s)" = Darwin ] || falha "Este instalador é para Mac. Para um servidor Linux: https://muxor.com.br/docs/modo-servidor"
  [ "$(id -u)" != 0 ] || falha "Rode sem sudo: o Muxor é instalado no seu usuário."
  [ -e /dev/tty ] || falha "Rode num terminal de verdade (o app Terminal), não num script."

  local BREW faltam=()
  BREW="$(achar_brew || true)"
  [ -n "$BREW" ] || faltam+=("Homebrew: o instalador de programas do Mac (pede a senha do Mac)")
  node_ok || faltam+=("Node.js: o Muxor roda nele")

  info "O Muxor fica em $CASA (o código, a configuração e os dados, só no seu usuário)."
  info "Depois abro a configuração guiada (muxor init): ela confere e instala o resto, com a sua confirmação."
  if [ ${#faltam[@]} -gt 0 ]; then
    printf '\n  Antes, preciso instalar:\n'
    printf '    - %s\n' "${faltam[@]}"
    perguntar "Instalar agora?" || falha "Nada foi instalado. Rode o comando de novo quando quiser."
  fi

  if [ -z "$BREW" ]; then
    info "Instalando o Homebrew. Ele pede a senha do Mac (não aparece enquanto você digita) e um Enter para seguir."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
    BREW="$(achar_brew || true)"
    [ -n "$BREW" ] || falha "O Homebrew não terminou de instalar. Rode o comando de novo."
    anotar "programa	homebrew	script"
    ok "Homebrew instalado."
  fi
  eval "$("$BREW" shellenv)"
  # shellcheck disable=SC2016
  grep -qs 'brew shellenv' "$PERFIL" || linha_no_perfil "eval \"\$($BREW shellenv)\""

  if ! clt_ok; then
    info "Falta o git (Command Line Tools da Apple). Vai abrir uma janela: clique em Instalar e espere terminar."
    xcode-select --install >/dev/null 2>&1 || true
    until clt_ok; do sleep 5; done
    ok "Command Line Tools instaladas."
  fi

  if ! node_ok; then
    info "Instalando o Node.js…"
    HOMEBREW_NO_AUTO_UPDATE=1 "$BREW" install node >/dev/null
    hash -r
    node_ok || falha "O Node.js não ficou disponível. Abra um Terminal novo e rode o comando de novo."
    anotar "programa	node	brew"
    ok "Node.js $(node --version) instalado."
  fi

  if [ -d "$APP/.git" ]; then
    info "O Muxor já está em $APP: atualizando…"
    git -C "$APP" pull --ff-only --quiet || falha "Não consegui atualizar $APP (git pull)."
  else
    info "Baixando o Muxor…"
    mkdir -p "$CASA" && chmod 700 "$CASA"
    git clone --quiet --depth 1 "$REPO" "$APP" || falha "Não consegui baixar o Muxor de $REPO."
  fi
  (cd "$APP" && NPM_CONFIG_UPDATE_NOTIFIER=false npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null) || falha "Falhou ao instalar as dependências do Muxor (npm ci)."
  ok "Muxor baixado em $APP."

  mkdir -p "$BIN"
  ln -sf "$APP/muxor" "$BIN/muxor"
  anotar "atalho	$BIN/muxor"
  # shellcheck disable=SC2016
  grep -qs '.local/bin' "$PERFIL" "$HOME/.zshrc" || linha_no_perfil 'export PATH="$HOME/.local/bin:$PATH"'
  export PATH="$BIN:$PATH"
  ok "Comando muxor criado (num Terminal novo, rode só: muxor)."

  # MUXOR_SO_BAIXAR=1: para aqui, sem abrir a configuração (teste do instalador).
  [ -z "${MUXOR_SO_BAIXAR:-}" ] || exit 0
  printf '\n'
  exec "$BIN/muxor" init </dev/tty
}

principal "$@"
