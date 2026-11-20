# Robôs oficiais

Alguns robôs **precisam** ver o seu site:

| Robô | Para quê |
|---|---|
| Google, Bing e Apple | Colocar o site na busca |
| Meta (Facebook e Instagram) | Revisar e mostrar seus anúncios, gerar prévia de link |
| WhatsApp, Telegram, LinkedIn, Slack e outros | Mostrar a prévia quando alguém compartilha o link |

## Por que não basta o nome

Qualquer programa pode dizer "eu sou o Google". O ANTI-REA não acredita no nome: ele confere o
endereço de onde o pedido veio, pelo método oficial de cada empresa. Quem mente sobre o nome cai
na sombra.

| Robô | Como o ANTI-REA confere |
|---|---|
| Google (Googlebot, Google-InspectionTool, AdsBot, Mediapartners, Storebot-Google do Shopping, GoogleOther) | DNS reverso termina em `.googlebot.com` ou `.google.com`, e esse nome aponta de volta para o mesmo IP |
| Google a pedido (Google-Site-Verification do Search Console, Google-Read-Aloud da leitura em voz alta) | O mesmo do Google; quando não confirma, segue como visitante comum, sem sombra |
| Bing | O mesmo, com `.search.msn.com` |
| Apple | O mesmo, com `.applebot.apple.com` |
| Meta | O IP está nas faixas que a Meta anuncia (AS32934) |

O sufixo `.googleusercontent.com` não vale: ele é de qualquer máquina alugada no Google Cloud, e
aceitar esse nome deixaria qualquer um se passar pelo Google.

Os robôs que o Google manda a pedido de alguém (a verificação do Search Console, a leitura em voz
alta) podem sair desse endereço que não dá para conferir. Por isso, quando não confirmam, eles não
caem na sombra: seguem as regras de visitante comum (a tela de verificação ou o 403). Para verificar
o site no Search Console, use o **registro TXT no DNS**: ele não depende de o robô chegar ao site e
nunca expira por causa do porteiro. A verificação por arquivo HTML ou etiqueta também funciona
quando o robô vem de `.google.com`.

As faixas da Meta vêm do RIPEstat, por HTTPS. Se o RIPEstat não responder, o ANTI-REA pergunta ao
whois do RADb (porta 43, que muita VPS bloqueia). A lista começa a carregar quando o porteiro
sobe, fica guardada por 24 horas e é renovada em segundo plano.

## Prévias e DuckDuckGo

WhatsApp, Telegram, Slack, LinkedIn, X (Twitter), Discord, Skype, Pinterest e o DuckDuckBot não
têm como ser conferidos: a prévia do WhatsApp sai do celular de quem manda o link, e o DuckDuckGo
não publica um nome de DNS reverso. Esses recebem a tela de verificação, que já leva o título, a
descrição e a imagem do seu site. Nunca a sombra, e do site só as imagens.

Com isso o DuckDuckGo indexa só a prévia da página.

## Quando não dá para conferir

Às vezes a conferência falha por um motivo passageiro: o DNS demora, responde com erro, ou a lista
da Meta ainda não carregou (o pedido espera no máximo 3 segundos por ela). Nesse caso vale a regra
da casa: **na dúvida, deixa passar e registra**. O robô vê o site e o registro guarda o evento
"robô não confirmado", sem aviso. A dúvida fica guardada só 1 minuto; a resposta certa (confirmado
ou não) fica guardada 1 hora.

Só cai na sombra quem tem resposta definitiva contra si: IP sem nome reverso, nome de fora da
lista, nome que não aponta de volta para o IP, ou IP fora das faixas da Meta.

## E a prévia de link de quem não está na lista?

A tela de verificação leva o título, a descrição e a imagem do seu site. Assim, até robô de prévia
desconhecido monta o cartão certinho, sem ver o resto do site. Ele recebe essa tela quando pede uma
página: com `Accept` de HTML, ou sem dizer o formato (sem `Accept` ou com o curinga `*/*`) num caminho
sem extensão de arquivo. Pedido de arquivo (`/app.js`) ou de outro formato (`application/json`) sem
passe leva 403.
