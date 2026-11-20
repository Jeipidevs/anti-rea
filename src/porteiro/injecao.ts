import { Transform, type TransformCallback } from "node:stream";
import zlib from "node:zlib";

// Injeção do script de guarda no HTML do site, em fluxo: só guarda o começo da página até achar
// onde pôr o script; o resto passa direto.

export const SCRIPT_GUARDA = '<script src="/.anti-rea/guarda.js" defer></script>';
const SCRIPT = Buffer.from(SCRIPT_GUARDA, "latin1");

/** Até onde procurar `</head>`. Passado isso, usa o `<body>` que já veio ou desiste da injeção. */
const LIMITE_BUSCA = 256 * 1024;

const FIM_HEAD = /<\/head\s*>/i;
const INICIO_BODY = /<body(?:\s[^>]*)?>/i;

function depoisDoBody(texto: string): number {
  const m = INICIO_BODY.exec(texto);
  return m ? m.index + m[0].length : -1;
}

/**
 * Põe o script antes de `</head>`; sem `</head>`, logo depois de `<body ...>`; sem os dois, no fim
 * do documento. Procura por bytes (latin1), então serve para UTF-8, Latin-1 e Windows-1252.
 */
export class InjetorGuarda extends Transform {
  private pendente: Buffer = Buffer.alloc(0);
  private feito = false;

  override _transform(pedaco: Buffer, _codificacao: BufferEncoding, pronto: TransformCallback): void {
    if (this.feito) return pronto(null, pedaco);
    this.pendente = Buffer.concat([this.pendente, pedaco]);
    const texto = this.pendente.toString("latin1");
    const fimHead = texto.search(FIM_HEAD);
    if (fimHead >= 0) return pronto(null, this.inserir(fimHead));
    if (this.pendente.length > LIMITE_BUSCA) {
      const corpo = depoisDoBody(texto);
      if (corpo >= 0) return pronto(null, this.inserir(corpo));
      // Página estranha: na dúvida, passa sem guarda em vez de partir uma etiqueta no meio.
      return pronto(null, this.soltar());
    }
    pronto();
  }

  override _flush(pronto: TransformCallback): void {
    if (this.feito) return pronto();
    const corpo = depoisDoBody(this.pendente.toString("latin1"));
    pronto(null, this.inserir(corpo >= 0 ? corpo : this.pendente.length));
  }

  private inserir(posicao: number): Buffer {
    const saida = Buffer.concat([this.pendente.subarray(0, posicao), SCRIPT, this.pendente.subarray(posicao)]);
    this.soltar();
    return saida;
  }

  private soltar(): Buffer {
    const saida = this.pendente;
    this.pendente = Buffer.alloc(0);
    this.feito = true;
    return saida;
  }
}

/** Codificações de conteúdo que o porteiro sabe abrir para injetar a guarda. */
export const CODIFICACOES_CONHECIDAS = new Set(["gzip", "x-gzip", "deflate", "br", "identity"]);

/**
 * Descompressor para o `content-encoding` da resposta: null quando não há compressão, undefined
 * quando a codificação é desconhecida ou em camadas (a página segue sem guarda). Tolerante a
 * fluxo cortado no fim, como os navegadores.
 */
export function descompressor(contentEncoding: string | undefined): Transform | null | undefined {
  const cod = (contentEncoding ?? "").trim().toLowerCase();
  const z = zlib.constants;
  switch (cod) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip({ flush: z.Z_SYNC_FLUSH, finishFlush: z.Z_SYNC_FLUSH });
    case "deflate":
      return zlib.createInflate({ flush: z.Z_SYNC_FLUSH, finishFlush: z.Z_SYNC_FLUSH });
    case "br":
      return zlib.createBrotliDecompress({ flush: z.BROTLI_OPERATION_FLUSH, finishFlush: z.BROTLI_OPERATION_FLUSH });
    default:
      return undefined;
  }
}

/** `accept-encoding` só com o que o porteiro sabe abrir (zstd e outras saem). */
export function aceitaSoConhecidas(acceptEncoding: string | undefined): string | undefined {
  if (!acceptEncoding) return undefined;
  const itens = acceptEncoding
    .split(",")
    .map((i) => i.trim())
    .filter((i) => CODIFICACOES_CONHECIDAS.has(i.split(";", 1)[0]!.trim().toLowerCase()));
  return itens.length > 0 ? itens.join(", ") : undefined;
}
