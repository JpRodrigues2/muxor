#!/usr/bin/env bash
# Cria a VM do hub na Oracle (Always Free, ARM) tentando de novo até haver capacidade.
# Roda no Cloud Shell da Oracle (ícone >_ no topo do console), que já vem com o `oci` logado:
#   bash oracle-criar-vm.sh
# Idempotente: reaproveita a rede vcn-hub/subnet-hub e não cria uma segunda VM com o mesmo nome.
# O limite de custo continua na cota "teto-always-free" (A1 até 2 OCPU / 12 GB): a Oracle recusa mais que isso.
set -euo pipefail

NOME="${NOME:-hub-cloud}"
OCPU="${OCPU:-2}"
MEMORIA="${MEMORIA:-12}"
ESPERA="${ESPERA:-90}"   # segundos entre tentativas
SHAPE=VM.Standard.A1.Flex
CHAVE_PUB="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAyTw6pLUoT+JVz1Gujgn1crGKRc2WDEYjSk/GTr3Ecf hub-task-cloud"

C="${OCI_TENANCY:?rode no Cloud Shell da Oracle (falta OCI_TENANCY)}"
q() { oci "$@" --raw-output 2>/dev/null || true; }
vazio() { [[ -z "$1" || "$1" == "null" ]]; }

existente=$(q compute instance list -c "$C" --display-name "$NOME" --query 'data[?"lifecycle-state"!=`TERMINATED`] | [0].id')
if ! vazio "$existente"; then
  echo "Já existe uma VM $NOME: $existente"
  exit 0
fi

AD=$(q iam availability-domain list -c "$C" --query 'data[0].name')
echo "Zona: $AD"

echo "Rede..."
VCN=$(q network vcn list -c "$C" --display-name vcn-hub --query 'data[0].id')
if vazio "$VCN"; then
  VCN=$(q network vcn create -c "$C" --display-name vcn-hub --cidr-blocks '["10.0.0.0/16"]' --dns-label vcnhub --wait-for-state AVAILABLE --query data.id)
fi
if vazio "$(q network internet-gateway list -c "$C" --vcn-id "$VCN" --query 'data[0].id')"; then
  IGW=$(q network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true --display-name igw-hub --wait-for-state AVAILABLE --query data.id)
  RT=$(q network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"')
  oci network route-table update --rt-id "$RT" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
fi
SUB=$(q network subnet list -c "$C" --vcn-id "$VCN" --display-name subnet-hub --query 'data[0].id')
if vazio "$SUB"; then
  SUB=$(q network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 --display-name subnet-hub --dns-label subnethub --wait-for-state AVAILABLE --query data.id)
fi
echo "Sub-rede: $SUB"

IMG=$(q compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" --shape "$SHAPE" \
  --sort-by TIMECREATED --sort-order DESC --query 'data[?!contains("display-name", `Minimal`)] | [0].id')
vazio "$IMG" && { echo "Imagem Ubuntu 24.04 ARM não encontrada"; exit 1; }
echo "Imagem: $IMG"

chave=$(mktemp)
echo "$CHAVE_PUB" > "$chave"

tentativa=0
while true; do
  tentativa=$((tentativa + 1))
  if saida=$(oci compute instance launch -c "$C" --availability-domain "$AD" --display-name "$NOME" \
      --shape "$SHAPE" --shape-config "{\"ocpus\":$OCPU,\"memoryInGBs\":$MEMORIA}" \
      --image-id "$IMG" --subnet-id "$SUB" --assign-public-ip true \
      --ssh-authorized-keys-file "$chave" --wait-for-state RUNNING --query data.id --raw-output 2>&1); then
    ID=$(echo "$saida" | grep -o 'ocid1\.instance[^" ]*' | tail -1)
    IP=$(q compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"')
    echo
    echo "VM criada na tentativa $tentativa: $ID"
    echo "IP público: $IP"
    echo "No Mac: ssh -i ~/.ssh/oracle_hub ubuntu@$IP"
    rm -f "$chave"
    exit 0
  fi
  if grep -qiE 'out of (host )?capacity|TooManyRequests|InternalError' <<<"$saida"; then
    echo "$(date '+%H:%M:%S') tentativa $tentativa: sem capacidade; de novo em ${ESPERA}s"
    sleep "$ESPERA"
    continue
  fi
  echo "Erro diferente de falta de capacidade, parei:"
  echo "$saida"
  rm -f "$chave"
  exit 1
done
