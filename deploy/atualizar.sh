#!/usr/bin/env bash
# Deploy automático (B31): roda NO SERVIDOR, como o usuário hub, pelo hub-atualizar.timer (a cada 5 min).
# O servidor busca no GitHub (nada entra nele): se a branch tem commit novo com o CI verde, baixa esse commit
# exato, confere (npm ci, tipos, testes), troca as pastas e reinicia o hub. Se o hub não subir, volta à anterior.
# O reinício não derruba as tasks: as sessões vivem no Orca, e o hub retoma o acompanhamento pelo banco.
# Uso manual: sudo -u hub /home/hub/app/deploy/atualizar.sh [--forcar]
set -euo pipefail

REPO="${HUB_DEPLOY_REPO:-JpRodrigues2/hub-tasks}"
BRANCH="${HUB_DEPLOY_BRANCH:-v2}"
BASE=/home/hub
APP=$BASE/app
VERSAO=$APP/.versao              # commit em produção
RECUSADO=$BASE/.deploy-recusado  # último commit que falhou (não tenta de novo)
FORCAR=false; [[ "${1:-}" == "--forcar" ]] && FORCAR=true

sha=$(git ls-remote "https://github.com/$REPO.git" "refs/heads/$BRANCH" | cut -f1)
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "não achei a branch $BRANCH"; exit 1; }
atual=$(cat "$VERSAO" 2>/dev/null || true)
[[ "$sha" == "$atual" ]] && ! $FORCAR && exit 0
[[ "$sha" == "$(cat "$RECUSADO" 2>/dev/null || true)" ]] && ! $FORCAR && exit 0

# Só o commit que passou no CI (workflow "CI" do GitHub Actions). Sem resultado ainda: tenta no próximo ciclo.
ci=$(curl -fsS "https://api.github.com/repos/$REPO/actions/runs?head_sha=$sha&per_page=20" | python3 -c '
import json, sys
runs = [r for r in json.load(sys.stdin)["workflow_runs"] if r["name"] == "CI"]
print((runs[0]["conclusion"] or "rodando") if runs else "sem-ci")')
case "$ci" in
  success) ;;
  rodando|sem-ci) echo "commit ${sha:0:7}: CI $ci, fica para o próximo ciclo"; exit 0 ;;
  *) echo "commit ${sha:0:7}: CI $ci, não atualizo"; echo "$sha" > "$RECUSADO"; exit 0 ;;
esac

echo "atualizando ${atual:0:7} → ${sha:0:7}"
novo=$BASE/app-novo
rm -rf "$novo" && mkdir "$novo"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$sha" | tar -xz -C "$novo" --strip-components=1
if ! (cd "$novo" && npm ci --silent --no-audit --no-fund && npx tsc --noEmit -p . && npx vitest run --silent); then
  echo "commit ${sha:0:7}: falhou na conferência do servidor, não atualizo"
  echo "$sha" > "$RECUSADO"; rm -rf "$novo"; exit 1
fi
echo "$sha" > "$novo/.versao"
[[ -d "$APP/logs" ]] && cp -a "$APP/logs" "$novo/"

rm -rf "$BASE/app-anterior"
mv "$APP" "$BASE/app-anterior" && mv "$novo" "$APP"
sudo -n systemctl restart hub.service
sleep 20
if systemctl is-active -q hub.service; then
  rm -f "$RECUSADO"
  echo "hub atualizado para ${sha:0:7}"
else
  echo "hub não subiu com ${sha:0:7}: voltando para ${atual:0:7}"
  rm -rf "$BASE/app-falho" && mv "$APP" "$BASE/app-falho" && mv "$BASE/app-anterior" "$APP"
  echo "$sha" > "$RECUSADO"
  sudo -n systemctl restart hub.service
  exit 1
fi
