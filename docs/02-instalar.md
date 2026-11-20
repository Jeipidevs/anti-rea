# Instalar

> [!NOTE]
> Versão 0.1: o porteiro funciona. O pacote no npm e a imagem no GHCR saem junto com a primeira
> versão publicada. Até lá, use o [jeito a partir do repositório](#antes-da-primeira-versão-publicada).

## Antes de começar

Você precisa de duas coisas:

1. **Onde o seu site roda hoje.** Por exemplo `http://localhost:3000` ou `http://meu-site:80` dentro
   da sua VPS. O porteiro vai buscar o site real ali.
2. **Node.js 22 ou mais novo**, ou **Docker**. Só com Docker, o assistente e o comando `dono` rodam
   pela própria imagem, como mostra o [Jeito 2](#jeito-2-docker).

## Jeito 1: assistente (o mais fácil)

<img src="../assets/telas/assistente.svg" alt="Assistente de instalação no terminal" width="100%">

```bash
npx anti-rea init
```

Responda as perguntas. No fim ele cria dois arquivos:

- `anti-rea.config.yml`: a configuração, com um comentário em português em cada linha.
- `.env`: as senhas dos canais de aviso. **Nunca suba esse arquivo para o GitHub.**

Ele também mostra o seu [link de dono](07-modo-dono.md). Guarde num lugar seguro.

Depois, ligue:

```bash
npx anti-rea start
```

## Jeito 2: Docker

Crie a configuração com o assistente. O assistente e o comando `dono` rodam fora do porteiro: o
contêiner do porteiro não tem o `.env` dentro (ele chega pelo `env_file`) e não grava na pasta da
instalação. Com Node no servidor, use `npx anti-rea init` (passo acima). Sem Node, rode o assistente
pela imagem, na pasta onde a configuração vai morar:

```bash
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/jeipidevs/anti-rea:latest node /app/dist/cli/index.js init
```

Ele cria `anti-rea.config.yml` e `.env` nessa pasta. No `upstream`, use o endereço do site visto de
dentro do contêiner (o nome do serviço e a porta), não `localhost`.

Depois, use este `docker-compose.yml` na mesma pasta:

```yaml
services:
  anti-rea:
    image: ghcr.io/jeipidevs/anti-rea:latest
    ports:
      - "8080:8080"
    env_file: .env
    volumes:
      - ./anti-rea.config.yml:/app/anti-rea.config.yml:ro
      - ./registro:/app/registro
```

A imagem roda com um usuário sem poder de administrador (uid 1000). Crie a pasta do registro
antes e dê a ela esse dono, senão o porteiro não consegue gravar as tentativas:

```bash
mkdir -p registro && sudo chown 1000:1000 registro
docker compose up -d
```

### Trocar o link de dono no Docker

O `env_file` só é lido quando o contêiner é criado. Depois de mexer no `.env` (por exemplo com
`dono --novo`), rode `docker compose up -d`, que recria o contêiner com o `.env` novo. O
`docker compose restart` não relê o `.env`: o link antigo continuaria valendo. Sem Node no servidor:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/jeipidevs/anti-rea:latest node /app/dist/cli/index.js dono --novo
docker compose up -d
```

Para só ver o link de novo, tire o `--novo` e pule o `up -d`. Qualquer outra mudança no `.env`
(a senha de um canal, por exemplo) também pede `docker compose up -d`.

## Antes da primeira versão publicada

Enquanto o pacote não está no npm, baixe o repositório e compile uma vez:

```bash
git clone https://github.com/Jeipidevs/anti-rea.git
cd anti-rea
npm ci
npm run build
```

Depois, na pasta onde a configuração vai morar, troque `npx anti-rea` por
`node <pasta do anti-rea>/dist/cli/index.js` nos comandos acima (`init`, `start` e `dono`).

Para o Docker, construa a imagem na pasta do repositório e use `anti-rea` no lugar de
`ghcr.io/jeipidevs/anti-rea:latest`, no `docker-compose.yml` (`image: anti-rea`) e nos comandos
`docker run` acima:

```bash
docker build -t anti-rea .
```

## Último passo: apontar o domínio para o porteiro

O porteiro precisa ficar **na frente** do site. Quem acessava o site agora acessa o porteiro, e o
porteiro busca o site.

```
Antes:   internet  ──►  seu site
Depois:  internet  ──►  ANTI-REA  ──►  seu site
```

### Em painéis como EasyPanel ou Coolify

1. Crie um serviço novo com a imagem `ghcr.io/jeipidevs/anti-rea`.
2. Em `upstream`, coloque o endereço interno do seu site (o nome do serviço e a porta).
3. Mova o domínio do serviço do site para o serviço do ANTI-REA.
4. Abra o site no navegador e confira que carrega normal.

### Com nginx na frente

Troque o `proxy_pass` do seu site para o porteiro:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

E diga ao ANTI-REA para confiar no IP que o nginx informa (`trustProxy: true` na configuração).

### Atrás da Cloudflare

Funciona. Ligue `trustProxy: cloudflare` para o porteiro ler o IP real no cabeçalho da Cloudflare.

## Conferir se deu certo

1. Abra o site num navegador comum. Ele deve carregar normal.
2. Rode, de outro computador: `curl -A "HTTrack" https://seusite.com.br`. Deve voltar a página sombra.
3. Confira se o aviso chegou.

Próximo passo: [Configurar](03-configurar.md).
