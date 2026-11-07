#!/bin/bash
# Desinstalador do Muxor no Mac: curl -fsSL https://muxor.com.br/uninstall | bash
# Chama o `muxor desinstalar`, que mostra o que vai desfazer e pede confirmação antes de qualquer coisa.
set -euo pipefail

principal() {
  local APP="${HUB_HOME:-$HOME/.muxor}/app"
  if [ ! -x "$APP/muxor" ]; then
    printf '\n  Não achei o Muxor instalado pelo site neste usuário (%s).\n' "$APP"
    printf '  Se você baixou com git clone, rode de dentro da pasta dele: ./muxor desinstalar\n\n'
    exit 0
  fi
  exec "$APP/muxor" desinstalar </dev/tty
}

principal "$@"
