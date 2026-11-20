import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { ipReal, pedidoHttps } from "../../src/porteiro/ip.js";

function req(socket: string | undefined, headers: Record<string, string | string[]> = {}, encrypted = false): IncomingMessage {
  return { socket: { remoteAddress: socket, encrypted }, headers } as unknown as IncomingMessage;
}

describe("ipReal", () => {
  it("trustProxy false: sempre o socket, mesmo com X-Forwarded-For forjado", () => {
    expect(ipReal(req("203.0.113.7", { "x-forwarded-for": "198.51.100.7" }), false)).toBe("203.0.113.7");
    expect(ipReal(req("203.0.113.7", { "cf-connecting-ip": "198.51.100.7" }), false)).toBe("203.0.113.7");
  });

  it("normaliza IPv4 mapeado em IPv6", () => {
    expect(ipReal(req("::ffff:127.0.0.1"), false)).toBe("127.0.0.1");
    expect(ipReal(req("::FFFF:203.0.113.7"), false)).toBe("203.0.113.7");
    expect(ipReal(req("::1"), false)).toBe("::1");
  });

  it("trustProxy true: último valor de X-Forwarded-For, senão socket", () => {
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": "198.51.100.7, 203.0.113.9" }), true)).toBe("203.0.113.9");
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": " 203.0.113.9 " }), true)).toBe("203.0.113.9");
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": "::ffff:203.0.113.9" }), true)).toBe("203.0.113.9");
    expect(ipReal(req("10.0.0.2"), true)).toBe("10.0.0.2");
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": "" }), true)).toBe("10.0.0.2");
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": "203.0.113.9, " }), true)).toBe("10.0.0.2");
  });

  it("valor que não é IP no cabeçalho cai no socket", () => {
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": "um-texto\nqualquer" }), true)).toBe("10.0.0.2");
    expect(ipReal(req("10.0.0.2", { "cf-connecting-ip": "<script>" }), "cloudflare")).toBe("10.0.0.2");
  });

  it('"cloudflare": CF-Connecting-IP, senão socket; X-Forwarded-For não conta', () => {
    expect(ipReal(req("10.0.0.2", { "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "198.51.100.7" }), "cloudflare")).toBe("2001:db8::1");
    expect(ipReal(req("10.0.0.2", { "x-forwarded-for": "198.51.100.7" }), "cloudflare")).toBe("10.0.0.2");
  });

  it("socket sem endereço vira texto vazio", () => {
    expect(ipReal(req(undefined), false)).toBe("");
  });
});

describe("pedidoHttps", () => {
  it("sem proxy confiável só vale o socket cifrado", () => {
    expect(pedidoHttps(req("203.0.113.7", { "x-forwarded-proto": "https" }), false)).toBe(false);
    expect(pedidoHttps(req("203.0.113.7", {}, true), false)).toBe(true);
  });

  it("com proxy confiável lê X-Forwarded-Proto (último valor)", () => {
    expect(pedidoHttps(req("10.0.0.2", { "x-forwarded-proto": "https" }), true)).toBe(true);
    expect(pedidoHttps(req("10.0.0.2", { "x-forwarded-proto": "http, https" }), true)).toBe(true);
    expect(pedidoHttps(req("10.0.0.2", { "x-forwarded-proto": "http" }), "cloudflare")).toBe(false);
    expect(pedidoHttps(req("10.0.0.2", { "x-forwarded-proto": "HTTPS" }), "cloudflare")).toBe(true);
  });
});
