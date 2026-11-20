import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Título, descrição e imagem do site, para a prévia de links (WhatsApp, Telegram). */
export type Previa = { titulo?: string; descricao?: string; imagem?: string };

const VALIDADE_NONCE_MS = 120_000;

/**
 * Coletor de sinais do navegador. Fonte única, usada pela tela de desafio e pela
 * guarda; copiado sem mudança em tests/fixtures/coletor.js (um teste confere).
 * Chamada: `coletor(nonce, sondarPausa, memo?)`. Provas no Chrome real: tests/e2e/coletor-cdp.test.ts.
 *
 * - `memo` (opcional): objeto que quem chama guarda entre as chamadas; as 1000 linhas da tabela são
 *   montadas uma vez e reaproveitadas. A guarda passa o mesmo `memo` em todas as voltas: o Chrome
 *   guarda os argumentos do console mesmo com o DevTools fechado, e uma tabela nova por volta
 *   retinha uns 7,5 MB na página (docs/_medicoes/2026-11-guarda.md). A detecção não muda: com a
 *   mesma tabela já impressa várias vezes, o `Runtime.enable` ainda deu `cdp` em todas as chamadas.
 * - A tabela impressa é um objeto simples com as linhas em 0..999, não uma lista: o V8 transforma
 *   cada mensagem do console em texto mesmo com o DevTools fechado e guarda até 10 MiB por página
 *   (contando o texto a 2 bytes por caractere); o Chrome guarda outra cópia e manda o texto ao
 *   processo principal. Lista vira "[object Object]," 1000 vezes (16 mil caracteres por chamada);
 *   objeto simples vira "[object Object]". A prévia linha por linha, que só existe com
 *   `Runtime.enable`, custa o mesmo. A base (cópia em JSON) continua sobre a lista.
 *
 * - Pausa (`sondarPausa`): `debugger;` só para quando o domínio Debugger está ligado
 *   (F12 aberto). Exige duas pausas seguidas de mais de 50 ms, para relógio arredondado
 *   não enganar. Pausa é F12, nunca `cdp`, para respeitar `devtoolsIsCaught: false`.
 * - Runtime (automação por CDP, como o REA): com `Runtime.enable` o Chrome monta a prévia
 *   de cada linha de `console.table`, que passa a custar dezenas de vezes o tempo de
 *   copiar as mesmas linhas em JSON (medido no Chrome 157: razão de 70 a 134 com CDP,
 *   de 0,5 a 3,1 sem; com a tabela como objeto, na Task 13: no mínimo 40 com CDP, no
 *   máximo 0,25 sem). Limiar: 20 vezes. Só roda em Blink e com `console.table` nativo
 *   (ferramenta do site que embrulha o console poderia encarecer a chamada). Com a
 *   janela encolhida mais de 160 px (F12 acoplado com pausas desligadas) conta como F12.
 * - O getter em `Error.stack` passado a `console.debug` não serve mais: no Chrome 157
 *   ele não roda nem com `Runtime.enable`.
 * - `uaChrome` só vale para Chrome de computador: celular e WebView (navegador
 *   embutido do Instagram, WhatsApp) ficam de fora, porque lá `window.chrome` e os
 *   plugins faltam de verdade. Vale também para celular no "modo computador" (o
 *   DuckDuckGo do Android manda UA de Linux x86_64 numa WebView): tela de toque ou
 *   dica de celular no `userAgentData` (Android, `mobile`, marca "Android WebView")
 *   tiram o `uaChrome`.
 */
function fonteColetor(comPausa: boolean): string {
  const pausa = comPausa
    ? `  var pausa = function () { var t = agora(); debugger; return agora() - t > 50; };
  var pausou = !!sondarPausa && pausa() && pausa();`
    : "  var pausou = false;";
  return `function (nonce, sondarPausa, memo) {
  var n = navigator, w = window, ua = String(n.userAgent || "");
  var agora = function () { return w.performance && performance.now ? performance.now() : Date.now(); };
  var temChrome = typeof w.chrome === "object" && w.chrome !== null;
  var encolhida = w.outerWidth - w.innerWidth > 160 || w.outerHeight - w.innerHeight > 160;
${pausa}
  var celular = /Android|Mobile|; wv\\)/.test(ua) || n.maxTouchPoints > 0;
  try {
    var d = n.userAgentData;
    if (d) celular = celular || d.mobile === true || d.platform === "Android" ||
      (d.brands || []).some(function (b) { return /Android WebView/.test(b.brand); });
  } catch (x) {}
  var runtime = false;
  try {
    var nativo = /\\[native code\\]/.test(Function.prototype.toString.call(console.table));
    if ((temChrome || !!n.userAgentData) && nativo) {
      var linhas = memo && memo.linhas, tabela = memo && memo.tabela;
      if (!linhas || !tabela) {
        linhas = [];
        tabela = {};
        for (var i = 0; i < 1000; i++) { linhas.push({ a: i, b: "x" + i, c: i % 7 }); tabela[i] = linhas[i]; }
        if (memo) { memo.linhas = linhas; memo.tabela = tabela; }
      }
      var t0 = agora(), voltas = 0;
      do { JSON.parse(JSON.stringify(linhas)); voltas++; } while (agora() - t0 < 2 && voltas < 200);
      var base = Math.max((agora() - t0) / voltas, 0.1);
      var custo = Infinity;
      for (var k = 0; k < 2; k++) { var t1 = agora(); console.table(tabela); custo = Math.min(custo, agora() - t1); }
      runtime = custo > 2 && custo > 20 * base;
    }
  } catch (x) {}
  return {
    webdriver: n.webdriver === true,
    headlessUA: /HeadlessChrome/.test(ua),
    semPlugins: !n.plugins || n.plugins.length === 0,
    temWindowChrome: temChrome,
    uaChrome: /\\bChrome\\/\\d/.test(ua) && !celular,
    cdp: runtime && !pausou && !encolhida,
    devtoolsAberto: pausou || (runtime && encolhida),
    linguas: n.languages ? n.languages.length : 0,
    nonce: String(nonce || "")
  };
}`;
}

/** Coletor completo, com a sonda de pausa (chamada: `coletor(nonce, sondarPausa, memo?)`). */
export const COLETOR = fonteColetor(true);
/** Mesmo coletor sem a sonda de pausa: nem o `debugger;` vai para a página. */
export const COLETOR_SEM_PAUSA = fonteColetor(false);

function assinar(segredo: string, carga: string): Buffer {
  return createHmac("sha256", segredo).update("nonce:" + carga).digest();
}

export function criarNonce(segredo: string, agora: number = Date.now()): string {
  const carga = `${Math.floor(agora)}.${randomBytes(9).toString("base64url")}`;
  return `${carga}.${assinar(segredo, carga).toString("base64url")}`;
}

/** Válido por 120 s a partir da criação, só com o mesmo segredo. */
export function conferirNonce(segredo: string, nonce: string, agora: number = Date.now()): boolean {
  const partes = nonce.split(".");
  if (partes.length !== 3) return false;
  const [momento, aleatorio, assinatura] = partes as [string, string, string];
  if (!/^\d+$/.test(momento) || !aleatorio || !assinatura) return false;

  const esperada = assinar(segredo, `${momento}.${aleatorio}`);
  const recebida = Buffer.from(assinatura, "base64url");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return false;

  const idade = agora - Number(momento);
  return idade >= 0 && idade <= VALIDADE_NONCE_MS;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Valor JS seguro dentro de <script>: JSON sem `<` literal. */
function jsSeguro(valor: unknown): string {
  return JSON.stringify(valor).replace(/</g, "\\u003c");
}

const TEXTOS = {
  "pt-BR": {
    verificando: "Verificando seu navegador",
    semJs: "Este site precisa de JavaScript para abrir. Ative o JavaScript e recarregue a página.",
    falha: "Não foi possível verificar. Recarregue a página.",
    semCookies: "Este site precisa de cookies para abrir. Ative os cookies e recarregue a página.",
  },
  en: {
    verificando: "Checking your browser",
    semJs: "This site needs JavaScript to open. Turn on JavaScript and reload the page.",
    falha: "Could not check your browser. Please reload the page.",
    semCookies: "This site needs cookies to open. Turn on cookies and reload the page.",
  },
} as const;

/** Recargas automáticas seguidas antes de desistir e mostrar a falha (passe que não gruda). */
const MAX_TENTATIVAS = 2;
/** Tentativa mais velha que isto não conta: o passe que vence horas depois passa de novo. */
const JANELA_TENTATIVAS_MS = 30_000;
const CHAVE_TENTATIVAS = "anti-rea-tentativas:";

function etiquetasDaPrevia(previa: Previa): string[] {
  const linhas: string[] = [];
  const descricao = previa.descricao ? escaparHtml(previa.descricao) : "";
  if (descricao) linhas.push(`<meta name="description" content="${descricao}">`);
  if (previa.titulo) linhas.push(`<meta property="og:title" content="${escaparHtml(previa.titulo)}">`);
  if (descricao) linhas.push(`<meta property="og:description" content="${descricao}">`);
  if (previa.imagem) linhas.push(`<meta property="og:image" content="${escaparHtml(previa.imagem)}">`);
  return linhas;
}

/**
 * Script da tela de desafio. Sem laço de recarga: com cookies desligados avisa e para;
 * conta as tentativas (sessionStorage, ou window.name quando ele está bloqueado) e, se o
 * passe não grudar em MAX_TENTATIVAS recargas, mostra a falha e zera a conta, para a
 * recarga manual tentar de novo. Só recarrega com resposta 2xx.
 */
function scriptDesafio(nonce: string, sondarPausa: boolean, t: (typeof TEXTOS)[keyof typeof TEXTOS]): string {
  const coletor = sondarPausa ? COLETOR : COLETOR_SEM_PAUSA;
  const K = jsSeguro(CHAVE_TENTATIVAS);
  return (
    `(function(){var m=document.getElementById("m");` +
    `function parar(x){m.textContent=x}` +
    `if(navigator.cookieEnabled===false)return parar(${jsSeguro(t.semCookies)});` +
    `function ler(){var v=null;try{v=sessionStorage.getItem(${K})}catch(e){}` +
    `if(v==null){var nm=String(window.name||"");if(nm.indexOf(${K})===0)v=nm.slice(${K}.length)}return v||""}` +
    `function gravar(v){try{sessionStorage.setItem(${K},v);return}catch(e){}window.name=${K}+v}` +
    `var agora=Date.now(),c=ler().split("."),n=parseInt(c[0],10)||0,t0=parseInt(c[1],10)||0;` +
    `if(agora-t0>${JANELA_TENTATIVAS_MS}||agora<t0)n=0;` +
    `function falhar(){gravar("");parar(${jsSeguro(t.falha)})}` +
    `if(n>=${MAX_TENTATIVAS})return falhar();` +
    `gravar((n+1)+"."+agora);` +
    `var s=(${coletor})(${jsSeguro(nonce)},${sondarPausa});` +
    `fetch("/.anti-rea/verificar",{method:"POST",credentials:"same-origin",` +
    `headers:{"content-type":"application/json"},body:JSON.stringify(s)})` +
    `.then(function(r){if(r.ok)location.reload();else falhar()},falhar)})();`
  );
}

/**
 * Tela "verificando" de menos de um segundo: coleta, posta e recarrega. Sem recurso externo.
 * `sondarPausa` (padrão true) liga a sonda de `debugger;`; a Task 9 passa
 * `cfg.check.devtoolsIsCaught`, para quem abre o F12 não parar no depurador quando ele não pega.
 */
export function paginaDesafio(opts: { nonce: string; previa: Previa; idioma: "pt-BR" | "en"; sondarPausa?: boolean }): string {
  const t = TEXTOS[opts.idioma];
  const titulo = escaparHtml(opts.previa.titulo || t.verificando);
  const script = scriptDesafio(opts.nonce, opts.sondarPausa !== false, t);

  return [
    "<!doctype html>",
    `<html lang="${opts.idioma}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${titulo}</title>`,
    ...etiquetasDaPrevia(opts.previa),
    "<style>",
    "html,body{height:100%;margin:0}",
    "body{background:#0B0C14;color:#E8E8F0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 16px}",
    ".r{width:40px;height:40px;margin:0 auto 20px;border:3px solid rgba(124,108,255,.25);border-top-color:#7C6CFF;border-radius:50%;animation:g .8s linear infinite}",
    "@keyframes g{to{transform:rotate(360deg)}}",
    "@media (prefers-reduced-motion:reduce){.r{animation-duration:2.4s}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    '<div class="r" aria-hidden="true"></div>',
    `<p id="m" role="status">${escaparHtml(t.verificando)}</p>`,
    `<noscript><p>${escaparHtml(t.semJs)}</p></noscript>`,
    "</main>",
    `<script>${script}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
