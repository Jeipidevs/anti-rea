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
- Perdeu o link? Rode `npx anti-rea dono` na pasta da instalação e ele aparece de novo.
- Quer trocar o link (alguém saiu da equipe)? Rode `npx anti-rea dono --novo` e reinicie o porteiro.
  O link antigo e os passes de dono antigos deixam de valer.
- Tentativa com o link errado também vira aviso.

## De onde vem o código

O código do link sai de duas variáveis do `.env`:

- `ANTI_REA_SECRET`: o segredo que assina os passes. Trocar o segredo troca o link e derruba todos os
  passes, de dono e de visitante.
- `ANTI_REA_OWNER_VERSION`: a versão do link de dono, um número inteiro a partir de 1 (sem a linha,
  vale 1). `npx anti-rea dono --novo` soma 1 nesse número. Muda só o link e os passes de dono; quem
  visita o site continua navegando.

Se a variável também estiver no ambiente do processo (no painel da hospedagem, por exemplo), ela vale
mais que o `.env`: troque lá também.
