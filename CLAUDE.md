# CLAUDE.md: anti-rea

ANTI-REA: porteiro (proxy reverso) open source contra engenharia reversa e cópia de sites.
**Repositório público.** Estado: `context.md` (fora do git) e claude-mem, lista `anti-rea`.

## O que muda decisão

- **Repositório público:** nenhum dado da JPStudio, de cliente, IP real, número de WhatsApp,
  domínio interno ou configuração real entra no git. Exemplo usa `seusite.com.br` e IP de
  documentação (`203.0.113.x`).
- **Na dúvida, deixa passar e registra.** Falso positivo em gente navegando normal é o pior bug.
  Exceção decidida: F12 aberto cai na sombra (configurável).
- **Página sombra:** nunca contém nada do site real, nunca roda nada contra o visitante.
- **Exame:** só GET, HEAD e OPTIONS e só em domínio provado por `/.well-known/anti-rea.txt`.
- **README não promete o que não roda.** Item novo do roteiro só vira `[x]` com teste passando.
- Arquitetura de referência: `docs/arquitetura.md`. Cada canal de aviso atrás de um módulo só.
- Imagens do README são SVG em `assets/`, cartão escuro próprio (funcionam no tema claro e escuro
  do GitHub). Conferir renderizando antes de subir.
- Sem travessão longo em nenhum texto.
- Na casa: instalar em site de produção só com sim do João, um por vez, e smoke na URL pública.
