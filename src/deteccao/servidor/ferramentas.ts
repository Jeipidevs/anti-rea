export type Gravidade = "copia" | "varredura";
export type Sinal = { motivo: string; gravidade: Gravidade };

const SCANNERS = ["sqlmap", "nikto", "nuclei", "masscan", "zgrab", "dirbuster", "gobuster", "ffuf", "wpscan"];
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

const LISTA: Array<{ nome: string; gravidade: Gravidade }> = [
  ...COPIADORES.map((nome) => ({ nome, gravidade: "copia" as const })),
  ...SCANNERS.map((nome) => ({ nome, gravidade: "varredura" as const })),
];

export function ferramentaConhecida(agente: string | undefined): Sinal | null {
  const texto = (agente ?? "").trim().toLowerCase();
  if (texto === "") return { motivo: "sem agente", gravidade: "copia" };
  for (const { nome, gravidade } of LISTA) {
    if (texto.includes(nome)) return { motivo: nome, gravidade };
  }
  return null;
}
