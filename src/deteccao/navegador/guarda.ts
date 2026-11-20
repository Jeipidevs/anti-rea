import { COLETOR } from "./desafio.js";

const INTERVALO_MS = 1500;
/** A sonda de pausa (`debugger;`) roda numa a cada tantas voltas: na hora e depois a cada 6 s. */
const VOLTAS_POR_PAUSA = 4;

/**
 * Script servido em /.anti-rea/guarda.js e injetado nas páginas reais.
 * Repete a coleta a cada 1,5 s, no tempo ocioso do navegador quando ele oferece
 * (`requestIdleCallback`), para não travar rolagem nem animação. Se pegar depuração
 * remota ou F12, avisa uma vez em POST /.anti-rea/pego, para de vigiar e só recarrega
 * quando o porteiro responde 204 (passe revogado).
 */
export function scriptGuarda(): string {
  return (
    `(function(){if(window.__antiReaGuarda)return;window.__antiReaGuarda=1;` +
    `var coletar=(${COLETOR});var avisado=false,volta=0,relogio;` +
    `function vigiar(){if(avisado)return;var s=coletar("",volta++%${VOLTAS_POR_PAUSA}===0);` +
    `if(!s.cdp&&!s.devtoolsAberto)return;avisado=true;clearInterval(relogio);` +
    `fetch("/.anti-rea/pego",{method:"POST",credentials:"same-origin",` +
    `headers:{"content-type":"application/json"},body:JSON.stringify(s)})` +
    `.then(function(r){if(r.status===204)location.reload()},function(){})}` +
    `function agendar(){if(window.requestIdleCallback)requestIdleCallback(vigiar,{timeout:1000});else vigiar()}` +
    `relogio=setInterval(agendar,${INTERVALO_MS});agendar()})();\n`
  );
}
