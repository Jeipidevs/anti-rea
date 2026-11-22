// Cliente HTTP do exame: a única porta de saída dele para a rede. Só lê (GET, HEAD, OPTIONS), só no
// host provado, com teto de pedidos, de tempo e de bytes.

/** Os únicos métodos que o exame usa. O tipo impede qualquer outro. */
export type MetodoDeLeitura = "GET" | "HEAD" | "OPTIONS";

export type RespostaExame = { status: number; tipo: string; cabecalhos: Headers; bytes: Buffer; texto: string; url: URL };

export type OpcoesCliente = {
  /** Agente honesto: quem lê o registro do site sabe que foi o exame. */
  agente: string;
  maxPedidos?: number;
  tempoMs?: number;
  maxBytes?: number;
  simultaneos?: number;
  /** Para teste: troca o fetch. */
  buscar?: typeof fetch;
};

export const MAX_PEDIDOS = 150;
export const TEMPO_PEDIDO_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
const SIMULTANEOS = 4;
const MAX_REDIRECIONAMENTOS = 3;

export class ClienteExame {
  readonly origem: string;
  private cookie: string | undefined;
  private feitos = 0;
  private ativos = 0;
  private readonly fila: Array<() => void> = [];
  /** Pedidos que não saíram porque o teto acabou. */
  recusados = 0;
  private readonly maxPedidos: number;
  private readonly tempoMs: number;
  private readonly maxBytes: number;
  private readonly simultaneos: number;
  private readonly buscar: typeof fetch;

  constructor(
    base: URL,
    private readonly op: OpcoesCliente,
  ) {
    this.origem = base.origin;
    this.maxPedidos = op.maxPedidos ?? MAX_PEDIDOS;
    this.tempoMs = op.tempoMs ?? TEMPO_PEDIDO_MS;
    this.maxBytes = op.maxBytes ?? MAX_BYTES;
    this.simultaneos = op.simultaneos ?? SIMULTANEOS;
    this.buscar = op.buscar ?? fetch;
  }

  /** Quantos pedidos já saíram. */
  get pedidos(): number {
    return this.feitos;
  }

  /** Cookie que vai em todo pedido depois daqui (o passe de dono). */
  usarCookie(cookie: string): void {
    this.cookie = cookie;
  }

  /** URL do mesmo host, ou null. Nada sai para outro host. */
  resolver(caminho: string | URL): URL | null {
    let url: URL;
    try {
      url = new URL(caminho, this.origem);
    } catch {
      return null;
    }
    return url.origin === this.origem ? url : null;
  }

  private async vez(): Promise<void> {
    if (this.ativos < this.simultaneos) {
      this.ativos++;
      return;
    }
    await new Promise<void>((pronto) => this.fila.push(pronto));
  }

  private liberar(): void {
    const proximo = this.fila.shift();
    if (proximo) proximo();
    else this.ativos--;
  }

  /**
   * Faz o pedido e lê o corpo até `maxBytes`. Segue redirecionamento só no mesmo host (no máximo 3).
   * Devolve null quando a rede falha, o teto acabou ou o destino é de outro host.
   */
  async pedir(
    caminho: string | URL,
    o: { metodo?: MetodoDeLeitura; accept?: string; maxBytes?: number; seguir?: boolean } = {},
  ): Promise<RespostaExame | null> {
    let url = this.resolver(caminho);
    const metodo = o.metodo ?? "GET";
    for (let saltos = 0; url && saltos <= MAX_REDIRECIONAMENTOS; saltos++) {
      if (this.feitos >= this.maxPedidos) {
        this.recusados++;
        return null;
      }
      this.feitos++;
      await this.vez();
      let resposta: Response;
      try {
        const cabecalhos: Record<string, string> = { "user-agent": this.op.agente, accept: o.accept ?? "*/*" };
        if (this.cookie) cabecalhos.cookie = this.cookie;
        resposta = await this.buscar(url, {
          method: metodo,
          headers: cabecalhos,
          redirect: "manual",
          signal: AbortSignal.timeout(this.tempoMs),
        });
        const local = resposta.headers.get("location");
        if (o.seguir !== false && resposta.status >= 300 && resposta.status < 400 && local) {
          await resposta.body?.cancel().catch(() => {});
          url = this.resolver(new URL(local, url));
          continue;
        }
        const bytes = await lerAte(resposta, o.maxBytes ?? this.maxBytes);
        return {
          status: resposta.status,
          tipo: resposta.headers.get("content-type") ?? "",
          cabecalhos: resposta.headers,
          bytes,
          texto: bytes.toString("utf8"),
          url,
        };
      } catch {
        return null;
      } finally {
        this.liberar();
      }
    }
    return null;
  }
}

/** Lê o corpo até `max` bytes e para ali (não baixa o resto). */
async function lerAte(resposta: Response, max: number): Promise<Buffer> {
  if (!resposta.body) return Buffer.alloc(0);
  const leitor = resposta.body.getReader();
  const partes: Buffer[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(Buffer.from(value));
      total += value.length;
    }
  } finally {
    if (total >= max) await leitor.cancel().catch(() => {});
  }
  return Buffer.concat(partes).subarray(0, max);
}
