import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config/carregar.js";
import { caminhoDeVarredura, caminhoTrancado } from "../deteccao/servidor/caminhos.js";
import { ferramentaConhecida, type Sinal } from "../deteccao/servidor/ferramentas.js";
import type { Ritmo } from "../deteccao/servidor/ritmo.js";
import { codigoDeDono } from "../passe/passe.js";
import { roboDeclarado, type Confirmacao, type Robo } from "../robos/robos.js";
import { lerCookies, passeDoPedido, temMarcaPego } from "./passes.js";
import { ehMidia, ehNavegacao, normalizarCaminho } from "./pedido.js";

/** O pedido como o porteiro o vê. `caminho` é o cru (com query); a detecção usa o normalizado. */
export type Pedido = {
  metodo: string;
  caminho: string;
  agente?: string;
  accept?: string;
  cookie?: string;
  ip: string;
  dominio: string;
  https: boolean;
};

export type RotaInterna = "verificar" | "guarda" | "pego";

/**
 * O que fazer com o pedido.
 * - `repassar.registrar`: passa, mas grava um evento "registrado" sem aviso (robô não confirmado).
 * - `repassar.emitirPasse`: passa e entrega um passe de visitante (firstVisit false), para a guarda
 *   poder revogar alguma coisa se pegar F12 ou automação.
 */
export type Decisao =
  | { acao: "repassar"; injetarGuarda: boolean; emitirPasse?: true; registrar?: Sinal }
  | { acao: "sombra"; sinal: Sinal; status: 200 | 404 }
  | { acao: "verificar" }
  | { acao: "recusar"; status: 403 }
  | { acao: "dono"; valido: boolean }
  | { acao: "interno"; rota: RotaInterna };

export type ContextoDecisao = {
  cfg: Config;
  segredo: string;
  versaoDono: number;
  ritmo: Ritmo;
  confirmarRobo: (r: Robo, ip: string) => Promise<Confirmacao>;
  agora: number;
};

const PREFIXO_DONO = "/.anti-rea/dono/";
const ROTAS = new Map<string, RotaInterna>([
  ["/.anti-rea/verificar", "verificar"],
  ["/.anti-rea/guarda.js", "guarda"],
  ["/.anti-rea/pego", "pego"],
]);

const PEGO: Sinal = { motivo: "pego na verificação", gravidade: "copia" };
const RAPIDO_DEMAIS: Sinal = { motivo: "navegação rápida demais", gravidade: "copia" };

/** Caminho (normalizado) casa com um dos isentos: `*` no fim casa o prefixo; sem `*`, só igual. */
export function caminhoIsento(caminho: string, isentos: string[]): boolean {
  return isentos.some((padrao) => (padrao.endsWith("*") ? caminho.startsWith(padrao.slice(0, -1)) : caminho === padrao));
}

function mesmoCodigo(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const repassar = (injetarGuarda: boolean): Decisao => ({ acao: "repassar", injetarGuarda });
const sombra = (sinal: Sinal, status: 200 | 404 = 200): Decisao => ({ acao: "sombra", sinal, status });

/** O pipeline de decisão: a primeira regra que casar vence. */
export async function decidir(p: Pedido, ctx: ContextoDecisao): Promise<Decisao> {
  const caminho = normalizarCaminho(p.caminho);

  // 1 e 2: link de dono e rotas internas.
  if (caminho.startsWith(PREFIXO_DONO)) {
    const codigo = caminho.slice(PREFIXO_DONO.length);
    return { acao: "dono", valido: mesmoCodigo(codigo, codigoDeDono(ctx.segredo, ctx.versaoDono)) };
  }
  const rota = ROTAS.get(caminho);
  if (rota) return { acao: "interno", rota };

  const cookies = lerCookies(p.cookie);
  const passe = passeDoPedido(cookies, ctx.segredo, ctx.versaoDono, ctx.agora);

  // 3: arquivo trancado. Com passe de visitante, procurar arquivo sensível é cópia.
  const trancado = caminhoTrancado(caminho);
  if (trancado) {
    const deDentro = passe?.tipo === "visitante" && trancado.gravidade === "varredura";
    return sombra(deDentro ? { ...trancado, gravidade: "copia" } : trancado, 404);
  }

  // 4 e 5: dono e caminho isento passam sem guarda.
  if (passe?.tipo === "dono") return repassar(false);
  if (caminhoIsento(caminho, ctx.cfg.exempt)) return repassar(false);

  // Pego na verificação ou pela guarda: sombra enquanto a marca valer.
  if (temMarcaPego(cookies, ctx.segredo, ctx.agora)) return sombra(PEGO);

  // 6: ferramenta conhecida ou caminho de varredura.
  const suspeito = ferramentaConhecida(p.agente) ?? caminhoDeVarredura(caminho);
  if (suspeito) return sombra(suspeito);

  // 7: robô declarado. Prévia de link vê a tela de verificação (com a prévia do site) e a imagem.
  const robo = roboDeclarado(p.agente);
  if (robo) {
    if (robo.classe === "previa") return ehMidia(caminho) ? repassar(false) : { acao: "verificar" };
    const confirmacao = await ctx.confirmarRobo(robo, p.ip);
    if (confirmacao === "sim") return repassar(false);
    if (confirmacao === "nao") return sombra({ motivo: `robô falso: ${robo.nome}`, gravidade: "copia" });
    // Incerto (DNS ou faixas fora do ar): na dúvida passa, e fica registrado.
    return {
      acao: "repassar",
      injetarGuarda: false,
      registrar: { motivo: `robô não confirmado: ${robo.nome}`, gravidade: "copia" },
    };
  }

  // 8: ritmo de navegação.
  const navegacao = ehNavegacao(p.metodo, p.accept);
  if (navegacao && ctx.ritmo.registrar(p.ip, ctx.agora)) return sombra(RAPIDO_DEMAIS);

  // 9 a 11: passe de visitante, primeira visita.
  const guarda = ctx.cfg.check.devtoolsIsCaught;
  if (passe) return repassar(guarda);
  if (!ctx.cfg.check.firstVisit) {
    return navegacao && guarda ? { acao: "repassar", injetarGuarda: true, emitirPasse: true } : repassar(guarda);
  }
  if (navegacao) return { acao: "verificar" };
  if (ehMidia(caminho)) return repassar(false);
  return { acao: "recusar", status: 403 };
}
