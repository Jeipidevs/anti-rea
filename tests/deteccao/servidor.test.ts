import { describe, expect, it } from "vitest";
import { ferramentaConhecida } from "../../src/deteccao/servidor/ferramentas.js";
import { caminhoDeVarredura, caminhoTrancado } from "../../src/deteccao/servidor/caminhos.js";
import { Ritmo } from "../../src/deteccao/servidor/ritmo.js";

describe("ferramentaConhecida", () => {
  it("classifica ferramentas por agente", () => {
    expect(ferramentaConhecida("Wget/1.21")?.gravidade).toBe("copia");
    expect(ferramentaConhecida("Mozilla/5.0 (compatible; HTTrack 3.0x)")?.motivo).toMatch(/httrack/i);
    expect(ferramentaConhecida("sqlmap/1.8")?.gravidade).toBe("varredura");
    expect(ferramentaConhecida(undefined)?.motivo).toBe("sem agente");
    expect(ferramentaConhecida("")?.motivo).toBe("sem agente");
    expect(ferramentaConhecida("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36")).toBeNull();
  });
  it("cobre java/ e headlesschrome", () => {
    expect(ferramentaConhecida("Java/17.0.1")?.motivo).toBe("java/");
    expect(ferramentaConhecida("HeadlessChrome/130")?.gravidade).toBe("copia");
  });
});

describe("caminhoTrancado", () => {
  it("tranca mapas e arquivos sensíveis", () => {
    expect(caminhoTrancado("/_next/static/chunks/app.js.map")?.gravidade).toBe("copia");
    expect(caminhoTrancado("/_next/static/chunks/app.js.map")?.motivo).toBe("mapa de código");
    expect(caminhoTrancado("/.env.production")?.gravidade).toBe("varredura");
    expect(caminhoTrancado("/.env")?.motivo).toBe("arquivo sensível");
    expect(caminhoTrancado("/repo/.git/config")).not.toBeNull();
    expect(caminhoTrancado("/dump.sql.gz")).not.toBeNull();
    expect(caminhoTrancado("/a/.DS_Store")).not.toBeNull();
    expect(caminhoTrancado("/APP.JS.MAP?v=1")?.gravidade).toBe("copia");
  });
  it("deixa passar o resto", () => {
    expect(caminhoTrancado("/app.js")).toBeNull();
    expect(caminhoTrancado("/wp-login.php")).toBeNull();
    expect(caminhoTrancado("/.environment")).toBeNull();
    expect(caminhoTrancado("/.github/workflows")).toBeNull();
  });
});

describe("caminhoDeVarredura", () => {
  it("pega caminhos de varredura", () => {
    expect(caminhoDeVarredura("/phpmyadmin/index.php")?.gravidade).toBe("varredura");
    expect(caminhoDeVarredura("/PMA")?.motivo).toBe("caminho de varredura");
    expect(caminhoDeVarredura("/HNAP1")).not.toBeNull();
    expect(caminhoDeVarredura("/cgi-bin/x?a=1")).not.toBeNull();
    expect(caminhoDeVarredura("/wp-admin")).toBeNull();
    expect(caminhoDeVarredura("/pmaster")).toBeNull();
  });
});

describe("Ritmo", () => {
  it("conta por IP dentro da janela", () => {
    const r = new Ritmo(3, 10_000);
    expect([1, 2, 3].map((t) => r.registrar("203.0.113.1", t))).toEqual([false, false, false]);
    expect(r.registrar("203.0.113.1", 4)).toBe(true);
    expect(r.registrar("203.0.113.1", 20_000)).toBe(false);
    expect(r.registrar("203.0.113.2", 5)).toBe(false);
  });
  it("guarda no maximo limite+1 instantes por IP", () => {
    const r = new Ritmo(3, 10_000);
    const respostas = Array.from({ length: 1000 }, (_, i) => r.registrar("203.0.113.1", i));
    expect(r.instantesGuardados("203.0.113.1")).toBeLessThanOrEqual(4);
    expect(respostas.slice(0, 3)).toEqual([false, false, false]);
    expect(respostas.slice(3).every((x) => x)).toBe(true);
    expect(r.registrar("203.0.113.1", 10_995)).toBe(true);
    expect(r.registrar("203.0.113.1", 10_998)).toBe(false);
    expect(r.registrar("203.0.113.1", 50_000)).toBe(false);
  });
  it("varre IPs inativos no maximo uma vez por meia janela", () => {
    const r = new Ritmo(3, 10_000);
    for (let i = 0; i < 10_000; i++) r.registrar(`10.0.${i >> 8}.${i & 255}`, i % 5_000);
    expect(r.varreduras).toBeLessThanOrEqual(1);
    expect(r.ipsGuardados).toBe(10_000);
    r.registrar("203.0.113.9", 4_999);
    expect(r.varreduras).toBeLessThanOrEqual(1);
    r.registrar("203.0.113.9", 30_000);
    expect(r.varreduras).toBe(2);
    expect(r.ipsGuardados).toBe(1);
  });
});
