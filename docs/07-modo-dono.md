# Modo dono

Você, sua equipe e quem desenvolve o site precisam abrir o F12 sem cair na página sombra. Para isso
existe o **link de dono**.

## Como funciona

1. O assistente mostra o link no fim da instalação:
   `https://seusite.com.br/.anti-rea/dono/<código>`
2. Abra esse link uma vez em cada navegador que for usar.
3. O navegador ganha um passe de dono e nunca mais é barrado (até você limpar os cookies).

## Cuidados

- Trate o link como senha. Não mande em grupo nem em texto aberto.
- Quer trocar o link (alguém saiu da equipe)? Rode `npx anti-rea dono --novo`. Os passes antigos
  deixam de valer.
- Tentativa com o link errado também vira aviso.
