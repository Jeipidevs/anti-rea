import { describe, expect, it } from "vitest";
import { confirmarPorDns, type Resolvedor } from "../../src/robos/dns.js";
import { FaixasMeta } from "../../src/robos/faixas-meta.js";
import { confirmarRobo, roboDeclarado } from "../../src/robos/robos.js";

const dnsGoogle: Resolvedor = {
  reverso: async (ip) =>
    ip === "66.249.66.1" ? ["crawl-66-249-66-1.googlebot.com"] : ["mentira.googlebot.com.evil.net"],
  direto: async (h) => (h.startsWith("crawl-66") ? ["66.249.66.1"] : ["203.0.113.9"]),
};

describe("roboDeclarado", () => {
  it("classifica pelo exemplo do plano", () => {
    expect(roboDeclarado("Mozilla/5.0 (compatible; Googlebot/2.1)")).toEqual({
      nome: "Googlebot",
      classe: "busca",
    });
    expect(roboDeclarado("facebookexternalhit/1.1")?.classe).toBe("meta");
    expect(roboDeclarado("WhatsApp/2.24")?.classe).toBe("previa");
    expect(roboDeclarado("Mozilla/5.0 Chrome/130")).toBeNull();
  });

  it("devolve null sem agente", () => {
    expect(roboDeclarado(undefined)).toBeNull();
    expect(roboDeclarado("")).toBeNull();
  });

  it("ignora maiusculas e minusculas e devolve o nome canonico", () => {
    expect(roboDeclarado("Mozilla/5.0 (compatible; BINGBOT/2.0)")).toEqual({
      nome: "bingbot",
      classe: "busca",
    });
    expect(roboDeclarado("whatsapp/2.23.20 A")).toEqual({ nome: "WhatsApp", classe: "previa" });
  });

  it("conhece a tabela inteira", () => {
    const casos: Array<[string, string, "busca" | "meta" | "previa"]> = [
      ["Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)", "Google-InspectionTool", "busca"],
      ["AdsBot-Google (+http://www.google.com/adsbot.html)", "AdsBot-Google", "busca"],
      ["Mediapartners-Google", "Mediapartners-Google", "busca"],
      ["Mozilla/5.0 (compatible; adidxbot/2.0)", "AdIdxBot", "busca"],
      ["Mozilla/5.0 (compatible; Applebot/0.1)", "Applebot", "busca"],
      ["DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)", "DuckDuckBot", "previa"],
      ["meta-externalagent/1.1", "meta-externalagent", "meta"],
      ["meta-externalads/1.1", "meta-externalads", "meta"],
      ["Facebot", "Facebot", "meta"],
      ["TelegramBot (like TwitterBot)", "TelegramBot", "previa"],
      ["Slackbot-LinkExpanding 1.0", "Slackbot", "previa"],
      ["LinkedInBot/1.0", "LinkedInBot", "previa"],
      ["Twitterbot/1.0", "Twitterbot", "previa"],
      ["Mozilla/5.0 (compatible; Discordbot/2.0)", "Discordbot", "previa"],
      ["Mozilla/5.0 SkypeUriPreview Preview/0.5", "SkypeUriPreview", "previa"],
      ["Pinterestbot/1.0", "Pinterestbot", "previa"],
    ];
    for (const [agente, nome, classe] of casos) {
      expect(roboDeclarado(agente), agente).toEqual({ nome, classe });
    }
  });

  it("primeiro casamento vence, na ordem busca, previa, meta", () => {
    // "TelegramBot (like TwitterBot)" casa as duas prévias; vale a primeira da tabela.
    expect(roboDeclarado("TelegramBot (like TwitterBot)")?.nome).toBe("TelegramBot");
    // Agente que cita um robô de busca e uma prévia fica com o de busca.
    expect(roboDeclarado("WhatsApp/2 Googlebot/2.1")?.nome).toBe("Googlebot");
  });

  it("DuckDuckBot e previa: o DuckDuckGo nao publica sufixo de DNS reverso", () => {
    expect(roboDeclarado("DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)")?.classe).toBe(
      "previa",
    );
  });

  it("previa do iMessage, que cita facebookexternalhit, fica como previa", () => {
    // Sai do aparelho de quem manda o link; o IP nunca é da Meta.
    const imessage =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) " +
      "Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";
    expect(roboDeclarado(imessage)).toEqual({ nome: "Twitterbot", classe: "previa" });
    // O robô de verdade da Meta não cita nenhuma prévia e continua meta.
    expect(
      roboDeclarado("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"),
    ).toEqual({ nome: "facebookexternalhit", classe: "meta" });
  });
});

describe("confirmarPorDns", () => {
  it("confirma quando o reverso termina no sufixo e o direto volta ao IP", async () => {
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], dnsGoogle)).toBe(true);
  });

  it("recusa nome que so contem o sufixo no meio", async () => {
    expect(await confirmarPorDns("203.0.113.9", [".googlebot.com"], dnsGoogle)).toBe(false);
  });

  it("recusa quando o direto aponta para outro IP", async () => {
    const r: Resolvedor = {
      reverso: async () => ["crawl.googlebot.com"],
      direto: async () => ["66.249.66.2"],
    };
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], r)).toBe(false);
  });

  it("aceita ponto final no nome e maiusculas", async () => {
    const r: Resolvedor = {
      reverso: async () => ["Crawl-1.GoogleBot.com."],
      direto: async () => ["66.249.66.1"],
    };
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], r)).toBe(true);
  });

  it("nao aceita o proprio dominio sem subdominio como sufixo falso", async () => {
    const r: Resolvedor = {
      reverso: async () => ["evilgooglebot.com"],
      direto: async () => ["66.249.66.1"],
    };
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], r)).toBe(false);
  });

  it("compara IPv6 em formas diferentes", async () => {
    const r: Resolvedor = {
      reverso: async () => ["crawl.googlebot.com"],
      direto: async () => ["2001:4860:4801:0010:0000:0000:0000:0001"],
    };
    expect(await confirmarPorDns("2001:4860:4801:10::1", [".googlebot.com"], r)).toBe(true);
  });

  it("trata IPv4 mapeado em IPv6 como IPv4", async () => {
    let perguntado = "";
    const r: Resolvedor = {
      reverso: async (ip) => {
        perguntado = ip;
        return ["crawl.googlebot.com"];
      },
      direto: async () => ["66.249.66.1"],
    };
    expect(await confirmarPorDns("::ffff:66.249.66.1", [".googlebot.com"], r)).toBe(true);
    expect(perguntado).toBe("66.249.66.1");
  });

  it("erro do resolvedor vira false, nunca excecao", async () => {
    const reversoQuebra: Resolvedor = {
      reverso: async () => {
        throw new Error("ENOTFOUND");
      },
      direto: async () => ["66.249.66.1"],
    };
    const diretoQuebra: Resolvedor = {
      reverso: async () => ["crawl.googlebot.com"],
      direto: async () => {
        throw new Error("ETIMEOUT");
      },
    };
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], reversoQuebra)).toBe(false);
    expect(await confirmarPorDns("66.249.66.1", [".googlebot.com"], diretoQuebra)).toBe(false);
  });

  it("IP invalido vira false", async () => {
    expect(await confirmarPorDns("nao-e-ip", [".googlebot.com"], dnsGoogle)).toBe(false);
  });
});

function faixasFalsas(lista: string[]) {
  let chamadas = 0;
  const meta = new FaixasMeta(async () => {
    chamadas++;
    return lista;
  });
  return { meta, chamadas: () => chamadas };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("confirmarRobo", () => {
  it("confirma robo de busca pelo DNS", async () => {
    const { meta } = faixasFalsas([]);
    const robo = roboDeclarado("Googlebot/2.1")!;
    expect(await confirmarRobo(robo, "66.249.66.1", { dns: dnsGoogle, meta, agora: 0 })).toBe("sim");
    expect(await confirmarRobo(robo, "203.0.113.9", { dns: dnsGoogle, meta, agora: 0 })).toBe("nao");
  });

  it("Google so por .googlebot.com e .google.com: VM do Google Cloud nao passa", async () => {
    const { meta } = faixasFalsas([]);
    const vm: Resolvedor = {
      reverso: async () => ["81.59.117.34.bc.googleusercontent.com"],
      direto: async () => ["34.117.59.81"],
    };
    const proxy: Resolvedor = {
      reverso: async () => ["rate-limited-proxy-66-249-90-1.google.com"],
      direto: async () => ["66.249.90.1"],
    };
    const robo = roboDeclarado("Googlebot/2.1")!;
    expect(await confirmarRobo(robo, "34.117.59.81", { dns: vm, meta, agora: 0 })).toBe("nao");
    expect(await confirmarRobo(robo, "66.249.90.1", { dns: proxy, meta, agora: 0 })).toBe("sim");
  });

  it("usa os sufixos de cada robo", async () => {
    const { meta } = faixasFalsas([]);
    const r: Resolvedor = {
      reverso: async () => ["msnbot-157-55-39-1.search.msn.com"],
      direto: async () => ["157.55.39.1"],
    };
    const bing = roboDeclarado("bingbot/2.0")!;
    const google = roboDeclarado("Googlebot/2.1")!;
    expect(await confirmarRobo(bing, "157.55.39.1", { dns: r, meta, agora: 0 })).toBe("sim");
    expect(await confirmarRobo(google, "157.55.39.2", { dns: r, meta, agora: 0 })).toBe("nao");
  });

  it("confirma robo da Meta pelas faixas", async () => {
    const { meta } = faixasFalsas(["31.13.24.0/21", "2a03:2880::/32"]);
    const robo = roboDeclarado("facebookexternalhit/1.1")!;
    const deps = { dns: dnsGoogle, meta, agora: 0 };
    expect(await confirmarRobo(robo, "31.13.24.11", deps)).toBe("sim");
    expect(await confirmarRobo(robo, "::ffff:31.13.24.12", deps)).toBe("sim");
    expect(await confirmarRobo(robo, "2a03:2880:2::1", deps)).toBe("sim");
    expect(await confirmarRobo(robo, "203.0.113.20", deps)).toBe("nao");
  });

  it("previa nunca se confirma e nem consulta DNS ou faixas", async () => {
    let consultas = 0;
    const r: Resolvedor = {
      reverso: async () => {
        consultas++;
        return ["x.googlebot.com"];
      },
      direto: async () => {
        consultas++;
        return ["66.249.66.1"];
      },
    };
    const { meta, chamadas } = faixasFalsas(["0.0.0.0/0"]);
    for (const agente of ["WhatsApp/2.24", "DuckDuckBot/1.1"]) {
      const robo = roboDeclarado(agente)!;
      expect(await confirmarRobo(robo, "66.249.66.1", { dns: r, meta, agora: 0 })).toBe("nao");
    }
    expect(consultas).toBe(0);
    expect(chamadas()).toBe(0);
  });

  it("guarda o sim por robo e IP durante 1 hora", async () => {
    let consultas = 0;
    let resposta = ["crawl.googlebot.com"];
    const r: Resolvedor = {
      reverso: async () => {
        consultas++;
        return resposta;
      },
      direto: async () => ["198.51.100.7"],
    };
    const { meta } = faixasFalsas([]);
    const robo = roboDeclarado("Googlebot/2.1")!;
    const ip = "198.51.100.7";
    expect(await confirmarRobo(robo, ip, { dns: r, meta, agora: 1_000 })).toBe("sim");
    resposta = ["outro.exemplo.net"];
    expect(await confirmarRobo(robo, ip, { dns: r, meta, agora: 1_000 + 3_599_999 })).toBe("sim");
    expect(consultas).toBe(1);
    expect(await confirmarRobo(robo, ip, { dns: r, meta, agora: 1_000 + 3_600_000 })).toBe("nao");
    expect(consultas).toBe(2);
  });

  it("guarda tambem o nao durante 1 hora", async () => {
    let consultas = 0;
    const r: Resolvedor = {
      reverso: async () => {
        consultas++;
        return ["nada.exemplo.net"];
      },
      direto: async () => [],
    };
    const { meta } = faixasFalsas([]);
    const robo = roboDeclarado("Applebot/0.1")!;
    expect(await confirmarRobo(robo, "198.51.100.8", { dns: r, meta, agora: 0 })).toBe("nao");
    expect(await confirmarRobo(robo, "198.51.100.8", { dns: r, meta, agora: 3_599_999 })).toBe("nao");
    expect(consultas).toBe(1);
    expect(await confirmarRobo(robo, "198.51.100.8", { dns: r, meta, agora: 3_600_000 })).toBe("nao");
    expect(consultas).toBe(2);
  });

  it("tempo esgotado no DNS e incerto, guardado 1 minuto", async () => {
    let consultas = 0;
    const r: Resolvedor = {
      reverso: async () => {
        consultas++;
        if (consultas === 1) {
          throw Object.assign(new Error("DNS sem resposta em 2000 ms"), { code: "ETIMEOUT" });
        }
        return ["crawl-66-249-66-9.googlebot.com"];
      },
      direto: async () => ["66.249.66.9"],
    };
    const { meta } = faixasFalsas([]);
    const robo = roboDeclarado("Googlebot/2.1")!;
    const ip = "66.249.66.9";
    expect(await confirmarRobo(robo, ip, { dns: r, meta, agora: 0 })).toBe("incerto");
    // Dentro de 1 minuto não pergunta de novo (não martela o DNS).
    expect(await confirmarRobo(robo, ip, { dns: r, meta, agora: 59_999 })).toBe("incerto");
    expect(consultas).toBe(1);
    expect(await confirmarRobo(robo, ip, { dns: r, meta, agora: 60_000 })).toBe("sim");
    expect(consultas).toBe(2);
  });

  it("SERVFAIL no direto e incerto", async () => {
    let falhar = true;
    const r: Resolvedor = {
      reverso: async () => ["crawl-66-249-66-10.googlebot.com"],
      direto: async () => {
        if (falhar) throw Object.assign(new Error("queryA ESERVFAIL"), { code: "ESERVFAIL" });
        return ["66.249.66.10"];
      },
    };
    const { meta } = faixasFalsas([]);
    const robo = roboDeclarado("Googlebot/2.1")!;
    expect(await confirmarRobo(robo, "66.249.66.10", { dns: r, meta, agora: 0 })).toBe("incerto");
    falhar = false;
    expect(await confirmarRobo(robo, "66.249.66.10", { dns: r, meta, agora: 60_000 })).toBe("sim");
  });

  it("erro sem codigo do resolvedor e incerto, nunca excecao", async () => {
    const { meta } = faixasFalsas([]);
    const r: Resolvedor = {
      reverso: async () => {
        throw new Error("algo estranho");
      },
      direto: async () => [],
    };
    const robo = roboDeclarado("bingbot/2.0")!;
    expect(await confirmarRobo(robo, "198.51.100.12", { dns: r, meta, agora: 0 })).toBe("incerto");
  });

  it("IP sem nome reverso (ENOTFOUND ou ENODATA) e nao, guardado 1 hora", async () => {
    let consultas = 0;
    const r: Resolvedor = {
      reverso: async (ip) => {
        consultas++;
        const code = ip.endsWith(".11") ? "ENOTFOUND" : "ENODATA";
        throw Object.assign(new Error(`getHostByAddr ${code}`), { code });
      },
      direto: async () => [],
    };
    const { meta } = faixasFalsas([]);
    const robo = roboDeclarado("Googlebot/2.1")!;
    expect(await confirmarRobo(robo, "198.51.100.11", { dns: r, meta, agora: 0 })).toBe("nao");
    expect(await confirmarRobo(robo, "198.51.100.11", { dns: r, meta, agora: 3_599_999 })).toBe("nao");
    expect(await confirmarRobo(robo, "198.51.100.13", { dns: r, meta, agora: 0 })).toBe("nao");
    expect(consultas).toBe(2);
  });

  it("faixas da Meta indisponiveis sao incerto, guardado 1 minuto", async () => {
    let chamadas = 0;
    const meta = new FaixasMeta(async () => {
      chamadas++;
      if (chamadas === 1) throw new Error("RIPEstat e whois fora do ar");
      return ["31.13.24.0/21"];
    });
    const robo = roboDeclarado("facebookexternalhit/1.1")!;
    const ip = "31.13.24.77";
    expect(await confirmarRobo(robo, ip, { dns: dnsGoogle, meta, agora: 0 })).toBe("incerto");
    expect(await confirmarRobo(robo, ip, { dns: dnsGoogle, meta, agora: 59_999 })).toBe("incerto");
    // FaixasMeta tenta de novo depois de 5 minutos; a confirmação acompanha.
    expect(await confirmarRobo(robo, ip, { dns: dnsGoogle, meta, agora: 6 * 60_000 })).toBe("sim");
    expect(chamadas).toBe(2);
  });

  it("faixas da Meta ainda carregando depois da espera sao incerto", async () => {
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
    const robo = roboDeclarado("meta-externalads/1.1")!;
    const ip = "31.13.24.78";
    expect(await confirmarRobo(robo, ip, { dns: dnsGoogle, meta, agora: 0 })).toBe("incerto");
    await esperar(120);
    expect(await confirmarRobo(robo, ip, { dns: dnsGoogle, meta, agora: 60_000 })).toBe("sim");
    expect(chamadas).toBe(1);
  });

  it("faixas carregadas e IP de fora e nao, guardado 1 hora", async () => {
    const { meta, chamadas } = faixasFalsas(["31.13.24.0/21"]);
    const robo = roboDeclarado("facebookexternalhit/1.1")!;
    expect(await confirmarRobo(robo, "203.0.113.21", { dns: dnsGoogle, meta, agora: 0 })).toBe("nao");
    expect(
      await confirmarRobo(robo, "203.0.113.21", { dns: dnsGoogle, meta, agora: 3_599_999 }),
    ).toBe("nao");
    expect(chamadas()).toBe(1);
  });

  it("o cache separa robos no mesmo IP, mesmo da mesma classe", async () => {
    let consultas = 0;
    const r: Resolvedor = {
      reverso: async () => {
        consultas++;
        return ["msnbot-198-51-100-14.search.msn.com"];
      },
      direto: async () => ["198.51.100.14"],
    };
    const { meta } = faixasFalsas(["198.51.100.0/24"]);
    const ip = "198.51.100.14";
    expect(await confirmarRobo(roboDeclarado("bingbot")!, ip, { dns: r, meta, agora: 0 })).toBe("sim");
    // Googlebot do mesmo IP não herda o sim do bingbot.
    expect(await confirmarRobo(roboDeclarado("Googlebot")!, ip, { dns: r, meta, agora: 0 })).toBe("nao");
    expect(consultas).toBe(2);
    expect(await confirmarRobo(roboDeclarado("Facebot")!, ip, { dns: r, meta, agora: 0 })).toBe("sim");
  });

  it("robo desconhecido nao se confirma", async () => {
    const { meta } = faixasFalsas(["0.0.0.0/0"]);
    expect(
      await confirmarRobo({ nome: "Inventado", classe: "busca" }, "198.51.100.10", {
        dns: dnsGoogle,
        meta,
        agora: 0,
      }),
    ).toBe("nao");
  });
});
