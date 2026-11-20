import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type Passe = { id: string; tipo: "visitante" | "dono"; expira: number };

const revogados = new Set<string>();

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

export function revogarPasse(id: string): void {
  revogados.add(id);
}

export function codigoDeDono(segredo: string, versao: number): string {
  return createHmac("sha256", segredo)
    .update("dono:" + versao)
    .digest("base64url")
    .slice(0, 24);
}
