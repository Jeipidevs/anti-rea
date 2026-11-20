import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { InjetorGuarda, SCRIPT_GUARDA } from "../../src/porteiro/injecao.js";

async function injetar(pedacos: string[], encoding: BufferEncoding = "utf8"): Promise<string> {
  const fonte = Readable.from(pedacos.map((p) => Buffer.from(p, encoding)));
  return text(fonte.pipe(new InjetorGuarda()));
}

describe("InjetorGuarda", () => {
  it("põe o script antes de </head>, mesmo partido entre pedaços", async () => {
    const saida = await injetar(["<html><head><title>x</title></he", "ad><body>oi</body></html>"]);
    expect(saida).toBe(`<html><head><title>x</title>${SCRIPT_GUARDA}</head><body>oi</body></html>`);
  });

  it("aceita </HEAD > em maiúsculas e com espaço", async () => {
    expect(await injetar(["<HEAD></HEAD ><p>a</p>"])).toBe(`<HEAD>${SCRIPT_GUARDA}</HEAD ><p>a</p>`);
  });

  it("sem </head>, entra logo depois de <body ...>", async () => {
    expect(await injetar(['<!doctype html><body class="x">', "<p>a</p></body>"])).toBe(
      `<!doctype html><body class="x">${SCRIPT_GUARDA}<p>a</p></body>`,
    );
  });

  it("sem head nem body, vai no fim do documento", async () => {
    expect(await injetar(["<p>só um pedaço</p>"])).toBe(`<p>só um pedaço</p>${SCRIPT_GUARDA}`);
  });

  it("não confunde <bodyx> com <body>", async () => {
    expect(await injetar(["<bodyx>a"])).toBe(`<bodyx>a${SCRIPT_GUARDA}`);
  });

  it("injeta uma vez só", async () => {
    const saida = await injetar(["<head></head>", "<head></head>"]);
    expect(saida.split(SCRIPT_GUARDA).length - 1).toBe(1);
  });

  it("preserva bytes de página em latin1", async () => {
    const fonte = Readable.from([Buffer.from("<head></head><p>café</p>", "latin1")]);
    const saida = Buffer.concat(await fonte.pipe(new InjetorGuarda()).toArray());
    expect(saida.toString("latin1")).toBe(`<head>${SCRIPT_GUARDA}</head><p>café</p>`);
  });

  it("depois de 256 KB sem </head> nem <body>, deixa a página passar sem script", async () => {
    const grande = "x".repeat(300 * 1024);
    const saida = await injetar([grande, "<head></head>"]);
    expect(saida).toBe(grande + "<head></head>");
  });

  it("depois de 256 KB sem </head>, usa o <body> que já veio", async () => {
    const grande = "<body>" + "x".repeat(300 * 1024);
    const saida = await injetar([grande, "fim"]);
    expect(saida.startsWith(`<body>${SCRIPT_GUARDA}xxx`)).toBe(true);
    expect(saida.endsWith("fim")).toBe(true);
  });
});
