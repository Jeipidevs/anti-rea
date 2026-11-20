import { createHmac } from "node:crypto";
import { conferirPasse, criarPasse, type Passe } from "../passe/passe.js";

// Cookies do porteiro: passe (visitante ou dono) e marca de pego. Nenhum dos dois chega ao site.

export const COOKIE_PASSE = "anti_rea_passe";
export const COOKIE_PEGO = "anti_rea_pego";

export const DURACAO_PASSE_DONO_MS = 365 * 86_400_000;
export const DURACAO_PEGO_MS = 3_600_000;

/**
 * Chave derivada do segredo para um uso só. O passe de dono é assinado com a chave da versão do
 * código de dono: trocar a versão (`anti-rea dono --novo`) derruba os passes de dono antigos. A
 * marca de pego tem chave própria, para um passe nunca valer como marca nem o contrário.
 */
function chave(segredo: string, uso: string): string {
  return createHmac("sha256", segredo).update(`anti-rea:${uso}`).digest("base64url");
}

const chaveDono = (segredo: string, versao: number) => chave(segredo, `passe-dono:${versao}`);
const chavePego = (segredo: string) => chave(segredo, "pego");

/** Valores de cada cookie do cabeçalho Cookie (um nome pode vir repetido). */
export function lerCookies(cabecalho: string | undefined): Map<string, string[]> {
  const cookies = new Map<string, string[]>();
  if (!cabecalho) return cookies;
  for (const parte of cabecalho.split(";")) {
    const igual = parte.indexOf("=");
    if (igual < 0) continue;
    const nome = parte.slice(0, igual).trim();
    const valor = parte.slice(igual + 1).trim();
    if (nome === "") continue;
    const lista = cookies.get(nome) ?? [];
    lista.push(valor);
    cookies.set(nome, lista);
  }
  return cookies;
}

export function criarPasseVisitante(segredo: string, duracaoMs: number, agora: number): string {
  return criarPasse(segredo, "visitante", duracaoMs, agora);
}

export function criarPasseDono(segredo: string, versao: number, agora: number): string {
  return criarPasse(chaveDono(segredo, versao), "dono", DURACAO_PASSE_DONO_MS, agora);
}

export function criarMarcaPego(segredo: string, agora: number): string {
  return criarPasse(chavePego(segredo), "visitante", DURACAO_PEGO_MS, agora);
}

/** O primeiro passe válido do pedido: visitante (assinado com o segredo) ou dono (chave da versão). */
export function passeDoPedido(
  cookies: Map<string, string[]>,
  segredo: string,
  versaoDono: number,
  agora: number,
): Passe | null {
  for (const valor of cookies.get(COOKIE_PASSE) ?? []) {
    const visitante = conferirPasse(segredo, valor, agora);
    if (visitante?.tipo === "visitante") return visitante;
    const dono = conferirPasse(chaveDono(segredo, versaoDono), valor, agora);
    if (dono?.tipo === "dono") return dono;
  }
  return null;
}

export function temMarcaPego(cookies: Map<string, string[]>, segredo: string, agora: number): boolean {
  const k = chavePego(segredo);
  return (cookies.get(COOKIE_PEGO) ?? []).some((v) => conferirPasse(k, v, agora) !== null);
}

/** Set-Cookie do porteiro: HttpOnly, SameSite=Lax, Path=/ e Secure quando o pedido veio por HTTPS. */
export function cookieDoPorteiro(nome: string, valor: string, duracaoMs: number, https: boolean): string {
  const segundos = Math.max(0, Math.floor(duracaoMs / 1000));
  return `${nome}=${valor}; Max-Age=${segundos}; Path=/; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
}

/** Cabeçalho Cookie sem os cookies do porteiro; undefined quando não sobra nada. */
export function cookiesParaOSite(cabecalho: string | undefined): string | undefined {
  if (!cabecalho) return undefined;
  const sobra = cabecalho
    .split(";")
    .map((p) => p.trim())
    .filter((p) => {
      if (p === "") return false;
      const nome = p.split("=", 1)[0]!.trim();
      return nome !== COOKIE_PASSE && nome !== COOKIE_PEGO;
    });
  return sobra.length > 0 ? sobra.join("; ") : undefined;
}
