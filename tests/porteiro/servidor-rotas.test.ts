import { once } from "node:events";
import http from "node:http";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { codigoDeDono } from "../../src/passe/passe.js";
import type { Resolvedor } from "../../src/robos/dns.js";
import { CHROME, HTML, IP_GOOGLE, PAGINA, SEGREDO, SINAIS_LIMPOS, cookieDe, esperar, limparTudo, linhaCookie, montar, pedir } from "./apoio-servidor.js";

afterEach(limparTudo);

describe("porteiro: dono", () => {
  it("link certo dá passe de dono e redireciona para /; o passe passa até curl e sem guarda", async () => {
    const t = await montar();
    const r = await t.get(`/.anti-rea/dono/${codigoDeDono(SEGREDO, 1)}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("/");
    expect(linhaCookie(r, "anti_rea_passe")).toMatch(/; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax$/);
    const dono = cookieDe(r, "anti_rea_passe")!;
    const pagina = await t.get("/", { accept: HTML, cookie: dono, "user-agent": "curl/8.7.1" });
    expect(pagina.status).toBe(200);
    expect(pagina.texto).toBe(PAGINA);
    expect(t.eventos()).toEqual([]);
  });

  it("link errado vira evento de cópia, aviso e sombra", async () => {
    const t = await montar();
    const r = await t.get("/.anti-rea/dono/errado");
    expect(r.status).toBe(200);
    expect(r.texto).toContain("Pegamos você");
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "link de dono errado", gravidade: "copia", destino: "sombra" });
    await esperar(() => t.enviados.length === 1);
  });
});

describe("porteiro: guarda e pego", () => {
  it("guarda.js sai sem cache e com a sonda de pausa conforme devtoolsIsCaught", async () => {
    const t = await montar();
    const r = await t.get("/.anti-rea/guarda.js");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/javascript/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.texto).toContain("/.anti-rea/pego");
    expect(r.texto).toContain("debugger");
    expect((await t.post("/.anti-rea/guarda.js", "")).status).toBe(405);

    const semF12 = await montar({ check: { devtoolsIsCaught: false } });
    expect((await semF12.get("/.anti-rea/guarda.js")).texto).not.toContain("debugger");
    expect((await semF12.get("/", { accept: HTML })).texto).not.toContain("debugger");
  });

  it("pego: revoga o passe e a próxima navegação vai à sombra", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.post("/.anti-rea/pego", JSON.stringify({ ...SINAIS_LIMPOS, cdp: true, nonce: "" }), { cookie: passe });
    expect(r.status).toBe(204);
    const pego = cookieDe(r, "anti_rea_pego")!;
    expect(pego).toBeDefined();
    expect(linhaCookie(r, "anti_rea_passe")).toMatch(/^anti_rea_passe=; Max-Age=0/);
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "depuração remota ativa", gravidade: "copia", destino: "sombra" });
    await esperar(() => t.enviados.length === 1);
    // Com a marca: sombra.
    const volta = await t.get("/", { accept: HTML, cookie: `${passe}; ${pego}` });
    expect(volta.texto).toContain("Pegamos você");
    // Sem a marca, o passe revogado não vale mais: volta para a verificação.
    const semMarca = await t.get("/", { accept: HTML, cookie: passe });
    expect(semMarca.texto).toContain("Verificando seu navegador");
  });

  it("pego sem passe válido responde 204 e não faz mais nada", async () => {
    const t = await montar();
    const r = await t.post("/.anti-rea/pego", JSON.stringify({ ...SINAIS_LIMPOS, cdp: true, nonce: "" }));
    expect(r.status).toBe(204);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(t.eventos()).toEqual([]);
  });

  it("pego com passe e sinais limpos não revoga (sem laço de recarga)", async () => {
    const t = await montar({ check: { devtoolsIsCaught: false } });
    const passe = await t.passe();
    const r = await t.post("/.anti-rea/pego", JSON.stringify({ ...SINAIS_LIMPOS, devtoolsAberto: true, nonce: "" }), { cookie: passe });
    expect(r.status).toBe(200);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect((await t.get("/", { accept: HTML, cookie: passe })).texto).toContain("Olá do site real");
  });

  it("pego com corpo inválido é 400", async () => {
    const t = await montar();
    const passe = await t.passe();
    expect((await t.post("/.anti-rea/pego", "{nada", { cookie: passe })).status).toBe(400);
    expect((await t.post("/.anti-rea/pego", JSON.stringify({ cdp: true }), { cookie: passe })).status).toBe(400);
    expect((await t.get("/.anti-rea/pego", { cookie: passe })).status).toBe(405);
  });
});

describe("porteiro: rotas internas só aceitam o próprio site", () => {
  // Formulário enctype=text/plain enviado sozinho por outro site: o corpo vira JSON válido.
  const CORPO_DE_FORMULARIO = (extra: Record<string, unknown>) =>
    `${JSON.stringify({ ...SINAIS_LIMPOS, webdriver: true, ...extra, nonce: "=" }).slice(0, -1)}}\r\n`;

  it("pego de outro site (form text/plain com Sec-Fetch-Site cross-site): 403, nada revogado, sem evento", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.post("/.anti-rea/pego", CORPO_DE_FORMULARIO({}), {
      cookie: passe,
      "content-type": "text/plain",
      origin: "https://site-malicioso.example",
      "sec-fetch-site": "cross-site",
    });
    expect(r.status).toBe(403);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(t.eventos()).toEqual([]);
    expect((await t.get("/", { accept: HTML, cookie: passe })).texto).toContain("Olá do site real");
  });

  it("pego e verificar: Origin de outro host é 403 mesmo sem Sec-Fetch-Site; cross-site é 403 mesmo com JSON", async () => {
    const t = await montar();
    const passe = await t.passe();
    const sinais = JSON.stringify({ ...SINAIS_LIMPOS, cdp: true, nonce: "" });
    const outroHost = { cookie: passe, host: "seusite.com.br", origin: "https://site-malicioso.example" };
    expect((await t.post("/.anti-rea/pego", sinais, outroHost)).status).toBe(403);
    expect((await t.post("/.anti-rea/pego", sinais, { cookie: passe, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await t.post("/.anti-rea/verificar", sinais, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await t.post("/.anti-rea/verificar", sinais, { host: "seusite.com.br", origin: "null" })).status).toBe(403);
    expect(t.eventos()).toEqual([]);
    // O próprio site (mesma origem, Origin com o mesmo host) continua valendo.
    const doSite = await t.post("/.anti-rea/pego", sinais, {
      cookie: passe,
      host: "seusite.com.br",
      origin: "https://seusite.com.br",
      "sec-fetch-site": "same-origin",
    });
    expect(doSite.status).toBe(204);
  });

  it("verificar com nonce de verdade vindo de formulário de outro site não marca ninguém como pego", async () => {
    const t = await montar();
    const desafio = await t.get("/", { accept: HTML });
    const nonce = /\("(\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",(?:true|false)\)/.exec(desafio.texto)![1]!;
    const corpo = CORPO_DE_FORMULARIO({ nonce });
    // Sem Sec-Fetch-Site nem Origin (navegador antigo, ou HTTP): o tipo text/plain basta para recusar.
    const r = await t.post("/.anti-rea/verificar", corpo.replace('"nonce":"="', `"nonce":"${nonce}"`), { "content-type": "text/plain" });
    expect(r.status).toBe(415);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(t.eventos()).toEqual([]);
  });

  it("content-type com charset e maiúsculas vale como JSON", async () => {
    const t = await montar();
    const passe = await t.passe();
    const sinais = JSON.stringify({ ...SINAIS_LIMPOS, nonce: "" });
    const r = await t.post("/.anti-rea/pego", sinais, { cookie: passe, "content-type": "Application/JSON; charset=utf-8" });
    expect(r.status).toBe(200);
  });
});

describe("porteiro: robôs oficiais", () => {
  const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

  // O porteiro dos testes recebe de 127.0.0.1: o IP do robô chega pelo proxy (trustProxy true).
  it("Googlebot confirmado repassa sem guarda", async () => {
    const t = await montar({ trustProxy: true });
    const r = await t.get("/", { "user-agent": GOOGLEBOT, accept: HTML, "x-forwarded-for": IP_GOOGLE });
    expect(r.texto).toBe(PAGINA);
    expect(t.eventos()).toEqual([]);
  });

  it("bingbot que não confirma vai à sombra como robô falso", async () => {
    const t = await montar({ trustProxy: true });
    const r = await t.get("/", { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)", accept: HTML, "x-forwarded-for": "203.0.113.9" });
    expect(r.texto).toContain("Pegamos você");
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "robô falso: bingbot", destino: "sombra", ip: "203.0.113.9" });
  });

  it("atrás de um proxy sem trustProxy (tudo de 127.0.0.1): Googlebot passa e fica só registrado, sem sombra", async () => {
    const t = await montar();
    const r = await t.get("/", { "user-agent": GOOGLEBOT, accept: HTML, "x-forwarded-for": IP_GOOGLE });
    expect(r.texto).toBe(PAGINA);
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "robô não confirmado: Googlebot", destino: "registrado", ip: "127.0.0.1" });
  });

  it("Applebot com DNS fora do ar passa e fica só registrado, sem aviso", async () => {
    const semResposta: Resolvedor = {
      reverso: async () => {
        throw Object.assign(new Error("tempo"), { code: "ETIMEOUT" });
      },
      direto: async () => [],
    };
    const t = await montar({ trustProxy: true }, { dns: semResposta });
    const r = await t.get("/", { "user-agent": "Mozilla/5.0 (compatible; Applebot/0.1)", accept: HTML, "x-forwarded-for": "203.0.113.17" });
    expect(r.texto).toBe(PAGINA);
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "robô não confirmado: Applebot", destino: "registrado" });
    await new Promise((x) => setTimeout(x, 30));
    expect(t.enviados).toEqual([]);
  });
});

describe("porteiro: WebSocket", () => {
  function abrir(porta: number, caminho: string, headers: http.OutgoingHttpHeaders = {}) {
    return new Promise<{ status: number; socket?: Duplex }>((resolver, rejeitar) => {
      const r = http.request({
        host: "127.0.0.1",
        port: porta,
        path: caminho,
        headers: { connection: "Upgrade", upgrade: "websocket", "user-agent": CHROME, ...headers },
        agent: false,
      });
      r.on("upgrade", (res, socket: Duplex) => resolver({ status: res.statusCode!, socket }));
      r.on("response", (res) => {
        res.resume();
        res.on("end", () => resolver({ status: res.statusCode! }));
      });
      r.on("error", rejeitar);
      r.end();
    });
  }

  async function eco(socket: Duplex, texto: string): Promise<string> {
    socket.write(texto);
    const [dado] = await once(socket, "data");
    return String(dado);
  }

  it("com passe o eco funciona; sem passe a conexão é recusada com 403", async () => {
    const t = await montar();
    const passe = await t.passe();
    const ok = await abrir(t.porteiro.porta, "/ws", { cookie: passe });
    expect(ok.status).toBe(101);
    expect(await eco(ok.socket!, "ping")).toBe("ping");
    const pedidoNoSite = t.site.recebidos.find((p) => p.url === "/ws")!;
    expect(pedidoNoSite.headers.cookie).toBeUndefined();
    expect(pedidoNoSite.headers["x-forwarded-for"]).toBe("127.0.0.1");
    ok.socket!.destroy();

    const recusado = await abrir(t.porteiro.porta, "/ws");
    expect(recusado.status).toBe(403);
    expect(t.site.recebidos.filter((p) => p.url === "/ws")).toHaveLength(1);
  });

  it("caminho isento abre sem passe", async () => {
    const t = await montar();
    const ok = await abrir(t.porteiro.porta, "/api/webhook/ws");
    expect(ok.status).toBe(101);
    expect(await eco(ok.socket!, "oi")).toBe("oi");
    ok.socket!.destroy();
  });

  it("só websocket é repassado: h2c recebe 400, fecha o socket e fica registrado como varredura", async () => {
    const t = await montar();
    const passe = await t.passe();
    for (const [caminho, headers] of [
      ["/api/webhook/x", { upgrade: "h2c", "http2-settings": "AAMAAABkAAQAAP__" }],
      ["/ws", { upgrade: "h2c", "http2-settings": "AAMAAABkAAQAAP__", cookie: passe }],
      ["/ws", { upgrade: "foo/1, websocket", cookie: passe }],
    ] as const) {
      const r = await abrir(t.porteiro.porta, caminho, headers);
      expect(r.status, `${caminho} ${headers.upgrade}`).toBe(400);
    }
    expect(t.site.recebidos.filter((p) => p.url !== "/")).toEqual([]);
    expect(t.eventos()).toHaveLength(3);
    expect(t.eventos().every((e) => e.motivo === "upgrade não suportado" && e.gravidade === "varredura" && e.destino === "recusado")).toBe(true);
    expect(t.eventos().map((e) => e.caminho)).toEqual(["/api/webhook/x", "/ws", "/ws"]);

    // websocket em maiúsculas continua valendo e chega ao site como websocket.
    const ok = await abrir(t.porteiro.porta, "/ws", { upgrade: "WebSocket", cookie: passe });
    expect(ok.status).toBe(101);
    expect(await eco(ok.socket!, "ping")).toBe("ping");
    expect(t.site.recebidos.find((p) => p.url === "/ws")!.headers.upgrade).toBe("websocket");
    ok.socket!.destroy();
  });

  it("firstVisit false e devtoolsIsCaught false: a primeira navegação dá passe e o WebSocket abre", async () => {
    const t = await montar({ check: { firstVisit: false, devtoolsIsCaught: false } });
    expect((await abrir(t.porteiro.porta, "/ws")).status).toBe(403);
    const r = await t.get("/", { accept: HTML });
    expect(r.texto).toBe(PAGINA);
    const passe = cookieDe(r, "anti_rea_passe");
    expect(passe).toBeDefined();
    const ok = await abrir(t.porteiro.porta, "/ws", { cookie: passe! });
    expect(ok.status).toBe(101);
    expect(await eco(ok.socket!, "oi")).toBe("oi");
    ok.socket!.destroy();
    // Só navegação com resposta 200 ganha passe.
    expect(cookieDe(await t.get("/nada", { accept: HTML }), "anti_rea_passe")).toBeUndefined();
    expect(cookieDe(await t.get("/app.js", { accept: "*/*" }), "anti_rea_passe")).toBeUndefined();
  });

  it("fechar() derruba túneis abertos e o servidor", async () => {
    const t = await montar();
    const passe = await t.passe();
    const ok = await abrir(t.porteiro.porta, "/ws", { cookie: passe });
    const fechou = once(ok.socket!, "close");
    await t.porteiro.fechar();
    await fechou;
    await expect(pedir(t.porteiro.porta, "/")).rejects.toThrow();
  });
});
