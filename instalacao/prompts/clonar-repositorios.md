# Prompt: clonar os repositórios de cada espaço

O `muxor init` copia este pedido para a área de transferência, já com os seus espaços. Você cola no Claude Code
(rodando `claude` numa janela nova do Terminal) e diz quais repositórios quer. Também dá para usar depois, para
trazer mais repositórios.

<!-- prompt -->
Quero clonar repositórios do GitHub para usar com o Muxor. Cada pasta abaixo é um "espaço" ligado a uma conta
do GitHub, e o git dentro dela já está configurado com a conta certa (nome, e-mail e credencial):

{{ESPACOS}}

Para cada repositório que eu pedir:
1. Confirme em qual espaço ele vai (pergunte se eu não disser).
2. Clone por HTTPS dentro da pasta do espaço: `git clone https://github.com/<dono>/<repo>.git` rodado dentro da pasta.
   Não use SSH e não mude nenhuma configuração do git, global ou do repositório.
3. Se o clone pedir login, pare e me avise: é sinal de que a conta do espaço não tem acesso ao repositório.
4. No fim, liste o que ficou em cada pasta.

Se eu não souber o nome exato, mostre as opções com `GH_CONFIG_DIR=<login do espaço> gh repo list <dono> --limit 100`
(o login de cada espaço está na lista acima). Não faça mais nada além de clonar.
