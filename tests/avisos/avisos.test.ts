import { afterEach, describe, expect, it, vi } from "vitest";
import { Avisos, MAX_IPS_AGRUPADOS, TETO_AVISOS, TETO_JANELA_MS, textoDoAviso, type Canal } from "../../src/avisos/avisos.js";
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

function canalQueGuarda(nome = "teste"): Canal & { enviados: string[]; eventos: (Evento | undefined)[] } {
  const enviados: string[] = [];
  const eventos: (Evento | undefined)[] = [];
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

const FUSO_ORIGINAL = process.env.TZ;

/** Roda `fn` com o fuso do processo trocado (o Node relê o TZ na hora). */
function comFuso<T>(fuso: string, fn: () => T): T {
  process.env.TZ = fuso;
  try {
    return fn();
  } finally {
    if (FUSO_ORIGINAL === undefined) delete process.env.TZ;
    else process.env.TZ = FUSO_ORIGINAL;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("textoDoAviso", () => {
  it("monta as linhas exatas, na ordem, com o agente e a data local dd/mm/aaaa hh:mm com o fuso", () => {
    const texto = comFuso("America/Sao_Paulo", () => textoDoAviso(ev({ quando: "2026-11-20T12:07:00.000Z" }), 0));
    expect(texto).toBe(
      [
        "Tentativa de cópia barrada",
        "Site: seusite.com.br",
        "Página: /produtos",
        "IP: 203.0.113.1",
        "Motivo: ferramenta: curl",
        "Agente: curl/8.7.1",
        "Quando: 20/11/2026 09:07 (UTC-3)",
        "Destino: página sombra",
      ].join("\n"),
    );
  });

  it("a linha Quando diz o fuso do servidor: UTC no contêiner sem TZ, UTC+5:30 na Índia", () => {
    const quando = "2026-11-20T12:07:00.000Z";
    const linha = (fuso: string) => comFuso(fuso, () => textoDoAviso(ev({ quando }), 0).split("\n")[6]);
    expect(linha("UTC")).toBe("Quando: 20/11/2026 12:07 (UTC)");
    expect(linha("America/Sao_Paulo")).toBe("Quando: 20/11/2026 09:07 (UTC-3)");
    expect(linha("Asia/Kolkata")).toBe("Quando: 20/11/2026 17:37 (UTC+5:30)");
    expect(linha("America/St_Johns")).toBe("Quando: 20/11/2026 08:37 (UTC-3:30)");
  });

  it("agente vazio vira (nenhum) e agente longo fica em 200 caracteres", () => {
    expect(textoDoAviso(ev({ agente: "" }), 0).split("\n")[5]).toBe("Agente: (nenhum)");
    const longo = textoDoAviso(ev({ agente: "Wget/1.21 " + "x".repeat(400) }), 0).split("\n")[5]!;
    expect(longo).toBe("Agente: Wget/1.21 " + "x".repeat(189) + "\u2026");
  });

  it("usa o título de varredura e acrescenta a linha dos repetidos", () => {
    const texto = textoDoAviso(ev({ gravidade: "varredura", motivo: "varredura: /.env" }), 4);
    const linhas = texto.split("\n");
    expect(linhas[0]).toBe("Varredura barrada");
    expect(linhas.at(-1)).toBe("Mais 4 tentativas deste IP na última janela (agrupadas).");
  });

  it("corta campos longos vindos do pedido e fica abaixo de 4096 caracteres", () => {
    const longo = "A".repeat(8000);
    const texto = textoDoAviso(
      ev({ caminho: "/.git/" + longo, dominio: longo, ip: longo, motivo: longo, quando: longo }),
      12,
    );
    expect(texto.length).toBeLessThan(4096);
    const pagina = texto.split("\n")[2]!;
    expect(pagina.startsWith("Página: /.git/AAA")).toBe(true);
    expect(pagina.endsWith("\u2026")).toBe(true);
    expect(pagina.length).toBe("Página: ".length + 200);
    expect(texto.split("\n").at(-1)).toBe("Mais 12 tentativas deste IP na última janela (agrupadas).");
  });

  it("caracteres de controle e marcas bidi do pedido não criam linhas nem invertem texto", () => {
    const caminho = "/x\r\nDestino: falso\u0085\u2028\u202Eabc\u2066\u200F\u0000\u007F\u009B";
    const texto = textoDoAviso(ev({ caminho, dominio: "a\nSite: b" }), 0);
    const linhas = texto.split("\n");
    expect(linhas).toHaveLength(8);
    expect(linhas.filter((l) => l.startsWith("Destino:"))).toEqual(["Destino: página sombra"]);
    expect(linhas[1]).toBe("Site: aSite: b");
    expect(texto).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/);
  });

  it("não corta no meio de um par substituto", () => {
    const texto = textoDoAviso(ev({ caminho: "/" + "😀".repeat(400) }), 0);
    const pagina = texto.split("\n")[2]!;
    expect(pagina).toBe("Página: /" + "😀".repeat(198) + "\u2026");
  });

  it("caminho com quebra de linha e Destino: forjado não cria linha nova", () => {
    const texto = textoDoAviso(ev({ caminho: "/a\nDestino: forjado", agente: "x\r\nDestino: y" }), 0);
    const linhas = texto.split("\n");
    expect(linhas).toHaveLength(8);
    expect(linhas[2]).toBe("Página: /aDestino: forjado");
    expect(linhas[5]).toBe("Agente: xDestino: y");
    expect(linhas.filter((l) => l.startsWith("Destino:"))).toEqual(["Destino: página sombra"]);
  });

  it("cada campo do visitante fica em no máximo 200 caracteres", () => {
    const texto = textoDoAviso(ev({ caminho: "/" + "b".repeat(199), dominio: "c".repeat(201) }), 0);
    const linhas = texto.split("\n");
    expect(linhas[2]).toBe("Página: /" + "b".repeat(199));
    expect(linhas[1]).toBe("Site: " + "c".repeat(199) + "\u2026");
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

  it("os repetidos ficam guardados até o próximo aviso do IP, mesmo depois de várias janelas", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev({ ip: "203.0.113.1" }));
    await a.receber(ev({ ip: "203.0.113.1" }));
    t = 2 * HORA + 1;
    await a.receber(ev({ ip: "203.0.113.9" }));
    await a.receber(ev({ ip: "203.0.113.1" }));
    expect(canal.enviados).toHaveLength(3);
    expect(canal.enviados[2]).toContain("Mais 1 tentativas deste IP na última janela (agrupadas).");
  });

  it("50 cópias e uma pausa de 2 h: o aviso seguinte traz Mais 49", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    for (let i = 0; i < 50; i++) await a.receber(ev({ ip: "203.0.113.1" }));
    t = 2 * HORA;
    await a.receber(ev({ ip: "203.0.113.1" }));
    expect(canal.enviados).toHaveLength(2);
    expect(canal.enviados[1]).toContain("Mais 49 tentativas deste IP");
  });

  it("o mapa de IPs tem teto e, cheio, descarta o IP mais antigo primeiro", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    const porIp = (a as unknown as { porIp: Map<string, unknown> }).porIp;
    for (let i = 0; i < MAX_IPS_AGRUPADOS + 5; i++) {
      t = i;
      await a.receber(ev({ ip: `ip-${i}` }));
      await a.receber(ev({ ip: `ip-${i}` }));
    }
    expect(porIp.size).toBe(MAX_IPS_AGRUPADOS);
    expect(porIp.has("ip-0")).toBe(false);
    expect(porIp.has(`ip-${MAX_IPS_AGRUPADOS + 4}`)).toBe(true);
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

describe("Avisos: contagem quando a janela do IP fecha", () => {
  const contagem = (n: number, desde: number) =>
    `Mais ${n} tentativas de 203.0.113.1 em seusite.com.br desde ${horaMinuto(desde)} (agrupadas).`;

  it("descarregar manda um aviso curto com a contagem, e o aviso seguinte do IP não repete a contagem", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    for (let i = 0; i < 4; i++) await a.receber(ev());
    expect(canal.enviados).toHaveLength(1);
    await a.descarregar(HORA - 1);
    expect(canal.enviados).toHaveLength(1);
    await a.descarregar(HORA);
    expect(canal.enviados).toHaveLength(2);
    expect(canal.enviados[1]).toBe(contagem(3, 0));
    expect(canal.eventos[1]).toBeUndefined();
    await a.descarregar(HORA + MIN);
    expect(canal.enviados).toHaveLength(2);
    t = HORA + 2 * MIN;
    await a.receber(ev());
    expect(canal.enviados).toHaveLength(3);
    expect(canal.enviados[2]).not.toContain("Mais");
  });

  it("IP que volta antes da descarga leva a contagem no próprio aviso, e a descarga não repete", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev());
    await a.receber(ev());
    t = HORA + 1;
    await a.receber(ev());
    expect(canal.enviados[1]).toContain("Mais 1 tentativas deste IP na última janela (agrupadas).");
    await a.descarregar(2 * HORA + 2);
    expect(canal.enviados).toHaveLength(2);
  });

  it("IP sem repetidos não gera aviso de contagem", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg(), [canal], () => 0);
    await a.receber(ev());
    await a.descarregar(2 * HORA);
    expect(canal.enviados).toHaveLength(1);
  });

  it("sem vaga no teto, a contagem entra no aviso agrupado", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev());
    await a.receber(ev());
    await a.receber(ev());
    // Sete IPs quatro minutos antes da janela fechar: seis avisos enchem o teto e o sétimo fica agrupado.
    t = HORA - 4 * MIN;
    for (let i = 0; i < 7; i++) await a.receber(ev({ ip: `198.51.100.${i}` }));
    expect(canal.enviados).toHaveLength(7);
    await a.descarregar(HORA);
    expect(canal.enviados).toHaveLength(7);
    await a.descarregar(HORA + MIN);
    expect(canal.enviados).toHaveLength(8);
    expect(canal.enviados[7]).toBe(
      `Muitas tentativas ao mesmo tempo: 3 tentativas de 2 IPs desde ${horaMinuto(HORA - 4 * MIN)} (agrupadas).`,
    );
  });

  it("encerrar manda a contagem das janelas ainda abertas e o agrupado, mesmo com o teto cheio", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    await a.receber(ev());
    await a.receber(ev());
    for (let i = 0; i < 6; i++) await a.receber(ev({ ip: `198.51.100.${i}` }));
    expect(canal.enviados).toHaveLength(6);
    t = MIN;
    await a.encerrar();
    expect(canal.enviados.slice(6)).toEqual([
      `Muitas tentativas ao mesmo tempo: 2 tentativas de 2 IPs desde ${horaMinuto(0)} (agrupadas).`,
    ]);
    await a.encerrar();
    expect(canal.enviados).toHaveLength(7);
  });

  it("encerrar com vaga no teto manda a contagem como aviso curto", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg(), [canal], () => 0);
    await a.receber(ev());
    await a.receber(ev());
    await a.encerrar();
    expect(canal.enviados).toEqual([expect.stringContaining("Tentativa de cópia barrada"), contagem(1, 0)]);
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

  it("ataque sempre avisa, com o título Ataque barrado, em qualquer scans, e não entra no resumo", async () => {
    for (const scans of ["panel", "dailySummary", "alert"] as const) {
      const canal = canalQueGuarda();
      const a = new Avisos(cfg(scans), [canal], () => 0);
      await a.receber(ev({ gravidade: "ataque", motivo: "sqlmap", agente: "sqlmap/1.8" }));
      expect(canal.enviados, scans).toHaveLength(1);
      expect(canal.enviados[0]?.split("\n")[0], scans).toBe("Ataque barrado");
      expect(a.resumoDoDia(), scans).toBe("Resumo do dia: 0 varreduras barradas");
    }
    expect(textoDoAviso(ev({ gravidade: "ataque" }), 0).split("\n")[0]).toBe("Ataque barrado");
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

const MIN = 60_000;

function horaMinuto(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe("Avisos: teto global", () => {
  it("o teto é de 6 avisos por 5 minutos", () => {
    expect(TETO_AVISOS).toBe(6);
    expect(TETO_JANELA_MS).toBe(5 * MIN);
  });

  it("20 IPs em 1 minuto: 6 avisos individuais e depois exatamente 1 agrupado quando o teto libera", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    for (let i = 0; i < 20; i++) {
      t = i * 3_000;
      await a.receber(ev({ ip: `198.51.100.${i}` }));
    }
    expect(canal.enviados).toHaveLength(6);
    for (const texto of canal.enviados) expect(texto.split("\n")[0]).toBe("Tentativa de cópia barrada");
    await a.descarregar(5 * MIN - 1);
    expect(canal.enviados).toHaveLength(6);
    await a.descarregar(5 * MIN);
    expect(canal.enviados).toHaveLength(7);
    expect(canal.enviados[6]).toBe(
      `Muitas tentativas ao mesmo tempo: 14 tentativas de 14 IPs desde ${horaMinuto(18_000)} (agrupadas).`,
    );
    expect(canal.eventos[6]).toBeUndefined();
    await a.descarregar(10 * MIN);
    await a.descarregar(20 * MIN);
    expect(canal.enviados).toHaveLength(7);
  });

  it("descarregar sem pendências não envia nada", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg(), [canal], () => 0);
    await a.descarregar();
    await a.descarregar(10 * MIN);
    expect(canal.enviados).toHaveLength(0);
    await a.receber(ev());
    await a.descarregar(10 * MIN);
    expect(canal.enviados).toHaveLength(1);
  });

  it("o agrupado sai no próximo espaço livre quando chega um evento, antes do aviso desse evento", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    for (let i = 0; i < 8; i++) await a.receber(ev({ ip: `198.51.100.${i}` }));
    expect(canal.enviados).toHaveLength(6);
    t = 5 * MIN;
    await a.receber(ev({ ip: "198.51.100.99" }));
    expect(canal.enviados).toHaveLength(8);
    expect(canal.enviados[6]).toBe(
      `Muitas tentativas ao mesmo tempo: 2 tentativas de 2 IPs desde ${horaMinuto(0)} (agrupadas).`,
    );
    expect(canal.enviados[7]?.split("\n")[3]).toBe("IP: 198.51.100.99");
  });

  it("o agrupado também ocupa vaga no teto", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos(cfg(), [canal], () => t);
    for (let i = 0; i < 7; i++) {
      t = i < 6 ? 0 : MIN;
      await a.receber(ev({ ip: `198.51.100.${i}` }));
    }
    t = 5 * MIN;
    await a.descarregar();
    expect(canal.enviados).toHaveLength(7);
    // As 6 vagas de t = 0 venceram, o agrupado ocupou uma: cabem mais 5 individuais até 10 min.
    for (let i = 0; i < 6; i++) await a.receber(ev({ ip: `192.0.2.${i}` }));
    expect(canal.enviados).toHaveLength(12);
    t = 10 * MIN;
    await a.descarregar();
    expect(canal.enviados[12]).toBe(
      `Muitas tentativas ao mesmo tempo: 1 tentativas de 1 IPs desde ${horaMinuto(5 * MIN)} (agrupadas).`,
    );
  });

  it("um IP que volta depois da janela própria conta como tentativa, sem contar o IP duas vezes", async () => {
    const canal = canalQueGuarda();
    let t = 0;
    const a = new Avisos({ channels: ["telegram"], groupByIpMs: 1_000, scans: "panel" }, [canal], () => t);
    for (let i = 0; i < 6; i++) await a.receber(ev({ ip: `198.51.100.${i}` }));
    t = 2_000;
    await a.receber(ev({ ip: "203.0.113.7" }));
    await a.receber(ev({ ip: "203.0.113.7" }));
    t = 4_000;
    await a.receber(ev({ ip: "203.0.113.7" }));
    await a.descarregar(5 * MIN);
    expect(canal.enviados.at(-1)).toBe(
      `Muitas tentativas ao mesmo tempo: 3 tentativas de 1 IPs desde ${horaMinuto(2_000)} (agrupadas).`,
    );
  });

  it("varredura só de painel não ocupa vaga no teto", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg("panel"), [canal], () => 0);
    for (let i = 0; i < 10; i++) await a.receber(ev({ ip: `198.51.100.${i}`, gravidade: "varredura" }));
    for (let i = 0; i < 6; i++) await a.receber(ev({ ip: `192.0.2.${i}` }));
    expect(canal.enviados).toHaveLength(6);
    await a.descarregar(0);
    expect(canal.enviados).toHaveLength(6);
  });
});

describe("Avisos: enviarResumo", () => {
  it("manda o resumo do dia a todos os canais, sem evento, e zera a contagem", async () => {
    const c1 = canalQueGuarda("um");
    const c2 = canalQueGuarda("dois");
    const a = new Avisos(cfg("dailySummary"), [c1, c2], () => 0);
    await a.receber(ev({ gravidade: "varredura", motivo: "varredura: /.env" }));
    await a.enviarResumo();
    for (const c of [c1, c2]) {
      expect(c.enviados).toEqual(["Resumo do dia: 1 varredura barrada\nvarredura: /.env: 1"]);
      expect(c.eventos).toEqual([undefined]);
    }
    await a.enviarResumo();
    expect(c1.enviados).toHaveLength(1);
  });

  it("sem eventos no dia não manda nada", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg("dailySummary"), [canal], () => 0);
    await a.enviarResumo();
    expect(canal.enviados).toHaveLength(0);
  });

  it("o resumo não depende do teto global", async () => {
    const canal = canalQueGuarda();
    const a = new Avisos(cfg("dailySummary"), [canal], () => 0);
    for (let i = 0; i < 6; i++) await a.receber(ev({ ip: `192.0.2.${i}` }));
    await a.receber(ev({ gravidade: "varredura" }));
    await a.enviarResumo();
    expect(canal.enviados).toHaveLength(7);
    expect(canal.enviados[6]).toMatch(/^Resumo do dia: 1 varredura barrada/);
  });

  it("falha de um canal no resumo é contida", async () => {
    const linhas = espiarStderr();
    const canal = canalQueGuarda();
    const quebrado: Canal = { nome: "x", enviar: () => Promise.reject(new Error("fora")) };
    const a = new Avisos(cfg("dailySummary"), [quebrado, canal], () => 0);
    await a.receber(ev({ gravidade: "varredura" }));
    await expect(a.enviarResumo()).resolves.toBeUndefined();
    expect(canal.enviados).toHaveLength(1);
    expect(linhas).toEqual(["[anti-rea] aviso x falhou: fora\n"]);
  });
});
