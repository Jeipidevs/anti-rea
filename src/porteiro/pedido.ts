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
    /\/[^/]*\.webmanifest$/.test(caminho)
  );
}

/**
 * Caminho público padrão: /robots.txt, /sitemap.xml e /sitemap*.xml na raiz, /ads.txt, /app-ads.txt,
 * /favicon.ico, /manifest.json, qualquer *.webmanifest e tudo sob /.well-known/. Como o isento, precisa
 * casar lido dos dois jeitos (normalizado e ao pé da letra). Só serve para caminho que não é ambíguo.
 */
export function caminhoPublico(cru: string): boolean {
  return ehPublicoPadrao(normalizarCaminho(cru)) && ehPublicoPadrao(caminhoLiteral(cru));
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

const EXTENSOES_MIDIA = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "woff", "woff2"]);

/** Imagem, fonte ou ícone pela extensão do último segmento do caminho (já normalizado). */
export function ehMidia(caminho: string): boolean {
  const ultimo = caminho.slice(caminho.lastIndexOf("/") + 1);
  const ponto = ultimo.lastIndexOf(".");
  return ponto > 0 && EXTENSOES_MIDIA.has(ultimo.slice(ponto + 1).toLowerCase());
}
