import { connect } from "node:net";

// Faixas de endereço da Meta (AS32934): RIPEstat por HTTPS, whois do RADb de reserva,
// guardadas em cache. Aqui também mora a conta de IP (IPv4 e IPv6 viram número) que dns.ts
// reaproveita.

export type Endereco = { familia: 4 | 6; valor: bigint };

/**
 * Resultado de uma confirmação. "nao" é resposta definitiva (o nome ou a faixa não batem);
 * "incerto" é falha passageira (tempo esgotado, SERVFAIL, faixas fora do ar ou ainda
 * carregando) e não prova nada.
 */
export type Confirmacao = "sim" | "nao" | "incerto";

type Faixa = { familia: 4 | 6; base: bigint; mascara: bigint };

const ESPERA_APOS_FALHA_MS = 5 * 60_000;
const ESPERA_PRIMEIRA_CARGA_MS = 3_000;
const TEMPO_WHOIS_MS = 15_000;
const TEMPO_RIPESTAT_MS = 10_000;
const URL_RIPESTAT =
  "https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS32934&sourceapp=anti-rea";

function ipv4ParaNumero(texto: string): bigint | null {
  const partes = texto.split(".");
  if (partes.length !== 4) return null;
  let valor = 0n;
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const n = Number(parte);
    if (n > 255) return null;
    valor = (valor << 8n) | BigInt(n);
  }
  return valor;
}

function ipv6ParaNumero(texto: string): bigint | null {
  let t = texto;
  // IPv4 no final ("64:ff9b::192.0.2.1") vira dois grupos hexadecimais.
  const ultimoDoisPontos = t.lastIndexOf(":");
  const cauda = t.slice(ultimoDoisPontos + 1);
  if (cauda.includes(".")) {
    const v4 = ipv4ParaNumero(cauda);
    if (v4 === null) return null;
    t = `${t.slice(0, ultimoDoisPontos + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const metades = t.split("::");
  if (metades.length > 2) return null;
  const ler = (s: string) => (s === "" ? [] : s.split(":"));
  const inicio = ler(metades[0]!);
  const fim = metades.length === 2 ? ler(metades[1]!) : [];
  const faltam = 8 - inicio.length - fim.length;
  if (metades.length === 2 ? faltam < 1 : faltam !== 0) return null;
  const grupos = [...inicio, ...Array<string>(metades.length === 2 ? faltam : 0).fill("0"), ...fim];
  let valor = 0n;
  for (const g of grupos) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    valor = (valor << 16n) | BigInt(parseInt(g, 16));
  }
  return valor;
}

/** Lê um IP. IPv4 mapeado em IPv6 ("::ffff:a.b.c.d") vira o IPv4; zona ("%en0") é ignorada. */
export function lerEndereco(ip: string): Endereco | null {
  const t = ip.trim().split("%")[0]!;
  if (t.includes(":")) {
    const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(t);
    if (mapeado) {
      const v4 = ipv4ParaNumero(mapeado[1]!);
      return v4 === null ? null : { familia: 4, valor: v4 };
    }
    const v6 = ipv6ParaNumero(t);
    return v6 === null ? null : { familia: 6, valor: v6 };
  }
  const v4 = ipv4ParaNumero(t);
  return v4 === null ? null : { familia: 4, valor: v4 };
}

/** IPv4 mapeado em IPv6 vira o próprio IPv4; o resto volta como veio. */
export function normalizarIp(ip: string): string {
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip.trim());
  return mapeado ? mapeado[1]! : ip.trim();
}

export function mesmoEndereco(a: string, b: string): boolean {
  const x = lerEndereco(a);
  const y = lerEndereco(b);
  return x !== null && y !== null && x.familia === y.familia && x.valor === y.valor;
}

function lerFaixa(cidr: string): Faixa | null {
  const partes = cidr.trim().split("/");
  if (partes.length !== 2 || !/^\d{1,3}$/.test(partes[1]!)) return null;
  const prefixo = Number(partes[1]);
  const texto = partes[0]!;
  const valor = texto.includes(":") ? ipv6ParaNumero(texto) : ipv4ParaNumero(texto);
  if (valor === null) return null;
  const familia = texto.includes(":") ? 6 : 4;
  const bits = familia === 4 ? 32 : 128;
  if (prefixo > bits) return null;
  const mascara = prefixo === 0 ? 0n : ((1n << BigInt(prefixo)) - 1n) << BigInt(bits - prefixo);
  return { familia, base: valor & mascara, mascara };
}

/** Linhas `route:` e `route6:` de uma resposta whois em formato RPSL, sem repetir. */
export function lerFaixasWhois(texto: string): string[] {
  const vistas = new Set<string>();
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^route6?:\s*(\S+)/.exec(linha);
    if (m) vistas.add(m[1]!);
  }
  return [...vistas];
}

/** Campo `data.prefixes[].prefix` da resposta do RIPEstat, sem repetir. Formato estranho vira []. */
export function lerFaixasRipestat(resposta: unknown): string[] {
  const prefixos = (resposta as { data?: { prefixes?: unknown } } | null)?.data?.prefixes;
  if (!Array.isArray(prefixos)) return [];
  const vistas = new Set<string>();
  for (const item of prefixos) {
    const prefixo = (item as { prefix?: unknown } | null)?.prefix;
    if (typeof prefixo === "string") vistas.add(prefixo);
  }
  return [...vistas];
}

type BuscarHttp = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** Pede ao RIPEstat (HTTPS, 10 s) os prefixos anunciados pelo AS32934. */
export async function buscarFaixasMetaPorRipestat(buscarHttp: BuscarHttp = fetch): Promise<string[]> {
  const resposta = await buscarHttp(URL_RIPESTAT, { signal: AbortSignal.timeout(TEMPO_RIPESTAT_MS) });
  if (!resposta.ok) throw new Error(`RIPEstat respondeu ${resposta.status}`);
  return lerFaixasRipestat(await resposta.json());
}

type Fonte = () => Promise<string[]>;

/**
 * Faixas da Meta: primeiro o RIPEstat (HTTPS); se ele falhar ou vier vazio, o whois do RADb
 * (porta 43, que muita VPS bloqueia). As duas falhando, lança o erro da reserva.
 */
export async function buscarFaixasMeta(
  fontes: { principal: Fonte; reserva: Fonte } = {
    principal: () => buscarFaixasMetaPorRipestat(),
    reserva: buscarFaixasMetaPorWhois,
  },
): Promise<string[]> {
  try {
    const faixas = await fontes.principal();
    if (faixas.length > 0) return faixas;
  } catch {
    // Segue para a reserva.
  }
  return fontes.reserva();
}

/** Consulta o RADb (`whois.radb.net:43`) pelas rotas anunciadas pelo AS32934. */
export function buscarFaixasMetaPorWhois(): Promise<string[]> {
  return new Promise((resolver, rejeitar) => {
    const pedacos: Buffer[] = [];
    const conexao = connect({ host: "whois.radb.net", port: 43 });
    conexao.setTimeout(TEMPO_WHOIS_MS, () => {
      conexao.destroy(new Error("whois do RADb não respondeu a tempo"));
    });
    conexao.on("connect", () => conexao.end("-i origin AS32934\r\n"));
    conexao.on("data", (pedaco: Buffer) => pedacos.push(pedaco));
    conexao.on("error", rejeitar);
    conexao.on("close", (comErro) => {
      if (!comErro) resolver(lerFaixasWhois(Buffer.concat(pedacos).toString("utf8")));
    });
  });
}

/**
 * Faixas em cache por `validadeMs` (24 h). `aquecer` inicia a carga sem bloquear (chamado na
 * subida). Sem nenhuma faixa ainda, `contem` espera a carga no máximo `esperaPrimeiraCargaMs`
 * (3 s); passado isso devolve "incerto" e a carga segue em segundo plano. Vencida a validade,
 * a renovação corre em segundo plano e as faixas antigas valem até ela terminar. Falha na
 * busca: "incerto" enquanto não houver faixas, nova tentativa depois de 5 minutos.
 */
export class FaixasMeta {
  private faixas: Faixa[] = [];
  private carregadoEm: number | null = null;
  private falhouEm: number | null = null;
  private emAndamento: Promise<void> | null = null;

  constructor(
    private readonly buscar: () => Promise<string[]>,
    private readonly validadeMs = 86_400_000,
    private readonly esperaPrimeiraCargaMs = ESPERA_PRIMEIRA_CARGA_MS,
  ) {}

  /** Começa a carregar as faixas, se preciso, sem esperar o resultado. */
  aquecer(agora: number = Date.now()): void {
    this.iniciarCargaSePreciso(agora);
  }

  async contem(ip: string, agora: number): Promise<Confirmacao> {
    const carga = this.iniciarCargaSePreciso(agora);
    // Renovação corre em segundo plano com as faixas antigas; só a primeira carga faz esperar.
    if (carga && this.faixas.length === 0) await this.esperarNoMaximo(carga, this.esperaPrimeiraCargaMs);
    const endereco = lerEndereco(ip);
    if (!endereco) return "nao";
    if (this.faixas.length === 0) return "incerto";
    const dentro = this.faixas.some(
      (f) => f.familia === endereco.familia && (endereco.valor & f.mascara) === f.base,
    );
    return dentro ? "sim" : "nao";
  }

  private precisaBuscar(agora: number): boolean {
    if (this.falhouEm !== null && agora - this.falhouEm < ESPERA_APOS_FALHA_MS) return false;
    return this.carregadoEm === null || agora - this.carregadoEm >= this.validadeMs;
  }

  /** A carga em andamento (nova ou já começada), ou null quando as faixas estão em dia. */
  private iniciarCargaSePreciso(agora: number): Promise<void> | null {
    if (this.emAndamento) return this.emAndamento;
    if (!this.precisaBuscar(agora)) return null;
    this.emAndamento = this.carregar(agora).finally(() => {
      this.emAndamento = null;
    });
    return this.emAndamento;
  }

  private async esperarNoMaximo(carga: Promise<void>, ms: number): Promise<void> {
    let relogio: NodeJS.Timeout | undefined;
    const limite = new Promise<void>((resolver) => {
      relogio = setTimeout(resolver, ms);
      relogio.unref?.();
    });
    await Promise.race([carga, limite]).finally(() => clearTimeout(relogio));
  }

  private async carregar(agora: number): Promise<void> {
    try {
      const faixas = (await this.buscar())
        .map(lerFaixa)
        .filter((f): f is Faixa => f !== null);
      if (faixas.length === 0) throw new Error("nenhuma faixa válida");
      this.faixas = faixas;
      this.carregadoEm = agora;
      this.falhouEm = null;
    } catch {
      // Sem faixas novas: mantém as antigas (se houver) e só tenta de novo depois da espera.
      this.falhouEm = agora;
    }
  }
}
