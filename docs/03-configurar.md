# Configurar

Toda a configuração mora em `anti-rea.config.yml`. O assistente cria esse arquivo para você; esta
página explica cada parte. O exemplo completo está em [`examples/anti-rea.config.yml`](../examples/anti-rea.config.yml).

## O site

```yaml
upstream: http://localhost:3000   # onde o seu site real roda
domains:
  - seusite.com.br                # um porteiro pode cuidar de vários domínios
trustProxy: false                 # true se tiver nginx/Traefik na frente; "cloudflare" se usar Cloudflare
```

## A verificação da primeira visita

```yaml
check:
  firstVisit: true        # mostra o "verificando" de menos de 1 s na primeira visita
  devtoolsIsCaught: true  # quem abre o F12 cai na sombra
  passDuration: 7d        # por quanto tempo o visitante verificado navega livre
```

Desligar `firstVisit` deixa o site abrir direto, mas o robô recebe o código antes de ser pego.
Só desligue se souber o que está trocando.

## Caminhos isentos

Caminhos chamados por máquinas, não por pessoas. Eles nunca passam pela verificação.

```yaml
exempt:
  - /api/webhook/*     # webhook de pagamento
  - /api/mobile/*      # app de celular
  - /health            # monitor de uptime
```

Os arquivos trancados (`.env`, `.git`, mapas de código) continuam trancados mesmo em caminho isento.
O caminho isento precisa casar como chega, letra por letra: `/api%2Fwebhook/x`, `//api/webhook/x`
e `/api/webhook;x/y` não contam como `/api/webhook/*`. Caminho com `.` ou `..` em qualquer forma
(`/../`, `%2e%2e`, `..;`, barra invertida) recebe 400 antes de qualquer outra regra, porque o site
poderia ler outro arquivo que não o conferido. Navegador nunca manda caminho assim.

Link de uso único com o código no próprio caminho (por exemplo `/login/magico/<código>`) deve
entrar em `exempt`: a tela de verificação busca a prévia do caminho no site e gastaria o código.
Código na query (`?token=...`) não corre esse risco, porque a prévia é buscada sem a query.

## Página sombra

```yaml
shadow:
  language: pt-BR
  title: "Ops. Pegamos você."
  message: "Belo esforço com o seu robô. O código que você queria não mora aqui."
```

Mais opções em [Página sombra](04-pagina-sombra.md).

## Avisos

```yaml
alerts:
  channels: [whatsapp]     # whatsapp, telegram, webhook (pode usar mais de um)
  groupByIp: 1h            # junta tentativas do mesmo IP num aviso só
  scans: panel             # varredura genérica: panel, dailySummary ou alert
```

As senhas de cada canal vão no `.env`. Veja [Avisos](05-avisos.md).

## Registro

```yaml
log:
  retention: 30d           # apaga tentativas mais velhas que isso (LGPD)
```

O registro grava no máximo 50000 tentativas por dia. Numa varredura em massa, passado esse teto,
o porteiro só conta as tentativas do resto do dia, sem gravar no disco, e escreve uma única linha
no log do contêiner:

```
[anti-rea] registro: limite de 50000 eventos atingido em AAAA-MM-DD; o resto do dia so conta.
```

Assim um ataque não enche o disco do servidor, que costuma hospedar outros sites.
