import type { Config } from "../config/carregar.js";
import type { Evento } from "../registro/registro.js";
import { canalTelegram } from "./canais/telegram.js";
import { canalWebhook } from "./canais/webhook.js";
import { canalWhatsapp } from "./canais/whatsapp.js";

/** Um destino de aviso. `enviar` lança em falha; quem chama (Avisos) contém o erro. */
export type Canal = { nome: string; enviar(texto: string, evento: Evento): Promise<void> };

type Definicao = { variaveis: readonly string[]; criar(valores: string[], fetchFn: typeof fetch): Canal };

const DEFINICOES: Record<string, Definicao> = {
  whatsapp: {
    variaveis: ["ANTI_REA_WHATSAPP_URL", "ANTI_REA_WHATSAPP_INSTANCE", "ANTI_REA_WHATSAPP_TOKEN", "ANTI_REA_WHATSAPP_TO"],
    criar: ([url, instancia, token, para], f) =>
      canalWhatsapp({ url: url!, instancia: instancia!, token: token!, para: para! }, f),
  },
  telegram: {
    variaveis: ["ANTI_REA_TELEGRAM_TOKEN", "ANTI_REA_TELEGRAM_CHAT"],
    criar: ([token, chat], f) => canalTelegram({ token: token!, chat: chat! }, f),
  },
  webhook: {
    variaveis: ["ANTI_REA_WEBHOOK_URL", "ANTI_REA_WEBHOOK_SECRET"],
    criar: ([url, segredo], f) => canalWebhook({ url: url!, segredo: segredo! }, f),
  },
};

/**
 * Monta os canais pedidos a partir das variáveis de ambiente. Canal com variável ausente (ou vazia)
 * não sobe; `faltando` lista cada variável ausente de cada canal pedido e cada nome desconhecido.
 */
export function canaisDoAmbiente(
  env: NodeJS.ProcessEnv,
  pedidos: string[],
  fetchFn: typeof fetch = fetch,
): { canais: Canal[]; faltando: string[] } {
  const canais: Canal[] = [];
  const faltando: string[] = [];
  for (const nome of new Set(pedidos)) {
    const def = Object.hasOwn(DEFINICOES, nome) ? DEFINICOES[nome] : undefined;
    if (!def) {
      faltando.push(`canal desconhecido: ${nome}`);
      continue;
    }
    const ausentes = def.variaveis.filter((v) => !env[v]);
    if (ausentes.length > 0) {
      faltando.push(...ausentes);
      continue;
    }
    canais.push(def.criar(def.variaveis.map((v) => env[v]!), fetchFn));
  }
  return { canais, faltando };
}

const TITULO: Record<Evento["gravidade"], string> = {
  copia: "Tentativa de cópia barrada",
  varredura: "Varredura barrada",
};

const DESTINO: Record<Evento["destino"], string> = {
  sombra: "página sombra",
  recusado: "pedido recusado",
  registrado: "só registrado",
};

/** dd/mm/aaaa hh:mm no fuso do servidor; data inválida sai como veio. */
function dataLocal(quando: string): string {
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return quando;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Texto puro do aviso, uma linha por campo; com repetidos > 0, a linha do agrupamento no fim. */
export function textoDoAviso(e: Evento, repetidos: number): string {
  const linhas = [
    TITULO[e.gravidade],
    `Site: ${e.dominio}`,
    `Página: ${e.caminho}`,
    `IP: ${e.ip}`,
    `Motivo: ${e.motivo}`,
    `Quando: ${dataLocal(e.quando)}`,
    `Destino: ${DESTINO[e.destino]}`,
  ];
  if (repetidos > 0) linhas.push(`Mais ${repetidos} tentativas deste IP na última janela (agrupadas).`);
  return linhas.join("\n");
}

type Janela = { inicio: number; repetidos: number };

/**
 * Decide o que vira aviso e despacha para os canais.
 * - `copia` sempre avisa; `varredura` avisa só com scans "alert", entra no resumo com "dailySummary"
 *   e com "panel" não faz nada aqui (o registro é de quem chama).
 * - Por IP, o primeiro aviso de cada janela `groupByIpMs` sai na hora; os seguintes só contam, e a
 *   contagem vai no primeiro aviso da janela seguinte.
 */
export class Avisos {
  private readonly porIp = new Map<string, Janela>();
  private readonly resumo = new Map<string, number>();
  private ultimaLimpeza = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly cfg: Config["alerts"],
    private readonly canais: Canal[],
    private readonly agora: () => number = Date.now,
  ) {}

  async receber(e: Evento): Promise<void> {
    if (e.gravidade === "varredura" && this.cfg.scans !== "alert") {
      if (this.cfg.scans === "dailySummary") this.resumo.set(e.motivo, (this.resumo.get(e.motivo) ?? 0) + 1);
      return;
    }
    const agora = this.agora();
    const janela = this.cfg.groupByIpMs;
    this.limpar(agora, janela);
    const atual = this.porIp.get(e.ip);
    if (atual && agora - atual.inicio < janela) {
      atual.repetidos++;
      return;
    }
    // Só conta os repetidos da janela imediatamente anterior; mais antigos que isso já valem como descartados.
    const repetidos = atual && agora - atual.inicio < 2 * janela ? atual.repetidos : 0;
    this.porIp.set(e.ip, { inicio: agora, repetidos: 0 });
    await this.despachar(textoDoAviso(e, repetidos), e);
  }

  /** Texto do resumo das varreduras desde a última chamada, por motivo; zera a contagem. */
  resumoDoDia(): string {
    const porMotivo = [...this.resumo].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    this.resumo.clear();
    const total = porMotivo.reduce((soma, [, n]) => soma + n, 0);
    const cabeca = `Resumo do dia: ${total} ${total === 1 ? "varredura barrada" : "varreduras barradas"}`;
    return [cabeca, ...porMotivo.map(([motivo, n]) => `${motivo}: ${n}`)].join("\n");
  }

  /** No máximo uma vez por janela, apaga os IPs cuja janela venceu há mais de uma janela. */
  private limpar(agora: number, janela: number): void {
    if (agora - this.ultimaLimpeza < janela) return;
    this.ultimaLimpeza = agora;
    for (const [ip, j] of this.porIp) if (agora - j.inicio >= 2 * janela) this.porIp.delete(ip);
  }

  private async despachar(texto: string, e: Evento): Promise<void> {
    await Promise.all(
      this.canais.map(async (canal) => {
        try {
          await canal.enviar(texto, e);
        } catch (erro) {
          const motivo = erro instanceof Error ? erro.message : String(erro);
          process.stderr.write(`[anti-rea] aviso ${canal.nome} falhou: ${motivo}\n`);
        }
      }),
    );
  }
}
