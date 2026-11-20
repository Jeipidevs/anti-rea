# O que é o ANTI-REA

<img src="../assets/diagramas/como-funciona.svg" alt="Diagrama de como o ANTI-REA funciona" width="100%">

## O problema

Existem ferramentas que abrem um site e desmontam ele por dentro. A mais completa hoje se chama
**REA** (Reverse Engineer Anything). Ela lê o código que o site manda para o navegador, encontra os
endereços da API, reconstrói o código original a partir dos mapas de código e monta um retrato de
como o sistema funciona.

Isso é útil para estudar, e é exatamente o que um concorrente usaria para copiar o seu sistema.

## A ideia

Pense num prédio com porteiro.

- O morador entra direto. O porteiro já conhece.
- Um visitante novo é olhado por um segundo e entra.
- Quem chega com pé de cabra não sobe. O porteiro manda para uma sala vazia com um bilhete
  debochado e liga para o síndico.

O ANTI-REA é esse porteiro. O **morador** é o visitante que já passou pela verificação. O **pé de
cabra** é o REA, o robô copiador, o navegador automatizado e a ferramenta de ataque. A **sala vazia**
é a página sombra. O **síndico** é você, avisado no celular.

## O que ele confere

**No servidor, a cada pedido:**
- se o pedido traz o passe da verificação. Quem busca código ou dados do site direto, sem passar
  pela tela de verificação, não recebe nada do site: arquivo (`/app.js`) ou outro formato
  (`application/json`) leva **403**, e página recebe a tela de verificação. É assim que fica de fora a
  busca que o REA faz por conta própria, fora do navegador: ela não se apresenta com um nome
  conhecido, mas também não tem passe;
- se está pedindo um arquivo trancado. Esses ficam trancados para todo mundo, até para quem tem
  passe, em qualquer pasta:
  - **mapa de código** (`.map`);
  - senhas: `.env`, `.env.*` e `.envrc`;
  - histórico e restos do código: `.git`, `.svn`, `.hg` e `.DS_Store`;
  - configuração e chaves: `.htaccess`, `.htpasswd`, `.npmrc`, `.git-credentials`, `.ssh`, `.aws` e
    cópias do `wp-config.php` (`wp-config.php.*`);
  - cópias e backups: arquivos terminados em `.bak`, `.old`, `.orig`, `.save`, `~`, `.swp`, `.swo`,
    `.sql` ou `.sql.gz`, e compactados (`.zip`, `.tar`, `.tar.gz`, `.tgz`, `.gz`, `.7z`, `.rar`) com nome
    que começa por `backup` ou `bkp`, ou, na raiz, chamados `site`, `www`, `web`, `html`,
    `public_html`, `htdocs`, `wwwroot`, `db`, `database` ou `dump`;
- se o pedido se apresenta como uma ferramenta de cópia ou de ataque conhecida (wget, HTTrack,
  navegador sem tela, scanners);
- se está navegando rápido demais para ser gente;
- se está testando caminhos clássicos de ataque.

**No navegador, na primeira visita (a verificação, menos de 1 segundo):**
- se o navegador é automatizado (robô pilotando um Chrome) ou roda sem tela, como o navegador que o
  próprio REA abre;
- se o navegador está em modo de depuração, que é como o REA se conecta. Abrir o F12 deixa o mesmo
  sinal, por isso quem abre o F12 também cai na sombra (dá para mudar).

**No navegador, depois da verificação (a guarda na aba):**
- com a configuração padrão, cada página do site leva uma **guarda** pequena que repete a conferência
  a cada 0,5 s, só enquanto a aba está visível (até uns 0,6 s numa página muito ocupada; num
  aparelho muito lento, ela recua para 1 s e depois 1,5 s). Se o REA está ligado a uma **aba visível** que já passou quando
  vem a conferência, a página vira sombra, o passe é cancelado e o aviso sai. Na medição, a inspeção
  curta dele foi pega 20 de 20 vezes, mas em 2 o REA já tinha lido a página. Numa aba escondida
  (em segundo plano, janela minimizada) a guarda não confere.

Nem tudo é pego. O que ainda escapa está em
[Limites conhecidos](perguntas-frequentes.md#limites-conhecidos).

## O que ele não é

- Não é firewall completo nem proteção contra DDoS. Use junto.
- Não deixa o site invisível. Veja [o que dá para proteger](../README.md#o-que-dá-para-proteger-a-verdade-sem-enfeite).
- Não contra-ataca. Ele defende, engana e avisa.

Próximo passo: [Instalar](02-instalar.md).
