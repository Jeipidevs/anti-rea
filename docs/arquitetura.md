# Arquitetura (para quem contribui)

> [!NOTE]
> Desenho de referência. Pode mudar enquanto a primeira versão é construída.

## Peças

```
src/
  porteiro/        proxy reverso: recebe o pedido, decide, repassa ou desvia
  deteccao/
    servidor/      sinais por pedido (assinaturas, caminhos, ritmo, arquivos trancados)
    navegador/     script da verificação da primeira visita e validação do resultado
    robos/         confirmação de robôs oficiais por DNS reverso e faixas publicadas
  passe/           cookie assinado do visitante verificado e do dono
  sombra/          página sombra e modelos
  avisos/          um módulo por canal (whatsapp, telegram, webhook) atrás de uma porta única
  registro/        gravação local das tentativas, retenção e painel
  exame/           o exame do próprio site
  config/          leitura e validação do anti-rea.config.yml
  cli/             init, start, exame, dono
```

## Regras do código

- Cada sinal de detecção é um módulo pequeno, com teste, que devolve `{ pego, motivo, peso }`.
- Na dúvida, deixa passar e registra. Falso positivo em gente navegando normal é o pior bug.
- Cada serviço de fora (Evolution, Telegram) fica atrás de um módulo só.
- Sem credencial, o serviço sobe e diz o que falta, sem quebrar.
- A página sombra nunca contém nada do site real.

## Como testar a detecção

O conjunto de testes roda ferramentas reais contra um site de exemplo: REA, Playwright, Puppeteer,
wget, HTTrack, curl e um scanner. Todas devem cair na sombra. Um navegador comum, nunca.
