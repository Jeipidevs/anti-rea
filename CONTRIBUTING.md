# Como contribuir

Obrigado por querer ajudar. Toda contribuição conta: código, documentação, um novo sinal de
detecção, uma tradução ou um relato de falso positivo.

## Antes de abrir um PR

1. Abra uma issue contando o que quer mudar, para combinarmos o caminho.
2. Leia a [arquitetura](docs/arquitetura.md).
3. Um PR, um assunto.

## A regra de ouro

**Na dúvida, deixa passar e registra.** Um sinal de detecção novo precisa provar, com teste, que não
barra um navegador comum navegando normal. Falso positivo em gente de verdade é o pior bug possível.

## Relatar falso positivo

Abra uma issue com: navegador e versão, sistema, extensões instaladas e o motivo que apareceu no
registro. Nunca cole IP, cookie ou dado pessoal de visitante.

## Escrita

Documentação em português claro, para quem não é da área. Sem travessão longo; use vírgula, ponto
ou dois-pontos.

## GitHub Actions

Toda ação de fora usada em `.github/workflows/` fica presa ao SHA do commit, com a versão num
comentário (`uses: actions/checkout@<sha> # v4.4.0`): a imagem publicada sai de um job que pode
escrever no GHCR, e uma tag como `@v4` pode ser trocada por quem controla a ação. Para subir de
versão, aceite o PR do Dependabot (`.github/dependabot.yml`) ou confira o SHA da tag nova com
`gh api repos/<dono>/<ação>/git/ref/tags/<tag>`. Um teste (`tests/publicacao.test.ts`) recusa
`uses:` sem SHA.

## Falha de segurança

Não abra issue pública. Siga o [SECURITY.md](SECURITY.md).
