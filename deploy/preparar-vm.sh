#!/usr/bin/env bash
# Prepara uma VM Ubuntu 24.04 (ARM ou x86) para rodar o hub. Roda como root:
#   sudo HUB_HOSTNAME=hub-cloud bash deploy/preparar-vm.sh [--fechar-ssh]
# Idempotente: cada passo confere se já foi feito, então rodar de novo conserta uma VM pela metade.
# Não faz o que exige uma pessoa: `tailscale up`, `claude` (login do agente) e o pareamento do celular.
# Desenho em docs/servidor.md.
#
# Variáveis opcionais:
#   HUB_HOSTNAME     nome na tailnet (padrão hub-cloud)
#   ORCA_VERSAO      versão do Orca (padrão abaixo; conferida pelo sha512 da release)
#   COFRE_CHAVE_B64  chave-mestra de recuperação (base64); só usada se o cofre ainda não tiver chave
set -euo pipefail

HUB_HOSTNAME="${HUB_HOSTNAME:-hub-cloud}"
ORCA_VERSAO="${ORCA_VERSAO:-1.4.246}"
FECHAR_SSH=false
[[ "${1:-}" == "--fechar-ssh" ]] && FECHAR_SSH=true

GRUPO=hub-agente               # o que o hub e o agente dividem: repositórios e anexos das tasks
REPOS=/srv/hub/repos           # clones dos projetos (o agente escreve; o hub cria pastas novas)
RUNS=/srv/hub/runs             # anexos e prompts das tasks (o hub escreve; o agente lê)
APP=/home/hub/app              # código do hub (trocado a cada deploy)
DADOS=/home/hub/dados          # banco, cofre e logs (preservados)
CHAVE=/etc/hub/cofre-chave.cred

passo() { printf '\n==> %s\n' "$*"; }
# Grava uma unidade do systemd lida da entrada padrão; devolve 0 só se o conteúdo mudou.
unidade() {
  local destino="/etc/systemd/system/$1" novo
  novo=$(cat)
  [[ -f "$destino" && "$(cat "$destino")" == "$novo" ]] && return 1
  printf '%s\n' "$novo" > "$destino"
  systemctl daemon-reload
}
[[ $EUID -eq 0 ]] || { echo "rode com sudo"; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu ]] || { echo "feito para Ubuntu (encontrado: $ID)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

passo "Pacotes do sistema e atualizações automáticas de segurança"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git sqlite3 acl ufw unattended-upgrades python3 openssl build-essential gh >/dev/null   # build-essential: better-sqlite3 compila no ARM; gh: login do GitHub do agente
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

passo "Swap de 4 GB (várias sessões do Claude juntas podem estourar a RAM)"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

passo "Node 22"
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

passo "Usuários: hub (hub, broker, cofre) e agente (Orca e sessões do Claude)"
getent group "$GRUPO" >/dev/null || groupadd "$GRUPO"
for u in hub agente; do
  id "$u" >/dev/null 2>&1 || useradd -m -s /bin/bash "$u"
  usermod -aG "$GRUPO" "$u"
  chmod 750 "/home/$u"
  loginctl enable-linger "$u"   # serviços do usuário continuam sem ninguém logado
done
install -d -m 700 -o hub -g hub "$DADOS" /home/hub/.ssh
install -d -m 755 -o root -g root /srv/hub
install -d -m 2775 -o agente -g "$GRUPO" "$REPOS"   # setgid: tudo criado dentro fica no grupo
install -d -m 2750 -o hub -g "$GRUPO" "$RUNS"       # o agente lê, não escreve
# O hub lê o histórico das sessões do Claude do agente (retomar sessões); só leitura, só essa pasta.
install -d -m 700 -o agente -g agente /home/agente/.claude /home/agente/.claude/projects
setfacl -m u:hub:x /home/agente /home/agente/.claude
setfacl -R -m u:hub:rX /home/agente/.claude/projects
setfacl -d -m u:hub:rX /home/agente/.claude/projects

passo "Tailscale"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1

passo "Firewall: nada entra pela internet; a tailnet entra"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 >/dev/null
if $FECHAR_SSH; then
  ufw delete allow 22/tcp >/dev/null 2>&1 || true
else
  ufw allow 22/tcp >/dev/null   # só até o Tailscale estar de pé; depois rode de novo com --fechar-ssh
fi
ufw --force enable >/dev/null
# A imagem Ubuntu da Oracle traz regras próprias (iptables-persistent) que liberam a 22 e rejeitam o resto
# antes das regras do ufw, então o ufw não manda em nada. Tira só essas três; as de InstanceServices
# (saída para os serviços da Oracle, como o disco de boot) ficam.
REGRAS_ORACLE=(
  "INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT"
  "INPUT -j REJECT --reject-with icmp-host-prohibited"
  "FORWARD -j REJECT --reject-with icmp-host-prohibited"
)
for regra in "${REGRAS_ORACLE[@]}"; do
  [[ -f /etc/iptables/rules.v4 ]] && sed -i "\|^-A $regra\$|d" /etc/iptables/rules.v4
  # shellcheck disable=SC2086
  while iptables -C $regra 2>/dev/null; do iptables -D $regra; done
done

passo "Orca $ORCA_VERSAO (pacote oficial, sha512 conferido)"
if [[ "$(dpkg-query -W -f='${Version}' orca-ide 2>/dev/null || true)" != "$ORCA_VERSAO" ]]; then
  arq="orca-ide_${ORCA_VERSAO}_$(dpkg --print-architecture).deb"
  base="https://github.com/stablyai/orca/releases/download/v${ORCA_VERSAO}"
  manifesto="latest-linux.yml"; [[ "$(dpkg --print-architecture)" == arm64 ]] && manifesto="latest-linux-arm64.yml"
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$arq" "$base/$arq"
  esperado=$(curl -fsSL "$base/$manifesto" | grep -A1 "url: $arq" | sed -n 's/.*sha512: //p')
  obtido=$(openssl dgst -sha512 -binary "$tmp/$arq" | base64 -w0)
  [[ -n "$esperado" && "$esperado" == "$obtido" ]] || { echo "sha512 do Orca não confere"; exit 1; }
  apt-get install -y -qq "$tmp/$arq" >/dev/null
  rm -rf "$tmp"
fi

passo "Ajudante: marcar a pasta atual como confiável no Claude do agente (roda antes de cada sessão do hub)"
cat > /usr/local/bin/hub-confiar-pasta <<'PY'
#!/usr/bin/env python3
# Marca a pasta atual como confiável no ~/.claude.json de quem roda (o agente). Sem isso o Claude
# para em "Do you trust this folder?", com "No, exit" como padrão.
import json, os, tempfile
p = os.path.expanduser("~/.claude.json")
d = json.load(open(p)) if os.path.exists(p) else {}
proj = d.setdefault("projects", {}).setdefault(os.getcwd(), {})
if not proj.get("hasTrustDialogAccepted"):
    proj["hasTrustDialogAccepted"] = True
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p))
    with os.fdopen(fd, "w") as f:
        json.dump(d, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)
PY
chmod 755 /usr/local/bin/hub-confiar-pasta

passo "Claude Code do agente, em modo auto"
sudo -u agente -i bash -c '[ -x ~/.local/bin/claude ] || curl -fsSL https://claude.ai/install.sh | bash >/dev/null'
sudo -u agente -i python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
d = json.load(open(p)) if os.path.exists(p) else {}
d.setdefault("permissions", {})["defaultMode"] = "auto"   # nunca bypassPermissions
json.dump(d, open(p, "w"), indent=2)
EOF
# Repositórios criados pelo hub ficam com outro dono; sem isto o git do agente recusa ("dubious ownership").
# O git do Ubuntu 24.04 (2.43) não aceita curinga no fim do caminho, só "*"; o único outro dono possível é o hub.
sudo -u agente git config --global --unset-all safe.directory "$REPOS/\\*" 2>/dev/null || true
sudo -u agente git config --global --get-all safe.directory | grep -qxF '*' || sudo -u agente git config --global --add safe.directory '*'

passo "Serviço do Orca (usuário agente)"
mudou=false
unidade orca.service <<EOF && mudou=true
[Unit]
Description=Orca sem tela (usuário agente)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=agente
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u agente)
WorkingDirectory=/home/agente
# Anuncia o IP do Tailscale para o Mac e o celular; sem Tailscale, só a própria máquina.
ExecStart=/bin/sh -c 'A=\$\$(tailscale ip -4 2>/dev/null | head -1); exec /usr/bin/orca-ide serve --port 6768 --pairing-address "\$\${A:-127.0.0.1}"'
StandardInput=null
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl enable orca.service >/dev/null 2>&1
if $mudou || ! systemctl is-active -q orca.service; then systemctl restart orca.service; fi

passo "Pareamento do hub com o Orca do agente (pela própria máquina)"
if ! sudo -u hub -i orca-ide environment list --json 2>/dev/null | grep -q '"name": "agente"'; then
  inicio=$(systemctl show -p ActiveEnterTimestamp --value orca.service)
  url=""
  for _ in $(seq 1 30); do
    url=$(journalctl -u orca.service --since "$inicio" --no-pager -o cat | grep -o 'orca://pair?code=[^ ]*' | tail -1 || true)
    [[ -n "$url" ]] && break
    sleep 2
  done
  [[ -n "$url" ]] || { echo "o Orca não publicou link de pareamento"; exit 1; }
  # O hub fala com o Orca por 127.0.0.1, para não depender do Tailscale estar de pé.
  url=$(URL="$url" python3 - <<'EOF'
import base64, json, os, urllib.parse
u = urllib.parse.urlparse(os.environ["URL"])
codigo = urllib.parse.parse_qs(u.query)["code"][0]
url_safe = "-" in codigo or "_" in codigo
padrao = codigo.replace("-", "+").replace("_", "/")
d = json.loads(base64.b64decode(padrao + "=" * (-len(padrao) % 4)))
d["endpoint"] = "ws://127.0.0.1:6768"
novo = base64.b64encode(json.dumps(d, separators=(",", ":")).encode()).decode().rstrip("=")
if url_safe:
    novo = novo.replace("+", "-").replace("/", "_")
print("orca://pair?code=" + novo)
EOF
)
  sudo -u hub -i orca-ide environment add --name agente --pairing-code "$url" --json >/dev/null
fi
ok=false
for _ in $(seq 1 30); do
  sudo -u hub -i orca-ide repo list --environment agente --json 2>/dev/null | grep -q '"ok": true' && { ok=true; break; }
  sleep 2
done
$ok || { echo "o hub não alcança o Orca"; exit 1; }

passo "Cofre: chave-mestra guardada pelo systemd-creds"
install -d -m 700 -o root -g root /etc/hub
if [[ ! -f "$CHAVE" ]]; then
  systemd-creds setup >/dev/null 2>&1 || true
  if [[ -n "${COFRE_CHAVE_B64:-}" ]]; then
    printf '%s' "$COFRE_CHAVE_B64" | base64 -d | systemd-creds encrypt --name=cofre-chave - "$CHAVE"
  else
    head -c 32 /dev/urandom | systemd-creds encrypt --name=cofre-chave - "$CHAVE"
    echo "CHAVE NOVA: guarde a cópia de recuperação (rode e salve no app Senhas):"
    echo "  sudo systemd-creds decrypt --name=cofre-chave $CHAVE - | base64 -w0"
  fi
  chmod 600 "$CHAVE"
fi

passo "Broker: MCP \"hub\" no Claude do agente (as sessões usam a Funifier sem ver a chave)"
# O token só diz "sou uma sessão do agente"; quais gamificações valem o hub decide pelas tasks em andamento.
TOKEN_BROKER=$DADOS/broker-token
install -d -m 700 -o hub -g hub "$DADOS"
[[ -s "$TOKEN_BROKER" ]] || { openssl rand -hex 32 > "$TOKEN_BROKER"; chown hub:hub "$TOKEN_BROKER"; chmod 600 "$TOKEN_BROKER"; }
if ! sudo -u agente -i claude mcp get hub >/dev/null 2>&1; then
  sudo -u agente -i claude mcp add --transport http --scope user hub "http://127.0.0.1:7790/mcp" \
    --header "Authorization: Bearer $(cat "$TOKEN_BROKER")" >/dev/null
fi

passo "Serviço do hub (sobe quando o código estiver em $APP)"
# Unidade mudou com o hub rodando: reinicia para valer (try-restart não liga se estiver parado).
unidade hub.service <<EOF && systemctl try-restart hub.service || true
[Unit]
Description=Muxor (hub de tasks)
After=network-online.target orca.service
Wants=network-online.target orca.service
ConditionPathExists=$APP/package.json
ConditionPathExists=$DADOS/.env

[Service]
User=hub
UMask=0007
WorkingDirectory=$APP
Environment=DOTENV_CONFIG_PATH=$DADOS/.env
Environment=ORCA_BIN=/usr/bin/orca-ide
Environment=ORCA_ENVIRONMENT=agente
Environment=HUB_COFRE=arquivo-cifrado
Environment=HUB_CONFIAR_PASTA_CMD=/usr/local/bin/hub-confiar-pasta
Environment=HUB_DADOS_DIR=$DADOS
Environment=HUB_APPS_FILE=$DADOS/apps.yaml
Environment=HUB_REPOS_DIR=$REPOS
Environment=HUB_RUNS_DIR=$RUNS
Environment=HUB_CLAUDE_DIR=/home/agente/.claude
Environment="HUB_GIT_COMO=sudo -n -u agente"
Environment=HUB_BROKER=ligado
Environment=HUB_BROKER_TOKEN_ARQ=$TOKEN_BROKER
LoadCredentialEncrypted=cofre-chave:$CHAVE
ExecStart=/usr/bin/npm start --silent
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl enable hub.service >/dev/null 2>&1
# O deploy (usuário hub) só pode reiniciar estes dois serviços.
cat > /etc/sudoers.d/hub-deploy <<'EOF'
hub ALL=(root) NOPASSWD: /usr/bin/systemctl restart hub.service, /usr/bin/systemctl restart orca.service
# O hub clona e consulta repositórios como o agente (chaves e logins do git são dele).
hub ALL=(agente) NOPASSWD: /usr/bin/git
EOF
chmod 440 /etc/sudoers.d/hub-deploy
visudo -cq

passo "Deploy automático: o servidor busca no GitHub a cada 5 min (B31; nada entra no servidor)"
unidade hub-atualizar.service <<EOF || true
[Unit]
Description=Atualiza o hub para o último commit com CI verde
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=hub
ExecStart=$APP/deploy/atualizar.sh
EOF
unidade hub-atualizar.timer <<EOF || true
[Unit]
Description=Deploy automático do hub a cada 5 min

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF
systemctl enable --now hub-atualizar.timer >/dev/null 2>&1

passo "Pronto. Falta o que exige você:"
tailscale status >/dev/null 2>&1 || echo "  - sudo tailscale up --hostname $HUB_HOSTNAME   (depois: sudo systemctl restart orca.service)"
sudo -u agente -i bash -c '~/.local/bin/claude auth status 2>/dev/null | grep -q "\"loggedIn\": true"' || echo "  - sudo -u agente -i claude   (login do Claude do agente)"
$FECHAR_SSH || echo "  - com o Tailscale de pé, rode de novo com --fechar-ssh"
[[ -f "$DADOS/.env" ]] || echo "  - criar $DADOS/.env (tokens do Telegram e das ferramentas; modelo em .env.example), dono hub, modo 600"
echo "  - parear o Mac e o celular: sudo journalctl -u orca.service -o cat | grep 'Pairing URL' | tail -1"
echo "  - no Orca (Mac): Settings → Agents → Claude → launch arguments: --permission-mode auto"
