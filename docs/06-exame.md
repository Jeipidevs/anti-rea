# Exame do seu site

<img src="../assets/telas/exame.svg" alt="Relatório do exame no terminal" width="100%">

O exame faz o que um curioso faria com uma ferramenta de engenharia reversa, só que para você ver
primeiro.

## Como rodar

```bash
npx anti-rea exame https://seusite.com.br
```

Na primeira vez ele pede para você provar que o site é seu: crie o arquivo
`/.well-known/anti-rea.txt` no site com o código que ele mostrar. Sem isso, o exame não roda. É o que
impede alguém de usar o exame contra o site dos outros.

## O que ele procura

| Item | Por que importa |
|---|---|
| Mapas de código públicos | Reconstroem o seu código original, com nomes e comentários |
| Arquivos sensíveis no ar | `.env`, `.git`, backups: senhas e histórico inteiro do código |
| API que responde sem login | Qualquer um lê os dados direto |
| Chave aparente no código | Chave secreta que foi parar no navegador por engano |
| Porteiro ativo | Se o ANTI-REA está mesmo na frente do site |

## Só leitura

O exame só faz pedidos de leitura (`GET`, `HEAD`, `OPTIONS`). Ele nunca altera, cria ou apaga nada.
Testar métodos que alteram dado exige a opção `--ambiente-de-teste` e nunca deve ser usado em produção.

## O relatório

Sai um arquivo HTML com cada item em português claro: o que achou, por que é perigoso e o que fazer.
