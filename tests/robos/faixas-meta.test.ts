import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buscarFaixasMeta,
  buscarFaixasMetaPorRipestat,
  FaixasMeta,
  lerFaixasRipestat,
  lerFaixasWhois,
} from "../../src/robos/faixas-meta.js";

const amostra = readFileSync(new URL("../fixtures/whois/radb-as32934.txt", import.meta.url), "utf8");
const amostraRipestat: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/ripestat/announced-prefixes-as32934.json", import.meta.url), "utf8"),
);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("lerFaixasWhois", () => {
  it("le route e route6 da resposta capturada do RADb, sem repetir", () => {
    expect(lerFaixasWhois(amostra)).toEqual([
      "31.13.24.0/21",
      "31.13.64.0/18",
      "2401:db00::/32",
      "2620:0:1c00::/40",
    ]);
  });

  it("aceita fim de linha CRLF e ignora outras linhas", () => {
    const texto = "% comentario\r\nroute:   192.0.2.0/24\r\ndescr: route: 10.0.0.0/8\r\nroute6:  2001:db8::/32\r\n";
    expect(lerFaixasWhois(texto)).toEqual(["192.0.2.0/24", "2001:db8::/32"]);
  });

  it("texto vazio devolve lista vazia", () => {
    expect(lerFaixasWhois("")).toEqual([]);
  });
});

describe("lerFaixasRipestat", () => {
  it("le data.prefixes[].prefix da resposta capturada do RIPEstat, sem repetir", () => {
    expect(lerFaixasRipestat(amostraRipestat)).toEqual([
      "57.144.84.0/23",
      "157.240.8.0/24",
      "157.240.14.0/24",
      "2a03:2880:f066::/48",
      "2a03:2880:f361::/48",
    ]);
  });

  it("formato inesperado devolve lista vazia, sem excecao", () => {
    expect(lerFaixasRipestat(null)).toEqual([]);
    expect(lerFaixasRipestat({})).toEqual([]);
    expect(lerFaixasRipestat({ data: { prefixes: "x" } })).toEqual([]);
    expect(lerFaixasRipestat({ data: { prefixes: [{ prefix: 7 }, null, { prefix: "192.0.2.0/24" }] } })).toEqual([
      "192.0.2.0/24",
    ]);
  });
});

describe("buscarFaixasMetaPorRipestat", () => {
  it("pede o AS32934 por HTTPS com tempo-limite e le as faixas", async () => {
    let pedido = "";
    let sinal: AbortSignal | null | undefined;
    const faixas = await buscarFaixasMetaPorRipestat(async (url, init) => {
      pedido = String(url);
      sinal = init?.signal;
      return new Response(JSON.stringify(amostraRipestat), { status: 200 });
    });
    expect(pedido).toBe(
      "https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS32934&sourceapp=anti-rea",
    );
    expect(sinal).toBeInstanceOf(AbortSignal);
    expect(faixas).toHaveLength(5);
  });

  it("resposta HTTP de erro vira excecao", async () => {
    await expect(
      buscarFaixasMetaPorRipestat(async () => new Response("fora", { status: 503 })),
    ).rejects.toThrow();
  });
});

describe("buscarFaixasMeta", () => {
  it("usa o RIPEstat e nem chama o whois quando ele responde", async () => {
    let whois = 0;
    const faixas = await buscarFaixasMeta({
      principal: async () => ["31.13.24.0/21"],
      reserva: async () => {
        whois++;
        return ["192.0.2.0/24"];
      },
    });
    expect(faixas).toEqual(["31.13.24.0/21"]);
    expect(whois).toBe(0);
  });

  it("cai no whois quando o RIPEstat falha ou vem vazio", async () => {
    const reserva = async () => ["192.0.2.0/24"];
    expect(
      await buscarFaixasMeta({
        principal: async () => {
          throw new Error("RIPEstat fora");
        },
        reserva,
      }),
    ).toEqual(["192.0.2.0/24"]);
    expect(await buscarFaixasMeta({ principal: async () => [], reserva })).toEqual(["192.0.2.0/24"]);
  });

  it("as duas fontes falhando vira excecao", async () => {
    await expect(
      buscarFaixasMeta({
        principal: async () => {
          throw new Error("RIPEstat fora");
        },
        reserva: async () => {
          throw new Error("porta 43 fechada");
        },
      }),
    ).rejects.toThrow();
  });
});

describe("FaixasMeta", () => {
  it("aquecer inicia a carga sem bloquear e o pedido seguinte ja encontra as faixas", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return ["31.13.24.0/21"];
    });
    expect(meta.aquecer(0)).toBeUndefined();
    expect(chamadas).toBe(1);
    expect(await meta.contem("31.13.24.10", 1)).toBe("sim");
    expect(chamadas).toBe(1);
  });

  it("aquecer com fonte fora do ar nao quebra e o pedido fica incerto", async () => {
    const meta = new FaixasMeta(async () => {
      throw new Error("sem rede");
    });
    meta.aquecer(0);
    await esperar(0);
    expect(await meta.contem("31.13.24.10", 1)).toBe("incerto");
  });

  it("espera no maximo o limite pela primeira carga e ela segue em segundo plano", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(
      async () => {
        chamadas++;
        await esperar(80);
        return ["31.13.24.0/21"];
      },
      86_400_000,
      10,
    );
    const inicio = Date.now();
    expect(await meta.contem("31.13.24.10", 0)).toBe("incerto");
    expect(Date.now() - inicio).toBeLessThan(70);
    await esperar(120);
    expect(await meta.contem("31.13.24.10", 1)).toBe("sim");
    expect(chamadas).toBe(1);
  });

  it("espera padrao pela primeira carga e de 3 segundos", async () => {
    vi.useFakeTimers();
    try {
      const meta = new FaixasMeta(() => new Promise<string[]>(() => {}));
      let resposta: string | undefined;
      void meta.contem("31.13.24.10", 0).then((r) => (resposta = r));
      await vi.advanceTimersByTimeAsync(2_999);
      expect(resposta).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(resposta).toBe("incerto");
    } finally {
      vi.useRealTimers();
    }
  });

  it("segue o exemplo do plano", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return ["31.13.24.0/21", "2a03:2880::/32"];
    });
    expect(await meta.contem("31.13.24.10", 0)).toBe("sim");
    expect(await meta.contem("2a03:2880:1::1", 1)).toBe("sim");
    expect(await meta.contem("203.0.113.5", 2)).toBe("nao");
    expect(chamadas).toBe(1);
    const falha = new FaixasMeta(async () => {
      throw new Error("sem rede");
    });
    expect(await falha.contem("31.13.24.10", 0)).toBe("incerto");
  });

  it("respeita as bordas da faixa", async () => {
    const meta = new FaixasMeta(async () => ["31.13.24.0/21", "2a03:2880::/32"]);
    expect(await meta.contem("31.13.24.0", 0)).toBe("sim");
    expect(await meta.contem("31.13.31.255", 0)).toBe("sim");
    expect(await meta.contem("31.13.32.0", 0)).toBe("nao");
    expect(await meta.contem("31.13.23.255", 0)).toBe("nao");
    expect(await meta.contem("2a03:2880:ffff:ffff:ffff:ffff:ffff:ffff", 0)).toBe("sim");
    expect(await meta.contem("2a03:2881::", 0)).toBe("nao");
  });

  it("trata IPv4 mapeado em IPv6 como IPv4", async () => {
    const meta = new FaixasMeta(async () => ["31.13.24.0/21"]);
    expect(await meta.contem("::ffff:31.13.24.10", 0)).toBe("sim");
    expect(await meta.contem("::FFFF:31.13.40.10", 0)).toBe("nao");
  });

  it("IPv4 nao casa faixa IPv6 e vice-versa", async () => {
    const meta = new FaixasMeta(async () => ["::/0"]);
    expect(await meta.contem("31.13.24.10", 0)).toBe("nao");
    expect(await meta.contem("2001:db8::1", 0)).toBe("sim");
    const v4 = new FaixasMeta(async () => ["0.0.0.0/0"]);
    expect(await v4.contem("2001:db8::1", 0)).toBe("nao");
    expect(await v4.contem("198.51.100.1", 0)).toBe("sim");
  });

  it("prefixo /32 e /128 casam um endereco so", async () => {
    const meta = new FaixasMeta(async () => ["192.0.2.7/32", "2001:db8::7/128"]);
    expect(await meta.contem("192.0.2.7", 0)).toBe("sim");
    expect(await meta.contem("192.0.2.8", 0)).toBe("nao");
    expect(await meta.contem("2001:db8::7", 0)).toBe("sim");
    expect(await meta.contem("2001:db8::8", 0)).toBe("nao");
  });

  it("pula linhas de faixa malformadas", async () => {
    const meta = new FaixasMeta(async () => [
      "lixo",
      "192.0.2.0/33",
      "2001:db8::/129",
      "192.0.2.0/-1",
      "192.0.2.0/",
      "300.0.0.0/8",
      "192.0.2.0/24/1",
      "192.0.2.0/2a",
      "198.51.100.0/24",
    ]);
    expect(await meta.contem("198.51.100.1", 0)).toBe("sim");
    expect(await meta.contem("192.0.2.1", 0)).toBe("nao");
  });

  it("aceita IPv6 com IPv4 no final e zona", async () => {
    const meta = new FaixasMeta(async () => ["64:ff9b::/96", "fe80::/10"]);
    expect(await meta.contem("64:ff9b::192.0.2.1", 0)).toBe("sim");
    expect(await meta.contem("fe80::1%en0", 0)).toBe("sim");
  });

  it("endereco invalido nao casa", async () => {
    const meta = new FaixasMeta(async () => ["0.0.0.0/0", "::/0"]);
    expect(await meta.contem("nao-e-ip", 0)).toBe("nao");
    expect(await meta.contem("", 0)).toBe("nao");
  });

  it("renova as faixas em segundo plano quando a validade vence", async () => {
    let chamadas = 0;
    let lista = ["192.0.2.0/24"];
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return lista;
    }, 1_000);
    expect(await meta.contem("192.0.2.1", 0)).toBe("sim");
    lista = ["198.51.100.0/24"];
    expect(await meta.contem("192.0.2.1", 999)).toBe("sim");
    expect(chamadas).toBe(1);
    // Vencida a validade, a renovação corre em segundo plano; as faixas antigas valem até ela terminar.
    expect(await meta.contem("192.0.2.1", 1_000)).toBe("sim");
    expect(chamadas).toBe(2);
    await esperar(0);
    expect(await meta.contem("192.0.2.1", 1_001)).toBe("nao");
    expect(await meta.contem("198.51.100.1", 1_002)).toBe("sim");
    expect(chamadas).toBe(2);
  });

  it("validade padrao e de 24 horas", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return ["192.0.2.0/24"];
    });
    await meta.contem("192.0.2.1", 0);
    await meta.contem("192.0.2.1", 86_399_999);
    expect(chamadas).toBe(1);
    await meta.contem("192.0.2.1", 86_400_000);
    expect(chamadas).toBe(2);
  });

  it("falha na busca so tenta de novo depois de 5 minutos", async () => {
    let chamadas = 0;
    let quebrar = true;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      if (quebrar) throw new Error("sem rede");
      return ["31.13.24.0/21"];
    });
    expect(await meta.contem("31.13.24.10", 0)).toBe("incerto");
    expect(await meta.contem("31.13.24.10", 1)).toBe("incerto");
    expect(await meta.contem("31.13.24.10", 299_999)).toBe("incerto");
    expect(chamadas).toBe(1);
    quebrar = false;
    expect(await meta.contem("31.13.24.10", 300_000)).toBe("sim");
    expect(chamadas).toBe(2);
  });

  it("lista vazia conta como falha", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return [];
    });
    expect(await meta.contem("31.13.24.10", 0)).toBe("incerto");
    expect(await meta.contem("31.13.24.10", 1_000)).toBe("incerto");
    expect(chamadas).toBe(1);
    await meta.contem("31.13.24.10", 300_000);
    expect(chamadas).toBe(2);
  });

  it("renovacao que falha mantem as faixas antigas e espera 5 minutos", async () => {
    let chamadas = 0;
    let quebrar = false;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      if (quebrar) throw new Error("sem rede");
      return ["31.13.24.0/21"];
    }, 1_000);
    expect(await meta.contem("31.13.24.10", 0)).toBe("sim");
    quebrar = true;
    expect(await meta.contem("31.13.24.10", 1_000)).toBe("sim");
    expect(await meta.contem("31.13.24.10", 2_000)).toBe("sim");
    expect(chamadas).toBe(2);
    quebrar = false;
    await meta.contem("31.13.24.10", 301_000);
    expect(chamadas).toBe(3);
  });

  it("consultas simultaneas fazem uma busca so", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      await new Promise((r) => setTimeout(r, 5));
      return ["31.13.24.0/21"];
    });
    const r = await Promise.all([meta.contem("31.13.24.1", 0), meta.contem("31.13.24.2", 0)]);
    expect(r).toEqual(["sim", "sim"]);
    expect(chamadas).toBe(1);
  });
});
