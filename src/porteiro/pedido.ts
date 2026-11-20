// Leitura do pedido: caminho cru, caminho normalizado para a detecção, domínio e tipo de pedido.

/**
 * Caminho e query do alvo do pedido. Forma de origem ("/a?b") volta como veio; forma absoluta
 * ("http://host/a?b") vira "/a?b". Qualquer outra coisa ("*", "host:443") devolve null.
 */
export function caminhoDoAlvo(alvo: string): string | null {
  if (alvo.startsWith("/")) return alvo;
  if (!/^https?:\/\//i.test(alvo)) return null;
  try {
    const url = new URL(alvo);
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/**
 * Caminho para o registro e o aviso: a query fica com os nomes e perde os valores, trocados por "..."
 * (código de login, token de troca de senha e e-mail não vão para o disco nem para o WhatsApp). Valor
 * vazio e nome sem valor ficam como vieram.
 */
export function caminhoParaORegistro(cru: string): string {
  const i = cru.indexOf("?");
  if (i < 0) return cru;
  const parametros = cru
    .slice(i + 1)
    .split("&")
    .map((p) => {
      const igual = p.indexOf("=");
      return igual < 0 || igual === p.length - 1 ? p : `${p.slice(0, igual)}=...`;
    });
  return `${cru.slice(0, i)}?${parametros.join("&")}`;
}

/** Decodifica cada sequência de %xx uma vez; sequência que não forma UTF-8 válido fica crua. */
function decodificarUmaVez(caminho: string): string {
  return caminho.replace(/(?:%[0-9a-f]{2})+/gi, (trecho) => {
    try {
      return decodeURIComponent(trecho);
    } catch {
      return trecho;
    }
  });
}

/** Caminho sem query nem fragmento. */
function semQuery(cru: string): string {
  return cru.split(/[?#]/, 1)[0] ?? "";
}

/** Parte do segmento antes do parâmetro de matriz (";..."), que Tomcat, Jetty e Spring tiram antes de resolver "..". */
function semMatriz(segmento: string): string {
  return segmento.split(";", 1)[0] ?? "";
}

/** Segmentos lidos do jeito mais largo: %xx decodificado uma vez, e barra, barra invertida, %2F e %5C separam. */
function segmentosLargos(cru: string): string[] {
  return decodificarUmaVez(semQuery(cru)).replace(/\\/g, "/").split("/").slice(1);
}

/**
 * Caminho usado nas conferências que barram (trancado, varredura, rotas internas) e na de mídia: sem
 * query nem fragmento, %xx decodificado uma vez, barra invertida vira barra, barras repetidas viram
 * uma, parâmetro de matriz sai de cada segmento e segmentos "." e ".." são resolvidos. Maiúsculas
 * ficam: quem compara decide.
 */
export function normalizarCaminho(cru: string): string {
  const segmentos = segmentosLargos(cru)
    .map(semMatriz)
    .filter((s, i, todos) => s !== "" || i === todos.length - 1);
  const saida: string[] = [];
  segmentos.forEach((s, i) => {
    const ultimo = i === segmentos.length - 1;
    if (s === "." || s === "..") {
      if (s === "..") saida.pop();
      if (ultimo) saida.push("");
      return;
    }
    saida.push(s);
  });
  return "/" + saida.join("/");
}

/**
 * O site pode resolver este caminho diferente do porteiro: tem barra invertida crua ou um segmento
 * "." ou ".." em alguma leitura (decodificado, separado por %2F ou %5C, ou sem o parâmetro de
 * matriz). Navegador nunca manda isso: ele resolve os pontos antes de pedir.
 */
export function caminhoAmbiguo(cru: string): boolean {
  if (semQuery(cru).includes("\\")) return true;
  return segmentosLargos(cru).some((s) => {
    const nome = semMatriz(s);
    return nome === "." || nome === "..";
  });
}

/**
 * Caminho lido ao pé da letra, para a conferência que libera (isento): %xx decodificado uma vez,
 * mas %2F e %5C continuam codificados (decodificar nunca cria separador), sem juntar barras e sem
 * tirar parâmetro de matriz. Só serve para caminho que não é ambíguo.
 */
export function caminhoLiteral(cru: string): string {
  return semQuery(cru)
    .split("/")
    .map((s) => decodificarUmaVez(s).replace(/\//g, "%2F").replace(/\\/g, "%5C"))
    .join("/");
}

/** Caminhos que o navegador e as integrações pedem sem cookie e que não têm código de valor. */
function ehPublicoPadrao(caminho: string): boolean {
  return (
    caminho.startsWith("/.well-known/") ||
    /^\/(?:robots\.txt|ads\.txt|app-ads\.txt|favicon\.ico|manifest\.json|sitemap[^/]*\.xml)$/.test(caminho) ||
    /\/[^/]*\.webmanifest$/.test(caminho) ||
    // Feeds: leitor de RSS não roda JavaScript nem guarda cookie. "/feed" fica de fora: pode ser uma
    // página de aplicativo, e página pública sai sem passe e quebraria o JS dela na primeira visita.
    /\/(?:rss|feed|atom)\.xml$/.test(caminho) ||
    /\/[^/]*\.(?:rss|atom)$/.test(caminho)
  );
}

/**
 * Caminho público padrão: /robots.txt, /sitemap.xml e /sitemap*.xml na raiz, /ads.txt, /app-ads.txt,
 * /favicon.ico, /manifest.json, qualquer *.webmanifest, tudo sob /.well-known/ e os feeds (rss.xml,
 * feed.xml e atom.xml em qualquer pasta, qualquer *.rss e *.atom). Como o isento, precisa casar lido
 * dos dois jeitos (normalizado e ao pé da letra). Só serve para caminho que não é ambíguo.
 */
export function caminhoPublico(cru: string): boolean {
  return ehPublicoPadrao(normalizarCaminho(cru)) && ehPublicoPadrao(caminhoLiteral(cru));
}

/** Caminho (já normalizado) é a pasta /.anti-rea ou está sob ela: é do porteiro, nunca vai ao site. */
export function caminhoDoPorteiro(caminho: string): boolean {
  const minusculo = caminho.toLowerCase();
  return minusculo === "/.anti-rea" || minusculo.startsWith("/.anti-rea/");
}

/** Host do pedido para o registro: minúsculo, sem porta, só [a-z0-9.-], até 100; vazio vira "desconhecido". */
export function dominioDoHost(host: string | undefined): string {
  const limpo = (host ?? "")
    .toLowerCase()
    .replace(/:\d*$/, "")
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 100);
  return limpo === "" ? "desconhecido" : limpo;
}

/** Navegação: GET com `accept` contendo text/html. */
export function ehNavegacao(metodo: string, accept: string | undefined): boolean {
  return metodo.toUpperCase() === "GET" && (accept ?? "").toLowerCase().includes("text/html");
}

/** Accept ausente, vazio ou só o curinga de qualquer tipo, com parâmetro ou não: quem pede não disse que formato quer. */
export function semFormato(accept: string | undefined): boolean {
  const valor = (accept ?? "").trim();
  return valor === "" || /^\*\/\*\s*(?:;[^,]*)?$/.test(valor);
}

/**
 * Pré-carga ou pré-renderização: o navegador busca a página antes de a pessoa abrir (Speculation
 * Rules, Turbo, `<link rel=prefetch>`). Vem em Sec-Purpose, Purpose, X-Purpose, X-Sec-Purpose ou
 * X-Moz, já juntos em `proposito`.
 */
export function ehPreCarga(proposito: string | undefined): boolean {
  return /prefetch|prerender|preview/i.test(proposito ?? "");
}

/** Página aberta dentro de outra (Sec-Fetch-Dest iframe ou frame). */
export function ehQuadro(destinoFetch: string | undefined): boolean {
  return /^\s*i?frame\s*$/i.test(destinoFetch ?? "");
}

const EXTENSOES_MIDIA = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "woff", "woff2"]);

/** Extensão do último segmento do caminho (já normalizado), em minúsculas; null sem ela ("pagina", ".well-known"). */
function extensao(caminho: string): string | null {
  const ultimo = caminho.slice(caminho.lastIndexOf("/") + 1);
  const ponto = ultimo.lastIndexOf(".");
  return ponto > 0 && ponto < ultimo.length - 1 ? ultimo.slice(ponto + 1).toLowerCase() : null;
}

/** Imagem, fonte ou ícone pela extensão do último segmento do caminho (já normalizado). */
export function ehMidia(caminho: string): boolean {
  const ext = extensao(caminho);
  return ext !== null && EXTENSOES_MIDIA.has(ext);
}

/** O último segmento do caminho (já normalizado) tem extensão de arquivo (`app.js`, `dados.json`). */
export function temExtensao(caminho: string): boolean {
  return extensao(caminho) !== null;
}
