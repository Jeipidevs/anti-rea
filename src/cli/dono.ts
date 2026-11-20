import { readFileSync, writeFileSync } from "node:fs";
import { carregarConfig } from "../config/carregar.js";
import { codigoDeDono } from "../passe/passe.js";
import { ambienteComEnv, analisarEnv, caminhoDoEnv, versaoDoDono } from "./start.js";

/** Link que dá o passe de dono no domínio. */
export function linkDeDono(dominio: string, segredo: string, versao: number): string {
  return `https://${dominio}/.anti-rea/dono/${codigoDeDono(segredo, versao)}`;
}

const CHAVE_VERSAO = "ANTI_REA_OWNER_VERSION";

/** A linha define ANTI_REA_OWNER_VERSION do jeito que o analisarEnv lê (espaços em volta, sem `#` na frente)? */
function linhaDaVersao(bruta: string): boolean {
  const linha = bruta.trim();
  if (linha.startsWith("#")) return false;
  const igual = linha.indexOf("=");
  return igual > 0 && linha.slice(0, igual).trim() === CHAVE_VERSAO;
}

/**
 * Grava ANTI_REA_OWNER_VERSION no .env sem mexer no resto nem no modo do arquivo. A chave repetida
 * (o .env.example colado por cima, por exemplo) vira uma linha só, no lugar da primeira; sem a linha,
 * ela entra no fim. Depois relê o .env como o start lê e falha se a versão que vale não for a gravada.
 */
function gravarVersao(caminho: string, versao: number): void {
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    throw new Error(`Não achei o .env em ${caminho}. Rode anti-rea init antes.`);
  }
  const nova = `${CHAVE_VERSAO}=${versao}`;
  const saida: string[] = [];
  let gravou = false;
  for (const linha of texto.split("\n")) {
    if (!linhaDaVersao(linha)) {
      saida.push(linha);
    } else if (!gravou) {
      saida.push(linha.endsWith("\r") ? `${nova}\r` : nova);
      gravou = true;
    }
  }
  texto = saida.join("\n");
  if (!gravou) texto = `${texto}${texto === "" || texto.endsWith("\n") ? "" : "\n"}${nova}\n`;
  writeFileSync(caminho, texto);

  const valendo = analisarEnv(readFileSync(caminho, "utf8"))[CHAVE_VERSAO];
  let lida: number | undefined;
  try {
    lida = versaoDoDono({ [CHAVE_VERSAO]: valendo });
  } catch {
    lida = undefined;
  }
  if (lida !== versao) {
    throw new Error(
      `Gravei ${nova} em ${caminho}, mas ao reler vale ${CHAVE_VERSAO}=${valendo ?? "(ausente)"}. ` +
        "O link de dono não foi trocado: confira o .env à mão.",
    );
  }
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
    linhas.push("No Docker, rode docker compose up -d: ele recria o contêiner. O docker compose restart não relê o .env.");
  } else {
    linhas.push("Seu link de dono (guarde, ele libera você):");
  }
  for (const dominio of cfg.domains) linhas.push(linkDeDono(dominio, segredo, versao));
  return linhas;
}
