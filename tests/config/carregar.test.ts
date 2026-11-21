import { describe, expect, it } from "vitest";
import { carregarConfig, validarConfig } from "../../src/config/carregar.js";

describe("carregarConfig", () => {
  it("lê o exemplo do repositório", () => {
    const c = carregarConfig("examples/anti-rea.config.yml");
    expect(c.upstream).toBe("http://localhost:3000");
    expect(c.domains).toEqual(["seusite.com.br"]);
    expect(c.check.passDurationMs).toBe(7 * 86_400_000);
    expect(c.alerts.scans).toBe("panel");
    expect(c.alerts.channels).toEqual(["whatsapp"]);
    expect(c.exempt).toContain("/health");
  });

  it("avisa em português quando o arquivo não existe", () => {
    expect(() => carregarConfig("nao-existe.yml")).toThrow(/nao-existe\.yml/);
  });
});

describe("validarConfig", () => {
  it("aplica os padrões na configuração mínima", () => {
    const minimo = validarConfig({ upstream: "http://site:80", domains: ["a.com"] });
    expect(minimo.trustProxy).toBe(false);
    expect(minimo.check.firstVisit).toBe(true);
    expect(minimo.check.devtoolsIsCaught).toBe(true);
    expect(minimo.check.passDurationMs).toBe(7 * 86_400_000);
    expect(minimo.alerts.groupByIpMs).toBe(3_600_000);
    expect(minimo.alerts.scans).toBe("panel");
    expect(minimo.alerts.channels).toEqual([]);
    expect(minimo.log.retentionMs).toBe(30 * 86_400_000);
    expect(minimo.upstreamTimeoutMs).toBe(60_000);
    expect(minimo.shadow.language).toBe("pt-BR");
    expect(minimo.shadow.showIp).toBe(true);
    expect(minimo.exempt).toEqual([]);
  });

  it("aceita trustProxy true e cloudflare", () => {
    const base = { upstream: "http://site:80", domains: ["a.com"] };
    expect(validarConfig({ ...base, trustProxy: true }).trustProxy).toBe(true);
    expect(validarConfig({ ...base, trustProxy: "cloudflare" }).trustProxy).toBe("cloudflare");
  });

  it("lista os campos errados em português", () => {
    expect(() => validarConfig({ domains: [] })).toThrow(/upstream: campo obrigatório/);
    expect(() => validarConfig({ domains: [] })).toThrow(/domains: informe ao menos um domínio/);
    expect(() =>
      validarConfig({ upstream: "x", domains: ["a.com"], trustProxy: "talvez" }),
    ).toThrow(/trustProxy: valor inválido, use true, false ou "cloudflare"/);
  });

  it("aponta chave desconhecida e valor fora da lista em português", () => {
    const base = { upstream: "http://s", domains: ["a.com"] };
    expect(() => validarConfig({ ...base, trustProxi: true })).toThrow(/chave desconhecida: trustProxi/);
    expect(() => validarConfig({ ...base, check: { firstVisits: true } })).toThrow(
      /check\.firstVisits: chave desconhecida/,
    );
    expect(() => validarConfig({ ...base, alerts: { scans: "tudo" } })).toThrow(
      /alerts\.scans: valor inválido, aceitos: "panel", "dailySummary", "alert"/,
    );
    expect(() => validarConfig({ ...base, check: { firstVisit: "sim" } })).toThrow(
      /check\.firstVisit: tipo inválido, esperado verdadeiro ou falso/,
    );
    expect(() => validarConfig({ ...base, domains: "a.com" })).toThrow(
      /domains: tipo inválido, esperado lista/,
    );
  });

  it("exige upstream http ou https", () => {
    expect(() => validarConfig({ upstream: "ftp://site", domains: ["a.com"] })).toThrow(
      /upstream: precisa ser uma URL http: ou https:/,
    );
  });

  it("rejeita duração inválida apontando o campo", () => {
    expect(() =>
      validarConfig({ upstream: "http://s", domains: ["a.com"], check: { passDuration: "7 dias" } }),
    ).toThrow(/check\.passDuration/);
  });

  it("upstreamTimeout: de 1 s a 10 min, apontando o campo quando sai disso", () => {
    const base = { upstream: "http://s", domains: ["a.com"] };
    expect(validarConfig({ ...base, upstreamTimeout: "180s" }).upstreamTimeoutMs).toBe(180_000);
    expect(validarConfig({ ...base, upstreamTimeout: "1s" }).upstreamTimeoutMs).toBe(1_000);
    expect(validarConfig({ ...base, upstreamTimeout: "10m" }).upstreamTimeoutMs).toBe(600_000);
    for (const valor of ["0s", "11m", "1h", "2 min", 90]) {
      expect(() => validarConfig({ ...base, upstreamTimeout: valor }), String(valor)).toThrow(/upstreamTimeout/);
    }
  });

  it("rejeita raiz que não é objeto", () => {
    expect(() => validarConfig(null)).toThrow(/configuração/);
  });
});
