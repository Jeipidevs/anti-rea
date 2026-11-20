import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Config } from "../config/carregar.js";
import { avaliarNavegador, type SinaisNavegador } from "../deteccao/navegador/avaliar.js";
import { conferirNonce } from "../deteccao/navegador/desafio.js";
import type { Sinal } from "../deteccao/servidor/ferramentas.js";
import { revogarPasse } from "../passe/passe.js";
import {
  COOKIE_PASSE,
  COOKIE_PEGO,
  cookieDoPorteiro,
  criarMarcaPego,
  criarPasseVisitante,
  DURACAO_PEGO_MS,
  lerCookies,
  passeDoPedido,
} from "./passes.js";
import { enviar, responderJson, responderTexto, responderVazio } from "./respostas.js";

// Rotas internas sob /.anti-rea/: verificar (POST), pego (POST) e guarda.js.

export const MAX_CORPO = 4 * 1024;

/** Sinais do coletor, exatamente: tipo errado ou chave a mais é 400, nunca um erro solto. */
const esquemaSinais = z.strictObject({
  webdriver: z.boolean(),
  headlessUA: z.boolean(),
  semPlugins: z.boolean(),
  temWindowChrome: z.boolean(),
  uaChrome: z.boolean(),
  cdp: z.boolean(),
  devtoolsAberto: z.boolean(),
  linguas: z.number().int().min(0).max(1_000),
  nonce: z.string().max(1_000),
});

export function lerSinais(corpo: Buffer): SinaisNavegador | null {
  let valor: unknown;
  try {
    valor = JSON.parse(corpo.toString("utf8"));
  } catch {
    return null;
  }
  const r = esquemaSinais.safeParse(valor);
  return r.success ? r.data : null;
}

/**
 * Corpo do pedido até `max` bytes. "grande" quando passa (pelo content-length ou contando);
 * null quando o visitante foi embora no meio.
 */
export function lerCorpo(req: IncomingMessage, max: number): Promise<Buffer | "grande" | null> {
  const declarado = Number(req.headers["content-length"]);
  if (Number.isFinite(declarado) && declarado > max) return Promise.resolve("grande");
  return new Promise((resolver) => {
    const partes: Buffer[] = [];
    let total = 0;
    const acabar = (valor: Buffer | "grande" | null) => {
      req.off("data", aoReceber);
      req.off("end", aoTerminar);
      req.off("close", aoFechar);
      resolver(valor);
    };
    const aoReceber = (pedaco: Buffer) => {
      total += pedaco.length;
      if (total > max) {
        req.pause();
        acabar("grande");
        return;
      }
      partes.push(pedaco);
    };
    const aoTerminar = () => acabar(Buffer.concat(partes));
    const aoFechar = () => acabar(null);
    req.on("data", aoReceber);
    req.on("end", aoTerminar);
    req.on("close", aoFechar);
  });
}

/** O que as rotas precisam do pedido e do porteiro. `registrar` grava o evento e avisa. */
export type ContextoRota = {
  cfg: Config;
  segredo: string;
  versaoDono: number;
  agora: number;
  https: boolean;
  registrar: (sinal: Sinal) => void;
};

function responderGrande(res: ServerResponse): void {
  responderTexto(res, 413, "Corpo grande demais.", { connection: "close" });
}

/** Lê e valida os sinais; quando não dá, já respondeu (413 ou 400) e devolve null. */
async function sinaisDoCorpo(req: IncomingMessage, res: ServerResponse): Promise<SinaisNavegador | null> {
  const corpo = await lerCorpo(req, MAX_CORPO);
  if (corpo === null) return null;
  if (corpo === "grande") {
    responderGrande(res);
    return null;
  }
  const sinais = lerSinais(corpo);
  if (!sinais) responderTexto(res, 400, "Pedido inválido.");
  return sinais;
}

/**
 * POST /.anti-rea/verificar. Nonce inválido: 400. Pego: marca de pego (1 h), evento, aviso e
 * {"ok":false}. Limpo: passe de visitante e {"ok":true}.
 */
export async function rotaVerificar(req: IncomingMessage, res: ServerResponse, c: ContextoRota): Promise<void> {
  if (req.method !== "POST") return responderVazio(res, 405, { allow: "POST" });
  const sinais = await sinaisDoCorpo(req, res);
  if (!sinais) return;
  if (!conferirNonce(c.segredo, sinais.nonce, c.agora)) return responderTexto(res, 400, "Pedido inválido.");
  const sinal = avaliarNavegador(sinais, { devtoolsIsCaught: c.cfg.check.devtoolsIsCaught });
  if (sinal) {
    c.registrar(sinal);
    const marca = cookieDoPorteiro(COOKIE_PEGO, criarMarcaPego(c.segredo, c.agora), DURACAO_PEGO_MS, c.https);
    return responderJson(res, 200, { ok: false }, [marca]);
  }
  const duracao = c.cfg.check.passDurationMs;
  const passe = cookieDoPorteiro(COOKIE_PASSE, criarPasseVisitante(c.segredo, duracao, c.agora), duracao, c.https);
  return responderJson(res, 200, { ok: true }, [passe]);
}

/**
 * POST /.anti-rea/pego, chamado pela guarda. Sem passe de visitante válido: 204 e nada mais (um
 * POST de outro site não carrega o cookie). Com passe e sinal que pega: revoga, marca de pego,
 * evento, aviso e 204 (a guarda recarrega). Com passe e sinais que não pegam (F12 com
 * devtoolsIsCaught false): 200 {"ok":true}, sem recarga.
 */
export async function rotaPego(req: IncomingMessage, res: ServerResponse, c: ContextoRota): Promise<void> {
  if (req.method !== "POST") return responderVazio(res, 405, { allow: "POST" });
  const passe = passeDoPedido(lerCookies(req.headers.cookie), c.segredo, c.versaoDono, c.agora);
  if (passe?.tipo !== "visitante") return responderVazio(res, 204);
  const sinais = await sinaisDoCorpo(req, res);
  if (!sinais) return;
  const sinal = avaliarNavegador(sinais, { devtoolsIsCaught: c.cfg.check.devtoolsIsCaught });
  if (!sinal) return responderJson(res, 200, { ok: true });
  revogarPasse(passe.id, passe.expira, c.agora);
  c.registrar(sinal);
  return responderVazio(res, 204, {
    "set-cookie": [
      cookieDoPorteiro(COOKIE_PEGO, criarMarcaPego(c.segredo, c.agora), DURACAO_PEGO_MS, c.https),
      cookieDoPorteiro(COOKIE_PASSE, "", 0, c.https),
    ],
  });
}

/** GET /.anti-rea/guarda.js, sem cache. */
export function rotaGuarda(req: IncomingMessage, res: ServerResponse, script: string): void {
  if (req.method !== "GET" && req.method !== "HEAD") return responderVazio(res, 405, { allow: "GET, HEAD" });
  enviar(
    res,
    200,
    { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    script,
  );
}
