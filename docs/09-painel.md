# Painel de registro

Cada tentativa que o porteiro pega vira uma linha no registro (um arquivo JSONL por dia, na pasta
`registro`). O painel mostra esse registro de um jeito que dá para ler: quantos foram pegos no dia,
para onde foram, quem mais aparece e a lista dos eventos.

## No próprio site

Abra o seu link de dono (sai em `anti-rea dono`) e depois:

```text
https://seusite.com.br/.anti-rea/painel
```

- **Só o dono vê.** Sem o passe de dono, o endereço responde 404, igual a qualquer endereço que não
  existe: quem não é dono nem fica sabendo que o painel está ali.
- Mostra o dia de hoje (UTC). Os dias anteriores ficam nas barras; clique numa barra para abrir o dia.
- Clique num IP ou num motivo para ver só os eventos dele. "limpar" tira o filtro.
- A tabela mostra os 300 eventos mais recentes do dia.
- Abrir o painel não vira evento, nem aviso.

## Em arquivo

Sem domínio, ou com o porteiro dentro do Docker, grave o painel num arquivo HTML:

```bash
npx @jeipidevs/anti-rea painel --registro ./registro
```

Sem `--dia`, sai o dia mais recente que tem registro. Com `--dia 2026-11-20`, sai aquele dia. Com
`--saida caminho.html`, o arquivo vai para onde você quiser. O arquivo sai só para o seu usuário
(modo 0600), porque tem IP.

## Segurança

- A página não tem script nenhum e não pode ser aberta dentro de outro site (iframe).
- Tudo que vem do registro é tratado como texto: o agente e o caminho são escritos por quem foi pego, e
  nenhum deles vira código na página.
- Não fica em cache e não manda o endereço para outro site quando você clica num link.

> [!IMPORTANT]
> IP é dado pessoal (LGPD e GDPR). O painel é para o dono do site. Não compartilhe o link de dono nem
> o arquivo gravado.
