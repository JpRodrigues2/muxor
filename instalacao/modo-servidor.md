# Modo servidor: o Muxor num servidor seu (VPS)

No modo servidor o Muxor e as sessões do Claude rodam 24 h num servidor seu; o Mac e o celular só acompanham. **O
`muxor init` para servidor ainda está em construção.** Hoje a instalação no servidor é guiada por scripts, e funciona
(é como roda o Muxor do mantenedor).

## O servidor

O Muxor não cria o servidor: você cria, sozinho ou com o seu Claude Code. Requisitos:

| | Mínimo |
|---|---|
| Sistema | Ubuntu 24.04 LTS |
| Processador e memória | 2 vCPU e 8 GB (12 GB para várias sessões ao mesmo tempo) |
| Disco | 40 GB |
| Custo | Oracle Cloud "Always Free" (ARM, grátis) ou Hetzner (~€ 6–10/mês) |

## Como entrar no servidor

Você vai usar o **SSH** (um jeito seguro de rodar comandos no servidor pelo Terminal) e o **Tailscale** (uma rede
privada entre o seu Mac, o celular e o servidor, para nada do servidor ficar aberto na internet). Se nunca usou, peça
ao seu Claude Code: "siga instalacao/modo-servidor.md e me ajude a entrar no meu servidor por SSH".

## Passos (hoje)

1. Crie o servidor e entre nele por SSH.
2. Baixe o Muxor: `git clone https://github.com/JpRodrigues2/muxor.git` e rode `sudo bash muxor/deploy/preparar-vm.sh`.
   Ele instala tudo (usuários, Node, Orca, Tailscale, firewall, serviços, cofre) e, no fim, lista o que só você faz:
   `tailscale up`, login do Claude, o `.env` e o pareamento do Mac e do celular.
3. Confira com `sudo -u hub -i /home/hub/app/bin/muxor.mjs diagnostico`.

## Remover

`sudo systemctl disable --now hub.service orca.service hub-atualizar.timer` e apague o servidor no painel do provedor.
