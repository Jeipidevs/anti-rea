import { afterEach, describe, expect, it } from "vitest";
import { codigoDeDono } from "../../src/passe/passe.js";
import { cookieDoPorteiro } from "../../src/porteiro/passes.js";
import { CHROME, HTML, SEGREDO, SINAIS_LIMPOS, cookieDe, limparTudo, linhaCookie, montar, pedir } from "./apoio-servidor.js";

// Pedidos que o navegador ou uma integração fazem sem cookie, e cookies que precisam chegar de outro site.

afterEach(limparTudo);

describe("porteiro: pré-voo CORS", () => {
  it("OPTIONS com Access-Control-Request-Method chega ao site sem passe e sem registro", async () => {
    const t = await montar();
    const r = await pedir(t.porteiro.porta, "/app.js", {
      metodo: "OPTIONS",
      headers: { origin: "https://outro.exemplo", "access-control-request-method": "POST", accept: "*/*" },
    });
    expect(r.status).toBe(200);
    expect(t.site.recebidos.map((p) => `${p.metodo} ${p.url}`)).toEqual(["OPTIONS /app.js"]);
    expect(t.eventos()).toEqual([]);
  });

  it("o pré-voo leva só o status e os cabeçalhos do site, nunca o corpo", async () => {
    const t = await montar();
    const preVoo = (caminho: string, agente = CHROME) =>
      pedir(t.porteiro.porta, caminho, {
        metodo: "OPTIONS",
        headers: { "user-agent": agente, origin: "https://outro.exemplo", "access-control-request-method": "GET" },
      });
    const pagina = await preVoo("/pre-voo");
    expect(pagina.status).toBe(200);
    expect(pagina.headers["access-control-allow-origin"]).toBe("*");
    expect(pagina.headers["content-length"]).toBe("0");
    expect(pagina.headers["content-encoding"]).toBeUndefined();
    expect(pagina.corpo).toHaveLength(0);
    const vazio = await preVoo("/pre-voo-204");
    expect(vazio.status).toBe(204);
    expect(vazio.headers["access-control-allow-methods"]).toBe("GET, POST");
    expect(vazio.headers["content-length"]).toBeUndefined();
    const naoMudou = await preVoo("/pre-voo-304");
    expect(naoMudou.status).toBe(304);
    expect(naoMudou.headers["content-length"]).toBeUndefined();
    expect(t.eventos()).toEqual([]);
    // Ferramenta conhecida não chega ao site nem pelo pré-voo.
    const curl = await preVoo("/pre-voo", "curl/8.4.0");
    expect(curl.texto).toContain("Pegamos você");
    expect(curl.texto).not.toContain("Olá do site real");
    expect(t.site.recebidos.map((p) => p.url)).toEqual(["/pre-voo", "/pre-voo-204", "/pre-voo-304"]);
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "curl", gravidade: "copia", destino: "sombra" });
  });

  it("sem o cabeçalho continua recusado, e caminho trancado continua na sombra", async () => {
    const t = await montar();
    expect((await pedir(t.porteiro.porta, "/app.js", { metodo: "OPTIONS", headers: { accept: "*/*" } })).status).toBe(403);
    const env = await pedir(t.porteiro.porta, "/.env", { metodo: "OPTIONS", headers: { "access-control-request-method": "GET" } });
    expect(env.status).toBe(404);
    expect(t.site.recebidos).toEqual([]);
  });
});

describe("porteiro: caminhos públicos padrão", () => {
  it("robots.txt, sitemap, manifesto e /.well-known/ chegam ao site sem passe e sem registro", async () => {
    const t = await montar();
    const caminhos = [
      "/robots.txt",
      "/sitemap.xml",
      "/sitemap-1.xml",
      "/ads.txt",
      "/app-ads.txt",
      "/favicon.ico",
      "/manifest.json",
      "/site.webmanifest",
      "/.well-known/security.txt",
      "/.well-known/assetlinks.json",
    ];
    for (const caminho of caminhos) {
      const r = await t.get(caminho, { accept: "*/*", "user-agent": "Wget/1.21" });
      expect(r.texto, caminho).toBe("não achei");
    }
    expect(t.site.recebidos.map((p) => p.url)).toEqual(caminhos);
    expect(t.eventos()).toEqual([]);
  });

  it("/.well-known/../app.js não passa", async () => {
    const t = await montar();
    expect((await t.get("/.well-known/../app.js", { accept: "*/*" })).status).toBe(400);
    expect(t.site.recebidos).toEqual([]);
  });
});

describe("porteiro: SameSite dos cookies", () => {
  const HTTPS = { "x-forwarded-proto": "https" };

  it("cookieDoPorteiro: SameSite=None; Secure em HTTPS, SameSite=Lax em HTTP", () => {
    expect(cookieDoPorteiro("anti_rea_passe", "v", 1000, true)).toBe("anti_rea_passe=v; Max-Age=1; Path=/; HttpOnly; SameSite=None; Secure");
    expect(cookieDoPorteiro("anti_rea_passe", "v", 1000, false)).toBe("anti_rea_passe=v; Max-Age=1; Path=/; HttpOnly; SameSite=Lax");
  });

  it("por HTTPS (X-Forwarded-Proto confiável) os três cookies saem com SameSite=None; Secure", async () => {
    const t = await montar({ trustProxy: true });
    const NONE = /; HttpOnly; SameSite=None; Secure$/;
    const dono = await t.get(`/.anti-rea/dono/${codigoDeDono(SEGREDO, 1)}`, HTTPS);
    expect(linhaCookie(dono, "anti_rea_passe")).toMatch(NONE);
    const verificado = await t.verificar(SINAIS_LIMPOS, HTTPS);
    expect(linhaCookie(verificado, "anti_rea_passe")).toMatch(NONE);
    const pego = await t.verificar({ ...SINAIS_LIMPOS, webdriver: true }, HTTPS);
    expect(linhaCookie(pego, "anti_rea_pego")).toMatch(NONE);
    const passe = cookieDe(verificado, "anti_rea_passe")!;
    const revogado = await t.post("/.anti-rea/pego", JSON.stringify({ ...SINAIS_LIMPOS, cdp: true, nonce: "" }), { ...HTTPS, cookie: passe });
    expect(linhaCookie(revogado, "anti_rea_pego")).toMatch(NONE);
    expect(linhaCookie(revogado, "anti_rea_passe")).toMatch(NONE);
  });

  it("firstVisit false por HTTPS: o passe da navegação também sai com SameSite=None; Secure", async () => {
    const t = await montar({ trustProxy: true, check: { firstVisit: false } });
    expect(linhaCookie(await t.get("/", { ...HTTPS, accept: HTML }), "anti_rea_passe")).toMatch(/SameSite=None; Secure$/);
  });

  it("X-Forwarded-Proto sem proxy confiável não conta: HTTP simples fica com SameSite=Lax", async () => {
    const t = await montar();
    const r = await t.get(`/.anti-rea/dono/${codigoDeDono(SEGREDO, 1)}`, HTTPS);
    expect(linhaCookie(r, "anti_rea_passe")).toMatch(/; HttpOnly; SameSite=Lax$/);
  });
});
