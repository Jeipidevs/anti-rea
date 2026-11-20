import type { Previa } from "../deteccao/navegador/desafio.js";

// Prévia do site (título, descrição, imagem) para a tela de verificação: quem manda o link no
// WhatsApp ou no Telegram vê o cartão do site, mesmo antes de passar pela verificação.

const MAX_TEXTO = 300;
const MAX_IMAGEM = 2_000;
const VALIDADE_MS = 10 * 60_000;
const MAX_CAMINHOS = 500;

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteira, nome: string) => {
    if (nome[0] === "#") {
      const codigo = nome[1] === "x" || nome[1] === "X" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[nome.toLowerCase()] ?? inteira;
  });
}

function limpar(texto: string | undefined, max: number): string | undefined {
  if (texto === undefined) return undefined;
  const limpo = Array.from(decodificarEntidades(texto).replace(/\s+/g, " ").trim()).slice(0, max).join("");
  return limpo === "" ? undefined : limpo;
}

/** Atributos de uma etiqueta: nome em minúsculo -> valor. */
function atributos(etiqueta: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (let m = re.exec(etiqueta); m; m = re.exec(etiqueta)) {
    const nome = m[1]!.toLowerCase();
    if (!mapa.has(nome)) mapa.set(nome, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return mapa;
}

/** Lê título, descrição e imagem: etiquetas og primeiro, `<title>` e `description` de reserva. */
export function extrairPrevia(html: string): Previa {
  const metas = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = atributos(m[0]);
    const chave = (a.get("property") ?? a.get("name") ?? "").toLowerCase();
    const conteudo = a.get("content");
    if (chave !== "" && conteudo !== undefined && !metas.has(chave)) metas.set(chave, conteudo);
  }
  const tituloTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];

  const previa: Previa = {};
  const titulo = limpar(metas.get("og:title"), MAX_TEXTO) ?? limpar(tituloTag, MAX_TEXTO);
  const descricao = limpar(metas.get("og:description"), MAX_TEXTO) ?? limpar(metas.get("description"), MAX_TEXTO);
  const imagem = limpar(metas.get("og:image"), MAX_IMAGEM);
  if (titulo) previa.titulo = titulo;
  if (descricao) previa.descricao = descricao;
  if (imagem && (/^https?:\/\//i.test(imagem) || imagem.startsWith("/"))) previa.imagem = imagem;
  return previa;
}

/**
 * Prévia por caminho, guardada por 10 minutos, no máximo 500 caminhos (sai o mais antigo).
 * Pedidos simultâneos do mesmo caminho dividem a mesma busca. Erro na busca vira prévia vazia.
 */
export class CachePrevia {
  private readonly guardadas = new Map<string, { previa: Promise<Previa>; ate: number }>();

  constructor(private readonly agora: () => number = Date.now) {}

  get tamanho(): number {
    return this.guardadas.size;
  }

  obter(caminho: string, buscar: () => Promise<string>): Promise<Previa> {
    const agora = this.agora();
    const guardada = this.guardadas.get(caminho);
    if (guardada && agora < guardada.ate) return guardada.previa;
    this.guardadas.delete(caminho);
    while (this.guardadas.size >= MAX_CAMINHOS) this.guardadas.delete(this.guardadas.keys().next().value!);
    const previa = Promise.resolve()
      .then(buscar)
      .then((html) => extrairPrevia(html))
      .catch((): Previa => ({}));
    this.guardadas.set(caminho, { previa, ate: agora + VALIDADE_MS });
    return previa;
  }
}
