import { describe, expect, it } from "vitest";
import { confirmarPorDns, criarResolvedorDns } from "../../src/robos/dns.js";

// Base falsa no formato de node:dns/promises: nenhum teste toca a rede.
function baseFalsa(opcoes: {
  reverse?: (ip: string) => Promise<string[]>;
  resolve4?: (h: string) => Promise<string[]>;
  resolve6?: (h: string) => Promise<string[]>;
}) {
  const nunca = () => new Promise<string[]>(() => {});
  const vazio = async () => {
    throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
  };
  return {
    reverse: opcoes.reverse ?? nunca,
    resolve4: opcoes.resolve4 ?? vazio,
    resolve6: opcoes.resolve6 ?? vazio,
  };
}

describe("criarResolvedorDns", () => {
  it("direto junta IPv4 e IPv6 do nome", async () => {
    const r = criarResolvedorDns({
      base: baseFalsa({
        resolve4: async () => ["66.249.66.1"],
        resolve6: async () => ["2001:4860:4801:10::1"],
      }),
    });
    expect(await r.direto("crawl.googlebot.com")).toEqual(["66.249.66.1", "2001:4860:4801:10::1"]);
  });

  it("direto tolera uma familia sem resposta", async () => {
    const r = criarResolvedorDns({ base: baseFalsa({ resolve4: async () => ["66.249.66.1"] }) });
    expect(await r.direto("crawl.googlebot.com")).toEqual(["66.249.66.1"]);
  });

  it("reverso passa adiante o resultado", async () => {
    const r = criarResolvedorDns({ base: baseFalsa({ reverse: async () => ["a.googlebot.com"] }) });
    expect(await r.reverso("66.249.66.1")).toEqual(["a.googlebot.com"]);
  });

  it("estoura o tempo e a confirmacao vira false", async () => {
    const r = criarResolvedorDns({ base: baseFalsa({}), tempoMs: 20 });
    const inicio = Date.now();
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], r)).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it("direto que nunca responde tambem estoura o tempo", async () => {
    const nunca = () => new Promise<string[]>(() => {});
    const r = criarResolvedorDns({
      base: baseFalsa({ reverse: async () => ["a.googlebot.com"], resolve4: nunca, resolve6: nunca }),
      tempoMs: 20,
    });
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], r)).toBe(false);
  });

  it("direto sem endereco nas duas familias da erro definitivo (ENODATA)", async () => {
    const r = criarResolvedorDns({ base: baseFalsa({}) });
    await expect(r.direto("crawl.googlebot.com")).rejects.toMatchObject({ code: "ENODATA" });
  });

  it("direto com falha passageira numa familia repassa essa falha", async () => {
    const r = criarResolvedorDns({
      base: baseFalsa({
        resolve4: async () => {
          throw Object.assign(new Error("queryA ETIMEOUT"), { code: "ETIMEOUT" });
        },
      }),
    });
    await expect(r.direto("crawl.googlebot.com")).rejects.toMatchObject({ code: "ETIMEOUT" });
  });

  it("usa node:dns/promises por padrao sem quebrar com IP invalido", async () => {
    const r = criarResolvedorDns();
    expect(await confirmarPorDns("nao-e-ip", [".googlebot.com"], r)).toBe(false);
  });
});
