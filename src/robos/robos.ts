import { verificarPorDns, type Resolvedor } from "./dns.js";
import { normalizarIp, type Confirmacao, type FaixasMeta } from "./faixas-meta.js";

export type { Confirmacao } from "./faixas-meta.js";

// Classifica o robô que o agente declara e confirma pelo endereço de onde ele vem.

/**
 * busca: rastreador que se confirma por DNS; quem se diz um e não é cai na sombra.
 * aPedido: robô que busca a pedido de alguém (verificação do Search Console, leitura em voz alta);
 *   confirmado passa, não confirmado segue como visitante comum, nunca sombra.
 * meta: confirmado pelas faixas da Meta. previa: nunca se confirma (recebe a tela com a prévia).
 */
export type Robo = { nome: string; classe: "busca" | "aPedido" | "meta" | "previa" };

type Linha = { classe: Robo["classe"]; nomes: string[]; sufixos?: string[] };

// Sem .googleusercontent.com: esse sufixo é de qualquer VM do Google Cloud (e .gae. de qualquer app do App Engine).
const SUFIXOS_GOOGLE = [".googlebot.com", ".google.com"];

// Ordem importa: busca e a pedido, depois prévia, depois meta; o primeiro casamento vence.
// Prévia antes de meta: a prévia de link do iMessage (Mensagens no iPhone e no Mac) sai
// do aparelho de quem manda e se declara "... facebookexternalhit/1.1 Facebot Twitterbot/1.0".
// O robô de verdade da Meta não cita nenhuma prévia.
const TABELA: Linha[] = [
  {
    classe: "busca",
    // Storebot-Google confere os produtos do Google Shopping; GoogleOther (e -Image, -Video) é o
    // rastreador genérico do Google. Os dois saem de crawl-*.googlebot.com, como o Googlebot.
    nomes: ["Googlebot", "Google-InspectionTool", "AdsBot-Google", "Mediapartners-Google", "Storebot-Google", "GoogleOther"],
    sufixos: SUFIXOS_GOOGLE,
  },
  // A pedido de alguém: a doc do Google diz que esses saem de google-proxy-*.google.com ou de
  // *.gae.googleusercontent.com, e o segundo não dá para conferir. Por isso o não confirmado não vai
  // à sombra: segue como visitante comum.
  { classe: "aPedido", nomes: ["Google-Site-Verification", "Google-Read-Aloud"], sufixos: SUFIXOS_GOOGLE },
  { classe: "busca", nomes: ["bingbot", "AdIdxBot"], sufixos: [".search.msn.com"] },
  { classe: "busca", nomes: ["Applebot"], sufixos: [".applebot.apple.com"] },
  // Prévia de link não se confirma: a do WhatsApp sai do celular de quem manda.
  // DuckDuckBot fica aqui: o DuckDuckGo não publica sufixo de DNS reverso, então recebe a tela
  // de verificação com a prévia (nunca a sombra), como as prévias.
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
      "DuckDuckBot",
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
  const linha = TABELA.find((l) => l.sufixos !== undefined && l.nomes.includes(nome));
  return linha?.sufixos ?? null;
}

const VALIDADE_CACHE_MS = 60 * 60_000;
// Falha passageira fica pouco tempo: evita martelar o DNS sem negar um robô real por 1 hora.
const VALIDADE_DUVIDA_MS = 60_000;
const LIMITE_CACHE = 10_000;
const cache = new Map<string, { confirmacao: Confirmacao; ate: number }>();

function guardar(chave: string, confirmacao: Confirmacao, agora: number): void {
  if (cache.size >= LIMITE_CACHE) {
    for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
    // Ainda cheio: sai o mais antigo (o Map guarda a ordem de entrada).
    while (cache.size >= LIMITE_CACHE) cache.delete(cache.keys().next().value!);
  }
  const validade = confirmacao === "incerto" ? VALIDADE_DUVIDA_MS : VALIDADE_CACHE_MS;
  cache.set(chave, { confirmacao, ate: agora + validade });
}

async function verificar(
  robo: Robo,
  ip: string,
  deps: { dns: Resolvedor; meta: FaixasMeta; agora: number },
): Promise<Confirmacao> {
  if (robo.classe === "meta") return deps.meta.contem(ip, deps.agora);
  const sufixos = sufixosDe(robo.nome);
  return sufixos ? verificarPorDns(ip, sufixos, deps.dns) : "nao";
}

/**
 * Confirma que o robô declarado vem mesmo de quem diz ser. Busca e a pedido: DNS reverso e direto.
 * Meta: faixas do AS32934. Prévia: sempre "nao".
 * "nao" só com resposta definitiva (sem nome reverso, sufixo errado, direto para outro IP,
 * IP fora das faixas carregadas). Falha passageira (tempo esgotado, SERVFAIL, outro erro,
 * faixas fora do ar ou ainda carregando) é "incerto": na dúvida, o robô passa.
 * Cache por nome do robô e IP: "sim" e "nao" valem 1 hora, "incerto" só 1 minuto.
 */
export async function confirmarRobo(
  robo: Robo,
  ip: string,
  deps: { dns: Resolvedor; meta: FaixasMeta; agora: number },
): Promise<Confirmacao> {
  if (robo.classe === "previa") return "nao";
  const alvo = normalizarIp(ip);
  const chave = `${robo.nome}|${alvo}`;
  const guardado = cache.get(chave);
  if (guardado && deps.agora < guardado.ate) return guardado.confirmacao;
  let confirmacao: Confirmacao;
  try {
    confirmacao = await verificar(robo, alvo, deps);
  } catch {
    confirmacao = "incerto";
  }
  guardar(chave, confirmacao, deps.agora);
  return confirmacao;
}
