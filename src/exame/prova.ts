import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import type { ClienteExame } from "./cliente.js";

// Prova de dono: o exame só roda num site que serve /.well-known/anti-rea.txt com o código dele.

export const CAMINHO_DA_PROVA = "/.well-known/anti-rea.txt";
/** Arquivo, na pasta onde o exame roda, com o código de cada site (host com porta). */
export const ARQUIVO_DOS_CODIGOS = ".anti-rea-exame.json";

/** O código do host: o que já estava no arquivo ou um novo (32 hex), gravado só para o usuário. */
export function codigoDoHost(arquivo: string, host: string, gerar: () => string = () => randomBytes(16).toString("hex")): string {
  let codigos: Record<string, string> = {};
  try {
    const lido: unknown = JSON.parse(readFileSync(arquivo, "utf8"));
    if (lido && typeof lido === "object" && !Array.isArray(lido)) codigos = lido as Record<string, string>;
  } catch {
    // arquivo ausente ou ilegível: começa do zero
  }
  const atual = codigos[host];
  if (typeof atual === "string" && /^[0-9a-f]{32}$/.test(atual)) return atual;
  const novo = gerar();
  codigos[host] = novo;
  writeFileSync(arquivo, JSON.stringify(codigos, null, 2) + "\n", { mode: 0o600 });
  chmodSync(arquivo, 0o600);
  return novo;
}

/** O conteúdo que o dono põe no arquivo da prova. */
export function linhaDaProva(codigo: string): string {
  return `anti-rea=${codigo}`;
}

export type ResultadoProva = "ok" | "sem-arquivo" | "codigo-diferente" | "sem-resposta";

/** Busca o arquivo da prova (um GET, sem seguir para outro host) e confere o código. */
export async function conferirProva(cliente: ClienteExame, codigo: string): Promise<ResultadoProva> {
  const r = await cliente.pedir(CAMINHO_DA_PROVA, { accept: "text/plain", maxBytes: 4096 });
  if (!r) return "sem-resposta";
  if (r.status !== 200) return "sem-arquivo";
  const linhas = r.texto.split(/\r?\n/).map((l) => l.trim());
  return linhas.includes(linhaDaProva(codigo)) || linhas.includes(codigo) ? "ok" : "codigo-diferente";
}
