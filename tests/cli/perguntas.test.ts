import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// As perguntas do assistente, com as respostas da tela assets/telas/assistente.svg. O @inquirer/prompts
// é trocado por um falso que anota cada pergunta e responde como a tela mostra.

const perguntas: string[] = [];
const respostasDaTela: Record<string, unknown> = {
  "Endereço do seu site?": "http://localhost:3000",
  "Domínio público?": "seusite.com.br",
  "O que fica na frente do porteiro?": true,
  "Onde quer receber os avisos?": "whatsapp",
  "Quem abre o F12 cai na sombra?": true,
};

function responder({ message }: { message: string }): Promise<unknown> {
  perguntas.push(message);
  return Promise.resolve(message.startsWith("Caminhos de máquina") ? "/api/webhook/*" : respostasDaTela[message]);
}

vi.mock("@inquirer/prompts", () => ({ input: responder, select: responder, confirm: responder }));

const { perguntar, rodarInit } = await import("../../src/cli/init.js");
const tela = readFileSync(join(import.meta.dirname, "..", "..", "assets", "telas", "assistente.svg"), "utf8");

/** Pergunta e resposta de cada linha com ✔ da tela, já sem as etiquetas do SVG. */
function linhasDaTela(): { pergunta: string; resposta: string }[] {
  return [...tela.matchAll(/✔ <tspan fill="#EEF0FF">([^<]+)<\/tspan> <tspan fill="#8A90B2">([^<]+)<\/tspan>/g)].map((m) => ({
    pergunta: m[1]!,
    resposta: m[2]!,
  }));
}

describe("assistente: perguntas e a tela assistente.svg", () => {
  it("a última linha diz como ligar com o que roda hoje, sem npx anti-rea (o pacote ainda não está no npm)", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "anti-rea-init-"));
    try {
      const ultima = (await rodarInit(pasta, false)).at(-1)!;
      expect(ultima).not.toContain("npx anti-rea");
      expect(ultima).toContain("troque init por start");
      expect(ultima).toContain("docker compose up -d");
      // Quem rodou init --forcar não pode levar o --forcar para o start, que não o aceita.
      expect((await rodarInit(pasta, true)).at(-1)!).toContain("troque init --forcar por start");
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("a pergunta dos caminhos de máquina dá o exemplo com /* (prefixo), e a tela responde assim", async () => {
    perguntas.length = 0;
    const r = await perguntar();
    const pergunta = perguntas.find((p) => p.startsWith("Caminhos de máquina"));
    expect(pergunta).toBe("Caminhos de máquina (ex.: /api/webhook/*)?");
    expect(r.isentos).toEqual(["/api/webhook/*"]);
    const naTela = linhasDaTela().find((l) => l.pergunta === pergunta);
    expect(naTela?.resposta).toBe("/api/webhook/*");
  });

  it("a tela mostra as seis perguntas do assistente, na mesma ordem", async () => {
    perguntas.length = 0;
    await perguntar();
    expect(linhasDaTela().map((l) => l.pergunta)).toEqual(perguntas);
  });
});
