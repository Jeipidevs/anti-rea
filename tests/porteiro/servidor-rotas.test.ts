import { once } from "node:events";
import http from "node:http";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { codigoDeDono } from "../../src/passe/passe.js";
import type { Resolvedor } from "../../src/robos/dns.js";
import { CHROME, HTML, PAGINA, SEGREDO, SINAIS_LIMPOS, cookieDe, esperar, limparTudo, linhaCookie, montar, pedir } from "./apoio-servidor.js";

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

describe("porteiro: robôs oficiais", () => {
  const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

  it("Googlebot confirmado repassa sem guarda", async () => {
    const t = await montar();
    const r = await t.get("/", { "user-agent": GOOGLEBOT, accept: HTML });
    expect(r.texto).toBe(PAGINA);
    expect(t.eventos()).toEqual([]);
  });

  it("bingbot que não confirma vai à sombra como robô falso", async () => {
    const t = await montar();
    const r = await t.get("/", { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)", accept: HTML });
    expect(r.texto).toContain("Pegamos você");
    expect(t.eventos().at(-1)).toMatchObject({ motivo: "robô falso: bingbot", destino: "sombra" });
  });

  it("Applebot com DNS fora do ar passa e fica só registrado, sem aviso", async () => {
    const semResposta: Resolvedor = {
      reverso: async () => {
        throw Object.assign(new Error("tempo"), { code: "ETIMEOUT" });
      },
      direto: async () => [],
    };
    const t = await montar({}, { dns: semResposta });
    const r = await t.get("/", { "user-agent": "Mozilla/5.0 (compatible; Applebot/0.1)", accept: HTML });
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
