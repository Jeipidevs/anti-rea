import http from "node:http";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { CHROME, GUARDA, HTML, PAGINA, abrirCorpo, esperar, limparTudo, montar } from "./apoio-servidor.js";

// HTML comprimido pelo site: o porteiro abre, põe a guarda e devolve na mesma codificação, em fluxo.

afterEach(limparTudo);

const COM_GUARDA = PAGINA.replace("</head>", `${GUARDA}</head>`);

describe("porteiro: HTML comprimido pelo site", () => {
  it("gzip, x-gzip, deflate e br: volta na mesma codificação, com a guarda, o Vary do site e sem Content-Length", async () => {
    const t = await montar();
    const passe = await t.passe();
    for (const cod of ["gzip", "x-gzip", "deflate", "br"]) {
      const r = await t.get(`/codificado?cod=${cod}`, { accept: HTML, cookie: passe, "accept-encoding": "gzip, deflate, br" });
      expect(r.status, cod).toBe(200);
      expect(r.headers["content-encoding"], cod).toBe(cod);
      expect(r.headers.vary, cod).toBe("Accept-Encoding");
      expect(r.headers["content-length"], cod).toBeUndefined();
      expect(abrirCorpo(cod, r.corpo), cod).toBe(COM_GUARDA);
    }
  });

  it("a página do site em br sai comprimida: menor que a página aberta", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/comprimido", { accept: HTML, cookie: passe, "accept-encoding": "br" });
    expect(r.headers["content-encoding"]).toBe("br");
    expect(abrirCorpo("br", r.corpo)).toBe(COM_GUARDA);
    expect(r.corpo.length).toBeLessThan(Buffer.byteLength(COM_GUARDA));
  });

  it("sem compressão do site, a página sai aberta, sem content-encoding", async () => {
    const t = await montar();
    const passe = await t.passe();
    const r = await t.get("/comprimido", { accept: HTML, cookie: passe });
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.texto).toBe(COM_GUARDA);
  });

  it("em fluxo: o começo da página chega ao visitante, já com a guarda, antes de o site terminar", async () => {
    for (const cod of ["gzip", "deflate", "br"]) {
      const t = await montar();
      const passe = await t.passe();
      const abrir =
        cod === "br"
          ? zlib.createBrotliDecompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH })
          : cod === "deflate"
            ? zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH })
            : zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH });
      let texto = "";
      abrir.on("data", (p: Buffer) => (texto += p.toString("utf8")));
      const fim = new Promise<string | undefined>((resolver, rejeitar) => {
        const r = http.request(
          {
            host: "127.0.0.1",
            port: t.porteiro.porta,
            path: `/fluxo?cod=${cod}`,
            headers: { "user-agent": CHROME, accept: HTML, cookie: passe, "accept-encoding": "gzip, deflate, br" },
            agent: false,
          },
          (res) => {
            res.pipe(abrir);
            abrir.on("end", () => resolver(res.headers["content-encoding"]));
            abrir.on("error", rejeitar);
          },
        );
        r.on("error", rejeitar);
        r.end();
      });
      await esperar(() => texto.includes("Primeira parte"));
      expect(texto, cod).toBe(`<!doctype html><html><head><title>Fluxo</title>${GUARDA}</head><body><p>Primeira parte</p>`);
      t.site.fluxo.soltar();
      expect(await fim, cod).toBe(cod);
      expect(texto, cod).toContain("<p>Primeira parte</p><p>Segunda parte</p></body></html>");
      await limparTudo();
    }
  });
});
