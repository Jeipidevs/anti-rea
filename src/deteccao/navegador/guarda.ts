import { COLETOR, COLETOR_SEM_PAUSA } from "./desafio.js";

/**
 * Intervalo entre as voltas com a aba visível. Medido em docs/_medicoes/2026-11-guarda.md:
 * o menor intervalo em que a volta custa menos de 1% de CPU com a CPU 6 vezes mais lenta (com a
 * tabela como objeto simples, a volta caiu de uns 8 para uns 3,4 ms a 6x: 500 ms passou a caber).
 */
export const INTERVALO_MS = 500;
/** Teto do recuo: em aparelho mais lento que o medido, o intervalo dobra até aqui. */
export const INTERVALO_MAX_MS = 1500;
/** Fração do intervalo que a volta pode custar, em média, antes do recuo (1% de CPU). */
const TETO_CPU = 0.01;
/** Voltas na média do custo. A primeira (o navegador ainda compila o coletor) fica de fora. */
const VOLTAS_NA_MEDIA = 5;
/** Ritmo da sonda de pausa (`debugger;`): na primeira volta e depois a cada 6 s. */
const PAUSA_MS = 6000;
/**
 * Quanto a volta espera, no máximo, por tempo ocioso do navegador. Curto de propósito: numa página
 * que anima a cada quadro não há tempo ocioso, e um `timeout` igual ao intervalo dobrava a espera.
 */
const OCIOSO_MS = 150;

/**
 * Script servido em /.anti-rea/guarda.js e injetado nas páginas reais.
 * Só vigia com a aba visível: com ela escondida, para; quando volta a ficar visível, roda uma vez na
 * hora e retoma o ritmo. O ritmo é fixo: a próxima volta é marcada a partir do começo da anterior
 * (não do fim), e cada volta espera no máximo `OCIOSO_MS` por tempo ocioso do navegador
 * (`requestIdleCallback`), para não travar rolagem nem animação sem atrasar a conferência numa
 * página ocupada. Entre duas voltas: o intervalo, mais até `OCIOSO_MS`. A guarda mede o próprio custo e,
 * se a média passar de 1% do intervalo, dobra o intervalo até `INTERVALO_MAX_MS`. Se pegar depuração
 * remota ou F12, avisa uma vez em POST /.anti-rea/pego, para de vigiar e só recarrega quando o
 * porteiro responde 204 (passe revogado).
 * `sondarPausa` (padrão true) liga a sonda de `debugger;`; com false ela nem vai no script
 * (o servidor, em src/porteiro/servidor.ts, passa `cfg.check.devtoolsIsCaught`).
 */
export function scriptGuarda(opts: { sondarPausa?: boolean } = {}): string {
  const sondar = opts.sondarPausa !== false;
  const coletor = sondar ? COLETOR : COLETOR_SEM_PAUSA;
  const pausaNestaVolta = sondar ? `t-ultimaPausa>=${PAUSA_MS}` : "false";
  return (
    `(function(){if(window.__antiReaGuarda)return;window.__antiReaGuarda=1;` +
    `var coletar=(${coletor});var d=document,memo={},avisado=false,vez=0,intervalo=${INTERVALO_MS},` +
    `ultimaPausa=-Infinity,primeira=true,soma=0,voltas=0,inicio=0;` +
    `function agora(){return window.performance&&performance.now?performance.now():Date.now()}` +
    `function visivel(){return d.visibilityState==="visible"}` +
    `function vigiar(){if(avisado||!visivel())return;var t=agora();` +
    `var pausa=${pausaNestaVolta};if(pausa)ultimaPausa=t;var s=coletar("",pausa,memo);` +
    `if(s.cdp||s.devtoolsAberto){avisado=true;vez++;` +
    `fetch("/.anti-rea/pego",{method:"POST",credentials:"same-origin",` +
    `headers:{"content-type":"application/json"},body:JSON.stringify(s)})` +
    `.then(function(r){if(r.status===204)location.reload()},function(){});return}` +
    `if(primeira)primeira=false;else if(!pausa){soma+=agora()-t;` +
    `if(++voltas===${VOLTAS_NA_MEDIA}){` +
    `if(soma/voltas>intervalo*${TETO_CPU})intervalo=Math.min(intervalo*2,${INTERVALO_MAX_MS});soma=0;voltas=0}}` +
    `agendar(inicio+intervalo-agora())}` +
    `function agendar(ms){var minha=++vez;setTimeout(function(){if(minha!==vez)return;inicio=agora();` +
    `if(window.requestIdleCallback)requestIdleCallback(function(){if(minha===vez)vigiar()},{timeout:${OCIOSO_MS}});` +
    `else vigiar()},Math.max(0,ms))}` +
    `d.addEventListener("visibilitychange",function(){if(visivel()&&!avisado){vez++;inicio=agora();vigiar()}});` +
    `agendar(0)})();\n`
  );
}
