# Configurar

Toda a configuração mora em `anti-rea.config.yml`. O assistente cria esse arquivo para você; esta
página explica cada parte. O exemplo completo está em [`examples/anti-rea.config.yml`](../examples/anti-rea.config.yml).

## O site

```yaml
upstream: http://localhost:3000   # onde o seu site real roda
domains:
  - seusite.com.br                # um porteiro pode cuidar de vários domínios
trustProxy: false                 # true atrás de nginx, Traefik, EasyPanel ou Coolify; "cloudflare" atrás da Cloudflare
```

O `trustProxy` diz de onde sai o IP de cada visitante:

- `false`: o IP da conexão. Certo quando nada fica na frente do porteiro.
- `true`: o último item do `X-Forwarded-For`, que o seu proxy (nginx, Traefik, EasyPanel, Coolify)
  acrescenta.
- `cloudflare`: o `CF-Connecting-IP`, que a Cloudflare manda.

Com `true` ou `cloudflare`, a porta do porteiro só pode ser alcançada pelo proxy, e com a Cloudflare o
servidor só aceita conexões dos endereços dela. Se não, qualquer um escolhe o próprio IP com um
cabeçalho. Veja [Instalar](02-instalar.md#último-passo-apontar-o-domínio-para-o-porteiro).

Na dúvida, o porteiro deixa passar: pedido de IP interno (`10.x`, `172.16.x` a `172.31.x`,
`192.168.x`, `127.x`, `169.254.x` e os equivalentes em IPv6) nunca conta para o ritmo de navegação, e
robô oficial vindo de IP interno não é conferido: passa e fica registrado como "robô não confirmado".
Quando chega um pedido de IP interno com `X-Forwarded-For` e o `trustProxy` está `false`, o porteiro
escreve uma vez no log `pedido de IP interno com X-Forwarded-For: ligue trustProxy`.

## A verificação da primeira visita

```yaml
check:
  firstVisit: true        # mostra o "verificando" de menos de 1 s na primeira visita
  devtoolsIsCaught: true  # quem abre o F12 cai na sombra
  passDuration: 7d        # por quanto tempo o visitante verificado navega livre
```

Desligar `firstVisit` deixa o site abrir direto, mas o robô recebe o código antes de ser pego.
Só desligue se souber o que está trocando. Com `firstVisit: false`, toda página aberta pelo
navegador (resposta 200) entrega um passe, mesmo com `devtoolsIsCaught: false`: é ele que deixa o
WebSocket do site conectar.

Os cookies do porteiro (o passe, o passe de dono e a marca de quem foi pego) saem com
`SameSite=None; Secure` quando o pedido chega por HTTPS (direto ou pelo `X-Forwarded-Proto` do proxy
confiável, conforme `trustProxy`). Assim o retorno de um pagamento ou de um login que volta por POST
de outro site chega com o passe. Em HTTP simples eles ficam `SameSite=Lax`.

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

## Caminhos públicos padrão

Alguns arquivos o navegador e as integrações pedem sem cookie, e nenhum deles tem código de valor.
Eles passam sem passe, sem verificação e sem registro, sem precisar entrar em `exempt`:

- `/robots.txt`, `/sitemap.xml` e qualquer `/sitemap*.xml` na raiz (por exemplo `/sitemap-produtos.xml`)
- `/ads.txt` e `/app-ads.txt`
- `/favicon.ico`, `/manifest.json` e qualquer arquivo terminado em `.webmanifest` (manifesto do PWA)
- tudo sob `/.well-known/` (links de app, OAuth, `security.txt`)

Como nos isentos, o caminho precisa casar como chega: `/blog/sitemap.xml` ou `//robots.txt` não
contam, e `/.well-known/../app.js` recebe 400. Arquivo trancado continua trancado também aqui
(`/robots.txt.bak`, `/.well-known/app.js.map`).

Também passa sem passe e sem registro o pré-voo CORS (`OPTIONS` com o cabeçalho
`Access-Control-Request-Method`): o navegador nunca manda cookie nele, e é o site que decide se aceita
a outra origem. Um `OPTIONS` sem esse cabeçalho segue as regras comuns.

## WebSocket

O porteiro só repassa upgrade para WebSocket, e só com passe válido ou em caminho isento. Qualquer
outro upgrade (como `h2c`) recebe 400 e fica registrado como varredura: ele abriria um túnel direto
até o site, por fora do porteiro.

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
