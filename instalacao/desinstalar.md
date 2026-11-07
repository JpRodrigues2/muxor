# Desinstalar

```sh
muxor desinstalar
```

Ou, se o comando `muxor` não existir mais: `curl -fsSL https://muxor.com.br/uninstall | bash`.

Ele mostra exatamente o que vai desfazer e pede confirmação. Desfaz só o que o `muxor init` fez:

| O que | Como |
|---|---|
| O serviço do Muxor | Para e apaga o LaunchAgent |
| As linhas do Muxor no `~/.gitconfig` | Tira só as linhas `includeIf` que o Muxor pôs (as suas ficam) |
| As credenciais que você cadastrou pelo Telegram | Apaga os itens do Muxor no Keychain |
| `~/.muxor` | O Muxor, a configuração, o banco, os logs e os logins do GitHub que eram só do Muxor |
| O comando `muxor` | Apaga `~/.local/bin/muxor` e as linhas que o instalador pôs no `~/.zprofile` |
| Os programas que o Muxor instalou | Pergunta um por um (GitHub CLI, Claude Code, Orca, Tailscale, ngrok, Node). Diga não para o que você passou a usar. O Homebrew fica: outros programas podem depender dele |
| As pastas que o Muxor criou | Pergunta uma por uma (podem ter repositórios clonados) |

**Não mexe no que você já tinha** antes do Muxor: programas, contas e configurações.

**Fica com você** (o desinstalar lembra no fim):
- Apagar o bot no BotFather (`/deletebot`).
- Tirar do Orca os projetos que o Muxor abriu (botão direito → Remove) e o celular pareado, se quiser.
- Revogar o "GitHub CLI" em github.com/settings/applications, se quiser.
- Quem baixou com `git clone`: apagar a pasta do código.

## Testar num computador emprestado

Para não misturar nada com o que o dono do computador usa, o melhor é **uma conta de usuário nova no macOS**
(Ajustes → Usuários e Grupos → Adicionar usuário): ela começa sem `~/.claude`, `~/.gitconfig`, Keychain nem
configuração do Orca, e os programas instalados (Orca, Node) continuam disponíveis. No fim, apague a conta.

Se não der para criar uma conta, use a conta do dono e rode `muxor desinstalar` no fim: ele desfaz o que o Muxor fez,
sem tocar no Claude Code nem nas contas dele. Rode `muxor desinstalar` também entre uma tentativa e outra, para testar
de novo do zero.
