import { verificarPorDns, type Resolvedor } from "./dns.js";
import { normalizarIp, type FaixasMeta, type Veredito } from "./faixas-meta.js";

// Classifica o robô que o agente declara e confirma pelo endereço de onde ele vem.

export type Robo = { nome: string; classe: "busca" | "meta" | "previa" };

type Linha = { classe: Robo["classe"]; nomes: string[]; sufixos?: string[] };

// Ordem importa: busca, depois prévia, depois meta; o primeiro casamento vence.
// Prévia antes de meta: a prévia de link do iMessage (Mensagens no iPhone e no Mac) sai
// do aparelho de quem manda e se declara "... facebookexternalhit/1.1 Facebot Twitterbot/1.0".
// O robô de verdade da Meta não cita nenhuma prévia.
const TABELA: Linha[] = [
  {
    classe: "busca",
    nomes: ["Googlebot", "Google-InspectionTool", "AdsBot-Google", "Mediapartners-Google"],
    sufixos: [".googlebot.com", ".google.com", ".googleusercontent.com"],
  },
  { classe: "busca", nomes: ["bingbot", "AdIdxBot"], sufixos: [".search.msn.com"] },
  { classe: "busca", nomes: ["Applebot"], sufixos: [".applebot.apple.com"] },
  { classe: "busca", nomes: ["DuckDuckBot"], sufixos: [".duckduckgo.com"] },
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
  { classe: "meta", nomes: ["facebookexternalhit", "meta-externalagent", "meta-externalads", "Facebot"] },
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
// Falha passageira fica pouco tempo: evita martelar o DNS sem negar um robô real por 1 hora.
const VALIDADE_DUVIDA_MS = 60_000;
const LIMITE_CACHE = 10_000;
const cache = new Map<string, { confirmado: boolean; ate: number }>();

function guardar(chave: string, veredito: Veredito, agora: number): void {
  if (cache.size >= LIMITE_CACHE) {
    for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
    // Ainda cheio: sai o mais antigo (o Map guarda a ordem de entrada).
    while (cache.size >= LIMITE_CACHE) cache.delete(cache.keys().next().value!);
  }
  const validade = veredito === "incerto" ? VALIDADE_DUVIDA_MS : VALIDADE_CACHE_MS;
  cache.set(chave, { confirmado: veredito === "sim", ate: agora + validade });
}

async function verificar(
  robo: Robo,
  ip: string,
  deps: { dns: Resolvedor; meta: FaixasMeta; agora: number },
): Promise<Veredito> {
  if (robo.classe === "meta") return deps.meta.verificar(ip, deps.agora);
  const sufixos = sufixosDe(robo.nome);
  return sufixos ? verificarPorDns(ip, sufixos, deps.dns) : "nao";
}

/**
 * Confirma que o robô declarado vem mesmo de quem diz ser. Busca: DNS reverso e direto.
 * Meta: faixas do AS32934. Prévia: nunca. Resultado guardado por classe e IP durante 1 hora;
 * falha passageira (tempo esgotado, SERVFAIL, whois fora do ar) também volta false, mas fica
 * guardada só 1 minuto, para a próxima visita do robô perguntar de novo.
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
  let veredito: Veredito;
  try {
    veredito = await verificar(robo, alvo, deps);
  } catch {
    veredito = "incerto";
  }
  guardar(chave, veredito, deps.agora);
  return veredito === "sim";
}
