<div align="center">

<img src="assets/banner.svg" alt="ANTI-REA: quem tenta copiar seu site leva só a sombra" width="100%">

<br>

[![Versão 0.1.3](https://img.shields.io/badge/vers%C3%A3o-0.1.3-FFC24B?style=for-the-badge)](#trajeto-e-versões)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-7C6CFF?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](#instalar-em-3-passos)
[![PRs bem-vindos](https://img.shields.io/badge/PRs-bem--vindos-3BE8A8?style=for-the-badge)](CONTRIBUTING.md)

**[Documentação](docs/README.md)** · **[Instalar](#instalar-em-3-passos)** · **[Perguntas frequentes](docs/perguntas-frequentes.md)** · **[English](README.en.md)**

</div>

<br>

> [!NOTE]
> **Versão 0.1.3: o porteiro funciona, roda em produção e está no npm. O exame do próprio site e o painel vêm a seguir.**
> Veja o [trajeto e as versões](#trajeto-e-versões) e o [roteiro](#roteiro). Nada aqui promete o que ainda não roda.

## Em uma frase

O ANTI-REA é um **porteiro** que fica na frente do seu site. Gente de verdade entra normal. Quem chega
com ferramenta de engenharia reversa, robô copiador ou varredura de ataque cai numa **página sombra**
com uma mensagem sarcástica, no mesmo endereço. E você recebe um **aviso no celular** na hora.

Funciona com qualquer site: Next.js, WordPress, Laravel, HTML simples ou o que você tiver. Não precisa
mexer em uma linha do seu código; o WordPress só pede alguns caminhos isentos (veja
[Configurar](docs/03-configurar.md#wordpress-feeds-e-cdn)).

## O que ele faz

<table>
<tr>
<td width="33%" valign="top">
<img src="assets/icones/porteiro.svg" width="48" alt=""><br>
<b>Porteiro na frente do site</b><br>
Confere cada visitante antes de deixar entrar. Em menos de um segundo, só na primeira visita.
</td>
<td width="33%" valign="top">
<img src="assets/icones/sombra.svg" width="48" alt=""><br>
<b>Página sombra</b><br>
Robô copiador, navegador automatizado e quem abre o F12 veem só a mensagem sarcástica. Com a
configuração padrão, o REA ligado a uma aba visível também cai: a guarda confere a cada 0,5 s (até
uns 0,6 s numa página muito ocupada; num aparelho muito lento, ela recua para 1 s e depois 1,5 s). A
inspeção curta dele caiu 20 de 20 vezes, mas em 2 já tinha lido a página
(<a href="docs/perguntas-frequentes.md">o que ele ainda leva</a>).
</td>
<td width="33%" valign="top">
<img src="assets/icones/aviso.svg" width="48" alt=""><br>
<b>Aviso na hora</b><br>
WhatsApp, Telegram ou webhook, com IP, página, motivo, agente e horário. Tentativas repetidas vêm
agrupadas.
</td>
</tr>
<tr>
<td width="33%" valign="top">
<img src="assets/icones/bloqueio.svg" width="48" alt=""><br>
<b>Arquivos sensíveis trancados</b><br>
Ficam bloqueados para todo mundo, em qualquer pasta: mapas de código (<code>.map</code>);
<code>.env</code>, <code>.env.*</code> e <code>.envrc</code>; <code>.git</code>, <code>.svn</code>,
<code>.hg</code> e <code>.DS_Store</code>; <code>.htaccess</code>, <code>.htpasswd</code>,
<code>.npmrc</code>, <code>.git-credentials</code>, <code>.ssh</code>, <code>.aws</code> e
<code>wp-config.php.*</code>; arquivos terminados em <code>.bak</code>, <code>.old</code>,
<code>.orig</code>, <code>.save</code>, <code>~</code>, <code>.swp</code>, <code>.swo</code>,
<code>.sql</code> e <code>.sql.gz</code>; compactados (<code>.zip</code>, <code>.tar</code>,
<code>.tar.gz</code>, <code>.tgz</code>, <code>.gz</code>, <code>.7z</code>, <code>.rar</code>) com nome
que começa por <code>backup</code> ou <code>bkp</code> e, na raiz, os chamados <code>site</code>,
<code>www</code>, <code>web</code>, <code>html</code>, <code>public_html</code>, <code>htdocs</code>,
<code>wwwroot</code>, <code>db</code>, <code>database</code> ou <code>dump</code>
(<a href="docs/03-configurar.md#arquivos-trancados">detalhes</a>).
</td>
<td width="33%" valign="top">
<img src="assets/icones/exame.svg" width="48" alt=""><br>
<b>Exame do seu site</b><br>
Vai mostrar o que um curioso consegue ver do seu site antes que alguém de fora descubra. Vem a seguir.
</td>
<td width="33%" valign="top">
<img src="assets/icones/painel.svg" width="48" alt=""><br>
<b>Painel de registro</b><br>
Hoje as tentativas ficam num registro (JSONL) na sua máquina. A tela para ler esse registro vem a
seguir.
</td>
</tr>
</table>

## Como funciona

<img src="assets/diagramas/como-funciona.svg" alt="Diagrama: visitantes passam pelo porteiro; pessoa verificada e robôs oficiais (Google, Bing, Meta) vão ao site real; robô de prévia de link recebe a tela de verificação, com título, descrição e imagem; REA, robô copiador, F12 e varredura vão para a página sombra e geram aviso" width="100%">

1. **Todo visitante passa pelo porteiro.** Ele olha quem está pedindo e o que está pedindo.
2. **Na primeira visita, o navegador é verificado** por menos de um segundo. Quem passa ganha um
   passe e navega livre por dias.
3. **Robôs oficiais** (Google, Bing, Apple e Meta) são confirmados pelo endereço oficial deles e
   passam direto. Seu anúncio e sua busca continuam funcionando. Robôs de prévia de link (WhatsApp,
   Telegram e outros) recebem a tela de verificação, que já leva o título, a descrição e a imagem
   do site.
4. **Quem é pego** recebe a página sombra no mesmo endereço, sem redirecionar. Você recebe o aviso.

Quer entender cada parte com calma? Leia [O que é o ANTI-REA](docs/01-o-que-e.md).

## O que dá para proteger (a verdade, sem enfeite)

<img src="assets/diagramas/o-que-protege.svg" alt="Diagrama: no navegador ficam JavaScript, mapas de código, chamadas de API e arquivos esquecidos; no servidor ficam regras, banco, senhas e integrações" width="100%">

A lógica que roda no servidor nunca vai para o navegador. Ferramentas como o REA só alcançam o que o
site entrega para a tela. O ANTI-REA **barra quem tenta analisar** essa parte, e o **exame** (que vem a
seguir) vai avisar se algo do servidor vazou para ela.

> [!IMPORTANT]
> Nenhuma ferramenta impede 100% a cópia do que o navegador recebe. Uma pessoa paciente, com um
> navegador comum, sempre consegue salvar o que a página mostra. O ANTI-REA **encarece, denuncia e
> engana** quem tenta. Ele não deixa seu site invisível, e desconfie de quem prometer isso.

## Instalar em 3 passos

<img src="assets/telas/assistente.svg" alt="Terminal com o assistente de instalação perguntando endereço do site, domínio, o que fica na frente do porteiro, canal de aviso e caminhos isentos" width="100%">

> [!NOTE]
> O ANTI-REA está no npm ([`@jeipidevs/anti-rea`](https://www.npmjs.com/package/@jeipidevs/anti-rea)) e no GHCR
> (`ghcr.io/jeipidevs/anti-rea`). Escolha um dos dois: Node.js 22 ou mais novo, ou Docker.

**1. Rode o assistente** na pasta onde a configuração vai morar. Ele pergunta o endereço do seu site,
o que fica na frente dele e onde você quer os avisos, e escreve a configuração sozinho.

```bash
npx @jeipidevs/anti-rea init
```

**2. Ligue o porteiro.**

```bash
npx @jeipidevs/anti-rea start
```

Para deixar instalado na máquina, use `npm install -g @jeipidevs/anti-rea` e rode `anti-rea start`.
O pacote leva o nome da conta porque o npm recusou `anti-rea` sozinho, por ser parecido com outro
pacote que já existe. Instalado, o comando continua sendo `anti-rea`.

**3. Aponte o seu domínio para o porteiro** em vez do site. O porteiro fala HTTP simples na porta
8080: o HTTPS fica com quem está na frente dele (o nginx da máquina, o Traefik do painel ou a
Cloudflare), como explica [Instalar](docs/02-instalar.md#último-passo-apontar-o-domínio-para-o-porteiro).

Prefere Docker? Use a imagem publicada neste `docker-compose.yml`. A versão fica fixa (`:v0.1.3`): o
porteiro só muda quando você trocar a tag. No `upstream` da configuração, use o endereço do site visto
de dentro do contêiner, não `localhost`.

```yaml
services:
  anti-rea:
    image: ghcr.io/jeipidevs/anti-rea:v0.1.3
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    env_file: .env
    # Horário dos avisos e do resumo do dia: sem TZ, o contêiner fica em UTC.
    # environment:
    #   - TZ=America/Sao_Paulo
    volumes:
      - ./anti-rea.config.yml:/app/anti-rea.config.yml:ro
      - ./registro:/app/registro
```

A imagem roda com um usuário sem poder de administrador (uid 1000). Crie a pasta do registro com esse
dono antes de subir, senão o porteiro sobe mas não consegue guardar as tentativas:

```bash
mkdir -p registro && sudo chown 1000:1000 registro
docker compose up -d
```

O que fica na frente do porteiro muda a porta e o `trustProxy`:

- **nginx ou Traefik na mesma máquina:** `trustProxy: true` e a porta publicada só para a própria
  máquina (`"127.0.0.1:8080:8080"`), para só o proxy alcançar o porteiro.
- **Painel (EasyPanel, Coolify):** `trustProxy: true` e nenhuma porta publicada; o painel entrega o
  domínio pelo Traefik dele.
- **Cloudflare ligada direto no porteiro:** `trustProxy: cloudflare` e a porta 80 do servidor
  publicada para o porteiro (`"80:8080"`), sem `127.0.0.1` (a Cloudflare não alcançaria o porteiro e
  o site sairia do ar). Quem fecha a porta para o resto da internet é o
  firewall, que aceita só os endereços da Cloudflare: veja
  [Atrás da Cloudflare](docs/02-instalar.md#atrás-da-cloudflare).

No Docker, o assistente e o comando `dono` rodam com Node ou pela própria imagem (veja
[Instalar](docs/02-instalar.md#jeito-2-docker)). Depois de mudar o `.env`, rode `docker compose up -d`:
o `docker compose restart` não relê o `.env`.

Passo a passo para painel (EasyPanel, Coolify), nginx na mesma máquina e Cloudflare:
[Instalar](docs/02-instalar.md).

## A página sombra

<img src="assets/telas/pagina-sombra.svg" alt="Página sombra com o texto: Ops. Pegamos você. O código que você queria não mora aqui." width="100%">

Vem com uma mensagem padrão em português e inglês. Troque pelo seu texto, sua cor e seu logo em
[Página sombra](docs/04-pagina-sombra.md).

## O aviso no seu celular

<div align="center">
<img src="assets/telas/aviso-whatsapp.svg" alt="Aviso no WhatsApp: tentativa de cópia barrada, com site, página, IP, motivo, agente, horário com o fuso e destino" width="420">
</div>

Só tentativa de cópia e ataque direcionado (scanner como sqlmap ou nikto apontado para o seu site)
viram aviso. A varredura automática que todo site recebe
o dia inteiro fica só no registro, com um resumo diário opcional. Durante um ataque de muitos IPs, os
avisos param em 6 a cada 5 minutos e o resto chega agrupado. Seu celular não vira sirene.
Configurar: [Avisos](docs/05-avisos.md).

## O exame do seu site

> [!NOTE]
> O exame ainda não existe na versão 0.1. Esta seção mostra como ele vai funcionar.

<img src="assets/telas/exame.svg" alt="Terminal com o exame apontando mapa de código público, arquivo sensível, API sem login e chave aparente" width="100%">

```bash
npx @jeipidevs/anti-rea exame https://seusite.com.br
```

O exame vai usar a mesma lógica das ferramentas de engenharia reversa, só que a seu favor. Ele só vai
rodar em site que você prova ser seu, e só vai fazer leitura: nunca altera nada. Detalhes em [Exame](docs/06-exame.md).

## Perguntas rápidas

<details>
<summary><b>Meu cliente pode cair na página sombra por engano?</b></summary>

Quem navega normal, não. Quem abre as ferramentas de desenvolvedor (F12) cai, por padrão, porque esse
é o mesmo sinal que o REA deixa. Você pode mudar isso por site. Você e sua equipe usam o
[link de dono](docs/07-modo-dono.md) e não caem na página sombra (os arquivos trancados continuam
trancados para todo mundo).
</details>

<details>
<summary><b>Vai atrapalhar o Google ou meus anúncios?</b></summary>

Não. Google, Bing, Apple e Meta são confirmados pelo endereço oficial de cada um e passam direto. A
prévia do WhatsApp e de outros apps recebe o título, a descrição e a imagem do site. O DuckDuckGo não
tem como ser conferido e vê só essa prévia. Veja [Robôs oficiais](docs/08-robos-oficiais.md).
</details>

<details>
<summary><b>Meu site fica mais lento?</b></summary>

Pouco, e medimos. A primeira visita tem a verificação, de menos de um segundo. Depois, cada página
leva a guarda, que confere a aba duas vezes por segundo enquanto ela está visível: num aparelho com a
CPU 6 vezes mais lenta isso dá 0,7% de CPU
([os números](docs/_medicoes/2026-11-guarda.md)). A página que o
seu site manda comprimida (gzip, deflate ou br) continua comprimida, com a guarda.
</details>

<details>
<summary><b>E os webhooks de pagamento e o app de celular que chamam minha API?</b></summary>

Você lista esses caminhos como isentos, com `/*` no fim para valer para tudo abaixo deles
(`/api/webhook/*`). O assistente pergunta por eles na instalação.
`robots.txt`, sitemaps, o manifesto do PWA e `/.well-known/` já passam sozinhos. Veja
[Configurar](docs/03-configurar.md#caminhos-públicos-padrão).
</details>

<details>
<summary><b>Substitui um firewall ou proteção contra DDoS?</b></summary>

Não. O ANTI-REA cuida de cópia e análise. Use junto com a proteção que você já tem.
</details>

Mais perguntas: [Perguntas frequentes](docs/perguntas-frequentes.md) · Termos difíceis: [Glossário](docs/glossario.md)

## Roteiro

- [x] Projeto, marca e documentação
- [x] Porteiro (proxy reverso) com regras no servidor
- [x] Verificação do navegador na primeira visita
- [x] Confirmação de robôs oficiais
- [x] Página sombra configurável
- [x] Avisos: WhatsApp (Evolution API), Telegram e webhook
- [x] Assistente de instalação (`anti-rea init`)
- [x] Imagem Docker publicada (`ghcr.io/jeipidevs/anti-rea`)
- [x] Pacote publicado no npm (`@jeipidevs/anti-rea`)
- [x] Apps com login, PWA e service worker (v0.1.1)
- [ ] Exame do próprio site
- [ ] Painel de registro

## Trajeto e versões

O ANTI-REA nasceu em 20/11/2026 de uma pergunta simples: se uma ferramenta como o REA consegue
desmontar qualquer site pelo navegador, dá para perceber quem está fazendo isso e não entregar nada a
ele? O projeto começou pela documentação e pela marca, virou plano, e o porteiro foi construído em
pequenos passos, cada um com teste antes do código. A guarda foi medida contra o REA de verdade
([os números](docs/_medicoes/2026-11-guarda.md)) antes de qualquer promessa entrar aqui.

**Estado atual.** O porteiro roda em produção desde a noite de 20/11/2026, na frente de mais de 20
sites estáticos e sistemas com login. As correções da v0.1.1 e da v0.1.2 vieram desse uso real: o
registro mostrou onde o porteiro atrapalhava, e cada caso virou teste antes de virar versão. No
registro de produção, quem cai na página sombra é robô de datacenter, scanner de WordPress e
navegador automatizado; nenhum visitante comum.

| Versão | Data | O que entrou |
|---|---|---|
| [v0.1.3](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.3) | 21/11/2026 | **Primeira versão no npm:** `npx @jeipidevs/anti-rea init` e `npx @jeipidevs/anti-rea start`, sem clonar nem compilar. O porteiro é o mesmo da v0.1.2. O pacote leva só o necessário (o código compilado, o exemplo de configuração e os READMEs) e é compilado do zero antes de empacotar. |
| [v0.1.2](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.2) | 21/11/2026 | **Vídeo e áudio como mídia pública** (mp4, webm, mov, mp3, m4a, ogg, wav, flac e outros): sem passe, o link direto de um vídeo levava 403 e não tocava. **`meta-webindexer` na lista da Meta**, conferido pelas faixas AS32934: o indexador da Meta abre a página num Chrome sem tela e caía na página sombra. 559 testes. |
| [v0.1.1](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.1) | 20/11/2026 | **Pronto para apps com login** (Next.js, PWA, página única). `upstreamTimeout` configurável (60 s por padrão, de 1 s a 10 min), para página lenta não virar 504. Quem foi pego leva 403 no pedido feito por script, e não a sombra com 200, para o app não tomar a sombra por resposta. O passe renova em qualquer resposta abaixo de 400 (204, 304, redirecionamento). `.ttf` e `.otf` contam como mídia. Leitor de link que não pede HTML recebe a prévia. 558 testes. |
| [v0.1.0](https://github.com/Jeipidevs/anti-rea/releases/tag/v0.1.0) | 20/11/2026 | **Primeira versão do porteiro.** Verificação na primeira visita (menos de 1 s, com a prévia do site) e passe assinado. Guarda no navegador a cada 0,5 s com a aba visível. Arquivos sensíveis trancados em qualquer pasta. Robôs oficiais conferidos (Google, Bing, Apple pelo DNS; Meta pelas faixas). Página sombra configurável, avisos por WhatsApp, Telegram e webhook com teto e agrupamento, registro local com prazo, link de dono, assistente `init` e imagem Docker. 547 testes de unidade e 35 no Chrome real. |

Configuração com `upstreamTimeout` só sobe na v0.1.1 ou mais nova: a v0.1.0 recusa a chave
desconhecida.

## Uso responsável

- O ANTI-REA **defende**. A página sombra nunca roda nada contra a máquina de quem tentou e nunca
  coleta além do que chega na requisição.
- O exame (que vem a seguir) só vai rodar em site que você prova controlar. Ele não serve para
  varrer site dos outros.
- **IP é dado pessoal** pela LGPD (e pelo GDPR). Se você usar o ANTI-REA, cite a coleta na política
  de privacidade do seu site. O registro apaga sozinho depois do prazo que você escolher, só o usuário
  do porteiro lê os arquivos dele, e o endereço guardado perde os valores da query (`?token=...`).

## Contribuir

Ideias, correções e novos sinais de detecção são muito bem-vindos. Comece por
[CONTRIBUTING.md](CONTRIBUTING.md). Achou uma falha de segurança? Siga o [SECURITY.md](SECURITY.md)
e não abra issue pública.

## Créditos e licença

O ANTI-REA nasceu estudando a lógica do [REA (Reverse Engineer Anything)](https://github.com/morluto/rea),
para saber como uma análise acontece e como se defender dela. É um projeto **independente**, sem
ligação com o REA ou com seus autores.

Licença [MIT](LICENSE). Feito no Brasil pela JPStudio.

<div align="center">
<br>
<img src="assets/marca/simbolo.svg" width="56" alt="ANTI-REA">
</div>
