import { describe, expect, it } from "vitest";
import { duracaoMs } from "../../src/config/duracao.js";

describe("duracaoMs", () => {
  it("converte segundos, minutos, horas e dias", () => {
    expect(duracaoMs("7d")).toBe(7 * 86_400_000);
    expect(duracaoMs("1h")).toBe(3_600_000);
    expect(duracaoMs("30s")).toBe(30_000);
    expect(duracaoMs("5m")).toBe(300_000);
  });

  it("rejeita texto inválido", () => {
    expect(() => duracaoMs("7 dias")).toThrow("duração inválida: 7 dias");
    expect(() => duracaoMs("")).toThrow("duração inválida: ");
    expect(() => duracaoMs("d")).toThrow("duração inválida: d");
  });
});
