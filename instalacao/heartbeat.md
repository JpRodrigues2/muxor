# Heartbeat: aviso se o Muxor cair (opcional)

A cada 5 minutos o Muxor avisa um serviço externo, o [Healthchecks.io](https://healthchecks.io), que está vivo. Se os
avisos param (o Mac desligou, o Muxor travou), o Healthchecks avisa você por e-mail ou Telegram. Se o Orca cair com o
hub de pé, o aviso também chega.

1. Crie uma conta grátis em healthchecks.io.
2. **Add Check**, nome `hub`. Em Schedule, **Simple**: Period **5 minutes**, Grace time **10 minutes**.
3. Em **Integrations**, ligue o Telegram (Add Integration → Telegram) e/ou o e-mail.
4. Copie o **Ping URL** do check: aparece na lista de checks e na página do check, em "How To Ping"
   (`https://hc-ping.com/<código>`). Não mande esse endereço por chat: quem tem o endereço manda avisos falsos.
5. No Terminal, na pasta do Muxor: `./muxor adicionar heartbeat` e cole o endereço.

Pronto: o "Hub online" no Telegram passa a dizer "heartbeat ligado", e o check fica verde em segundos.

No modo servidor: ponha `HUB_HEARTBEAT_URL=https://hc-ping.com/<código>` no `/home/hub/dados/.env` e reinicie
(`sudo systemctl restart hub.service`).
