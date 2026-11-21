# Configurar

Toda a configuração mora em `anti-rea.config.yml`. O assistente cria esse arquivo para você; esta
página explica cada parte. O exemplo completo está em [`examples/anti-rea.config.yml`](../examples/anti-rea.config.yml).

## O site

```yaml
upstream: http://localhost:3000   # onde o seu site real roda
upstreamTimeout: 60s              # quanto o site tem para começar a responder (de 1s a 10m)
domains:
  - seusite.com.br                # um porteiro pode cuidar de vários domínios, todos no mesmo upstream
trustProxy: false                 # true atrás de nginx, Traefik, EasyPanel ou Coolify; "cloudflare" atrás da Cloudflare
```

Na versão 0.1, todos os domínios de um porteiro vão para o mesmo `upstream`: serve para o mesmo site
com mais de um endereço (`seusite.com.br` e `www.seusite.com.br`, por exemplo). Sites diferentes, cada
um com o próprio endereço interno (como no EasyPanel, onde cada site é um serviço), pedem um porteiro
para cada site. Um `upstream` por domínio fica para a próxima versão.

O `trustProxy` diz de onde sai o IP de cada visitante:

- `false`: o IP da conexão. Certo quando nada fica na frente do porteiro.
- `true`: o último item do `X-Forwarded-For`, que o seu proxy (nginx, Traefik, EasyPanel, Coolify)
  acrescenta.
- `cloudflare`: o `CF-Connecting-IP`, que a Cloudflare manda.

O site recebe do porteiro o IP já resolvido em `X-Forwarded-For` e em `X-Real-IP`, mais
`X-Forwarded-Proto` e `X-Forwarded-Host`, todos escritos por ele. Os cabeçalhos de IP e de endereço
que o visitante mandar (`X-Real-IP`, `True-Client-IP`, `X-Client-IP`, `Client-IP`,
`X-Cluster-Client-IP`, `Fastly-Client-IP`, `X-Originating-IP`, `X-Remote-IP`, `X-Remote-Addr`,
`X-Forwarded`, `Forwarded-For`, `X-Forwarded-Port`, `X-Forwarded-Prefix`, `X-Forwarded-Server`,
`X-Original-URL`, `X-Rewrite-URL` e `Forwarded`) não chegam ao site. O `CF-Connecting-IP` só segue com `trustProxy: cloudflare`.

Com `true` ou `cloudflare`, a porta do porteiro só pode ser alcançada pelo proxy, e com a Cloudflare o
servidor só aceita conexões dos endereços dela. Se não, qualquer um escolhe o próprio IP com um
cabeçalho. Veja [Instalar](02-instalar.md#último-passo-apontar-o-domínio-para-o-porteiro).

Na dúvida, o porteiro deixa passar: pedido sem passe vindo de IP interno (`10.x`, `172.16.x` a
`172.31.x`, `192.168.x`, `127.x`, `169.254.x` e os equivalentes em IPv6) nunca conta para o
[ritmo de navegação](#ritmo-de-navegação), e robô oficial vindo de IP interno não é conferido: passa
e fica registrado como "robô não confirmado".
Quando chega um pedido de IP interno com `X-Forwarded-For` e o `trustProxy` está `false`, o porteiro
escreve uma vez no log `pedido de IP interno com X-Forwarded-For: ligue trustProxy`.

### Site fora do ar ou lento

Se o site estiver fora do ar, o visitante recebe a página "Site temporariamente indisponível" (com
o código 502). Se o site aceitar o pedido e não começar a responder no `upstreamTimeout` (60 s por
padrão), o visitante recebe a mesma página, com o código 504. O prazo vale também para caminho isento
e conta até o site começar a responder: uma conexão que já começou (SSE, download longo) não é
cortada, e um envio que ainda está chegando renova o prazo. Se o site tem uma página que leva mais
que isso para começar (um relatório pesado, a conversão de um vídeo enviado, uma chamada lenta a
outro serviço), aumente o `upstreamTimeout` até 10m. O envio em si (o arquivo subindo) tem até 5 min
para chegar inteiro; passado isso, o Node corta com 408. Nos dois casos o porteiro escreve uma linha no
log, no máximo uma por minuto:

```
[anti-rea] falha no site http://localhost:3000: ECONNREFUSED. O visitante recebeu a página de indisponível (no máximo uma linha destas por minuto).
```

### Página comprimida

A página HTML que o site manda comprimida (gzip, deflate ou br) chega comprimida ao visitante: o
porteiro abre a página, põe a guarda e comprime de novo do mesmo jeito (o br com qualidade 4),
pedaço por pedaço, sem esperar a página inteira. O `Content-Encoding` e o `Vary` do site ficam como
vieram.

## A verificação da primeira visita

```yaml
check:
  firstVisit: true        # mostra o "verificando" de menos de 1 s na primeira visita
  devtoolsIsCaught: true  # quem abre o F12 cai na sombra
  passDuration: 7d        # por quanto tempo o visitante verificado navega livre
```

A tela de verificação leva a prévia da página (título, descrição e imagem), que o porteiro busca no
site. Ela nunca espera o site por mais de 0,3 s: se a busca demorar, a tela sai sem a prévia e a
busca termina em segundo plano, para o próximo pedido. Robô de prévia de link conhecido (WhatsApp,
Telegram e os outros de [Robôs oficiais](08-robos-oficiais.md#prévias-e-duckduckgo)) espera até 5 s,
porque é a prévia que ele veio buscar. O leitor de link que não pede HTML (o gerador de prévia de um
sistema que manda mensagens, por exemplo) também espera até 5 s: navegador sempre pede HTML. A prévia fica guardada por 10 minutos em cada caminho; a busca
que falha (site fora do ar, erro 5xx ou mais de 5 s) fica guardada só 30 s.

O passe se renova sozinho: passada a metade do `passDuration`, a próxima resposta do site que não é
erro (200, 204, 304 ou redirecionamento: uma página, um pedido de dados ou o índice de um app de
página única que volta 304; imagens, fontes, vídeo e áudio não contam) leva um passe novo, com a duração inteira.
Quem usa o site pelo menos uma vez a cada metade do prazo nunca volta para a verificação.

Desligar `firstVisit` deixa o site abrir direto, mas o robô recebe o código antes de ser pego.
Só desligue se souber o que está trocando. Com `firstVisit: false`, toda página aberta pelo
navegador (resposta que não é erro) entrega um passe, mesmo com `devtoolsIsCaught: false`: é ele que deixa o
WebSocket do site conectar.

Sem passe, só a navegação (o navegador pedindo uma página, com `Accept` de HTML) recebe a tela de
verificação. Leitor de prévia que não está na [lista de robôs](08-robos-oficiais.md#prévias-e-duckduckgo)
e não diz o formato (sem `Accept` ou com o curinga `*/*`) também recebe a tela, com a prévia, quando o
caminho não tem extensão de arquivo. Arquivo (`/app.js`) e outro formato (`application/json`) sem passe levam 403.

Numa aba aberta há dias o passe pode vencer. Aí o `fetch` do app a um caminho sem extensão, sem dizer
o formato (o `Accept` padrão do `fetch` é `*/*`), recebe a tela de verificação com 200, como o leitor
de prévia. É de propósito: o service worker de um PWA busca a página do mesmo jeito, e com 403 a pessoa
ficaria trancada, porque toda recarga passa de novo por ele. Para o app receber erro (403) no lugar da
tela, mande `Accept: application/json` nas chamadas de API; ao receber 403 ou uma resposta que não é
JSON, recarregue a página, que passa pela verificação em menos de 1 s.

Quem é pego vê a página sombra por 1 hora naquele navegador. Nesse tempo, o pedido feito por script
(o envio de dados de outra aba aberta: `Sec-Fetch-Dest: empty`) leva 403, sem a sombra: com a sombra
em 200, o app tomaria a página por resposta e daria o envio por feito. A navegação que o service
worker refaz (`Sec-Fetch-Mode: navigate`) continua na sombra. Sem esses cabeçalhos, de navegador
antigo, conta o método: POST, PUT, PATCH e DELETE.

### Ritmo de navegação

Mais de 30 navegações em 10 s com o mesmo passe vão à página sombra, como "navegação rápida demais"
(com aviso). Conta só a navegação que receberia o site:

- com passe, pelo passe: muita gente atrás do mesmo IP (escritório, operadora de celular, Wi-Fi de
  evento) nunca soma;
- sem passe, só com `firstVisit: false`, pelo IP (IP interno fica de fora). Com a verificação ligada,
  quem não tem passe só recebe a tela de verificação e não conta;
- pré-carga e pré-renderização (o navegador busca a página antes de você clicar: `Sec-Purpose`,
  `Purpose`, `X-Purpose`, `X-Sec-Purpose` ou `X-Moz` com `prefetch`, `prerender` ou `preview`), página
  aberta dentro de um `iframe` e, em HTTPS, pedido feito por script da própria página (`fetch`, Turbo
  Frames, htmx: o navegador manda `Sec-Fetch-Dest` diferente de `document`) não contam. Em HTTP sem
  nada na frente o navegador não manda esse cabeçalho, e o pedido de script que aceita HTML conta.

Um copiador que finge pré-carga ou pedido de script, ou troca de passe a cada pedido, escapa desse
limite, mas não da verificação nem da guarda.

Os cookies do porteiro (o passe, o passe de dono e a marca de quem foi pego) saem com
`SameSite=None; Secure` quando o pedido chega por HTTPS (direto ou pelo `X-Forwarded-Proto` do proxy
confiável, conforme `trustProxy`). Assim o retorno de um pagamento ou de um login que volta por POST
de outro site chega com o passe. Em HTTP simples eles ficam `SameSite=Lax`.

## Arquivos trancados

Alguns arquivos nunca saem do porteiro, para ninguém: nem para quem tem passe, nem em caminho
isento, nem em caminho público. Quem pede recebe a página sombra com 404 e o site nunca recebe o
pedido. Não há opção para destrancar.

Em qualquer pasta:

- mapas de código: tudo que termina em `.map`;
- pastas e arquivos com estes nomes: `.env`, `.envrc`, `.git`, `.svn`, `.hg`, `.DS_Store`,
  `.htaccess`, `.htpasswd`, `.npmrc`, `.git-credentials`, `.ssh` e `.aws`;
- nomes que começam com `.env.` ou `wp-config.php.`, ou seja, `.env.*` e `wp-config.php.*` (por
  exemplo `.env.local`, `.env.production`, `wp-config.php.bak`);
- arquivos que terminam em `.bak`, `.old`, `.orig`, `.save`, `~`, `.swp`, `.swo`, `.sql` ou `.sql.gz`;
- arquivos compactados (`.zip`, `.tar`, `.tar.gz`, `.tgz`, `.gz`, `.7z` ou `.rar`) com nome que
  começa por `backup` ou `bkp` (por exemplo `/uploads/backup-2026.zip`).

Só na raiz do site: os compactados chamados `site`, `www`, `web`, `html`, `public_html`, `htdocs`,
`wwwroot`, `db`, `database` ou `dump` (por exemplo `/site.zip` e `/www.tar.gz`; `/downloads/site.zip`
passa).

Mapa de código pedido é sempre tentativa de cópia, com aviso. Os segredos (`.env`, `.git`,
configuração e chaves, e também a cópia deles, como `.env~` e `.htpasswd.bak`), pedidos por quem já
passou pela verificação, também. As outras cópias e backups (os sufixos e os compactados) ficam como
varredura, só no registro, mesmo com passe: podem ser um download do próprio site. Pedidos por robô
da internet sem passe também ficam como varredura. Com o [passe de dono](07-modo-dono.md) o arquivo
continua trancado, mas sai um 404 simples, sem registro e sem aviso: é o F12 do dono buscando os
mapas de código sozinho.

Se o seu site serve de propósito um arquivo com um desses nomes (um `backup.zip` para download, por
exemplo), troque o nome: não há como isentar.

Tudo sob `/.anti-rea/` também é do porteiro: o que não é rota dele recebe 404 e nunca chega ao site.

## Caminhos isentos

Caminhos chamados por máquinas, não por pessoas. Eles nunca passam pela verificação.

```yaml
exempt:
  - /api/webhook/*     # webhook de pagamento
  - /api/mobile/*      # app de celular
  - /health            # monitor de uptime
```

Os [arquivos trancados](#arquivos-trancados) continuam trancados mesmo em caminho isento.
O caminho isento precisa casar como chega, letra por letra: `/api%2Fwebhook/x`, `//api/webhook/x`
e `/api/webhook;x/y` não contam como `/api/webhook/*`. Caminho com `.` ou `..` em qualquer forma
(`/../`, `%2e%2e`, `..;`, barra invertida) recebe 400 antes de qualquer outra regra, porque o site
poderia ler outro arquivo que não o conferido. Navegador nunca manda caminho assim.

Link de uso único com o código no próprio caminho (por exemplo `/login/magico/<código>`) deve
entrar em `exempt`: a tela de verificação busca a prévia do caminho no site e gastaria o código.
Código na query (`?token=...`) não corre esse risco, porque a prévia é buscada sem a query.

Padrão com `?` também confere a query, pelo começo dela: `/?wc-api=*` isenta `/?wc-api=WC_Gateway`
(e `/?wc-api=WC_Gateway&x=1`), mas não `/?x=1&wc-api=WC_Gateway` nem `/loja?wc-api=WC_Gateway`. O
caminho antes do `?` segue as mesmas regras de cima.

## WordPress, feeds e CDN

Alguns pedidos de máquina chegam sem cookie e sem rodar JavaScript. Sem isenção eles levam 403 (ou a
tela de verificação), e o site perde coisas que dependem deles.

**WordPress.** O próprio WordPress chama o site por HTTP para rodar as tarefas agendadas (post
agendado, e-mail, backup), e o WooCommerce recebe por HTTP o aviso de pagamento. Isente:

```yaml
exempt:
  - /wp-cron.php                   # tarefas agendadas (WP-Cron)
  - /wp-json/*                     # API REST: Saúde do Site, editor, apps e integrações
  - /wp-admin/admin-ajax.php       # fila do Action Scheduler (WooCommerce e outros plugins)
  - /wc-api/*                      # aviso de pagamento do WooCommerce, forma /wc-api/<nome>
  - /?wc-api=*                     # o mesmo aviso, forma /?wc-api=<nome>
  - /feed/*                        # feed do blog (/feed/, /feed/atom/)
```

Prefira configurar o meio de pagamento (Mercado Pago, PagSeguro e afins) para avisar em
`/wc-api/<nome>`, que é um caminho só dele. A forma `/?wc-api=` também funciona com o padrão acima.
Sem isenção, o aviso de pagamento é recusado e o pedido pago fica como não pago.

**Feeds.** `rss.xml`, `feed.xml` e `atom.xml` (em qualquer pasta) e qualquer arquivo `.rss` ou
`.atom` já são [públicos](#caminhos-públicos-padrão). O feed do WordPress (`/feed/`) não tem extensão
e precisa entrar em `exempt`, como acima.

**CDN de origem (pull zone).** Se uma CDN (BunnyCDN, KeyCDN, CloudFront) busca os arquivos no seu site
para guardar e servir, ela chega sem passe e leva 403, e a página sai sem CSS e sem JavaScript. Isente
as pastas que ela busca: `/wp-content/*` e `/wp-includes/*` no WordPress, `/_next/static/*` no
Next.js. Saiba o que está trocando: esses arquivos passam a sair para qualquer um, pela CDN e pelo
porteiro. A proteção do código fica só nas páginas, que continuam com verificação e guarda. A
Cloudflare na frente do porteiro não tem esse problema: ela repassa o pedido do visitante, com o
passe dele.

## Caminhos públicos padrão

Alguns arquivos o navegador e as integrações pedem sem cookie, e nenhum deles tem código de valor.
Eles passam sem passe, sem verificação e sem registro, sem precisar entrar em `exempt`:

- `/robots.txt`, `/sitemap.xml` e qualquer `/sitemap*.xml` na raiz (por exemplo `/sitemap-produtos.xml`)
- `/ads.txt` e `/app-ads.txt`
- `/favicon.ico`, `/manifest.json` e qualquer arquivo terminado em `.webmanifest` (manifesto do PWA)
- tudo sob `/.well-known/` (links de app, OAuth, `security.txt`)
- feeds: `rss.xml`, `feed.xml` e `atom.xml` em qualquer pasta, e qualquer arquivo `.rss` ou `.atom`

Como nos isentos, o caminho precisa casar como chega: `/blog/sitemap.xml` ou `//robots.txt` não
contam, e `/.well-known/../app.js` recebe 400. Arquivo trancado continua trancado também aqui
(`/robots.txt.bak`, `/.well-known/app.js.map`).

Também passa sem passe e sem registro o pré-voo CORS (`OPTIONS` com o cabeçalho
`Access-Control-Request-Method`): o navegador nunca manda cookie nele, e é o site que decide se aceita
a outra origem. Da resposta do site, o porteiro repassa só o status e os cabeçalhos, nunca o corpo: o
navegador não usa o corpo do pré-voo, e um site que responde `OPTIONS` com a página inteira a
entregaria a quem não roda JavaScript. Ferramenta conhecida (curl, wget e afins) cai na sombra também
no pré-voo. Um `OPTIONS` sem esse cabeçalho segue as regras comuns.

## WebSocket

O porteiro só repassa upgrade para WebSocket, e só com passe válido ou em caminho isento. Qualquer
outro upgrade (como `h2c`) recebe 400 e fica registrado como varredura: ele abriria um túnel direto
até o site, por fora do porteiro. Upgrade para um [arquivo trancado](#arquivos-trancados) ou para
`/.anti-rea/` recebe 404 e nunca chega ao site.

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

Cada tentativa guarda o IP, o domínio, o endereço pedido, o agente, o motivo e o destino. O endereço
vai com a query sem os valores: `/entrar?token=abc123&email=a%40b.com` fica
`/entrar?token=...&email=...`, para código de login, token de troca de senha e e-mail não irem para o
disco nem para o aviso. Os nomes ficam, e valor vazio ou nome sem valor ficam como vieram.

A pasta que o porteiro cria para o registro sai `0700` e cada arquivo do dia sai `0600`: só o usuário
que roda o porteiro lê. Uma pasta que já existia (como a `registro` montada no Docker) fica com as
permissões que tem; para fechar, `sudo chmod 700 registro`.

O registro grava no máximo 50000 tentativas por dia. Numa varredura em massa, passado esse teto,
o porteiro só conta as tentativas do resto do dia, sem gravar no disco, e escreve uma única linha
no log do contêiner:

```
[anti-rea] registro: limite de 50000 eventos atingido em AAAA-MM-DD; o resto do dia só conta.
```

Assim um ataque não enche o disco do servidor, que costuma hospedar outros sites.
