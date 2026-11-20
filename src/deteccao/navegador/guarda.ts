import { COLETOR } from "./desafio.js";

const INTERVALO_MS = 1500;

/**
 * Script servido em /.anti-rea/guarda.js e injetado nas páginas reais.
 * Repete a coleta a cada 1,5 s; se pegar depuração remota ou F12, avisa uma vez em
 * POST /.anti-rea/pego e só recarrega quando o porteiro responde 204 (passe revogado).
 */
export function scriptGuarda(): string {
  return (
    `(function(){if(window.__antiReaGuarda)return;window.__antiReaGuarda=1;` +
    `var coletar=(${COLETOR});var avisado=false;` +
    `function vigiar(){if(avisado)return;var s=coletar("");if(!s.cdp&&!s.devtoolsAberto)return;avisado=true;` +
    `fetch("/.anti-rea/pego",{method:"POST",credentials:"same-origin",` +
    `headers:{"content-type":"application/json"},body:JSON.stringify(s)})` +
    `.then(function(r){if(r.status===204)location.reload()},function(){})}` +
    `vigiar();setInterval(vigiar,${INTERVALO_MS})})();\n`
  );
}
