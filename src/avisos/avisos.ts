import type { Config } from "../config/carregar.js";
import type { Evento } from "../registro/registro.js";
import { canalTelegram } from "./canais/telegram.js";
import { canalWebhook } from "./canais/webhook.js";
import { canalWhatsapp } from "./canais/whatsapp.js";

/**
 * Um destino de aviso. `enviar` lança em falha; quem chama (Avisos) contém o erro. Sem `evento`, o
 * texto não é de um pedido só (resumo do dia ou aviso agrupado do teto global).
 */
export type Canal = { nome: string; enviar(texto: string, evento?: Evento): Promise<void> };

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
  ataque: "Ataque barrado",
  varredura: "Varredura barrada",
};

const DESTINO: Record<Evento["destino"], string> = {
  sombra: "página sombra",
  recusado: "pedido recusado",
  registrado: "só registrado",
};

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** hh:mm no fuso do servidor. */
function horaLocal(d: Date): string {
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

/** Fuso do servidor naquela data: "UTC", "UTC-3", "UTC+5:30". */
function fuso(d: Date): string {
  const minutos = -d.getTimezoneOffset();
  if (minutos === 0) return "UTC";
  const absoluto = Math.abs(minutos);
  const resto = absoluto % 60;
  return `UTC${minutos > 0 ? "+" : "-"}${Math.floor(absoluto / 60)}${resto ? `:${doisDigitos(resto)}` : ""}`;
}

/** dd/mm/aaaa hh:mm (fuso) no fuso do servidor; data inválida sai como veio. */
function dataLocal(quando: string): string {
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return quando;
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${horaLocal(d)} (${fuso(d)})`;
}

/** Tamanho máximo de cada campo do aviso que vem do pedido, já contando as reticências do corte. */
const MAX_CAMPO_AVISO = 200;

// C0, DEL, C1, separadores de linha e parágrafo do Unicode e marcas de direção (bidi).
const CONTROLE = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/**
 * Campo vindo do pedido (logo, do visitante): caractere de controle ou bidi sai, para não criar linha
 * falsa nem inverter o texto. Campo acima de MAX_CAMPO_AVISO caracteres fica com MAX_CAMPO_AVISO, o
 * último sendo as reticências, sem partir emoji, para o aviso caber no limite dos canais (Telegram
 * recusa acima de 4096).
 */
function campo(valor: string): string {
  const pontos = Array.from(valor.replace(CONTROLE, ""));
  return pontos.length > MAX_CAMPO_AVISO ? `${pontos.slice(0, MAX_CAMPO_AVISO - 1).join("")}\u2026` : pontos.join("");
}

/** Texto puro do aviso, uma linha por campo; com repetidos > 0, a linha do agrupamento no fim. */
export function textoDoAviso(e: Evento, repetidos: number): string {
  const linhas = [
    TITULO[e.gravidade],
    `Site: ${campo(e.dominio)}`,
    `Página: ${campo(e.caminho)}`,
    `IP: ${campo(e.ip)}`,
    `Motivo: ${campo(e.motivo)}`,
    `Agente: ${e.agente === "" ? "(nenhum)" : campo(e.agente)}`,
    `Quando: ${campo(dataLocal(e.quando))}`,
    `Destino: ${DESTINO[e.destino]}`,
  ];
  if (repetidos > 0) linhas.push(`Mais ${repetidos} tentativas deste IP na última janela (agrupadas).`);
  return linhas.join("\n");
}

/** Aviso curto da contagem de um IP quando a janela dele fecha. */
function textoDaContagem(ip: string, dominio: string, repetidos: number, inicio: number): string {
  return `Mais ${repetidos} tentativas de ${campo(ip)} em ${campo(dominio)} desde ${horaLocal(new Date(inicio))} (agrupadas).`;
}

/** Janela de agrupamento de um IP: início, tentativas que só contaram e o site do primeiro aviso. */
type Janela = { inicio: number; repetidos: number; dominio: string };

/** Teto de IPs guardados para o agrupamento; cheio, sai o IP de janela mais antiga. */
export const MAX_IPS_AGRUPADOS = 10_000;

/** Teto global: no máximo TETO_AVISOS avisos em qualquer intervalo de TETO_JANELA_MS, somando todos os IPs. */
export const TETO_AVISOS = 6;
export const TETO_JANELA_MS = 5 * 60_000;

/** O que passou do teto global e ainda não saiu, como um aviso agrupado. */
type Excesso = { tentativas: number; ips: Set<string>; ipsAlemDoTeto: number; desde: number };

/**
 * Decide o que vira aviso e despacha para os canais.
 * - `copia` e `ataque` sempre avisam; `varredura` avisa só com scans "alert", entra no resumo com
 *   "dailySummary" e com "panel" não faz nada aqui (o registro é de quem chama).
 * - Por IP, o primeiro aviso de cada janela `groupByIpMs` sai na hora; os seguintes só contam. A
 *   contagem sai uma vez só: num aviso curto quando a janela fecha (`descarregar`, a cada minuto) ou,
 *   se o IP voltar antes disso, na última linha do aviso seguinte dele.
 * - Teto global (TETO_AVISOS por TETO_JANELA_MS, todos os IPs): o aviso que passaria do teto não sai e
 *   entra num aviso agrupado único, enviado na próxima vaga (no próximo evento ou em `descarregar`).
 *   A contagem de um IP que não cabe no teto também entra nele.
 * - No desligamento, `encerrar` manda o que está pendente, mesmo com o teto cheio.
 */
export class Avisos {
  private readonly porIp = new Map<string, Janela>();
  private readonly resumo = new Map<string, number>();
  private ultimaLimpeza = Number.NEGATIVE_INFINITY;
  /** Instantes dos avisos enviados nos últimos TETO_JANELA_MS (no máximo TETO_AVISOS). */
  private enviosRecentes: number[] = [];
  private excesso: Excesso | undefined;

  constructor(
    private readonly cfg: Config["alerts"],
    private readonly canais: Canal[],
    private readonly agora: () => number = Date.now,
  ) {}

  async receber(e: Evento): Promise<void> {
    const agora = this.agora();
    // O agrupado pendente sai antes de qualquer outro aviso, se o teto já abriu vaga.
    await this.mandarExcesso(agora, false);
    if (e.gravidade === "varredura" && this.cfg.scans !== "alert") {
      if (this.cfg.scans === "dailySummary") this.resumo.set(e.motivo, (this.resumo.get(e.motivo) ?? 0) + 1);
      return;
    }
    const janela = this.cfg.groupByIpMs;
    this.limpar(agora, janela);
    const atual = this.porIp.get(e.ip);
    if (atual && agora - atual.inicio < janela) {
      atual.repetidos++;
      return;
    }
    const repetidos = atual?.repetidos ?? 0;
    // Apaga e grava de novo para a ordem do Map seguir o início da janela (mais antigo primeiro).
    this.porIp.delete(e.ip);
    if (this.porIp.size >= MAX_IPS_AGRUPADOS) this.porIp.delete(this.porIp.keys().next().value!);
    this.porIp.set(e.ip, { inicio: agora, repetidos: 0, dominio: e.dominio });
    if (!this.ocuparVaga(agora)) {
      this.acumular(e.ip, 1 + repetidos, agora);
      return;
    }
    await this.despachar(textoDoAviso(e, repetidos), e);
  }

  /**
   * O servidor chama a cada 60 s: manda o aviso agrupado do excesso do teto global, se o teto tiver
   * vaga, e a contagem de cada IP cuja janela fechou com repetidos (aviso curto; sem vaga no teto, a
   * contagem entra no agrupado). Sem pendência, não faz nada.
   */
  async descarregar(agora: number = this.agora()): Promise<void> {
    await this.mandarExcesso(agora, false);
    await this.fecharJanelas(agora, false);
  }

  /**
   * Desligamento: fecha todas as janelas com repetidos, abertas ou não, e manda o agrupado mesmo com
   * o teto cheio. Nada pendente se perde ao parar o porteiro.
   */
  async encerrar(agora: number = this.agora()): Promise<void> {
    await this.fecharJanelas(agora, true);
    await this.mandarExcesso(agora, true);
  }

  /** Manda o agrupado pendente quando o teto tem vaga (ou sempre, com `forcar`). */
  private async mandarExcesso(agora: number, forcar: boolean): Promise<void> {
    const x = this.excesso;
    if (!x || (!this.ocuparVaga(agora) && !forcar)) return;
    this.excesso = undefined;
    const ips = x.ips.size + x.ipsAlemDoTeto;
    const desde = horaLocal(new Date(x.desde));
    await this.despachar(
      `Muitas tentativas ao mesmo tempo: ${x.tentativas} tentativas de ${ips} IPs desde ${desde} (agrupadas).`,
    );
  }

  /**
   * Fecha as janelas que venceram (ou todas, com `todas`) e têm repetidos: cada contagem vira um aviso
   * curto se o teto tiver vaga; sem vaga, entra no agrupado. O IP sai do mapa: o aviso seguinte dele
   * não repete a contagem.
   */
  private async fecharJanelas(agora: number, todas: boolean): Promise<void> {
    const textos: string[] = [];
    for (const [ip, j] of this.porIp) {
      if (j.repetidos === 0 || (!todas && agora - j.inicio < this.cfg.groupByIpMs)) continue;
      this.porIp.delete(ip);
      if (this.ocuparVaga(agora)) textos.push(textoDaContagem(ip, j.dominio, j.repetidos, j.inicio));
      else this.acumular(ip, j.repetidos, agora);
    }
    for (const texto of textos) await this.despachar(texto);
  }

  /** Manda o resumo do dia a todos os canais, fora do teto global; sem varreduras contadas, não manda nada. */
  async enviarResumo(): Promise<void> {
    if (this.resumo.size === 0) return;
    await this.despachar(this.resumoDoDia());
  }

  /** Texto do resumo das varreduras desde a última chamada, por motivo; zera a contagem. */
  resumoDoDia(): string {
    const porMotivo = [...this.resumo].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    this.resumo.clear();
    const total = porMotivo.reduce((soma, [, n]) => soma + n, 0);
    const cabeca = `Resumo do dia: ${total} ${total === 1 ? "varredura barrada" : "varreduras barradas"}`;
    return [cabeca, ...porMotivo.map(([motivo, n]) => `${motivo}: ${n}`)].join("\n");
  }

  /**
   * No máximo uma vez por janela, apaga os IPs cuja janela venceu sem repetidos. IP com repetidos fica
   * até a contagem sair (`descarregar` ou o próximo aviso dele) ou até sair pelo teto MAX_IPS_AGRUPADOS.
   */
  private limpar(agora: number, janela: number): void {
    if (agora - this.ultimaLimpeza < janela) return;
    this.ultimaLimpeza = agora;
    for (const [ip, j] of this.porIp) if (j.repetidos === 0 && agora - j.inicio >= janela) this.porIp.delete(ip);
  }

  /** Reserva uma vaga no teto global para um aviso enviado agora; false quando o teto está cheio. */
  private ocuparVaga(agora: number): boolean {
    this.enviosRecentes = this.enviosRecentes.filter((t) => agora - t < TETO_JANELA_MS);
    if (this.enviosRecentes.length >= TETO_AVISOS) return false;
    this.enviosRecentes.push(agora);
    return true;
  }

  /** Soma ao agrupado pendente; o conjunto de IPs tem o mesmo teto do agrupamento por IP. */
  private acumular(ip: string, tentativas: number, agora: number): void {
    const x = (this.excesso ??= { tentativas: 0, ips: new Set(), ipsAlemDoTeto: 0, desde: agora });
    x.tentativas += tentativas;
    if (x.ips.has(ip)) return;
    if (x.ips.size < MAX_IPS_AGRUPADOS) x.ips.add(ip);
    else x.ipsAlemDoTeto++;
  }

  private async despachar(texto: string, e?: Evento): Promise<void> {
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
