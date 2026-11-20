import type { Sinal } from "./ferramentas.js";

const SEGMENTOS_SENSIVEIS = new Set([".git", ".svn", ".hg", ".ds_store"]);
const SUFIXOS_SENSIVEIS = [".bak", ".old", ".orig", ".swp", ".sql", ".sql.gz"];
const PREFIXOS_VARREDURA = [
  "/phpmyadmin",
  "/pma",
  "/.aws/",
  "/server-status",
  "/cgi-bin/",
  "/vendor/phpunit",
  "/actuator",
  "/console",
  "/boaform",
  "/hnap1",
];

function normalizar(caminho: string): string {
  return (caminho.split(/[?#]/)[0] ?? "").toLowerCase();
}

export function caminhoTrancado(caminho: string): Sinal | null {
  const p = normalizar(caminho);
  if (p.endsWith(".map")) return { motivo: "mapa de código", gravidade: "copia" };
  const sensivel: Sinal = { motivo: "arquivo sensível", gravidade: "varredura" };
  if (p === "/.env" || p.startsWith("/.env.")) return sensivel;
  if (p.split("/").some((s) => SEGMENTOS_SENSIVEIS.has(s))) return sensivel;
  if (SUFIXOS_SENSIVEIS.some((s) => p.endsWith(s))) return sensivel;
  return null;
}

export function caminhoDeVarredura(caminho: string): Sinal | null {
  const p = normalizar(caminho);
  for (const prefixo of PREFIXOS_VARREDURA) {
    const casa = prefixo.endsWith("/") ? p.startsWith(prefixo) : p === prefixo || p.startsWith(prefixo + "/");
    if (casa) return { motivo: "caminho de varredura", gravidade: "varredura" };
  }
  return null;
}
