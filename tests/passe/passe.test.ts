import { describe, expect, it } from "vitest";
import { codigoDeDono, conferirPasse, criarPasse, revogarPasse } from "../../src/passe/passe.js";

const s = "segredo-de-teste";

describe("passe", () => {
  it("aceita passe valido de visitante", () => {
    const v = criarPasse(s, "visitante", 60_000, 1_000);
    const p = conferirPasse(s, v, 2_000);
    expect(p?.tipo).toBe("visitante");
    expect(p?.expira).toBe(61_000);
  });

  it("aceita passe de dono", () => {
    const v = criarPasse(s, "dono", 60_000, 1_000);
    expect(conferirPasse(s, v, 2_000)?.tipo).toBe("dono");
  });

  it("recusa passe vencido", () => {
    const v = criarPasse(s, "visitante", 60_000, 1_000);
    expect(conferirPasse(s, v, 62_000)).toBeNull();
  });

  it("recusa segredo errado", () => {
    const v = criarPasse(s, "visitante", 60_000, 1_000);
    expect(conferirPasse("outro", v, 2_000)).toBeNull();
  });

  it("recusa passe adulterado", () => {
    const v = criarPasse(s, "visitante", 60_000, 1_000);
    expect(conferirPasse(s, v.slice(0, -2) + "xx", 2_000)).toBeNull();
  });

  it("recusa carga adulterada com assinatura antiga", () => {
    const dono = criarPasse(s, "dono", 60_000, 1_000);
    const visitante = criarPasse(s, "visitante", 60_000, 1_000);
    const forjado = dono.split(".")[0] + "." + visitante.split(".")[1];
    expect(conferirPasse(s, forjado, 2_000)).toBeNull();
  });

  it("recusa ausente e formato invalido sem lancar", () => {
    expect(conferirPasse(s, undefined, 2_000)).toBeNull();
    expect(conferirPasse(s, "", 2_000)).toBeNull();
    expect(conferirPasse(s, "abc", 2_000)).toBeNull();
    expect(conferirPasse(s, "a.b.c", 2_000)).toBeNull();
    expect(conferirPasse(s, ".", 2_000)).toBeNull();
  });

  it("recusa passe revogado", () => {
    const v = criarPasse(s, "visitante", 60_000, 1_000);
    const p = conferirPasse(s, v, 2_000)!;
    revogarPasse(p.id);
    expect(conferirPasse(s, v, 2_000)).toBeNull();
  });

  it("revogar um passe nao afeta outro", () => {
    const a = criarPasse(s, "visitante", 60_000, 1_000);
    const b = criarPasse(s, "visitante", 60_000, 1_000);
    revogarPasse(conferirPasse(s, a, 2_000)!.id);
    expect(conferirPasse(s, b, 2_000)).not.toBeNull();
  });

  it("codigo de dono tem 24 caracteres e muda com a versao e o segredo", () => {
    expect(codigoDeDono(s, 1)).toHaveLength(24);
    expect(codigoDeDono(s, 1)).toBe(codigoDeDono(s, 1));
    expect(codigoDeDono(s, 1)).not.toBe(codigoDeDono(s, 2));
    expect(codigoDeDono("outro", 1)).not.toBe(codigoDeDono(s, 1));
    expect(codigoDeDono(s, 1)).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
