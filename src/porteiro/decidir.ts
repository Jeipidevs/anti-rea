import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config/carregar.js";
import { caminhoDeVarredura, caminhoTrancado } from "../deteccao/servidor/caminhos.js";
import { ferramentaConhecida, type Sinal } from "../deteccao/servidor/ferramentas.js";
import type { Ritmo } from "../deteccao/servidor/ritmo.js";
import { codigoDeDono } from "../passe/passe.js";
import { roboDeclarado, type Confirmacao, type Robo } from "../robos/robos.js";
import { ipInterno } from "./ip.js";
import { lerCookies, passeDoPedido, temMarcaPego } from "./passes.js";
import { caminhoAmbiguo, caminhoLiteral, caminhoPublico, ehMidia, ehNavegacao, normalizarCaminho } from "./pedido.js";

/**
 * O pedido como o porteiro o vê. `caminho` é o cru (com query), o mesmo que vai ao site; a detecção
 * usa o normalizado, e caminho que o site poderia ler diferente (ponto-ponto) nunca chega lá.
 * `corsMetodo` é o cabeçalho Access-Control-Request-Method (só conta no OPTIONS do pré-voo).
 */
export type Pedido = {
  metodo: string;
  caminho: string;
  agente?: string;
  accept?: string;
  cookie?: string;
  corsMetodo?: string;
  ip: string;
  dominio: string;
  https: boolean;
};

export type RotaInterna = "verificar" | "guarda" | "pego";

/**
 * O que fazer com o pedido.
 * - `repassar.registrar`: passa, mas grava um evento "registrado" sem aviso (robô não confirmado).
 * - `repassar.emitirPasse`: passa e entrega um passe de visitante novo (só numa resposta 200). Com
 *   firstVisit false, na navegação sem passe, para a guarda poder revogar alguma coisa se pegar F12 ou
 *   automação e para o WebSocket do site abrir. Com passe de visitante que já passou da metade da
 *   validade, para renovar: senão ele vence com o visitante no meio do uso.
 * - `repassar.publico`: a resposta é a mesma para qualquer um (isento, público padrão ou mídia), então a CDN
 *   pode guardar. Sem ele, a resposta dependeu de passe ou de robô e não pode ir para cache
 *   compartilhado.
 * - `repassar.soCabecalhos`: pré-voo CORS; ao visitante vão só o status e os cabeçalhos do site.
 * - `recusar` 400: caminho ambíguo; 403: sem passe; 404: caminho sob /.anti-rea/ que não é rota do
 *   porteiro, ou arquivo trancado pedido com passe de dono (sem evento e sem aviso: o F12 do dono busca
 *   os mapas de código sozinho).
 */
export type Decisao =
  | { acao: "repassar"; injetarGuarda: boolean; emitirPasse?: true; registrar?: Sinal; publico?: true; soCabecalhos?: true }
  | { acao: "sombra"; sinal: Sinal; status: 200 | 404 }
  | { acao: "verificar" }
  | { acao: "recusar"; status: 400 | 403 | 404 }
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

const PREFIXO_PORTEIRO = "/.anti-rea";
const PREFIXO_DONO = "/.anti-rea/dono/";
const ROTAS = new Map<string, RotaInterna>([
  ["/.anti-rea/verificar", "verificar"],
  ["/.anti-rea/guarda.js", "guarda"],
  ["/.anti-rea/pego", "pego"],
]);

const PEGO: Sinal = { motivo: "pego na verificação", gravidade: "copia" };
const RAPIDO_DEMAIS: Sinal = { motivo: "navegação rápida demais", gravidade: "copia" };

/** `*` no fim do padrão casa o prefixo; sem `*`, só igual. */
function casa(texto: string, padrao: string): boolean {
  return padrao.endsWith("*") ? texto.startsWith(padrao.slice(0, -1)) : texto === padrao;
}

/** Query crua do pedido (sem o "?" e sem fragmento), ou null quando ele não tem "?". */
function queryDe(cru: string): string | null {
  const i = cru.indexOf("?");
  return i < 0 ? null : (cru.slice(i + 1).split("#", 1)[0] ?? "");
}

/**
 * Caminho cru (não ambíguo) casa com um dos isentos: `*` no fim casa o prefixo; sem `*`, só igual.
 * O caminho precisa casar lido dos dois jeitos, normalizado e ao pé da letra, para valer qualquer que
 * seja o jeito como o site lê %2F, barras dobradas e parâmetro de matriz. Padrão com "?" (como
 * "/?wc-api=*") também confere a query crua do pedido, pelo começo dela.
 */
export function caminhoIsento(cru: string, isentos: string[]): boolean {
  const normalizado = normalizarCaminho(cru);
  const literal = caminhoLiteral(cru);
  const query = queryDe(cru);
  return isentos.some((padrao) => {
    const q = padrao.indexOf("?");
    const caminhoDoPadrao = q < 0 ? padrao : padrao.slice(0, q);
    if (!casa(normalizado, caminhoDoPadrao) || !casa(literal, caminhoDoPadrao)) return false;
    return q < 0 || (query !== null && casa(query, padrao.slice(q + 1)));
  });
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
  const d = await primeiraRegra(p, ctx);
  // Isento, público padrão e mídia saem iguais para todo mundo; o resto dependeu de passe ou de robô.
  const igualParaTodos = () =>
    caminhoIsento(p.caminho, ctx.cfg.exempt) || caminhoPublico(p.caminho) || ehMidia(normalizarCaminho(p.caminho));
  if (d.acao === "repassar" && igualParaTodos()) {
    return { ...d, publico: true };
  }
  return d;
}

async function primeiraRegra(p: Pedido, ctx: ContextoDecisao): Promise<Decisao> {
  const caminho = normalizarCaminho(p.caminho);

  // 1 e 2: link de dono e rotas internas.
  if (caminho.startsWith(PREFIXO_DONO)) {
    const codigo = caminho.slice(PREFIXO_DONO.length);
    return { acao: "dono", valido: mesmoCodigo(codigo, codigoDeDono(ctx.segredo, ctx.versaoDono)) };
  }
  const rota = ROTAS.get(caminho);
  if (rota) return { acao: "interno", rota };
  // O resto de /.anti-rea/ é do porteiro e nunca vai ao site (nem uma pasta do site com esse nome).
  const minusculo = caminho.toLowerCase();
  if (minusculo === PREFIXO_PORTEIRO || minusculo.startsWith(`${PREFIXO_PORTEIRO}/`)) return { acao: "recusar", status: 404 };

  const cookies = lerCookies(p.cookie);
  const passe = passeDoPedido(cookies, ctx.segredo, ctx.versaoDono, ctx.agora);

  // 3: arquivo trancado. Com passe de visitante, procurar arquivo sensível é cópia. Com passe de dono
  // continua trancado, mas sem evento: o F12 do dono busca os mapas de código sozinho.
  const trancado = caminhoTrancado(caminho);
  if (trancado) {
    if (passe?.tipo === "dono") return { acao: "recusar", status: 404 };
    const deDentro = passe?.tipo === "visitante" && trancado.gravidade === "varredura";
    return sombra(deDentro ? { ...trancado, gravidade: "copia" } : trancado, 404);
  }

  // Ponto-ponto em alguma leitura: o site poderia resolver outro arquivo que não o conferido aqui.
  if (caminhoAmbiguo(p.caminho)) return { acao: "recusar", status: 400 };

  // Pré-voo CORS: o navegador nunca manda cookie nele e o site só responde se aceita a origem. Vai só
  // com status e cabeçalhos: site que responde OPTIONS com a página a entregaria a quem não roda
  // JavaScript. Ferramenta conhecida vem antes: navegador de verdade nunca se apresenta assim.
  if (p.metodo.toUpperCase() === "OPTIONS" && p.corsMetodo !== undefined) {
    const ferramenta = ferramentaConhecida(p.agente);
    return ferramenta ? sombra(ferramenta) : { acao: "repassar", injetarGuarda: false, soCabecalhos: true };
  }

  // robots.txt, sitemaps, manifesto do PWA, /.well-known/: o navegador e as integrações pedem sem cookie.
  if (caminhoPublico(p.caminho)) return repassar(false);

  // 4 e 5: dono e caminho isento passam sem guarda.
  if (passe?.tipo === "dono") return repassar(false);
  if (caminhoIsento(p.caminho, ctx.cfg.exempt)) return repassar(false);

  // Pego na verificação ou pela guarda: sombra enquanto a marca valer.
  if (temMarcaPego(cookies, ctx.segredo, ctx.agora)) return sombra(PEGO);

  // 6: ferramenta conhecida ou caminho de varredura.
  const suspeito = ferramentaConhecida(p.agente) ?? caminhoDeVarredura(caminho);
  if (suspeito) return sombra(suspeito);

  // 7: robô declarado. Prévia de link vê a tela de verificação (com a prévia do site) e a imagem.
  const robo = roboDeclarado(p.agente);
  if (robo) {
    if (robo.classe === "previa") return ehMidia(caminho) ? repassar(false) : { acao: "verificar" };
    // IP interno: o pedido veio de um proxy que o porteiro não lê (trustProxy desligado), e o IP de
    // quem pediu se perdeu. Não dá para conferir: na dúvida, passa e fica registrado.
    const confirmacao = ipInterno(p.ip) ? "incerto" : await ctx.confirmarRobo(robo, p.ip);
    if (confirmacao === "sim") return repassar(false);
    if (confirmacao === "incerto") {
      // DNS ou faixas fora do ar: na dúvida passa, e fica registrado.
      return {
        acao: "repassar",
        injetarGuarda: false,
        registrar: { motivo: `robô não confirmado: ${robo.nome}`, gravidade: "copia" },
      };
    }
    // Robô a pedido que não confirma pode ser o do Google saindo de endereço que não dá para conferir:
    // segue as regras de visitante comum. Os outros mentem sobre quem são.
    if (robo.classe !== "aPedido") return sombra({ motivo: `robô falso: ${robo.nome}`, gravidade: "copia" });
  }

  // 8: ritmo de navegação. IP interno não conta: atrás de um proxy que o porteiro não lê, todo
  // visitante teria o mesmo IP e o limite valeria para o site inteiro.
  const navegacao = ehNavegacao(p.metodo, p.accept);
  if (navegacao && !ipInterno(p.ip) && ctx.ritmo.registrar(p.ip, ctx.agora)) return sombra(RAPIDO_DEMAIS);

  // 9 a 11: passe de visitante, primeira visita.
  const guarda = ctx.cfg.check.devtoolsIsCaught;
  if (passe) {
    // O passe de visitante que já passou da metade da validade é renovado: quem usa o site toda semana
    // nunca fica sem passe no meio de um formulário. Mídia sai pública para a CDN e nunca leva Set-Cookie.
    const renovar = passe.expira - ctx.agora < ctx.cfg.check.passDurationMs / 2 && !ehMidia(caminho);
    return renovar ? { acao: "repassar", injetarGuarda: guarda, emitirPasse: true } : repassar(guarda);
  }
  if (!ctx.cfg.check.firstVisit) {
    // Toda navegação ganha passe, com ou sem guarda: sem ele nenhum WebSocket do site abriria.
    return navegacao ? { acao: "repassar", injetarGuarda: guarda, emitirPasse: true } : repassar(guarda);
  }
  if (navegacao) return { acao: "verificar" };
  if (ehMidia(caminho)) return repassar(false);
  return { acao: "recusar", status: 403 };
}
