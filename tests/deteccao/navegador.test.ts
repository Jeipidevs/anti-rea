import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { avaliarNavegador, type SinaisNavegador } from "../../src/deteccao/navegador/avaliar.js";
import { COLETOR, conferirNonce, criarNonce, paginaDesafio } from "../../src/deteccao/navegador/desafio.js";
import { scriptGuarda } from "../../src/deteccao/navegador/guarda.js";

const PASTA = new URL("../fixtures/", import.meta.url);

function fx(nome: string): SinaisNavegador {
  const { manual: _manual, ...sinais } = JSON.parse(readFileSync(new URL(`sinais/${nome}.json`, PASTA), "utf8"));
  return sinais as SinaisNavegador;
}

const op = { devtoolsIsCaught: true };

describe("avaliarNavegador", () => {
  it("deixa passar navegador de verdade", () => {
    for (const f of ["chrome", "firefox-rfp", "safari", "brave"]) expect(avaliarNavegador(fx(f), op)).toBeNull();
  });

  it("pega automação, depuração remota e F12", () => {
    expect(avaliarNavegador(fx("playwright-headless"), op)?.motivo).toMatch(/automatizado|sem tela/);
    expect(avaliarNavegador(fx("chrome-cdp"), op)?.motivo).toBe("depuração remota ativa");
    expect(avaliarNavegador(fx("chrome-devtools"), op)?.motivo).toBe("ferramentas de desenvolvedor abertas");
    expect(avaliarNavegador(fx("chrome-devtools"), { devtoolsIsCaught: false })).toBeNull();
  });

  it("nunca usa window.chrome fora de Chrome", () => {
    expect(avaliarNavegador({ ...fx("firefox-rfp"), temWindowChrome: false, semPlugins: true }, op)).toBeNull();
  });

  it("pega Chrome falso só com os três sinais juntos", () => {
    const base = fx("chrome");
    expect(avaliarNavegador({ ...base, temWindowChrome: false, semPlugins: true }, op)?.motivo).toBe("Chrome falso");
    expect(avaliarNavegador({ ...base, temWindowChrome: false }, op)).toBeNull();
    expect(avaliarNavegador({ ...base, semPlugins: true }, op)).toBeNull();
  });

  it("línguas zeradas sozinhas não pegam", () => {
    expect(avaliarNavegador({ ...fx("chrome"), linguas: 0 }, op)).toBeNull();
  });

  it("todo sinal do navegador é cópia", () => {
    expect(avaliarNavegador({ ...fx("chrome"), webdriver: true }, op)).toEqual({ motivo: "navegador automatizado", gravidade: "copia" });
    expect(avaliarNavegador({ ...fx("chrome"), headlessUA: true }, op)).toEqual({ motivo: "navegador sem tela", gravidade: "copia" });
  });
});

describe("nonce", () => {
  it("vale por 120 s e só com o mesmo segredo", () => {
    const n = criarNonce("s", 1_000);
    expect(conferirNonce("s", n, 100_000)).toBe(true);
    expect(conferirNonce("s", n, 121_000)).toBe(true);
    expect(conferirNonce("s", n, 122_000)).toBe(false);
    expect(conferirNonce("t", n, 2_000)).toBe(false);
  });

  it("recusa nonce adulterado ou malformado", () => {
    const n = criarNonce("s", 1_000);
    const [, aleatorio, assinatura] = n.split(".");
    expect(conferirNonce("s", `90000.${aleatorio}.${assinatura}`, 100_000)).toBe(false);
    expect(conferirNonce("s", "", 1_000)).toBe(false);
    expect(conferirNonce("s", "a.b", 1_000)).toBe(false);
    expect(conferirNonce("s", n, 500)).toBe(false);
    expect(criarNonce("s", 1_000)).not.toBe(n);
  });
});

describe("paginaDesafio", () => {
  const n = criarNonce("s", 1_000);

  it("leva a prévia escapada e posta para /.anti-rea/verificar", () => {
    const html = paginaDesafio({ nonce: n, previa: { titulo: "Loja <X>", imagem: "https://seusite.com.br/og.png" }, idioma: "pt-BR" });
    expect(html).toContain("<title>Loja &lt;X&gt;</title>");
    expect(html).toContain('property="og:image" content="https://seusite.com.br/og.png"');
    expect(html).toContain('property="og:title" content="Loja &lt;X&gt;"');
    expect(html).toContain("/.anti-rea/verificar");
    expect(html).toContain('credentials:"same-origin"');
    expect(html).toContain("location.reload()");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("Verificando seu navegador");
    expect(html).toContain("<noscript>");
    expect(html).toContain(JSON.stringify(n) + ",true)");
  });

  it("escapa aspas e e-comercial na descrição", () => {
    const html = paginaDesafio({ nonce: n, previa: { descricao: `A "melhor" & <b>'única'</b>` }, idioma: "en" });
    expect(html).toContain('name="description" content="A &quot;melhor&quot; &amp; &lt;b&gt;&#39;única&#39;&lt;/b&gt;"');
    expect(html).toContain('property="og:description"');
    expect(html).not.toContain("<b>");
    expect(html).toContain("Checking your browser");
    expect(html).toContain('<html lang="en">');
  });

  it("sem prévia não emite etiquetas og vazias", () => {
    const html = paginaDesafio({ nonce: n, previa: {}, idioma: "pt-BR" });
    expect(html).not.toContain("og:");
    expect(html).toContain("<title>Verificando seu navegador</title>");
  });

  it("não usa recurso externo nem travessão longo", () => {
    const html = paginaDesafio({ nonce: n, previa: { imagem: "https://seusite.com.br/og.png" }, idioma: "pt-BR" });
    const semPrevia = html.replace(/<meta property="og:image"[^>]*>/, "");
    expect(semPrevia).not.toMatch(/https?:\/\//);
    expect(semPrevia).not.toMatch(/\ssrc=|<link/);
    expect(html).not.toContain("\u2014");
    expect(scriptGuarda()).not.toContain("\u2014");
    expect(COLETOR).not.toContain("\u2014");
  });
});

describe("scriptGuarda", () => {
  it("vigia a cada 1,5 s, posta para /.anti-rea/pego e só recarrega com 204", () => {
    const js = scriptGuarda();
    expect(js).toContain("/.anti-rea/pego");
    expect(js).toContain("1500");
    expect(js).toContain("%4===0");
    expect(js).toContain("requestIdleCallback");
    expect(js).toContain("status===204");
    expect(js).toContain('credentials:"same-origin"');
    expect(js).not.toMatch(/https?:\/\//);
  });

  it("usa o mesmo coletor da tela de desafio", () => {
    expect(scriptGuarda()).toContain(COLETOR);
    expect(paginaDesafio({ nonce: "x", previa: {}, idioma: "pt-BR" })).toContain(COLETOR);
  });

  it("o coletor gravado nas fixtures é o mesmo do código", () => {
    expect(readFileSync(new URL("coletor.js", PASTA), "utf8").trim()).toBe(COLETOR.trim());
  });

  it("o coletor é JavaScript válido", () => {
    expect(() => new Function(`return (${COLETOR});`)).not.toThrow();
    expect(() => new Function(scriptGuarda())).not.toThrow();
  });
});
