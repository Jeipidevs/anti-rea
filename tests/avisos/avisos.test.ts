import { afterEach, describe, expect, it, vi } from "vitest";
import { Avisos, textoDoAviso, type Canal } from "../../src/avisos/avisos.js";
import type { Config } from "../../src/config/carregar.js";
import type { Evento } from "../../src/registro/registro.js";

const HORA = 3_600_000;

function ev(parcial: Partial<Evento> = {}): Evento {
  return {
    quando: "2026-11-20T10:05:00",
    ip: "203.0.113.1",
    dominio: "seusite.com.br",
    caminho: "/produtos",
    agente: "curl/8.7.1",
    motivo: "ferramenta: curl",
    gravidade: "copia",
    destino: "sombra",
    ...parcial,
  };
}

function cfg(scans: Config["alerts"]["scans"] = "panel"): Config["alerts"] {
  return { channels: ["telegram"], groupByIpMs: HORA, scans };
}

function canalQueGuarda(nome = "teste"): Canal & { enviados: string[]; eventos: Evento[] } {
  const enviados: string[] = [];
  const eventos: Evento[] = [];
  return {
    nome,
    enviados,
    eventos,
    enviar: async (texto, evento) => {
      enviados.push(texto);
      eventos.push(evento);
    },
  };
}

function espiarStderr(): string[] {
  const linhas: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((texto: string | Uint8Array) => {
    linhas.push(String(texto));
    return true;
  });
  return linhas;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("textoDoAviso", () => {
  it("monta as linhas exatas, na ordem, com a data local dd/mm/aaaa hh:mm", () => {
    const quando = new Date(2026, 10, 20, 9, 7).toISOString();
    expect(textoDoAviso(ev({ quando }), 0)).toBe(
      [
        "Tentativa de cópia barrada",
        "Site: seusite.com.br",
        "Página: /produtos",
        "IP: 203.0.113.1",
        "Motivo: ferramenta: curl",
        "Quando: 20/11/2026 09:07",
        "Destino: página sombra",
      ].join("\n"),
    );
  });

  it("usa o título de varredura e acrescenta a linha dos repetidos", () => {
    const texto = textoDoAviso(ev({ gravidade: "varredura", motivo: "varredura: /.env" }), 4);
    const linhas = texto.split("\n");
    expect(linhas[0]).toBe("Varredura barrada");
    expect(linhas.at(-1)).toBe("Mais 4 tentativas deste IP na última janela (agrupadas).");
  });

  it("é texto puro, sem markdown e sem o travessão longo", () => {
    const texto = textoDoAviso(ev(), 2);
    expect(texto).not.toMatch(/[*_`]/);
    expect(texto).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("Avisos: agrupamento por IP", () => {
  it("segue o exemplo do plano: um aviso por janela e a contagem no seguinte", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg("panel"), [canal], () => t);
    await a.receber(ev({ gravidade: "copia" }));
    await a.receber(ev({ gravidade: "copia" }));
    await a.receber(ev({ gravidade: "varredura" }));
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]).not.toContain("Mais");
    t = HORA + 1;
    await a.receber(ev({ gravidade: "copia" }));
    expect(canal.enviados).toHaveLength(2);
    expect(canal.enviados[1]).toContain("Mais 1 tentativas deste IP na última janela (agrupadas).");
    expect(canal.eventos[1]?.gravidade).toBe("copia");
  });

  it("sem repetidos na janela anterior, o aviso seguinte não traz a linha", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev());
    t = HORA + 5;
    await a.receber(ev());
    expect(canal.enviados).toHaveLength(2);
    expect(canal.enviados[1]).not.toContain("Mais");
  });

  it("IPs diferentes têm janelas separadas", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg(), [canal], () => 0);
    await a.receber(ev({ ip: "203.0.113.1" }));
    await a.receber(ev({ ip: "203.0.113.2" }));
    await a.receber(ev({ ip: "203.0.113.1" }));
    expect(canal.enviados).toHaveLength(2);
  });

  it("a janela vence exatamente em groupByIpMs", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev());
    t = HORA - 1;
    await a.receber(ev());
    expect(canal.enviados).toHaveLength(1);
    t = HORA;
    await a.receber(ev());
    expect(canal.enviados).toHaveLength(2);
    expect(canal.enviados[1]).toContain("Mais 1 tentativas");
  });

  it("os repetidos de uma janela só contam uma vez", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev());
    await a.receber(ev());
    await a.receber(ev());
    t = HORA;
    await a.receber(ev());
    expect(canal.enviados[1]).toContain("Mais 2 tentativas");
    t = 2 * HORA;
    await a.receber(ev());
    expect(canal.enviados[2]).not.toContain("Mais");
  });

  it("estado de IP cuja janela venceu há mais de uma janela é descartado", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev({ ip: "203.0.113.1" }));
    await a.receber(ev({ ip: "203.0.113.1" }));
    t = 2 * HORA + 1;
    await a.receber(ev({ ip: "203.0.113.9" }));
    await a.receber(ev({ ip: "203.0.113.1" }));
    expect(canal.enviados).toHaveLength(3);
    expect(canal.enviados[2]).not.toContain("Mais");
  });

  it("o estado guardado não cresce sem limite com muitos IPs", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    for (let i = 0; i < 200; i++) await a.receber(ev({ ip: `203.0.113.${i % 250}`, caminho: `/${i}` }));
    t = 3 * HORA;
    await a.receber(ev({ ip: "203.0.113.250" }));
    expect((a as unknown as { porIp: Map<string, unknown> }).porIp.size).toBe(1);
  });
});

describe("Avisos: gravidade e scans", () => {
  it("varredura com scans alert vira aviso com o título de varredura", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg("alert"), [canal], () => 0);
    await a.receber(ev({ gravidade: "varredura", motivo: "varredura: /.env" }));
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]?.split("\n")[0]).toBe("Varredura barrada");
  });

  it("varredura com scans alert entra no agrupamento do IP", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg("alert"), [canal], () => t);
    await a.receber(ev({ gravidade: "copia" }));
    await a.receber(ev({ gravidade: "varredura" }));
    expect(canal.enviados).toHaveLength(1);
    t = HORA;
    await a.receber(ev({ gravidade: "copia" }));
    expect(canal.enviados[1]).toContain("Mais 1 tentativas");
  });

  it("varredura com scans panel não avisa nem entra no resumo", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg("panel"), [canal], () => 0);
    await a.receber(ev({ gravidade: "varredura" }));
    expect(canal.enviados).toHaveLength(0);
    expect(a.resumoDoDia()).toBe("Resumo do dia: 0 varreduras barradas");
  });

  it("varredura com scans dailySummary não avisa, entra no resumo e o resumo zera", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg("dailySummary"), [canal], () => 0);
    await a.receber(ev({ gravidade: "varredura", motivo: "varredura: /.env" }));
    await a.receber(ev({ gravidade: "varredura", motivo: "varredura: /wp-admin", ip: "203.0.113.2" }));
    await a.receber(ev({ gravidade: "varredura", motivo: "varredura: /.env", ip: "203.0.113.3" }));
    await a.receber(ev({ gravidade: "copia" }));
    expect(canal.enviados).toHaveLength(1);
    expect(a.resumoDoDia()).toBe(
      ["Resumo do dia: 3 varreduras barradas", "varredura: /.env: 2", "varredura: /wp-admin: 1"].join("\n"),
    );
    expect(a.resumoDoDia()).toBe("Resumo do dia: 0 varreduras barradas");
  });

  it("resumo com uma varredura usa o singular", async () => {
    const a = new Avisos(cfg("dailySummary"), [], () => 0);
    await a.receber(ev({ gravidade: "varredura", motivo: "scanner: nikto" }));
    expect(a.resumoDoDia()).toBe(["Resumo do dia: 1 varredura barrada", "scanner: nikto: 1"].join("\n"));
  });
});

describe("Avisos: falha de canal", () => {
  it("um canal quebrado não derruba os outros e vira uma linha no stderr", async () => {
    const linhas = espiarStderr();
    const canal = canalQueGuarda();
    const quebrado: Canal = {
      nome: "x",
      enviar: async () => {
        throw new Error("fora");
      },
    };
    await expect(new Avisos(cfg(), [quebrado, canal], () => 0).receber(ev())).resolves.toBeUndefined();
    expect(canal.enviados).toHaveLength(1);
    expect(linhas).toEqual(["[anti-rea] aviso x falhou: fora\n"]);
  });

  it("canal que lança algo que não é Error também é contido", async () => {
    const linhas = espiarStderr();
    const quebrado: Canal = {
      nome: "y",
      enviar: () => Promise.reject("sem conexao"),
    };
    await expect(new Avisos(cfg(), [quebrado], () => 0).receber(ev())).resolves.toBeUndefined();
    expect(linhas).toEqual(["[anti-rea] aviso y falhou: sem conexao\n"]);
  });

  it("sem canais, receber não faz nada e não lança", async () => {
    await expect(new Avisos(cfg(), []).receber(ev())).resolves.toBeUndefined();
  });
});
