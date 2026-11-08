# Modo local: o Muxor neste Mac

## 1. Instale

No app **Terminal**, cole:

```sh
curl -fsSL https://muxor.com.br/install | bash
```

Ele instala o que faltar para o Muxor rodar (Homebrew e Node, com a sua confirmação), baixa o Muxor em `~/.muxor` e
cria o comando `muxor`. Em seguida abre a configuração guiada, o `muxor init`.

Prefere baixar à mão? `git clone https://github.com/JpRodrigues2/muxor.git`, `cd muxor`, `npm install` e `./muxor init`
(os comandos ficam `./muxor …`, de dentro da pasta).

## 2. O `muxor init`

Ele guia 12 passos e confere cada um de verdade. Se você parar no meio (Ctrl+C) ou algo falhar, rode `muxor init` de
novo: ele continua do passo que falta. O que dá para automatizar ele faz sozinho; o que precisa de você (senha do Mac,
logins, permissões) ele pede na hora, com o passo a passo.

| # | Passo | O que você faz | Tenha em mãos |
|---|---|---|---|
| 1 | Programas | Confirma a lista do que falta (GitHub CLI, Claude Code, Orca, Tailscale) e digita a senha do Mac para o Tailscale. O resto baixa em segundo plano enquanto você segue. Um QR code abre no celular a lista dos apps para instalar lá | A senha do Mac; o celular |
| 2 | Onde roda | Escolhe "Neste Mac" | — |
| 3 | Ferramentas de gestão | Marca as que usa e faz o login de cada uma | Funifier PM: login no navegador. Bnexo: endereço e token do MCP. Jira: endereço do site, e-mail e API token (a página de criar abre sozinha) |
| 4 | Espaços | Para cada conta do GitHub: nome, pasta, login no navegador (com um código de 8 letras), nome e e-mail dos commits, regras de trabalho. Se o GitHub perguntar "Authenticate Git with your GitHub credentials?", responda **N**: o Muxor já faz isso só para a pasta do espaço | As senhas do GitHub |
| 5 | Projetos que você já tem no Orca | Marca quais trazer para o Muxor. O que entra recebe tasks (o Muxor escreve inclusive nas sessões que já existem nessa pasta); o que fica de fora o Muxor nunca toca | — |
| 6 | Repositórios | Cola no seu Claude Code o pedido que o Muxor copiou e diz quais repositórios quer | — |
| 7 | Projetos → pastas | Para cada projeto das ferramentas, escolhe a pasta (ou cria uma sem repositório, ou deixa para depois) | — |
| 8 | Telegram | Cria um bot no BotFather, cola o token e manda /start para ele | O celular com o Telegram |
| 9 | Orca e celular | Opcional: pareia o celular pelo Relay (qualquer rede) | O celular com o app do Orca |
| 10 | Front-end no celular | Opcional: permite a VPN do Tailscale no Mac, entra numa conta e entra com a mesma no celular. O ngrok (link público, para mostrar a outra pessoa) é opcional: cria uma conta grátis e cola o Authtoken | O celular com o app do Tailscale |
| 11 | Serviço | Nada: o Muxor vira um serviço que sobe sozinho com o Mac | — |
| 12 | Teste | Acompanha uma task de teste no Orca e no Telegram | — |

**Os segredos** (tokens) são digitados em campos que não aparecem na tela e vão direto para `~/.muxor/dados/.env`
(só o seu usuário lê). Nunca mande token pelo Telegram nem por chat.

## 3. Use

No Telegram, no bot que você criou:
- `/tarefas`: as suas tasks, um projeto por mensagem. Toque no número (`/t1`, `/t2`…) para marcar e depois em ▶️ Iniciar.
- `/nova <instruções>`: uma atividade avulsa, sem ferramenta de gestão.
- `/menu`: os outros comandos (status, projetos, regras, limpar…).

Na primeira task de cada projeto, o Claude pergunta se confia na pasta: o Muxor avisa no Telegram, e você responde
"Yes" no Orca (no Mac ou no celular). Só uma vez por pasta.

## Importante no modo local

- **O Mac precisa ficar ligado e acordado** para as tasks rodarem. Em Ajustes → Bateria (ou Energia), evite que ele
  durma com a tampa aberta e carregador ligado.
- **O Orca precisa estar aberto.**
- Para conferir tudo a qualquer momento: `muxor diagnostico`.
- **Errou uma resposta?** Aperte **Esc** em qualquer pergunta: dá para voltar ao passo anterior, refazer o passo ou sair
  (o que já foi feito fica salvo). Rodando `muxor init` de novo, ele pergunta se você quer seguir ou voltar a um passo.

## Comandos do terminal

De qualquer pasta (quem baixou com `git clone` usa `./muxor`, de dentro da pasta):

| Comando | O que faz |
|---|---|
| `muxor init` | Configura (ou continua a configuração; dá para voltar a um passo anterior) |
| `muxor init --refazer <passo>` | Refaz a partir de um passo: `ferramentas`, `espacos`, `existentes`, `repositorios`, `depara`, `telegram`, `orca`, `front`, `servico`, `teste` |
| `muxor diagnostico` | Confere cada peça e diz o próximo passo de cada problema |
| `muxor adicionar github-workspace` | Mais um espaço (outra conta do GitHub) |
| `muxor adicionar projeto` | Traz para o Muxor projetos que já estão no Orca ou nas pastas dos espaços, e liga aos projetos das ferramentas |
| `muxor adicionar heartbeat` | Aviso se o Muxor cair ([heartbeat](heartbeat.md)) |
| `muxor update` | Baixa a versão nova do Muxor e reinicia o serviço |
| `muxor desinstalar` | Tira o Muxor do Mac ([desinstalar](desinstalar.md)) |
