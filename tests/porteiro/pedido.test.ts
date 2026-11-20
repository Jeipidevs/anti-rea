import { describe, expect, it } from "vitest";
import { caminhoDoAlvo, dominioDoHost, ehMidia, ehNavegacao, normalizarCaminho } from "../../src/porteiro/pedido.js";

describe("caminhoDoAlvo", () => {
  it("forma de origem fica como veio", () => {
    expect(caminhoDoAlvo("/a/b?x=1")).toBe("/a/b?x=1");
    expect(caminhoDoAlvo("//.env")).toBe("//.env");
  });

  it("forma absoluta vira só caminho e query", () => {
    expect(caminhoDoAlvo("http://outro.host/.env?x=1")).toBe("/.env?x=1");
    expect(caminhoDoAlvo("HTTPS://outro.host")).toBe("/");
  });

  it("alvo que não é caminho devolve null", () => {
    expect(caminhoDoAlvo("*")).toBeNull();
    expect(caminhoDoAlvo("")).toBeNull();
    expect(caminhoDoAlvo("exemplo.com:443")).toBeNull();
  });
});

describe("normalizarCaminho", () => {
  it("tira query e fragmento, junta barras e resolve ponto-ponto", () => {
    expect(normalizarCaminho("/a//b///c?x=//y")).toBe("/a/b/c");
    expect(normalizarCaminho("/a/./b/../c#f")).toBe("/a/c");
    expect(normalizarCaminho("/../../.env")).toBe("/.env");
    expect(normalizarCaminho("/a/b/..")).toBe("/a/");
    expect(normalizarCaminho("/api/webhook/")).toBe("/api/webhook/");
  });

  it("decodifica %xx uma vez só", () => {
    expect(normalizarCaminho("/%2e%65nv")).toBe("/.env");
    expect(normalizarCaminho("/%252e%2565nv")).toBe("/%2e%65nv");
    expect(normalizarCaminho("/a%2f..%2f.env")).toBe("/.env");
    expect(normalizarCaminho("/caf%C3%A9")).toBe("/café");
  });

  it("%xx malformado fica cru, o resto decodifica", () => {
    expect(normalizarCaminho("/%E0%A4%A/x")).toBe("/%E0%A4%A/x");
    expect(normalizarCaminho("/%2e%65nv%")).toBe("/.env%");
    expect(normalizarCaminho("/%zz/%41")).toBe("/%zz/A");
  });

  it("barra invertida conta como barra", () => {
    expect(normalizarCaminho("/\\.env")).toBe("/.env");
    expect(normalizarCaminho("/%5c.git%5cconfig")).toBe("/.git/config");
  });

  it("mantém maiúsculas", () => {
    expect(normalizarCaminho("/API/Webhook")).toBe("/API/Webhook");
  });
});

describe("dominioDoHost", () => {
  it("minúsculo, sem porta, só letras, números, ponto e hífen, até 100", () => {
    expect(dominioDoHost("SeuSite.com.BR:8443")).toBe("seusite.com.br");
    expect(dominioDoHost("seusite.com.br\r\nX: y")).toBe("seusite.com.brxy");
    expect(dominioDoHost("a".repeat(150))).toBe("a".repeat(100));
    expect(dominioDoHost(undefined)).toBe("desconhecido");
    expect(dominioDoHost("")).toBe("desconhecido");
    expect(dominioDoHost(":80")).toBe("desconhecido");
  });
});

describe("ehNavegacao e ehMidia", () => {
  it("navegação é GET com accept contendo text/html", () => {
    expect(ehNavegacao("GET", "text/html,application/xhtml+xml")).toBe(true);
    expect(ehNavegacao("get", "TEXT/HTML")).toBe(true);
    expect(ehNavegacao("POST", "text/html")).toBe(false);
    expect(ehNavegacao("GET", "*/*")).toBe(false);
    expect(ehNavegacao("GET", undefined)).toBe(false);
  });

  it("mídia é imagem, fonte ou ícone pela extensão", () => {
    for (const c of ["/og.png", "/a.JPG", "/b.jpeg", "/c.gif", "/d.webp", "/e.avif", "/f.svg", "/favicon.ico", "/g.woff", "/h.woff2"]) {
      expect(ehMidia(c), c).toBe(true);
    }
    for (const c of ["/app.js", "/", "/png", "/a.png.js", "/x.css", "/.png/x"]) expect(ehMidia(c), c).toBe(false);
  });
});
