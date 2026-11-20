import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registro, TETO_EVENTOS_POR_DIA, type Evento } from "../../src/registro/registro.js";

const DIA_MS = 86_400_000;

function ev(parcial: Partial<Evento> = {}): Evento {
  return {
    quando: "2026-11-20T10:00:00Z",
    ip: "203.0.113.7",
    dominio: "seusite.com.br",
    caminho: "/",
    agente: "curl/8.7.1",
    motivo: "ferramenta: curl",
    gravidade: "copia",
    destino: "sombra",
    ...parcial,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anti-rea-registro-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function espiarStderr(): string[] {
  const linhas: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((texto: string | Uint8Array) => {
    linhas.push(String(texto));
    return true;
  });
  return linhas;
}

describe("Registro", () => {
  it("segue o exemplo do plano", () => {
    const r = new Registro(dir, 2 * DIA_MS);
    r.gravar(ev({ quando: "2026-11-20T10:00:00Z" }));
    r.gravar(ev({ quando: "2026-11-20T11:00:00Z" }));
    expect(r.ler("2026-11-20")).toHaveLength(2);
    writeFileSync(join(dir, "2026-11-10.jsonl"), "");
    expect(r.apagarVencidos(new Date("2026-11-20T12:00:00Z"))).toBe(1);
    expect(existsSync(join(dir, "2026-11-20.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "2026-11-10.jsonl"))).toBe(false);
  });

  it("cria a pasta, inclusive aninhada, se nao existir", () => {
    const pasta = join(dir, "a", "b", "registro");
    const r = new Registro(pasta, DIA_MS);
    expect(existsSync(pasta)).toBe(true);
    r.gravar(ev());
    expect(r.ler("2026-11-20")).toEqual([ev()]);
  });

  it("devolve o evento igual ao gravado, com uma linha JSON por evento", () => {
    const r = new Registro(dir, DIA_MS);
    const a = ev({ caminho: "/a", destino: "registrado", gravidade: "varredura" });
    const b = ev({ caminho: "/b", destino: "recusado" });
    r.gravar(a);
    r.gravar(b);
    expect(r.ler("2026-11-20")).toEqual([a, b]);
    const linhas = readFileSync(join(dir, "2026-11-20.jsonl"), "utf8").split("\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[2]).toBe("");
    expect(JSON.parse(linhas[0]!)).toEqual(a);
  });

  it("o nome do arquivo vem do dia UTC de quando, nao do fuso local", () => {
    const r = new Registro(dir, DIA_MS);
    r.gravar(ev({ quando: "2026-11-20T23:30:00-03:00" }));
    expect(existsSync(join(dir, "2026-11-21.jsonl"))).toBe(true);
    expect(r.ler("2026-11-21")).toHaveLength(1);
    expect(r.ler("2026-11-20")).toEqual([]);
  });

  it("quebra de linha dentro de um campo nao quebra o formato", () => {
    const r = new Registro(dir, DIA_MS);
    const malicioso = ev({ agente: 'Mozilla/5.0\n{"falso":true}\r\nfim' });
    r.gravar(malicioso);
    r.gravar(ev({ caminho: "/depois" }));
    const conteudo = readFileSync(join(dir, "2026-11-20.jsonl"), "utf8");
    expect(conteudo.split("\n")).toHaveLength(3);
    const lidos = r.ler("2026-11-20");
    expect(lidos).toHaveLength(2);
    expect(lidos[0]).toEqual(malicioso);
    expect(lidos[1]!.caminho).toBe("/depois");
  });

  it("ler devolve lista vazia quando o arquivo do dia nao existe", () => {
    const r = new Registro(dir, DIA_MS);
    expect(r.ler("2026-01-01")).toEqual([]);
  });

  it("ler pula linhas malformadas e linhas vazias", () => {
    const r = new Registro(dir, DIA_MS);
    const bom = ev();
    writeFileSync(
      join(dir, "2026-11-20.jsonl"),
      [JSON.stringify(bom), "{quebrado", "", "42", "null", JSON.stringify(bom), "\r"].join("\n") + "\n",
    );
    expect(r.ler("2026-11-20")).toEqual([bom, bom]);
  });

  it("ler recusa dia fora do formato AAAA-MM-DD", () => {
    const r = new Registro(join(dir, "registro"), DIA_MS);
    writeFileSync(join(dir, "fora.jsonl"), JSON.stringify(ev()) + "\n");
    expect(r.ler("../fora")).toEqual([]);
  });

  it("gravar nunca lanca: erro de disco vira uma linha no stderr", () => {
    const pasta = join(dir, "registro");
    const r = new Registro(pasta, DIA_MS);
    rmSync(pasta, { recursive: true });
    writeFileSync(pasta, "agora sou um arquivo");
    const linhas = espiarStderr();
    expect(() => r.gravar(ev())).not.toThrow();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.startsWith("[anti-rea] registro:")).toBe(true);
    expect(linhas[0]!.endsWith("\n")).toBe(true);
  });

  it("falha de gravacao avisa uma vez por dia, com o que fazer, e nao uma linha por evento", () => {
    const pasta = join(dir, "registro");
    const r = new Registro(pasta, DIA_MS);
    rmSync(pasta, { recursive: true });
    writeFileSync(pasta, "agora sou um arquivo");
    const linhas = espiarStderr();
    for (let i = 0; i < 200; i++) r.gravar(ev({ quando: "2026-11-20T10:00:00Z" }));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain(`falha ao gravar em ${pasta}`);
    expect(linhas[0]).toContain("chown 1000:1000");
    // O dia seguinte tem a própria linha.
    r.gravar(ev({ quando: "2026-11-21T10:00:00Z" }));
    r.gravar(ev({ quando: "2026-11-21T11:00:00Z" }));
    expect(linhas).toHaveLength(2);
  });

  it("podeGravar diz se a pasta aceita arquivo novo, sem deixar nada nela", () => {
    const r = new Registro(dir, DIA_MS);
    expect(r.podeGravar()).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    const pasta = join(dir, "registro");
    const outro = new Registro(pasta, DIA_MS);
    rmSync(pasta, { recursive: true });
    writeFileSync(pasta, "agora sou um arquivo");
    expect(outro.podeGravar()).toBeInstanceOf(Error);
  });

  it("gravar com quando invalido nao lanca e avisa no stderr", () => {
    const r = new Registro(dir, DIA_MS);
    const linhas = espiarStderr();
    expect(() => r.gravar(ev({ quando: "ontem" }))).not.toThrow();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.startsWith("[anti-rea] registro:")).toBe(true);
  });

  it("apagarVencidos guarda os dias que ainda podem ter evento dentro da retencao", () => {
    const r = new Registro(dir, 2 * DIA_MS);
    for (const dia of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]) {
      writeFileSync(join(dir, `${dia}.jsonl`), "");
    }
    // corte em 2026-11-18T12:00Z: o dia 17 acabou antes do corte, o dia 18 ainda nao
    expect(r.apagarVencidos(new Date("2026-11-20T12:00:00Z"))).toBe(2);
    expect(existsSync(join(dir, "2026-11-16.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "2026-11-17.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "2026-11-18.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "2026-11-19.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "2026-11-20.jsonl"))).toBe(true);
  });

  it("apagarVencidos so mexe em arquivos com nome exato AAAA-MM-DD.jsonl", () => {
    const r = new Registro(dir, DIA_MS);
    const outros = [
      "notas.txt",
      "2026-11-01.jsonl.bak",
      "2026-1-01.jsonl",
      "x2026-11-01.jsonl",
      "2026-11-01.json",
      "2026-13-45.jsonl",
      "2026-02-30.jsonl",
    ];
    for (const nome of outros) writeFileSync(join(dir, nome), "");
    mkdirSync(join(dir, "2026-11-02.jsonl"));
    writeFileSync(join(dir, "2026-11-01.jsonl"), "");
    const linhas = espiarStderr();
    expect(r.apagarVencidos(new Date("2026-11-20T12:00:00Z"))).toBe(1);
    for (const nome of outros) expect(existsSync(join(dir, nome))).toBe(true);
    expect(existsSync(join(dir, "2026-11-02.jsonl"))).toBe(true);
    expect(existsSync(join(dir, "2026-11-01.jsonl"))).toBe(false);
    expect(linhas).toEqual([]);
  });

  it("apagarVencidos nunca lanca: erro de disco vai para o stderr e devolve 0", () => {
    const pasta = join(dir, "registro");
    const r = new Registro(pasta, DIA_MS);
    rmSync(pasta, { recursive: true });
    const linhas = espiarStderr();
    expect(r.apagarVencidos(new Date("2026-11-20T12:00:00Z"))).toBe(0);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.startsWith("[anti-rea] registro:")).toBe(true);
  });

  it("apagarVencidos com pasta vazia devolve 0", () => {
    const r = new Registro(dir, DIA_MS);
    expect(r.apagarVencidos(new Date("2026-11-20T12:00:00Z"))).toBe(0);
  });
});

describe("Registro: teto de eventos por dia", () => {
  it("o teto padrao e 50000 eventos por dia", () => {
    expect(TETO_EVENTOS_POR_DIA).toBe(50_000);
  });

  it("passado o teto, so conta: nao escreve no arquivo e avisa uma unica vez no stderr", () => {
    const r = new Registro(dir, DIA_MS, 3);
    const linhas = espiarStderr();
    for (let i = 0; i < 3; i++) r.gravar(ev({ caminho: `/${i}` }));
    expect(linhas).toEqual([]);
    for (let i = 3; i < 10; i++) r.gravar(ev({ caminho: `/${i}` }));
    expect(r.ler("2026-11-20").map((e) => e.caminho)).toEqual(["/0", "/1", "/2"]);
    expect(readFileSync(join(dir, "2026-11-20.jsonl"), "utf8").split("\n")).toHaveLength(4);
    expect(r.contagem("2026-11-20")).toBe(10);
    expect(linhas).toEqual([
      "[anti-rea] registro: limite de 3 eventos atingido em 2026-11-20; o resto do dia so conta.\n",
    ]);
  });

  it("o teto vale por dia: o dia seguinte volta a gravar e tem o proprio aviso", () => {
    const r = new Registro(dir, DIA_MS, 2);
    const linhas = espiarStderr();
    for (let i = 0; i < 4; i++) r.gravar(ev({ quando: "2026-11-20T10:00:00Z" }));
    for (let i = 0; i < 4; i++) r.gravar(ev({ quando: "2026-11-21T10:00:00Z" }));
    expect(r.ler("2026-11-20")).toHaveLength(2);
    expect(r.ler("2026-11-21")).toHaveLength(2);
    expect(r.contagem("2026-11-20")).toBe(4);
    expect(r.contagem("2026-11-21")).toBe(4);
    expect(linhas).toEqual([
      "[anti-rea] registro: limite de 2 eventos atingido em 2026-11-20; o resto do dia so conta.\n",
      "[anti-rea] registro: limite de 2 eventos atingido em 2026-11-21; o resto do dia so conta.\n",
    ]);
  });

  it("o teto conta o que ja estava no arquivo do dia: reiniciar o processo nao zera", () => {
    const antes = new Registro(dir, DIA_MS, 3);
    antes.gravar(ev());
    antes.gravar(ev());
    const depois = new Registro(dir, DIA_MS, 3);
    const linhas = espiarStderr();
    depois.gravar(ev());
    depois.gravar(ev());
    expect(depois.ler("2026-11-20")).toHaveLength(3);
    expect(depois.contagem("2026-11-20")).toBe(4);
    expect(linhas).toHaveLength(1);
  });

  it("contagem de dia sem evento e 0", () => {
    const r = new Registro(dir, DIA_MS, 3);
    expect(r.contagem("2026-11-20")).toBe(0);
  });

  it("o teto padrao vale quando o construtor nao recebe teto", () => {
    const r = new Registro(dir, DIA_MS);
    for (let i = 0; i < 5; i++) r.gravar(ev());
    expect(r.ler("2026-11-20")).toHaveLength(5);
  });
});
