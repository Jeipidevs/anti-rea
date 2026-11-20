# Arquitetura (para quem contribui)

Como o código da versão 0.1 está dividido, o que cada parte faz e as regras que valem para todas.
O exame do próprio site e o painel do registro ainda não existem; quando chegarem, ganham pasta
própria aqui.

## O caminho de um pedido

1. O **servidor** (`porteiro/servidor.ts`) recebe o pedido e lê o que importa: caminho, agente,
   cookies e o IP real (`porteiro/ip.ts`, conforme o `trustProxy`).
2. A **decisão** (`porteiro/decidir.ts`) passa o pedido por uma lista de regras, em ordem. A
   primeira que casar vence: link de dono, rotas internas, arquivo trancado, caminho público,
   isento, marca de pego, ferramenta conhecida, robô declarado, ritmo, passe e primeira visita.
3. Conforme a decisão, o servidor **repassa** ao site (`porteiro/repasse.ts`, com a guarda posta no
   HTML por `porteiro/injecao.ts`), mostra a **tela de verificação**, a **página sombra** ou recusa.
4. Quem foi pego vira um **evento** no registro e, se for tentativa de cópia, um **aviso**.

## Peças

```
src/
  porteiro/              o proxy reverso
    servidor.ts          sobe o servidor HTTP, liga as peças e atende cada pedido
    decidir.ts           a lista de regras, em ordem: a primeira que casar vence
    pedido.ts            leitura do caminho (normalizado e ao pé da letra), domínio, navegação,
                         mídia e caminhos públicos padrão
    ip.ts                IP real do visitante (trustProxy), HTTPS e IP interno
    passes.ts            cookies do porteiro: passe de visitante, passe de dono, marca de pego
    rotas.ts             rotas internas: /.anti-rea/verificar, /.anti-rea/pego e /.anti-rea/guarda.js
    repasse.ts           repasse ao site em fluxo, WebSocket e busca da prévia
    injecao.ts           põe o script da guarda no HTML do site
    previa.ts            título, descrição e imagem da página para a tela de verificação
    respostas.ts         respostas prontas: sombra, tela de verificação, recusa, site fora do ar
    tarefas.ts           tarefas de tempo em tempo: retenção do registro, avisos agrupados, resumo do dia
  deteccao/
    servidor/            sinais de cada pedido
      ferramentas.ts     agente de ferramenta conhecida (wget, curl, HTTrack, sqlmap...)
      caminhos.ts        arquivo trancado (.env, .git, mapas de código) e caminho de varredura
      ritmo.ts           navegação rápida demais para gente
    navegador/           o que roda no navegador do visitante
      desafio.ts         tela de verificação e o coletor de sinais
      guarda.ts          conferência contínua da aba depois da verificação
      avaliar.ts         decide, pelos sinais coletados, se o navegador foi pego
  robos/                 robôs oficiais
    robos.ts             quem o agente diz ser e a confirmação (com cache)
    dns.ts               DNS reverso com confirmação direta
    faixas-meta.ts       faixas de IP da Meta (RIPEstat, com o whois do RADb de reserva)
  passe/passe.ts         passe assinado e lista de passes cancelados
  sombra/sombra.ts       a página sombra
  avisos/
    avisos.ts            porta única dos avisos: agrupamento por IP, teto global, resumo do dia
    canais/              um módulo por canal: whatsapp.ts, telegram.ts, webhook.ts
  registro/registro.ts   registro local em JSONL, um arquivo por dia, teto diário e retenção
  config/                leitura e validação do anti-rea.config.yml (carregar.ts, duracao.ts)
  cli/                   comandos: index.ts (roteamento), init.ts, start.ts, dono.ts
```

## O contrato de um sinal

Todo sinal de detecção é uma função pequena, com teste, que olha uma coisa só e devolve:

```ts
type Sinal = { motivo: string; gravidade: "copia" | "varredura" } | null;
```

- `null`: não pegou nada. É a resposta da maioria dos pedidos.
- `motivo`: o texto que vai para o registro e para o aviso, em português ("mapa de código",
  "navegação rápida demais").
- `gravidade`: `copia` é tentativa de copiar o site e vira aviso na hora; `varredura` é a varredura
  genérica da internet e fica só no registro (ou no resumo do dia, conforme `alerts.scans`).

Exemplos: `ferramentaConhecida(agente)` e `caminhoDeVarredura(caminho)` em `deteccao/servidor/`, e
`avaliarNavegador(sinais)` em `deteccao/navegador/`. Quem junta os sinais e escolhe o destino
(sombra, recusa ou só registro) é `porteiro/decidir.ts`.

## Regras do código

- Na dúvida, deixa passar e registra. Falso positivo em gente navegando normal é o pior bug.
- Cada serviço de fora (Evolution, Telegram, webhook, RIPEstat) fica atrás de um módulo só.
- Sem credencial, o serviço sobe e diz o que falta, sem quebrar.
- A página sombra nunca contém nada do site real e nunca roda nada contra o visitante.
- Texto para pessoas em português, sem o travessão longo.

## Como testar

- `npm test`: os testes de unidade e de servidor (o porteiro de verdade na frente de um site de teste).
- `npm run typecheck`: confere os tipos do código e dos testes.
- `npm run test:e2e`: ferramentas reais contra o site de exemplo (`tests/e2e/site-exemplo`): curl,
  wget, HTTrack, Playwright, um cliente de depuração remota (CDP) e, quando o CLI existe, o próprio
  REA. Todas caem na sombra ou levam 403; o Chrome comum navegando, nunca.
