import { once } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { cacheSoDoNavegador } from "../../src/porteiro/repasse.js";
import { HTML, PNG, limparTudo, montar } from "./apoio-servidor.js";

// Segurança do servidor (src/porteiro/servidor.ts): caminho decidido igual ao recebido pelo site, cache compartilhado,
// prévia sem query e corpo sempre enquadrado no pedido ao site.

afterEach(limparTudo);

const CURL = { "user-agent": "curl/8.4.0" };

describe("porteiro: o site recebe o caminho que foi decidido", () => {
  it("ponto-ponto escondido atrás de %2F em caminho isento é recusado com 400", async () => {
    const t = await montar();
    for (const alvo of ["/api/webhook/a%2fb%2fc/../../../app.js", "/api/webhook/..;/app.js"]) {
      const r = await t.get(alvo, CURL);
      expect(r.status, alvo).toBe(400);
      expect(r.texto, alvo).not.toContain("console.log");
    }
    expect(t.eventos().at(-1)).toMatchObject({ destino: "recusado", motivo: "caminho ambíguo" });
    // Lido normalizado vira /api/webhook/.env: trancado em qualquer pasta, antes do 400.
    const env = await t.get("/api/webhook/a%2fb%2fc/../../../.env", CURL);
    expect(env.status).toBe(404);
    expect(env.texto).not.toContain("DB_PASS");
    expect(t.site.recebidos).toHaveLength(0);
  });

  it("com passe, ponto-ponto que o porteiro resolveria diferente do site também é recusado", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/x/a%2fb/../../app.js", { cookie: passe });
    expect(r.status).toBe(400);
    expect(r.texto).not.toContain("console.log");
    expect(t.site.recebidos.some((p) => p.url.includes("app.js"))).toBe(false);
    const env = await t.get("/x/a%2fb/../../.env", { cookie: passe });
    expect(env.status).toBe(404);
    expect(env.texto).not.toContain("DB_PASS");
    expect(t.site.recebidos.some((p) => p.url.includes(".env"))).toBe(false);
  });

  it("parâmetro de matriz não faz JS passar por imagem", async () => {
    const t = await montar();
    const r = await t.get("/app.js;.png", { accept: "*/*" });
    expect(r.status).toBe(403);
    expect(t.site.recebidos).toHaveLength(0);
  });
});

describe("porteiro: cache compartilhado", () => {
  it("resposta liberada por passe não fica no cache da CDN; o navegador continua podendo guardar", async () => {
    const t = await montar();
    const passe = await t.passe();
    const js = await t.get("/app.js", { cookie: passe });
    expect(js.status).toBe(200);
    expect(js.headers["cdn-cache-control"]).toBe("no-store");
    expect(js.headers["cloudflare-cdn-cache-control"]).toBe("no-store");
    expect(js.headers["cache-control"]).toBe("private, max-age=31536000");
    const html = await t.get("/", { accept: HTML, cookie: passe });
    expect(html.headers["cdn-cache-control"]).toBe("no-store");
    expect(html.headers["cache-control"]).toBe("private");
  });

  it("imagem e caminho isento ficam com os cabeçalhos do site", async () => {
    const t = await montar();
    const img = await t.get("/og.png", { accept: "image/*" });
    expect(img.corpo.equals(PNG)).toBe(true);
    expect(img.headers["cdn-cache-control"]).toBeUndefined();
    expect(img.headers["cache-control"]).toBeUndefined();
    const isento = await t.post("/api/webhook/x", "{}", CURL);
    expect(isento.headers["cdn-cache-control"]).toBeUndefined();
  });
});

describe("cacheSoDoNavegador", () => {
  it("tira public e s-maxage, põe private e deixa no-store como veio", () => {
    expect(cacheSoDoNavegador(undefined)).toBe("private");
    expect(cacheSoDoNavegador("public, max-age=31536000, immutable")).toBe("private, max-age=31536000, immutable");
    expect(cacheSoDoNavegador("max-age=60, S-MaxAge=600")).toBe("private, max-age=60");
    expect(cacheSoDoNavegador("private, max-age=0")).toBe("private, max-age=0");
    expect(cacheSoDoNavegador("no-store")).toBe("no-store");
  });
});

describe("porteiro: prévia sem query", () => {
  it("link de uso único não é gasto pela busca da prévia", async () => {
    const t = await montar();
    const r = await t.get("/api/auth/callback/email?token=UNICO123&email=a%40b.c", { accept: HTML });
    expect(r.status).toBe(200);
    expect(r.texto).toContain("Verificando seu navegador");
    expect(t.site.recebidos.map((p) => p.url)).toEqual(["/api/auth/callback/email"]);
  });
});

/** Site cru em TCP: guarda os bytes do pedido e responde 200 sem corpo (vale também para HEAD) depois de um instante. */
async function siteCru() {
  let bytes = "";
  const sockets = new Set<net.Socket>();
  const servidor = net.createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
    let respondeu = false;
    s.on("data", (d: Buffer) => {
      bytes += d.toString("latin1");
      if (!respondeu && bytes.includes("\r\n\r\n")) {
        respondeu = true;
        setTimeout(() => s.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), 100);
      }
    });
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  return {
    porta: (servidor.address() as net.AddressInfo).port,
    bytes: () => bytes,
    fechar: () => {
      for (const s of sockets) s.destroy();
      servidor.close();
    },
  };
}

/** Manda bytes crus ao porteiro e espera a resposta inteira. */
async function pedidoCru(porta: number, texto: string): Promise<string> {
  const s = net.connect(porta, "127.0.0.1");
  let resposta = "";
  s.on("data", (d: Buffer) => (resposta += d.toString("latin1")));
  s.write(texto);
  await once(s, "end");
  s.destroy();
  return resposta;
}

describe("porteiro: corpo sempre enquadrado no pedido ao site", () => {
  const contrabando = "GET /app.js HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: 203.0.113.9\r\n\r\n";

  it("GET com Transfer-Encoding chunked chega ao site em chunked, sem pedido contrabandeado", async () => {
    const cru = await siteCru();
    try {
      const t = await montar({ upstream: `http://127.0.0.1:${cru.porta}` });
      for (const metodo of ["GET", "HEAD", "DELETE", "OPTIONS"]) {
        const tamanho = Buffer.byteLength(contrabando).toString(16);
        const r = await pedidoCru(
          t.porteiro.porta,
          `${metodo} /api/webhook/x HTTP/1.1\r\nHost: seusite.com.br\r\nUser-Agent: curl/8.4.0\r\n` +
            `Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n${tamanho}\r\n${contrabando}\r\n0\r\n\r\n`,
        );
        expect(r, metodo).toMatch(/^HTTP\/1\.1 200/);
      }
      const pedidos = cru.bytes().split(/(?=^(?:GET|HEAD|DELETE|OPTIONS) \/api\/webhook\/x )/m);
      expect(pedidos).toHaveLength(4);
      for (const p of pedidos) {
        const fim = p.indexOf("\r\n\r\n");
        expect(p.slice(0, fim)).toMatch(/\r\ntransfer-encoding: chunked(\r\n|$)/i);
        expect(p.slice(fim + 4)).toMatch(/^[0-9a-f]+\r\nGET \/app\.js HTTP\/1\.1\r\n/);
      }
    } finally {
      cru.fechar();
    }
  });

  it("Connection: content-length não tira o Content-Length do pedido ao site", async () => {
    const cru = await siteCru();
    try {
      const t = await montar({ upstream: `http://127.0.0.1:${cru.porta}` });
      const r = await pedidoCru(
        t.porteiro.porta,
        `GET /api/webhook/x HTTP/1.1\r\nHost: seusite.com.br\r\nUser-Agent: curl/8.4.0\r\n` +
          `Content-Length: ${Buffer.byteLength(contrabando)}\r\nConnection: close, content-length\r\n\r\n${contrabando}`,
      );
      expect(r).toMatch(/^HTTP\/1\.1 200/);
      const p = cru.bytes();
      const fim = p.indexOf("\r\n\r\n");
      expect(p.slice(0, fim)).toMatch(new RegExp(`\\r\\ncontent-length: ${Buffer.byteLength(contrabando)}(\\r\\n|$)`, "i"));
    } finally {
      cru.fechar();
    }
  });
});
