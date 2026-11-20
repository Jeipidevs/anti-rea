// Regra de abertura do navegador dos casos e2e: no CI uma falha ao abrir derruba o caso; fora dele
// o caso pula dizendo por quê (o Mac com macOS 13 não instala o Chromium do Playwright).
import { describe, expect, it } from "vitest";
import { abrirComReserva, emCI, type CanalNavegador } from "./abrir-navegador.js";

const CANAIS: CanalNavegador[] = [{ channel: "chrome" }, {}];

/** Lançador falso: cada canal falha com o erro dado, ou abre quando o erro é null. */
function lancador(erros: Array<Error | null>) {
  const tentados: CanalNavegador[] = [];
  const lancar = async (canal: CanalNavegador) => {
    const erro = erros[tentados.length];
    tentados.push(canal);
    if (erro) throw erro;
    return { aberto: canal };
  };
  return { lancar, tentados };
}

describe("abrirComReserva", () => {
  it("devolve o primeiro canal que abre", async () => {
    const { lancar, tentados } = lancador([new Error("sem chrome"), null]);
    const r = await abrirComReserva(lancar, CANAIS, true);
    expect(r.navegador).toEqual({ aberto: {} });
    expect(tentados).toEqual(CANAIS);
  });

  it("no CI, sem nenhum canal, lança o último erro em vez de deixar o caso pular", async () => {
    const ultimo = new Error("Executable doesn't exist at /ms-playwright/chromium");
    const { lancar } = lancador([new Error("sem chrome"), ultimo]);
    await expect(abrirComReserva(lancar, CANAIS, true)).rejects.toBe(ultimo);
  });

  it("fora do CI, sem nenhum canal, devolve o motivo com o último erro para o caso pular", async () => {
    const { lancar } = lancador([new Error("sem chrome"), new Error("sandbox falhou")]);
    const r = await abrirComReserva(lancar, CANAIS, false);
    expect(r.navegador).toBeNull();
    expect(r).toMatchObject({ motivo: expect.stringContaining("sandbox falhou") });
  });
});

describe("emCI", () => {
  it("lê a variável CI", () => {
    expect(emCI({ CI: "true" })).toBe(true);
    expect(emCI({ CI: "1" })).toBe(true);
    expect(emCI({})).toBe(false);
    expect(emCI({ CI: "" })).toBe(false);
    expect(emCI({ CI: "false" })).toBe(false);
    expect(emCI({ CI: "0" })).toBe(false);
  });
});
