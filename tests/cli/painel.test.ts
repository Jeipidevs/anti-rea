import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gravarPainel } from "../../src/cli/painel.js";
import { Registro } from "../../src/registro/registro.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anti-rea-cli-painel-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const evento = (quando: string) => ({
  quando,
  ip: "203.0.113.7",
  dominio: "seusite.com.br",
  caminho: "/.env",
  agente: "curl/8.7.1",
  motivo: "curl",
  gravidade: "copia" as const,
  destino: "sombra" as const,
});

describe("anti-rea painel", () => {
  it("grava o painel do dia mais recente num arquivo só do usuário", () => {
    const registro = new Registro(join(dir, "registro"), 30 * 86_400_000);
    registro.gravar(evento("2026-11-20T10:00:00.000Z"));
    registro.gravar(evento("2026-11-21T10:00:00.000Z"));
    const saida = join(dir, "painel.html");
    const linhas = gravarPainel({ registro: join(dir, "registro"), saida, agora: new Date("2026-11-22T00:00:00Z") });
    expect(linhas[0]).toBe("Painel de 2026-11-21: 1 eventos.");
    expect(linhas[1]).toContain(saida);
    const html = readFileSync(saida, "utf8");
    expect(html).toContain("Painel do ANTI-REA");
    expect(html).toContain("203.0.113.7");
    expect(html).not.toContain('href="?');
    expect(statSync(saida).mode & 0o777).toBe(0o600);
  });

  it("com --dia escolhe o dia; dia inválido e pasta que não existe viram mensagem clara", () => {
    const registro = new Registro(join(dir, "registro"), 30 * 86_400_000);
    registro.gravar(evento("2026-11-20T10:00:00.000Z"));
    const saida = join(dir, "p.html");
    expect(gravarPainel({ registro: join(dir, "registro"), dia: "2026-11-20", saida })[0]).toBe("Painel de 2026-11-20: 1 eventos.");
    expect(() => gravarPainel({ registro: join(dir, "registro"), dia: "20/11", saida })).toThrow("Dia inválido");
    expect(() => gravarPainel({ registro: join(dir, "nao-existe"), saida })).toThrow("Não achei a pasta do registro");
  });
});
