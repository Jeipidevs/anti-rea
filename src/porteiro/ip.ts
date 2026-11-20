import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
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

// Redes privadas, de loopback e link-local (RFC 1918, 3927, 4193 e 4291).
const INTERNOS = new BlockList();
for (const [rede, prefixo] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8], ["169.254.0.0", 16]] as const) {
  INTERNOS.addSubnet(rede, prefixo, "ipv4");
}
for (const [rede, prefixo] of [["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) INTERNOS.addSubnet(rede, prefixo, "ipv6");

/**
 * IP privado, de loopback ou link-local. Visitante da internet nunca chega assim: é a própria máquina
 * ou um proxy da rede interna (Traefik, nginx) que o porteiro não sabe ler (trustProxy desligado).
 */
export function ipInterno(ip: string): boolean {
  const alvo = normalizar(ip);
  const familia = isIP(alvo);
  if (familia === 0) return false;
  return INTERNOS.check(alvo, familia === 4 ? "ipv4" : "ipv6");
}

/**
 * Há um proxy na frente que o porteiro está ignorando: trustProxy desligado, a conexão vem de IP
 * interno e traz X-Forwarded-For ou CF-Connecting-IP.
 */
export function proxyIgnorado(req: IncomingMessage, trustProxy: Config["trustProxy"]): boolean {
  if (trustProxy !== false) return false;
  if (req.headers["x-forwarded-for"] === undefined && req.headers["cf-connecting-ip"] === undefined) return false;
  return ipInterno(req.socket.remoteAddress ?? "");
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
