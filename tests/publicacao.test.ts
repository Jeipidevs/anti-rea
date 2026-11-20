import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Cadeia de publicação: a imagem :latest sai de um job com packages: write, então cada ação de fora
// fica presa ao commit (tag móvel pode ser trocada por quem controla a ação). O Dependabot propõe
// as versões novas, com o SHA e a versão no comentário.

const raiz = join(import.meta.dirname, "..");
const pastaFluxos = join(raiz, ".github", "workflows");
const fluxos = readdirSync(pastaFluxos).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));

describe("GitHub Actions presas ao commit", () => {
  it("há fluxos para conferir", () => {
    expect(fluxos).toEqual(expect.arrayContaining(["ci.yml", "imagem.yml"]));
  });

  for (const nome of fluxos) {
    it(`${nome}: cada uses: aponta para o SHA de 40 caracteres, com a versão num comentário`, () => {
      const linhas = readFileSync(join(pastaFluxos, nome), "utf8").split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
      expect(linhas.length).toBeGreaterThan(0);
      for (const linha of linhas) {
        expect(linha, linha).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    });
  }

  it("dependabot.yml acompanha as ações do GitHub", () => {
    const arquivo = join(raiz, ".github", "dependabot.yml");
    expect(existsSync(arquivo)).toBe(true);
    const cfg = parse(readFileSync(arquivo, "utf8")) as {
      version: number;
      updates: { "package-ecosystem": string; directory: string; schedule: { interval: string } }[];
    };
    expect(cfg.version).toBe(2);
    const acoes = cfg.updates.find((u) => u["package-ecosystem"] === "github-actions");
    expect(acoes?.directory).toBe("/");
    expect(acoes?.schedule.interval).toMatch(/^(daily|weekly|monthly)$/);
  });
});
