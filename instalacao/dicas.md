# Dicas e dúvidas

## Primeiro passo para qualquer problema

`./muxor diagnostico` (na pasta do Muxor). Ele confere cada peça e diz o próximo passo de cada problema.
Com `--json`, a saída é para o seu Claude Code ler e ajudar.

## Perguntas comuns

**O Claude parou perguntando "Do you trust this folder?".**
Normal na primeira task de cada pasta. Responda "Yes" no Orca (Mac ou celular). Só uma vez por pasta.

**O Muxor disse "login necessário" no Funifier PM.**
Mande `/pm_login` no Telegram e siga o link. Se o navegador do Telegram não concluir, abra o link no Safari.

**As tasks não rodam.**
No modo local, o Mac precisa estar ligado e acordado, e o Orca aberto. Confira com `./muxor diagnostico`.

**Um projeto novo apareceu "sem ambiente".**
Ao iniciar a task, o Muxor pergunta pelo Telegram em qual pasta roda (ou cria uma).

**Quero mudar as regras de trabalho.**
`/regras` no Telegram: mostra o texto, você manda o novo inteiro. As regras vão em todo prompt do espaço.

**Já uso o Orca para outras coisas. O Muxor vai mexer nos meus projetos?**
Só nos que você trouxer para o Muxor (no `./muxor init` ou com `./muxor adicionar projeto`). Nesses, o Muxor manda tasks,
escreve nas sessões do Claude daquela pasta (inclusive as que você abriu) e marca o status da área de trabalho no
Orca. Os outros ele nunca toca. As configurações do Orca não mudam.

**Quero mais uma conta do GitHub.**
`./muxor adicionar github-workspace`. Depois traga os repositórios com o [prompt de clonar](prompts/clonar-repositorios.md).

**Gamificações da Funifier.**
Cadastre as credenciais pelo `/gamificacoes` no Telegram: a mensagem com a credencial é apagada na hora e a credencial
vai para o Keychain.

**O celular não conecta ao Orca fora de casa.**
Pareie de novo escolhendo **Relay** (qualquer rede) em vez de LAN (só a mesma Wi-Fi).

**Quero ver o que o Muxor está fazendo.**
Os logs ficam em `~/.muxor/dados/logs/` (`hub-<data>.log` e `servico.log`).

## Como o Muxor protege você

- Só a sua conversa no Telegram é atendida.
- Nas ferramentas de gestão, o Muxor só muda o status para "em progresso" (ao despachar) e "concluída" (com o seu Sim no
  Encerrar); nunca comenta nem põe em revisão sem você pedir.
- As sessões do Claude rodam com `--permission-mode auto`: o Claude pede aprovação para o que é arriscado.
- Commits e PRs saem pela conta do GitHub do espaço, sem menção a IA.
- Os segredos ficam em `~/.muxor/dados/.env` (só o seu usuário lê) e no Keychain; nunca passam pelo Telegram.
