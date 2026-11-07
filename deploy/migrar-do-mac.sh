#!/usr/bin/env bash
# Leva para o servidor os projetos do catálogo do Mac e os históricos do Claude de cada um, para as sessões
# continuarem na nuvem com o mesmo contexto. Roda NO MAC:
#   HUB_SERVIDOR=ubuntu@<ip do servidor na tailnet> bash deploy/migrar-do-mac.sh [app ...]
# Sem nomes, leva todos os apps do catálogo. Idempotente: rodar de novo atualiza o que mudou.
#
# Projeto: copia a pasta como está (o .git, a branch atual, mudanças sem commit e commits não enviados), sem o que
# o .gitignore ignora (dependências e builds, que se reinstalam), exceto a configuração local: .env*, funifier.json e .mcp.json. Pasta sem git vai inteira,
# sem node_modules. Destino: /srv/hub/repos/<caminho relativo a ~/Documents>, dono agente.
# Históricos: ~/.claude/projects/<pasta do Mac> → /home/agente/.claude/projects/<pasta do servidor>, com os
# caminhos do Mac trocados pelos do servidor e as datas preservadas (o `claude -c` retoma o mais recente).
# Sem limpeza de segredos nos históricos: quem migra decide (os históricos podem conter credenciais antigas).
# Imprime no fim o catálogo do servidor (pastas relativas); o script não o grava.
set -euo pipefail

SERVIDOR="${HUB_SERVIDOR:?defina HUB_SERVIDOR=usuario@host}"
CHAVE="${HUB_CHAVE_SSH:-$HOME/.ssh/oracle_hub}"
CATALOGO="${HUB_CATALOGO:-$HOME/Documents/HUB/apps.yaml}"
BASE_MAC="$HOME/Documents"
BASE_SRV=/srv/hub/repos
export COPYFILE_DISABLE=1 # sem os arquivos ._* do macOS no tar

ssh_srv() { ssh -i "$CHAVE" -o BatchMode=yes "$SERVIDOR" "$@"; }
# Pasta de históricos do Claude: todo caractere fora de [A-Za-z0-9] vira "-".
pasta_claude() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }

apps=$(python3 - "$CATALOGO" "$@" <<'EOF'
import sys, yaml
cat, nomes = sys.argv[1], set(sys.argv[2:])
for a in yaml.safe_load(open(cat))['apps']:
    if not nomes or a['app'] in nomes:
        print(f"{a['app']}\t{a['pasta']}")
EOF
)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

while IFS=$'\t' read -r app pasta; do
  [[ -d "$pasta" ]] || { echo "⚠️  $app: $pasta não existe no Mac, pulei"; continue; }
  rel="${pasta#"$BASE_MAC"/}"
  [[ "$rel" == "HUB/sandbox" ]] && rel=sandbox # o sandbox do servidor já existia em /srv/hub/repos/sandbox
  destino="$BASE_SRV/$rel"
  echo "==> $app → $destino"

  # Projeto
  lista="$tmp/lista"
  if [[ -d "$pasta/.git" ]]; then
    ( cd "$pasta"
      # Só o que existe: arquivo apagado e ainda não commitado continua na lista do git e faria o tar falhar.
      git ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
        [[ -e "$f" || -L "$f" ]] && printf '%s\0' "$f"
      done
      git ls-files -z -o -i --exclude-standard --directory | tr '\0' '\n' | grep -E '(^|/)(\.env[^/]*|funifier\.json|\.mcp\.json)$' | tr '\n' '\0' || true
      printf '.git\0' ) > "$lista"
    tar --no-xattrs --no-mac-metadata -C "$pasta" --null -T "$lista" -cf -
  else
    tar --no-xattrs --no-mac-metadata -C "$pasta" --exclude=node_modules -cf - .
  fi | ssh_srv "sudo -u agente mkdir -p '$destino' && sudo -u agente tar -x --no-same-owner -C '$destino'"

  # Históricos do Claude
  hist="$HOME/.claude/projects/$(pasta_claude "$pasta")"
  if [[ -d "$hist" ]]; then
    novo="$tmp/hist"
    rm -rf "$novo" && mkdir -p "$novo"
    cp -Rp "$hist/." "$novo/"
    find "$novo" -name '*.jsonl' -print0 | while IFS= read -r -d '' f; do
      sed -i '' "s#$pasta#$destino#g" "$f"
      touch -r "$hist/${f#"$novo"/}" "$f"
    done
    dir_srv="/home/agente/.claude/projects/$(pasta_claude "$destino")"
    tar --no-xattrs --no-mac-metadata -C "$novo" -cf - . | ssh_srv "sudo -u agente mkdir -p '$dir_srv' && sudo -u agente tar -x --no-same-owner -C '$dir_srv' && sudo setfacl -R -m u:hub:rX '$dir_srv'"
    echo "    históricos: $(find "$hist" -name '*.jsonl' | wc -l | tr -d ' ') sessão(ões)"
  fi
done <<< "$apps"

echo
echo "# Catálogo do servidor: troque as pastas do Mac por estas (relativas a $BASE_SRV)"
while IFS=$'\t' read -r app pasta; do
  rel="${pasta#"$BASE_MAC"/}"; [[ "$rel" == "HUB/sandbox" ]] && rel=sandbox
  echo "#   $app: $rel"
done <<< "$apps"
