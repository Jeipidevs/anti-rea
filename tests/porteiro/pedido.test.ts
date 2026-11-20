import { describe, expect, it } from "vitest";
import {
  caminhoAmbiguo,
  caminhoDoAlvo,
  caminhoLiteral,
  caminhoParaORegistro,
  dominioDoHost,
  ehMidia,
  ehNavegacao,
  normalizarCaminho,
} from "../../src/porteiro/pedido.js";

describe("caminhoParaORegistro", () => {
  it("troca o valor de cada parâmetro da query por ... e deixa os nomes", () => {
    expect(caminhoParaORegistro("/entrar?token=abc123&email=a%40b.com")).toBe("/entrar?token=...&email=...");
    expect(caminhoParaORegistro("/senha/nova?codigo=9f8e7d&passo=2")).toBe("/senha/nova?codigo=...&passo=...");
    expect(caminhoParaORegistro("/x?a=b=c")).toBe("/x?a=...");
    expect(caminhoParaORegistro("/x?a=1&&b=2")).toBe("/x?a=...&&b=...");
  });

  it("valor vazio, nome sem valor e caminho sem query ficam como vieram", () => {
    expect(caminhoParaORegistro("/x?a=&b")).toBe("/x?a=&b");
    expect(caminhoParaORegistro("/x?")).toBe("/x?");
    expect(caminhoParaORegistro("/.env")).toBe("/.env");
    expect(caminhoParaORegistro("/a%3Fb=1")).toBe("/a%3Fb=1");
  });
});

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

  it("tira o parâmetro de matriz (;...) de cada segmento antes de resolver ponto-ponto, como Tomcat e Jetty", () => {
    expect(normalizarCaminho("/api/webhook/..;/app.js")).toBe("/api/app.js");
    expect(normalizarCaminho("/app.js;.png")).toBe("/app.js");
    expect(normalizarCaminho("/.git;/config")).toBe("/.git/config");
    expect(normalizarCaminho("/pagina;jsessionid=ABC")).toBe("/pagina");
    expect(normalizarCaminho("/;x/.env")).toBe("/.env");
  });
});

describe("caminhoAmbiguo", () => {
  it("ponto-ponto, ponto ou barra invertida em qualquer forma deixam o caminho ambíguo", () => {
    for (const c of [
      "/x/../y",
      "/x/./y",
      "/x/..",
      "/x/%2e%2e/y",
      "/x/.%2E/y",
      "/api/webhook/a%2fb%2fc/../../../app.js",
      "/api/webhook/a%2f..%2f..%2fapp.js",
      "/api/webhook/..;/app.js",
      "/api/webhook/.;x/app.js",
      "/a\\b",
      "/a%5c..%5cb",
    ]) {
      expect(caminhoAmbiguo(c), c).toBe(true);
    }
  });

  it("caminho comum, %2F sem ponto-ponto, barra dobrada, parâmetro de matriz e query não são ambíguos", () => {
    for (const c of ["/", "/a/b", "/a/b/", "/a;jsessionid=1/b", "/a%2Fb", "//a", "/a?x=../..", "/arquivo..txt", "/...", "/.well-known/x"]) {
      expect(caminhoAmbiguo(c), c).toBe(false);
    }
  });
});

describe("caminhoLiteral", () => {
  it("decodifica %xx uma vez sem criar separador, não junta barras nem tira parâmetro de matriz", () => {
    expect(caminhoLiteral("/api%2Fwebhook%2Fx")).toBe("/api%2Fwebhook%2Fx");
    expect(caminhoLiteral("/api%5cwebhook")).toBe("/api%5Cwebhook");
    expect(caminhoLiteral("/a//b")).toBe("/a//b");
    expect(caminhoLiteral("/caf%C3%A9?x=1")).toBe("/café");
    expect(caminhoLiteral("/a;b/c")).toBe("/a;b/c");
    expect(caminhoLiteral("/%E0%A4%A/x")).toBe("/%E0%A4%A/x");
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
    // Conferida sempre no caminho normalizado: o parâmetro de matriz já saiu.
    expect(ehMidia(normalizarCaminho("/app.js;.png"))).toBe(false);
  });
});
