import { readFileSync, writeFileSync } from "node:fs";
import { carregarConfig } from "../config/carregar.js";
import { codigoDeDono } from "../passe/passe.js";
import { ambienteComEnv, caminhoDoEnv, versaoDoDono } from "./start.js";

/** Link que dá o passe de dono no domínio. */
export function linkDeDono(dominio: string, segredo: string, versao: number): string {
  return `https://${dominio}/.anti-rea/dono/${codigoDeDono(segredo, versao)}`;
}

/** Troca (ou acrescenta) a linha ANTI_REA_OWNER_VERSION do .env, sem mexer no resto nem no modo do arquivo. */
function gravarVersao(caminho: string, versao: number): void {
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    throw new Error(`Não achei o .env em ${caminho}. Rode anti-rea init antes.`);
  }
  const linha = `ANTI_REA_OWNER_VERSION=${versao}`;
  const existente = /^[ \t]*ANTI_REA_OWNER_VERSION[ \t]*=.*$/m;
  if (existente.test(texto)) {
    texto = texto.replace(existente, linha);
  } else {
    texto = `${texto}${texto === "" || texto.endsWith("\n") ? "" : "\n"}${linha}\n`;
  }
  writeFileSync(caminho, texto);
}

/**
 * O `anti-rea dono`: devolve as linhas com o link de dono de cada domínio. Com `novo`, soma 1 em
 * ANTI_REA_OWNER_VERSION no .env ao lado da config: o código muda e os passes de dono antigos caem.
 */
export function mostrarDono(config: string, novo: boolean, env: NodeJS.ProcessEnv = process.env): string[] {
  const cfg = carregarConfig(config);
  const efetivo = ambienteComEnv(config, env);
  const segredo = efetivo.ANTI_REA_SECRET;
  if (!segredo) {
    throw new Error(`Sem ANTI_REA_SECRET em ${caminhoDoEnv(config)}: o link de dono depende dele. Rode anti-rea init.`);
  }
  let versao = versaoDoDono(efetivo);
  const linhas: string[] = [];
  if (novo) {
    versao++;
    gravarVersao(caminhoDoEnv(config), versao);
    linhas.push(`Link de dono trocado (versão ${versao}). Os passes de dono antigos deixam de valer.`);
    if (env.ANTI_REA_OWNER_VERSION) {
      linhas.push("Atenção: ANTI_REA_OWNER_VERSION também está no ambiente e vale mais que o .env. Troque lá também.");
    }
    linhas.push("Reinicie o porteiro (anti-rea start) para o link novo valer.");
  } else {
    linhas.push("Seu link de dono (guarde, ele libera você):");
  }
  for (const dominio of cfg.domains) linhas.push(linkDeDono(dominio, segredo, versao));
  return linhas;
}
