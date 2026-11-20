import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Config } from "../config/carregar.js";

/** Dados do pedido pego, mostrados na sombra. */
export type DadosSombra = { ip: string; caminho: string; quando: Date };

type Textos = {
  titulo: string;
  mensagem: string;
  rodape: string;
  tentativa: string;
  registrada: string;
  seuIp: string;
  donoAvisado: string;
  agoraMesmo: string;
};

const TEXTOS: Record<"pt-BR" | "en", Textos> = {
  "pt-BR": {
    titulo: "Ops. Pegamos você.",
    mensagem: "Belo esforço com o seu robô. O código que você queria não mora aqui.",
    rodape: "Que tal criar o seu? Dá menos trabalho e é mais divertido.",
    tentativa: "tentativa",
    registrada: "registrada",
    seuIp: "seu IP",
    donoAvisado: "dono avisado",
    agoraMesmo: "agora mesmo",
  },
  en: {
    titulo: "Oops. Caught you.",
    mensagem: "Nice try with your bot. The code you wanted doesn't live here.",
    rodape: "Why not build your own? It's less work and more fun.",
    tentativa: "attempt",
    registrada: "logged",
    seuIp: "your IP",
    donoAvisado: "owner notified",
    agoraMesmo: "just now",
  },
};

const COR_PADRAO = "#7C6CFF";
const COR_VALIDA = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Extensão do logo -> MIME. O que não está aqui fica sem logo. */
const MIME_LOGO: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Leitor padrão: imagem binária volta em base64, o resto (SVG, HTML) em UTF-8. */
function lerDoDisco(p: string): string {
  const ext = extname(p).toLowerCase();
  const binario = ext in MIME_LOGO && ext !== ".svg";
  return readFileSync(p, binario ? "base64" : "utf8");
}

function escapar(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Hora local do servidor: dd/mm/aaaa hh:mm em pt-BR, yyyy-mm-dd hh:mm em inglês. */
function formatarHora(q: Date, ingles: boolean): string {
  if (Number.isNaN(q.getTime())) return "";
  const [d, m, a] = [dois(q.getDate()), dois(q.getMonth() + 1), q.getFullYear()];
  const hora = `${dois(q.getHours())}:${dois(q.getMinutes())}`;
  return ingles ? `${a}-${m}-${d} ${hora}` : `${d}/${m}/${a} ${hora}`;
}

/** Logo como data: URI, ou undefined se a extensão não serve ou o arquivo não abre. */
function logoDataUri(caminho: string, ler: (p: string) => string): string | undefined {
  const ext = extname(caminho).toLowerCase();
  const mime = MIME_LOGO[ext];
  if (!mime) return undefined;
  try {
    const conteudo = ler(caminho);
    const b64 = ext === ".svg" ? Buffer.from(conteudo, "utf8").toString("base64") : conteudo.trim();
    return `data:${mime};base64,${b64}`;
  } catch {
    return undefined;
  }
}

/** Marca do ANTI-REA (a mesma de assets/telas/pagina-sombra.svg), em SVG embutido. */
function marca(cor: string): string {
  return `<svg class="marca" viewBox="30 30 204 204" aria-hidden="true"><rect x="84" y="84" width="140" height="140" rx="26" fill="${cor}"/><rect x="40" y="40" width="140" height="140" rx="26" fill="#0B0C14" stroke="#EEF0FF" stroke-width="18"/><path fill="none" stroke="#EEF0FF" stroke-width="16" stroke-linecap="round" d="M78 122Q104 144 142 108"/></svg>`;
}

/**
 * Monta a página sombra: HTML fechado, sem script e sem recurso de fora. Nada do
 * site real entra aqui. `lerArquivo` lê o `logo` e o `template` (padrão: disco).
 */
export function paginaSombra(
  cfg: Config["shadow"],
  dados: DadosSombra,
  lerArquivo: (p: string) => string = lerDoDisco,
): string {
  const ingles = cfg.language === "en";
  const lang = ingles ? "en" : "pt-BR";
  const t = TEXTOS[lang];
  const hora = formatarHora(dados.quando, ingles);
  const ip = cfg.showIp ? dados.ip : "";

  if (cfg.template) {
    let tpl: string | undefined;
    try {
      tpl = lerArquivo(cfg.template);
    } catch {
      tpl = undefined;
    }
    if (tpl !== undefined) {
      const valores: Record<string, string> = { ip, path: dados.caminho, time: hora };
      return tpl.replace(/\{\{(ip|path|time)\}\}/g, (_, k: string) => escapar(valores[k]));
    }
  }

  const cor = cfg.accentColor && COR_VALIDA.test(cfg.accentColor) ? cfg.accentColor : COR_PADRAO;
  const titulo = escapar(cfg.title ?? t.titulo);
  const mensagem = escapar(cfg.message ?? t.mensagem);
  const rodape = escapar(cfg.footer ?? t.rodape);
  const logo = cfg.logo ? logoDataUri(cfg.logo, lerArquivo) : undefined;
  const topo = logo ? `<img class="logo" src="${escapar(logo)}" alt="">` : marca(cor);
  const linhaIp = cfg.showIp
    ? `<div class="linha"><span>${escapar(t.seuIp)}</span><span class="ip">${escapar(ip)}</span></div>`
    : "";
  const quando = Number.isNaN(dados.quando.getTime())
    ? ""
    : `<p class="quando"><time datetime="${escapar(dados.quando.toISOString())}">${escapar(hora)}</time></p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${titulo}</title>
<style>
:root { --cor: ${cor}; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 32px 16px; background: #0B0C14;
  background-image: radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--cor) 28%, transparent), transparent 60%);
  color: #EEF0FF; font-family: Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; text-align: center;
}
main { width: 100%; max-width: 720px; }
.marca, .logo { width: 86px; height: 86px; object-fit: contain; margin: 0 auto 28px; display: block; }
h1 { font-size: clamp(32px, 6vw, 48px); font-weight: 800; letter-spacing: -1px; margin: 0 0 16px; }
.mensagem { font-size: clamp(17px, 2.6vw, 22px); color: color-mix(in srgb, var(--cor) 55%, #FFFFFF); margin: 0 0 12px; }
.rodape { font-size: clamp(15px, 2vw, 18px); color: #8A90B2; margin: 0 0 40px; }
.cartao {
  max-width: 400px; margin: 0 auto; padding: 22px 28px; border-radius: 16px;
  background: #141626; border: 1px solid #262A40; text-align: left;
  font-family: "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px;
}
.linha { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; color: #8A90B2; }
.linha span:last-child { text-align: right; overflow-wrap: anywhere; }
.registrada { color: #FF8DA2; }
.ip { color: #EEF0FF; }
.avisado { color: #3BE8A8; }
.quando { margin: 14px 0 0; font-family: "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: #5A6088; }
</style>
</head>
<body>
<main>
${topo}
<h1>${titulo}</h1>
<p class="mensagem">${mensagem}</p>
<p class="rodape">${rodape}</p>
<div class="cartao">
<div class="linha"><span>${escapar(t.tentativa)}</span><span class="registrada">${escapar(t.registrada)}</span></div>
${linhaIp}
<div class="linha"><span>${escapar(t.donoAvisado)}</span><span class="avisado">${escapar(t.agoraMesmo)}</span></div>
</div>
${quando}
</main>
</body>
</html>
`;
}
