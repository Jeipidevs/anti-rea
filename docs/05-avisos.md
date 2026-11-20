# Avisos

<div align="center">
<img src="../assets/telas/aviso-whatsapp.svg" alt="Aviso no WhatsApp" width="380">
</div>

Cada tentativa barrada pode virar um aviso com: site, página, IP, motivo, horário e destino.

## O que vira aviso e o que não vira

| Acontecimento | Padrão |
|---|---|
| REA, navegador automatizado, F12 aberto | Aviso na hora |
| Robô copiador (wget, HTTrack e afins) | Aviso na hora |
| Scanner apontado para o site (sqlmap, nikto, nuclei, dirbuster, gobuster, ffuf, wpscan, feroxbuster, wfuzz, openvas, w3af, arachni, commix) | Aviso na hora, com o título "Ataque barrado" |
| Pedido de mapa de código | Aviso na hora |
| Arquivo sensível (`.env`, `.git`, backup) pedido por quem já passou pela verificação | Aviso na hora |
| Robô que diz ser o Google ou a Meta e não é | Aviso na hora |
| Link de dono errado | Aviso na hora |
| Pedido direto sem passe a arquivo (`/app.js`) ou a outro formato (`application/json`) | Só no registro, e o pedido leva 403 |
| Varredura genérica (`/phpmyadmin`, `/.env` vindo de robô da internet, masscan e zgrab varrendo a internet inteira) | Só no registro |
| Robô oficial que não deu para conferir (DNS ou lista da Meta fora do ar) | Só no registro |

Varredura genérica acontece o dia inteiro em qualquer site público. Se virasse aviso, seu celular
não pararia. Quer um resumo diário dela? Use `scans: dailySummary` (sai às 08:00, no fuso do
servidor). Quer cada uma na hora? Use `scans: alert`. O padrão, `scans: panel`, só guarda no
registro; a tela para ler o registro vem a seguir.

Tentativas repetidas do mesmo IP viram **um aviso só**, com a contagem (`groupByIp`).

### Teto de avisos durante um ataque

Saem no máximo **6 avisos a cada 5 minutos**, somando todos os IPs. Um ataque vindo de muitos IPs
ao mesmo tempo não inunda o seu WhatsApp nem derruba a instância da Evolution. O que passar do teto
vira um aviso agrupado único, enviado assim que o teto abre vaga (o porteiro confere a cada minuto):

```text
Muitas tentativas ao mesmo tempo: 14 tentativas de 14 IPs desde 10:05 (agrupadas).
```

Tudo continua no registro, com o detalhe de cada pedido. O resumo diário das varreduras não entra
no teto.

## WhatsApp (pela Evolution API)

Você precisa de uma instância da [Evolution API](https://github.com/EvolutionAPI/evolution-api)
conectada a um número. Use um número só para avisos, não o seu pessoal.

No `.env`:

```bash
ANTI_REA_WHATSAPP_URL=https://sua-evolution.com
ANTI_REA_WHATSAPP_INSTANCE=avisos
ANTI_REA_WHATSAPP_TOKEN=sua-chave
ANTI_REA_WHATSAPP_TO=5511999999999
```

## Telegram

1. Crie um bot com o [@BotFather](https://t.me/BotFather) e copie o token.
2. Mande uma mensagem para o bot e descubra o seu `chat_id`.

```bash
ANTI_REA_TELEGRAM_TOKEN=123456:abc
ANTI_REA_TELEGRAM_CHAT=123456789
```

## Webhook (para integrar com o que quiser)

```bash
ANTI_REA_WEBHOOK_URL=https://seu-sistema.com/anti-rea
ANTI_REA_WEBHOOK_SECRET=um-segredo-longo
```

O ANTI-REA manda um `POST` com JSON e assina o corpo com o segredo (cabeçalho
`X-Anti-Rea-Signature: sha256=<HMAC-SHA256 do corpo em hex>`), para você conferir que veio dele.

O aviso de uma tentativa leva o evento (`quando`, `ip`, `dominio`, `caminho`, `agente`, `motivo`,
`gravidade`, `destino`). A `gravidade` é `copia` (tentativa de cópia), `ataque` (scanner apontado para
o site) ou `varredura` (varredura genérica). O resumo diário e o aviso agrupado do teto levam
`{"tipo":"resumo","texto":"...","quando":"<data ISO>"}`.

## Sem canal configurado

O porteiro funciona mesmo assim. Ele avisa no terminal o que falta e guarda tudo no registro (a
pasta `registro`, um arquivo JSONL por dia).
