/**
 * `copia`: tentativa de copiar o site; `ataque`: scanner apontado para o site. Os dois sempre avisam.
 * `varredura`: varredura genérica da internet; avisa conforme `alerts.scans`.
 */
export type Gravidade = "copia" | "ataque" | "varredura";
export type Sinal = { motivo: string; gravidade: Gravidade };

/** Scanner apontado para um site (ataque direcionado). docs/05 lista estes nomes; um teste confere. */
export const SCANNERS = [
  "sqlmap",
  "nikto",
  "nuclei",
  "dirbuster",
  "gobuster",
  "ffuf",
  "wpscan",
  "feroxbuster",
  "wfuzz",
  "openvas",
  "w3af",
  "arachni",
  "commix",
];
/** Agente padrão de scanner que não leva o próprio nome: o motivo é o nome da ferramenta. */
const APELIDOS: Array<[string, string]> = [["fuzz faster u fool", "ffuf"]];
/** Varredura da internet inteira, que passa por todo site público. */
const VARREDORES = ["masscan", "zgrab"];
const COPIADORES = [
  "wget",
  "curl",
  "httrack",
  "python-requests",
  "python-urllib",
  "aiohttp",
  "scrapy",
  "go-http-client",
  "java/",
  "okhttp",
  "libwww-perl",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "selenium",
];

// Scanner antes do copiador: scanner que embrulha um cliente de HTTP conhecido continua ataque.
const LISTA: Array<{ trecho: string; motivo: string; gravidade: Gravidade }> = [
  ...SCANNERS.map((nome) => ({ trecho: nome, motivo: nome, gravidade: "ataque" as const })),
  ...APELIDOS.map(([trecho, motivo]) => ({ trecho, motivo, gravidade: "ataque" as const })),
  ...COPIADORES.map((nome) => ({ trecho: nome, motivo: nome, gravidade: "copia" as const })),
  ...VARREDORES.map((nome) => ({ trecho: nome, motivo: nome, gravidade: "varredura" as const })),
];

export function ferramentaConhecida(agente: string | undefined): Sinal | null {
  const texto = (agente ?? "").trim().toLowerCase();
  if (texto === "") return { motivo: "sem agente", gravidade: "copia" };
  for (const { trecho, motivo, gravidade } of LISTA) {
    if (texto.includes(trecho)) return { motivo, gravidade };
  }
  return null;
}
