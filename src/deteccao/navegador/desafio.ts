import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Título, descrição e imagem do site, para a prévia de links (WhatsApp, Telegram). */
export type Previa = { titulo?: string; descricao?: string; imagem?: string };

const VALIDADE_NONCE_MS = 120_000;

/**
 * Coletor de sinais do navegador. Fonte única, usada pela tela de desafio e pela
 * guarda; copiado sem mudança em tests/fixtures/coletor.js (um teste confere).
 *
 * - `cdp` e `devtoolsAberto` usam o mesmo getter em `stack` de um `Error` passado a
 *   `console.debug`: o getter só roda quando um protocolo de depuração serializa o
 *   objeto. Com a janela encolhida em mais de 160 px (F12 acoplado) é F12; sem isso
 *   é depuração remota. A diferença de tamanho sozinha (zoom, barra lateral) não pega.
 * - `uaChrome` só vale para Chrome de computador: celular e WebView (navegador
 *   embutido do Instagram, WhatsApp) ficam de fora, porque lá `window.chrome` e os
 *   plugins faltam de verdade.
 */
export const COLETOR = `function (nonce) {
  var n = navigator, w = window, ua = String(n.userAgent || "");
  var getter = false;
  try {
    var e = new Error("anti-rea");
    Object.defineProperty(e, "stack", { configurable: true, get: function () { getter = true; return ""; } });
    console.debug(e);
  } catch (x) {}
  var encolhida = w.outerWidth - w.innerWidth > 160 || w.outerHeight - w.innerHeight > 160;
  return {
    webdriver: n.webdriver === true,
    headlessUA: /HeadlessChrome/.test(ua),
    semPlugins: !n.plugins || n.plugins.length === 0,
    temWindowChrome: typeof w.chrome === "object" && w.chrome !== null,
    uaChrome: /\\bChrome\\/\\d/.test(ua) && !/Android|Mobile|; wv\\)/.test(ua),
    cdp: getter && !encolhida,
    devtoolsAberto: getter && encolhida,
    linguas: n.languages ? n.languages.length : 0,
    nonce: String(nonce || "")
  };
}`;

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
  },
  en: {
    verificando: "Checking your browser",
    semJs: "This site needs JavaScript to open. Turn on JavaScript and reload the page.",
    falha: "Could not check your browser. Please reload the page.",
  },
} as const;

function etiquetasDaPrevia(previa: Previa): string[] {
  const linhas: string[] = [];
  const descricao = previa.descricao ? escaparHtml(previa.descricao) : "";
  if (descricao) linhas.push(`<meta name="description" content="${descricao}">`);
  if (previa.titulo) linhas.push(`<meta property="og:title" content="${escaparHtml(previa.titulo)}">`);
  if (descricao) linhas.push(`<meta property="og:description" content="${descricao}">`);
  if (previa.imagem) linhas.push(`<meta property="og:image" content="${escaparHtml(previa.imagem)}">`);
  return linhas;
}

/** Tela "verificando" de menos de um segundo: coleta, posta e recarrega. Sem recurso externo. */
export function paginaDesafio(opts: { nonce: string; previa: Previa; idioma: "pt-BR" | "en" }): string {
  const t = TEXTOS[opts.idioma];
  const titulo = escaparHtml(opts.previa.titulo || t.verificando);
  const script =
    `(function(){var s=(${COLETOR})(${jsSeguro(opts.nonce)});` +
    `fetch("/.anti-rea/verificar",{method:"POST",credentials:"same-origin",` +
    `headers:{"content-type":"application/json"},body:JSON.stringify(s)})` +
    `.then(function(){location.reload()},function(){document.getElementById("m").textContent=${jsSeguro(t.falha)}})})();`;

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
