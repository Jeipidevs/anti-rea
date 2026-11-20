import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type Passe = { id: string; tipo: "visitante" | "dono"; expira: number };

/** Teto da lista de revogados: passou dele, sai o mais antigo. */
export const MAX_REVOGADOS = 100_000;
const LIMPEZA_MS = 60_000;

/** id do passe revogado -> quando o passe vence (depois disso ele já não vale e sai da lista). */
const revogados = new Map<string, number>();
let ultimaLimpeza = Number.NEGATIVE_INFINITY;

function assinar(segredo: string, carga: string): Buffer {
  return createHmac("sha256", segredo).update(carga).digest();
}

export function criarPasse(
  segredo: string,
  tipo: Passe["tipo"],
  duracaoMs: number,
  agora: number = Date.now(),
): string {
  const passe: Passe = { id: randomUUID(), tipo, expira: agora + duracaoMs };
  const carga = Buffer.from(JSON.stringify(passe)).toString("base64url");
  return `${carga}.${assinar(segredo, carga).toString("base64url")}`;
}

export function conferirPasse(
  segredo: string,
  valor: string | undefined,
  agora: number = Date.now(),
): Passe | null {
  if (!valor) return null;
  const partes = valor.split(".");
  if (partes.length !== 2) return null;
  const [carga, assinatura] = partes as [string, string];
  if (!carga || !assinatura) return null;

  const esperada = assinar(segredo, carga);
  const recebida = Buffer.from(assinatura, "base64url");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;

  let passe: unknown;
  try {
    passe = JSON.parse(Buffer.from(carga, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof passe !== "object" || passe === null) return null;
  const { id, tipo, expira } = passe as Record<string, unknown>;
  if (typeof id !== "string") return null;
  if (tipo !== "visitante" && tipo !== "dono") return null;
  if (typeof expira !== "number" || !Number.isFinite(expira)) return null;
  if (expira <= agora) return null;
  if (revogados.has(id)) return null;
  return { id, tipo, expira };
}

/**
 * Revoga o passe até ele vencer. A lista fica só na memória: revogado vencido sai numa limpeza feita
 * no máximo uma vez por minuto, e a lista nunca passa de MAX_REVOGADOS (sai o revogado mais antigo).
 */
export function revogarPasse(id: string, expira: number = Number.POSITIVE_INFINITY, agora: number = Date.now()): void {
  // Relógio que voltou (ajuste de hora) também limpa, para a limpeza não parar até ele alcançar.
  if (agora < ultimaLimpeza || agora - ultimaLimpeza >= LIMPEZA_MS) {
    for (const [revogado, vence] of revogados) if (vence <= agora) revogados.delete(revogado);
    ultimaLimpeza = agora;
  }
  revogados.delete(id);
  revogados.set(id, expira);
  while (revogados.size > MAX_REVOGADOS) revogados.delete(revogados.keys().next().value!);
}

/** Quantos passes estão na lista de revogados agora. */
export function totalRevogados(): number {
  return revogados.size;
}

export function codigoDeDono(segredo: string, versao: number): string {
  return createHmac("sha256", segredo)
    .update("dono:" + versao)
    .digest("base64url")
    .slice(0, 24);
}
