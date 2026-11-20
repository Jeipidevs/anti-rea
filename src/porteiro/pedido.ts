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

/**
 * Caminho usado em toda conferência (trancado, varredura, isento, extensão, rotas internas):
 * sem query nem fragmento, %xx decodificado uma vez, barra invertida vira barra, barras repetidas
 * viram uma e segmentos "." e ".." resolvidos. Maiúsculas ficam: quem compara decide.
 */
export function normalizarCaminho(cru: string): string {
  const semQuery = cru.split(/[?#]/, 1)[0] ?? "";
  const plano = decodificarUmaVez(semQuery).replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const segmentos = plano.split("/").slice(1);
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
