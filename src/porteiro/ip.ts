import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { Config } from "../config/carregar.js";

/** "::ffff:a.b.c.d" vira "a.b.c.d"; o resto volta sem espaços nas pontas. */
function normalizar(ip: string): string {
  const t = ip.trim();
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(t);
  return mapeado ? mapeado[1]! : t;
}

function cabecalho(req: IncomingMessage, nome: string): string | undefined {
  const v = req.headers[nome];
  return Array.isArray(v) ? v.join(",") : v;
}

/** Último item de uma lista separada por vírgula (o que o proxy confiável acrescentou). */
function ultimoDaLista(valor: string | undefined): string {
  if (valor === undefined) return "";
  const partes = valor.split(",");
  return (partes[partes.length - 1] ?? "").trim();
}

/** IP do socket, ou o do cabeçalho do proxy confiável quando ele é um IP de verdade. */
export function ipReal(req: IncomingMessage, trustProxy: Config["trustProxy"]): string {
  const socket = normalizar(req.socket.remoteAddress ?? "");
  let doProxy = "";
  if (trustProxy === true) doProxy = ultimoDaLista(cabecalho(req, "x-forwarded-for"));
  else if (trustProxy === "cloudflare") doProxy = (cabecalho(req, "cf-connecting-ip") ?? "").trim();
  const ip = normalizar(doProxy);
  return ip !== "" && isIP(ip) !== 0 ? ip : socket;
}

/** O pedido chegou por HTTPS? Sem proxy confiável, só o socket cifrado conta. */
export function pedidoHttps(req: IncomingMessage, trustProxy: Config["trustProxy"]): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted === true) return true;
  if (trustProxy === false) return false;
  return ultimoDaLista(cabecalho(req, "x-forwarded-proto")).toLowerCase() === "https";
}
