import { confirmarPorDns, type Resolvedor } from "./dns.js";
import { normalizarIp, type FaixasMeta } from "./faixas-meta.js";

// Classifica o robô que o agente declara e confirma pelo endereço de onde ele vem.

export type Robo = { nome: string; classe: "busca" | "meta" | "previa" };

type Linha = { classe: Robo["classe"]; nomes: string[]; sufixos?: string[] };

// Ordem importa: busca, depois meta, depois prévia; o primeiro casamento vence.
const TABELA: Linha[] = [
  {
    classe: "busca",
    nomes: ["Googlebot", "Google-InspectionTool", "AdsBot-Google", "Mediapartners-Google"],
    sufixos: [".googlebot.com", ".google.com", ".googleusercontent.com"],
  },
  { classe: "busca", nomes: ["bingbot", "AdIdxBot"], sufixos: [".search.msn.com"] },
  { classe: "busca", nomes: ["Applebot"], sufixos: [".applebot.apple.com"] },
  { classe: "busca", nomes: ["DuckDuckBot"], sufixos: [".duckduckgo.com"] },
  { classe: "meta", nomes: ["facebookexternalhit", "meta-externalagent", "meta-externalads", "Facebot"] },
  // Prévia de link não se confirma: a do WhatsApp sai do celular de quem manda.
  {
    classe: "previa",
    nomes: [
      "WhatsApp",
      "TelegramBot",
      "Slackbot",
      "LinkedInBot",
      "Twitterbot",
      "Discordbot",
      "SkypeUriPreview",
      "Pinterestbot",
    ],
  },
];

export function roboDeclarado(agente: string | undefined): Robo | null {
  if (!agente) return null;
  const minusculo = agente.toLowerCase();
  for (const linha of TABELA) {
    for (const nome of linha.nomes) {
      if (minusculo.includes(nome.toLowerCase())) return { nome, classe: linha.classe };
    }
  }
  return null;
}

function sufixosDe(nome: string): string[] | null {
  const linha = TABELA.find((l) => l.classe === "busca" && l.nomes.includes(nome));
  return linha?.sufixos ?? null;
}

const VALIDADE_CACHE_MS = 60 * 60_000;
const LIMITE_CACHE = 10_000;
const cache = new Map<string, { confirmado: boolean; ate: number }>();

function guardar(chave: string, confirmado: boolean, agora: number): void {
  if (cache.size >= LIMITE_CACHE) {
    for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
    // Ainda cheio: sai o mais antigo (o Map guarda a ordem de entrada).
    while (cache.size >= LIMITE_CACHE) cache.delete(cache.keys().next().value!);
  }
  cache.set(chave, { confirmado, ate: agora + VALIDADE_CACHE_MS });
}

async function verificar(
  robo: Robo,
  ip: string,
  deps: { dns: Resolvedor; meta: FaixasMeta; agora: number },
): Promise<boolean> {
  if (robo.classe === "meta") return deps.meta.contem(ip, deps.agora);
  const sufixos = sufixosDe(robo.nome);
  return sufixos ? confirmarPorDns(ip, sufixos, deps.dns) : false;
}

/**
 * Confirma que o robô declarado vem mesmo de quem diz ser. Busca: DNS reverso e direto.
 * Meta: faixas do AS32934. Prévia: nunca. Resultado guardado por classe e IP durante 1 hora.
 */
export async function confirmarRobo(
  robo: Robo,
  ip: string,
  deps: { dns: Resolvedor; meta: FaixasMeta; agora: number },
): Promise<boolean> {
  if (robo.classe === "previa") return false;
  const alvo = normalizarIp(ip);
  const chave = `${robo.classe}|${alvo}`;
  const guardado = cache.get(chave);
  if (guardado && deps.agora < guardado.ate) return guardado.confirmado;
  let confirmado: boolean;
  try {
    confirmado = await verificar(robo, alvo, deps);
  } catch {
    confirmado = false;
  }
  guardar(chave, confirmado, deps.agora);
  return confirmado;
}
