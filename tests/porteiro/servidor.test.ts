import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CHROME, GUARDA, HTML, PNG, type Resposta, SINAIS_LIMPOS, cookieDe, esperar, limparTudo, linhaCookie, montar, pedir } from "./apoio-servidor.js";

afterEach(limparTudo);

describe("porteiro: primeira visita e verificação", () => {
  it("navegação sem passe recebe a tela de verificação com a prévia do site", async () => {
    const t = await montar();
    const r1 = await t.get("/", { accept: HTML });
    expect(r1.status).toBe(200);
    expect(r1.texto).toContain("Verificando seu navegador");
    expect(r1.texto).toContain('<meta property="og:title" content="Loja de Teste">');
    expect(r1.texto).not.toContain("Olá do site real");
    expect(r1.headers["content-security-policy"]).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; connect-src 'self'",
    );
    expect(r1.headers["x-robots-tag"]).toBe("noindex");
    expect(r1.headers["cache-control"]).toBe("no-store");
    // A prévia sai do site sem cookie de ninguém e fica guardada.
    await t.get("/", { accept: HTML, cookie: "tema=escuro" });
    const previas = t.site.recebidos.filter((p) => p.url === "/");
    expect(previas).toHaveLength(1);
    expect(previas[0]!.headers.accept).toBe("text/html");
    expect(previas[0]!.headers.cookie).toBeUndefined();
  });

  it("fluxo completo: verificar com sinais limpos -> passe -> site real com guarda", async () => {
    const t = await montar();
    const r = await t.verificar();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.texto)).toEqual({ ok: true });
    const linha = linhaCookie(r, "anti_rea_passe")!;
    expect(linha).toMatch(/; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/);
    const passe = cookieDe(r, "anti_rea_passe")!;
    const r2 = await t.get("/", { accept: HTML, cookie: passe });
    expect(r2.status).toBe(200);
    expect(r2.texto).toContain(`<meta property="og:title" content="Loja de Teste">${GUARDA}</head>`);
    expect(r2.texto).toContain("Olá do site real");
    expect(r2.headers.server).toBeUndefined();
    expect(r2.headers["x-powered-by"]).toBeUndefined();
    expect(r2.headers["content-length"]).toBeUndefined();
    expect(r2.headers["set-cookie"]).toEqual(["sessao=abc; Path=/"]);
    expect(t.eventos()).toEqual([]);
  });

  it("cookie Secure quando o proxy confiável diz https", async () => {
    const t = await montar({ trustProxy: true });
    const r = await t.verificar(SINAIS_LIMPOS, { "x-forwarded-proto": "https" });
    expect(linhaCookie(r, "anti_rea_passe")).toMatch(/; Secure$/);
  });

  it("verificar com sinais de automação: marca de pego, registro, aviso e sombra na volta", async () => {
    const t = await montar();
    const r = await t.verificar({ ...SINAIS_LIMPOS, webdriver: true });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.texto)).toEqual({ ok: false });
    expect(cookieDe(r, "anti_rea_passe")).toBeUndefined();
    expect(linhaCookie(r, "anti_rea_pego")).toMatch(/; Max-Age=3600; Path=\/; HttpOnly; SameSite=Lax$/);
    const ev = t.eventos().at(-1)!;
    expect(ev).toMatchObject({ motivo: "navegador automatizado", gravidade: "copia", destino: "sombra", ip: "127.0.0.1" });
    await esperar(() => t.enviados.length === 1);
    const volta = await t.get("/", { accept: HTML, cookie: cookieDe(r, "anti_rea_pego")! });
    expect(volta.status).toBe(200);
    expect(volta.texto).toContain("Pegamos você");
    expect(volta.texto).not.toContain("Olá do site real");
  });

  it("verificar recusa corpo inválido com 400 e corpo grande com 413, sem cair", async () => {
    const t = await montar();
    const desafio = await t.get("/", { accept: HTML });
    const nonce = /\("(\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",(?:true|false)\)/.exec(desafio.texto)![1]!;
    const casos: Array<string> = [
      "{",
      "null",
      "[]",
      '"texto"',
      JSON.stringify({ ...SINAIS_LIMPOS, webdriver: "false", nonce }),
      JSON.stringify({ ...SINAIS_LIMPOS, nonce: 123 }),
      JSON.stringify({ ...SINAIS_LIMPOS, nonce, extra: 1 }),
      JSON.stringify({ ...SINAIS_LIMPOS }),
      JSON.stringify({ ...SINAIS_LIMPOS, nonce: "1.2.3" }),
      JSON.stringify({ ...SINAIS_LIMPOS, nonce: { split: 1 } }),
      JSON.stringify({ ...SINAIS_LIMPOS, linguas: "4", nonce }),
    ];
    for (const corpo of casos) {
      const r = await t.post("/.anti-rea/verificar", corpo);
      expect(r.status, corpo).toBe(400);
      expect(cookieDe(r, "anti_rea_passe"), corpo).toBeUndefined();
    }
    expect((await t.post("/.anti-rea/verificar", "x".repeat(5_000))).status).toBe(413);
    expect((await t.get("/.anti-rea/verificar")).status).toBe(405);
    // Depois de tudo isso, o porteiro segue de pé.
    expect((await t.post("/.anti-rea/verificar", JSON.stringify({ ...SINAIS_LIMPOS, nonce }))).status).toBe(200);
  });

  it("corpo grande sem content-length também para em 4 KB", async () => {
    const t = await montar();
    const status = await new Promise<number>((resolver, rejeitar) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: t.porteiro.porta,
          path: "/.anti-rea/verificar",
          method: "POST",
          headers: { "content-type": "application/json" },
          agent: false,
        },
        (res) => {
          res.resume();
          resolver(res.statusCode!);
        },
      );
      r.on("error", rejeitar);
      r.write("x".repeat(3_000));
      r.end("y".repeat(3_000));
    });
    expect(status).toBe(413);
  });
});

describe("porteiro: repasse", () => {
  it("HTML em br chega descomprimido e com guarda", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r3 = await t.get("/comprimido", { accept: HTML, cookie: passe, "accept-encoding": "br" });
    expect(r3.status).toBe(200);
    expect(r3.headers["content-encoding"]).toBeUndefined();
    expect(r3.texto).toContain(GUARDA);
    expect(r3.texto).toContain("Olá do site real");
  });

  it("HTML em gzip também", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/gzip", { accept: HTML, cookie: passe, "accept-encoding": "gzip" });
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.texto).toContain(`${GUARDA}</head>`);
  });

  it("sem </head>, a guarda entra no início do body", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/sem-head", { accept: HTML, cookie: passe });
    expect(r.texto).toBe(`<!doctype html><body class="x">${GUARDA}<p>sem cabeça</p></body>`);
  });

  it("com guarda, o site só recebe codificações que o porteiro sabe abrir", async () => {
    const t = await montar();
    const passe = await t.passe();
    await t.get("/pagina", { accept: HTML, cookie: passe, "accept-encoding": "gzip, deflate, br, zstd" });
    expect(t.site.recebidos.at(-1)!.headers["accept-encoding"]).toBe("gzip, deflate, br");
  });

  it("imagem sem passe passa, JS sem passe é recusado", async () => {
    const t = await montar();
    const img = await t.get("/og.png", { accept: "image/*" });
    expect(img.status).toBe(200);
    expect(img.corpo.equals(PNG)).toBe(true);
    const js = await t.get("/app.js");
    expect(js.status).toBe(403);
    expect(js.texto).toBe("Acesso negado.");
    expect(js.headers["cache-control"]).toBe("no-store");
    expect(t.site.recebidos.some((p) => p.url === "/app.js")).toBe(false);
    expect(t.eventos().at(-1)).toMatchObject({ destino: "recusado", caminho: "/app.js", motivo: "sem passe", gravidade: "varredura" });
  });

  it("robô de prévia (WhatsApp) leva a imagem e não leva o JS", async () => {
    const t = await montar();
    expect((await t.get("/og.png", { "user-agent": "WhatsApp/2.24.1 A", accept: "*/*" })).status).toBe(200);
    const js = await t.get("/app.js", { "user-agent": "WhatsApp/2.24.1 A", accept: "*/*" });
    expect(js.texto).toContain("Verificando seu navegador");
    expect(js.texto).not.toContain("console.log");
  });

  it("JS e imagem com passe não recebem guarda nem mudam", async () => {
    const t = await montar();
    const passe = await t.passe();
    const js = await t.get("/app.js", { cookie: passe });
    expect(js.status).toBe(200);
    expect(js.texto).toBe("console.log(1)");
  });

  it("os cookies do porteiro nunca chegam ao site; X-Forwarded-* é do porteiro", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/eco", {
      cookie: `tema=escuro; ${passe}; anti_rea_pego=qualquer; outra=1`,
      "x-forwarded-for": "198.51.100.7",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "mentira.example",
      forwarded: "for=198.51.100.7",
      host: "seusite.com.br",
    });
    const recebido = JSON.parse(r.texto) as Record<string, string>;
    expect(recebido.cookie).toBe("tema=escuro; outra=1");
    expect(recebido["x-forwarded-for"]).toBe("127.0.0.1");
    expect(recebido["x-forwarded-proto"]).toBe("http");
    expect(recebido["x-forwarded-host"]).toBe("seusite.com.br");
    expect(recebido.host).toBe("seusite.com.br");
    expect(recebido.forwarded).toBeUndefined();
    const soPasse = JSON.parse((await t.get("/eco", { cookie: passe })).texto) as Record<string, string>;
    expect(soPasse.cookie).toBeUndefined();
  });

  it("POST de 5 MB vai em fluxo e chega inteiro ao site", async () => {
    const t = await montar();
    const passe = await t.passe();
    const MB = 1024 * 1024;
    const resposta = await new Promise<Resposta>((resolver, rejeitar) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: t.porteiro.porta,
          path: "/upload",
          method: "POST",
          headers: { "user-agent": CHROME, cookie: passe, "content-type": "application/octet-stream" },
          agent: false,
        },
        (res) => {
          const partes: Buffer[] = [];
          res.on("data", (p: Buffer) => partes.push(p));
          res.on("end", () => {
            const corpo = Buffer.concat(partes);
            resolver({ status: res.statusCode!, headers: res.headers, corpo, texto: corpo.toString("utf8") });
          });
        },
      );
      r.on("error", rejeitar);
      r.write(Buffer.alloc(MB, 1));
      // O site recebe o começo antes de o corpo terminar: nada fica guardado no porteiro.
      esperar(() => t.site.progresso.bytes > 0).then(
        () => r.end(Buffer.alloc(4 * MB, 2)),
        rejeitar,
      );
    });
    expect(resposta.status).toBe(200);
    expect(JSON.parse(resposta.texto)).toEqual({ bytes: 5 * MB });
  });

  it("isento repassa até agente curl sem passe", async () => {
    const t = await montar();
    const r = await t.post("/api/webhook/x", "{}", { "user-agent": "curl/8.7.1" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.texto)).toEqual({ bytes: 2 });
  });

  it("site fora do ar com POST ainda enviando o corpo: o visitante recebe o 502", async () => {
    const t = await montar();
    const passe = await t.passe();
    await t.site.fechar();
    const status = await new Promise<number>((resolver, rejeitar) => {
      const r = http.request(
        {
          host: "127.0.0.1",
          port: t.porteiro.porta,
          path: "/upload",
          method: "POST",
          headers: { "user-agent": CHROME, cookie: passe },
          agent: false,
        },
        (res) => {
          res.resume();
          resolver(res.statusCode!);
          r.end();
        },
      );
      r.on("error", rejeitar);
      // O corpo fica aberto: o porteiro descobre o site fora do ar antes de ele terminar.
      r.write(Buffer.alloc(64 * 1024, 1));
    });
    expect(status).toBe(502);
  });

  it("site fora do ar: 502 simples, sem evento nem aviso, e o porteiro segue de pé", async () => {
    const t = await montar();
    const passe = await t.passe();
    const eventosAntes = t.eventos().length;
    const antes = t.enviados.length;
    await t.site.fechar();
    const r5 = await t.get("/x", { cookie: passe });
    expect(r5.status).toBe(502);
    expect(r5.texto).toContain("Site temporariamente indisponível");
    expect(r5.headers["cache-control"]).toBe("no-store");
    expect(t.enviados).toHaveLength(antes);
    expect(t.eventos()).toHaveLength(eventosAntes);
    // A tela de verificação sai mesmo sem prévia.
    const desafio = await t.get("/outra", { accept: HTML });
    expect(desafio.status).toBe(200);
    expect(desafio.texto).toContain("<title>Verificando seu navegador</title>");
    expect((await t.get("/.anti-rea/guarda.js")).status).toBe(200);
  });

  it("visitante que desiste no meio não derruba o porteiro", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = http.request({
      host: "127.0.0.1",
      port: t.porteiro.porta,
      path: "/lento",
      headers: { "user-agent": CHROME, cookie: passe },
      agent: false,
    });
    r.on("error", () => {});
    r.end();
    await esperar(() => t.site.recebidos.some((p) => p.url === "/lento"));
    r.destroy();
    await new Promise((x) => setTimeout(x, 50));
    expect((await t.get("/pagina", { accept: HTML, cookie: passe })).status).toBe(200);
  });

  it("firstVisit false: repassa com guarda e entrega um passe", async () => {
    const t = await montar({ check: { firstVisit: false } });
    const r = await t.get("/", { accept: HTML });
    expect(r.texto).toContain(`${GUARDA}</head>`);
    expect(linhaCookie(r, "anti_rea_passe")).toMatch(/HttpOnly; SameSite=Lax$/);
    expect(r.headers["set-cookie"]).toContain("sessao=abc; Path=/");
  });
});

describe("porteiro: sombra, eventos e avisos", () => {
  it("X-Forwarded-For forjado com trustProxy false: registra o IP do socket", async () => {
    const t = await montar();
    const r = await t.get("/", { "user-agent": "Wget/1.21", "x-forwarded-for": "198.51.100.7" });
    expect(r.status).toBe(200);
    expect(r.texto).toContain("Pegamos você");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(r.headers["x-robots-tag"]).toBe("noindex");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(t.eventos().at(-1)!.ip).toBe("127.0.0.1");
    expect(t.site.recebidos).toHaveLength(0);
    await esperar(() => t.enviados.length === 1);
    expect(t.enviados[0]).toContain("Tentativa de cópia barrada");
  });

  it("campos do evento: domínio limpo, caminho e agente cortados em 300, data ISO", async () => {
    const t = await montar();
    const caminho = "/" + "a".repeat(400);
    await t.get(caminho, { "user-agent": "Wget/1.21 " + "x".repeat(400), host: "SeuSite.COM.br:8080" });
    const ev = t.eventos().at(-1)!;
    expect(ev.dominio).toBe("seusite.com.br");
    expect(ev.caminho).toBe(caminho.slice(0, 300));
    expect(ev.agente).toHaveLength(300);
    expect(new Date(ev.quando).toISOString()).toBe(ev.quando);
    expect(ev).toMatchObject({ motivo: "wget", gravidade: "copia", destino: "sombra" });
  });

  it("arquivo trancado: 404 na sombra, também com caminho disfarçado e forma absoluta", async () => {
    const t = await montar();
    for (const caminho of ["/.env", "//.env", "/%2e%65nv", "/x/../.env", "/.env?x=1", "http://outro.host/.env"]) {
      const r = await t.get(caminho, { accept: HTML });
      expect(r.status, caminho).toBe(404);
      expect(r.texto, caminho).toContain("Pegamos você");
    }
    expect(t.site.recebidos).toHaveLength(0);
    expect(t.eventos().map((e) => e.caminho)).toEqual(["/.env", "//.env", "/%2e%65nv", "/x/../.env", "/.env?x=1", "/.env"]);
    expect(t.eventos().every((e) => e.gravidade === "varredura")).toBe(true);
  });

  it(".map com passe é cópia e avisa", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/app.js.map", { cookie: passe });
    expect(r.status).toBe(404);
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "mapa de código", gravidade: "copia" });
    await esperar(() => t.enviados.length === 1);
  });

  it("alvo que não é caminho recebe 400", async () => {
    const t = await montar();
    expect((await pedir(t.porteiro.porta, "*", { metodo: "OPTIONS" })).status).toBe(400);
  });
});
