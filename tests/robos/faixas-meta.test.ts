import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FaixasMeta, lerFaixasWhois } from "../../src/robos/faixas-meta.js";

const amostra = readFileSync(new URL("../fixtures/whois/radb-as32934.txt", import.meta.url), "utf8");

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

describe("FaixasMeta", () => {
  it("segue o exemplo do plano", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return ["31.13.24.0/21", "2a03:2880::/32"];
    });
    expect(await meta.contem("31.13.24.10", 0)).toBe(true);
    expect(await meta.contem("2a03:2880:1::1", 1)).toBe(true);
    expect(await meta.contem("203.0.113.5", 2)).toBe(false);
    expect(chamadas).toBe(1);
    const falha = new FaixasMeta(async () => {
      throw new Error("sem rede");
    });
    expect(await falha.contem("31.13.24.10", 0)).toBe(false);
  });

  it("respeita as bordas da faixa", async () => {
    const meta = new FaixasMeta(async () => ["31.13.24.0/21", "2a03:2880::/32"]);
    expect(await meta.contem("31.13.24.0", 0)).toBe(true);
    expect(await meta.contem("31.13.31.255", 0)).toBe(true);
    expect(await meta.contem("31.13.32.0", 0)).toBe(false);
    expect(await meta.contem("31.13.23.255", 0)).toBe(false);
    expect(await meta.contem("2a03:2880:ffff:ffff:ffff:ffff:ffff:ffff", 0)).toBe(true);
    expect(await meta.contem("2a03:2881::", 0)).toBe(false);
  });

  it("trata IPv4 mapeado em IPv6 como IPv4", async () => {
    const meta = new FaixasMeta(async () => ["31.13.24.0/21"]);
    expect(await meta.contem("::ffff:31.13.24.10", 0)).toBe(true);
    expect(await meta.contem("::FFFF:31.13.40.10", 0)).toBe(false);
  });

  it("IPv4 nao casa faixa IPv6 e vice-versa", async () => {
    const meta = new FaixasMeta(async () => ["::/0"]);
    expect(await meta.contem("31.13.24.10", 0)).toBe(false);
    expect(await meta.contem("2001:db8::1", 0)).toBe(true);
    const v4 = new FaixasMeta(async () => ["0.0.0.0/0"]);
    expect(await v4.contem("2001:db8::1", 0)).toBe(false);
    expect(await v4.contem("198.51.100.1", 0)).toBe(true);
  });

  it("prefixo /32 e /128 casam um endereco so", async () => {
    const meta = new FaixasMeta(async () => ["192.0.2.7/32", "2001:db8::7/128"]);
    expect(await meta.contem("192.0.2.7", 0)).toBe(true);
    expect(await meta.contem("192.0.2.8", 0)).toBe(false);
    expect(await meta.contem("2001:db8::7", 0)).toBe(true);
    expect(await meta.contem("2001:db8::8", 0)).toBe(false);
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
    expect(await meta.contem("198.51.100.1", 0)).toBe(true);
    expect(await meta.contem("192.0.2.1", 0)).toBe(false);
  });

  it("aceita IPv6 com IPv4 no final e zona", async () => {
    const meta = new FaixasMeta(async () => ["64:ff9b::/96", "fe80::/10"]);
    expect(await meta.contem("64:ff9b::192.0.2.1", 0)).toBe(true);
    expect(await meta.contem("fe80::1%en0", 0)).toBe(true);
  });

  it("endereco invalido nao casa", async () => {
    const meta = new FaixasMeta(async () => ["0.0.0.0/0", "::/0"]);
    expect(await meta.contem("nao-e-ip", 0)).toBe(false);
    expect(await meta.contem("", 0)).toBe(false);
  });

  it("renova as faixas quando a validade vence", async () => {
    let chamadas = 0;
    let lista = ["192.0.2.0/24"];
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return lista;
    }, 1_000);
    expect(await meta.contem("192.0.2.1", 0)).toBe(true);
    lista = ["198.51.100.0/24"];
    expect(await meta.contem("192.0.2.1", 999)).toBe(true);
    expect(chamadas).toBe(1);
    expect(await meta.contem("192.0.2.1", 1_000)).toBe(false);
    expect(await meta.contem("198.51.100.1", 1_001)).toBe(true);
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
    expect(await meta.contem("31.13.24.10", 0)).toBe(false);
    expect(await meta.contem("31.13.24.10", 1)).toBe(false);
    expect(await meta.contem("31.13.24.10", 299_999)).toBe(false);
    expect(chamadas).toBe(1);
    quebrar = false;
    expect(await meta.contem("31.13.24.10", 300_000)).toBe(true);
    expect(chamadas).toBe(2);
  });

  it("lista vazia conta como falha", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      return [];
    });
    expect(await meta.contem("31.13.24.10", 0)).toBe(false);
    expect(await meta.contem("31.13.24.10", 1_000)).toBe(false);
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
    expect(await meta.contem("31.13.24.10", 0)).toBe(true);
    quebrar = true;
    expect(await meta.contem("31.13.24.10", 1_000)).toBe(true);
    expect(await meta.contem("31.13.24.10", 2_000)).toBe(true);
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
    expect(r).toEqual([true, true]);
    expect(chamadas).toBe(1);
  });
});
