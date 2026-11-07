# Muxor: instalação

**Comece aqui.** Este guia é tudo o que você precisa para instalar e usar o Muxor. Se for pedir ajuda ao seu Claude
Code, peça para ele seguir esta pasta (`instalacao/`): ela responde sozinha as dúvidas de instalação e uso.

## O que é o Muxor

O Muxor lê as suas tasks nas ferramentas de gestão (Funifier PM, Bnexo, Jira) e manda a lista no Telegram. Você escolhe
as tasks, ele escreve as instruções e abre uma sessão do Claude Code no Orca, na pasta do projeto. Quando a sessão
termina ou precisa de você, ele avisa no Telegram. Dá para acompanhar e responder pelo celular.

## Antes de começar

| Você vai precisar de | Para quê |
|---|---|
| Um Mac, com o Node, git, GitHub CLI, Claude Code e Orca instalados | Ver [pré-requisitos](pre-requisitos.md) |
| A conta do Claude Code (assinatura) | As sessões que fazem as tasks |
| O Telegram no celular | Onde o Muxor fala com você |
| Acesso às suas ferramentas de gestão | Funifier PM (login normal), Bnexo (endereço e token do MCP) ou Jira (e-mail e API token) |
| As contas do GitHub que você usa (ex.: a do trabalho e a pessoal) | Uma para cada "espaço" |
| Uns 20 minutos | O `muxor init` guia tudo |

## Onde o Muxor roda

| | Neste Mac (local) | Num servidor seu (VPS) |
|---|---|---|
| Para quem | Para começar e testar | Para usar 24 h, com o Mac desligado |
| O Mac | Precisa ficar ligado e acordado para as tasks rodarem | Só acompanha |
| Guia | [modo local](modo-local.md) | [modo servidor](modo-servidor.md) |

A maioria começa no modo local. Dá para levar para um servidor depois ([migrar](migrar-para-servidor.md)).

## Os passos

1. Instale os [pré-requisitos](pre-requisitos.md).
2. Baixe o Muxor e rode o `muxor init`: [modo local](modo-local.md).
3. Use pelo Telegram: `/tarefas`, `/nova` e `/menu`.

## Outros guias

| Guia | Quando |
|---|---|
| [Heartbeat](heartbeat.md) | Receber um aviso se o Muxor cair (opcional) |
| [Desinstalar](desinstalar.md) | Tirar o Muxor do computador, deixando tudo como estava |
| [Dicas e dúvidas](dicas.md) | Algo não funcionou, ou você quer saber como algo funciona |
| [Prompts](prompts/) | Pedidos prontos para o seu Claude Code (ex.: clonar repositórios) |
