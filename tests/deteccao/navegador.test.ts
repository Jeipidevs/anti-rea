import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { avaliarNavegador, type SinaisNavegador } from "../../src/deteccao/navegador/avaliar.js";
import { COLETOR, conferirNonce, criarNonce, paginaDesafio } from "../../src/deteccao/navegador/desafio.js";
import { scriptGuarda } from "../../src/deteccao/navegador/guarda.js";

const PASTA = new URL("../fixtures/", import.meta.url);

function fx(nome: string): SinaisNavegador {
  const { manual: _manual, origem: _origem, ...sinais } = JSON.parse(readFileSync(new URL(`sinais/${nome}.json`, PASTA), "utf8"));
  return sinais as SinaisNavegador;
}

const op = { devtoolsIsCaught: true };

describe("avaliarNavegador", () => {
  it("deixa passar navegador de verdade", () => {
    for (const f of ["chrome", "firefox-rfp", "safari", "brave", "android-webview-desktop"]) expect(avaliarNavegador(fx(f), op)).toBeNull();
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
  it("vigia com a aba visível, posta para /.anti-rea/pego e só recarrega com 204", () => {
    // A política (intervalo, visibilidade, recuo, pausa) é testada rodando o script: guarda.test.ts.
    const js = scriptGuarda();
    expect(js).toContain("/.anti-rea/pego");
    expect(js).toContain('visibilityState==="visible"');
    expect(js).toContain("visibilitychange");
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

// Ambiente de navegador falso para rodar o coletor e o script da tela de desafio em node:vm.
type Ambiente = {
  ua: string;
  plugins?: number;
  chrome?: object;
  userAgentData?: object;
  maxTouchPoints?: number;
  cookieEnabled?: boolean;
  armazenamento?: Map<string, string> | "bloqueado";
  nome?: string;
  resposta?: { ok: boolean; status: number };
  agora?: number;
  linguas?: string[];
  /** `console.table` que parece nativo (função ligada): o coletor só imprime a tabela assim. */
  tabela?: (linhas: unknown) => void;
};

function rodar(codigo: string, a: Ambiente) {
  const armazenamento = a.armazenamento ?? new Map<string, string>();
  const registro = { fetches: 0, recargas: 0, texto: "" };
  const sessionStorage = {
    getItem: (k: string) => {
      if (armazenamento === "bloqueado") throw new Error("SecurityError");
      return armazenamento.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (armazenamento === "bloqueado") throw new Error("SecurityError");
      armazenamento.set(k, String(v));
    },
  };
  const caixa: Record<string, unknown> = {
    navigator: {
      userAgent: a.ua,
      webdriver: false,
      languages: a.linguas ?? ["pt-BR"],
      plugins: { length: a.plugins ?? 0 },
      userAgentData: a.userAgentData,
      maxTouchPoints: a.maxTouchPoints ?? 0,
      cookieEnabled: a.cookieEnabled ?? true,
    },
    chrome: a.chrome,
    outerWidth: 1200,
    innerWidth: 1200,
    outerHeight: 800,
    innerHeight: 800,
    name: a.nome ?? "",
    performance: { now: () => 0 },
    console: { table: a.tabela ? a.tabela.bind(null) : () => {} },
    Date: { now: () => a.agora ?? 1_000_000 },
    document: { getElementById: () => ({ set textContent(t: string) { registro.texto = t; } }) },
    location: { reload: () => { registro.recargas++; } },
    fetch: () => {
      registro.fetches++;
      return Promise.resolve(a.resposta ?? { ok: true, status: 200 });
    },
  };
  Object.defineProperty(caixa, "sessionStorage", { get: () => sessionStorage });
  caixa.window = caixa;
  const resultado = vm.runInContext(codigo, vm.createContext(caixa));
  return { resultado, registro, caixa };
}

function scriptDaPagina(html: string): string {
  return /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
}

const UA_DESKTOP_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Safari/537.36";

describe("coletor em celular no modo computador", () => {
  const coletar = (a: Ambiente) => rodar(`(${COLETOR})("n", false)`, a).resultado as SinaisNavegador;

  it("WebView do Android (DuckDuckGo) com UA de computador não é Chrome falso", () => {
    const comDicas = coletar({
      ua: UA_DESKTOP_LINUX,
      userAgentData: { brands: [{ brand: "Android WebView", version: "157" }], mobile: false, platform: "Android" },
      maxTouchPoints: 5,
    });
    expect(comDicas.uaChrome).toBe(false);
    expect(avaliarNavegador(comDicas, op)).toBeNull();
    expect(avaliarNavegador(comDicas, { devtoolsIsCaught: false })).toBeNull();

    const soPlataforma = coletar({ ua: UA_DESKTOP_LINUX, userAgentData: { brands: [], mobile: false, platform: "Android" } });
    expect(avaliarNavegador(soPlataforma, op)).toBeNull();
    const soMovel = coletar({ ua: UA_DESKTOP_LINUX, userAgentData: { brands: [], mobile: true, platform: "" } });
    expect(avaliarNavegador(soMovel, op)).toBeNull();
    const soToque = coletar({ ua: UA_DESKTOP_LINUX, maxTouchPoints: 5 });
    expect(avaliarNavegador(soToque, op)).toBeNull();
  });

  it("a fixture do WebView no modo computador bate com o coletor", () => {
    const s = coletar({
      ua: UA_DESKTOP_LINUX,
      userAgentData: { brands: [{ brand: "Android WebView", version: "157" }], mobile: false, platform: "Android" },
      maxTouchPoints: 5,
      linguas: ["pt-BR", "pt", "en-US", "en"],
    });
    const { nonce: _n, ...gravado } = fx("android-webview-desktop");
    const { nonce: _m, ...coletado } = s;
    expect(coletado).toEqual(gravado);
  });

  it("Chrome falso de computador, sem toque e sem dica de celular, continua pego", () => {
    const s = coletar({ ua: UA_DESKTOP_LINUX });
    expect(s.uaChrome).toBe(true);
    expect(avaliarNavegador(s, op)?.motivo).toBe("Chrome falso");
  });
});

describe("coletor com memo (Task 13)", () => {
  it("com o mesmo memo monta as 1000 linhas uma vez; sem memo, monta a cada chamada", () => {
    // O Chrome guarda os argumentos do console mesmo com o DevTools fechado: tabela nova a cada
    // volta da guarda retinha uns 7,5 MB (docs/_medicoes/2026-11-guarda.md).
    const tabelas: unknown[] = [];
    const codigo = `var c = (${COLETOR}); var memo = {}; [c("", false, memo), c("", false, memo), c("", false)]`;
    rodar(codigo, { ua: UA_DESKTOP_LINUX, chrome: {}, plugins: 5, tabela: (x) => tabelas.push(x) });
    expect(tabelas).toHaveLength(6);
    expect(Object.keys(tabelas[0] as object)).toHaveLength(1000);
    expect(tabelas[2]).toBe(tabelas[0]);
    expect(tabelas[3]).toBe(tabelas[0]);
    expect(tabelas[4]).not.toBe(tabelas[0]);
  });

  it("a tabela é um objeto simples: o texto que o Chrome guarda dela é curto", () => {
    // Mesmo com o DevTools fechado, o V8 transforma cada argumento do console em texto e guarda a
    // mensagem (até 10 MiB por página). Lista de 1000 linhas vira "[object Object]," 1000 vezes
    // (16 mil caracteres); objeto simples vira "[object Object]". A prévia linha por linha, que só
    // existe com Runtime.enable e é o que a sonda mede, continua igual (tests/e2e/coletor-cdp.test.ts).
    const tabelas: unknown[] = [];
    rodar(`(${COLETOR})("", false, {})`, { ua: UA_DESKTOP_LINUX, chrome: {}, plugins: 5, tabela: (x) => tabelas.push(x) });
    expect(tabelas).toHaveLength(2);
    const t = tabelas[0] as Record<string, unknown>;
    expect(Array.isArray(t)).toBe(false);
    expect(Object.prototype.toString.call(t)).toBe("[object Object]");
    expect(String(t)).toBe("[object Object]");
    expect(Object.keys(t)).toHaveLength(1000);
    expect(t[999]).toEqual({ a: 999, b: "x999", c: 5 });
  });
});

describe("sonda de pausa opcional", () => {
  const n = criarNonce("s", 1_000);

  it("tela de desafio: com sondarPausa false não leva o debugger", () => {
    const sem = paginaDesafio({ nonce: n, previa: {}, idioma: "pt-BR", sondarPausa: false });
    expect(sem).not.toMatch(/\bdebugger\b/);
    expect(sem).toContain(JSON.stringify(n) + ",false)");
    const padrao = paginaDesafio({ nonce: n, previa: {}, idioma: "pt-BR" });
    expect(padrao).toMatch(/\bdebugger\b/);
    expect(padrao).toContain(JSON.stringify(n) + ",true)");
    expect(paginaDesafio({ nonce: n, previa: {}, idioma: "pt-BR", sondarPausa: true })).toBe(padrao);
  });

  it("guarda: com sondarPausa false não leva o debugger nem sonda a pausa", () => {
    const sem = scriptGuarda({ sondarPausa: false });
    expect(sem).not.toMatch(/\bdebugger\b/);
    expect(sem).toContain("var pausa=false;");
    expect(() => new Function(sem)).not.toThrow();
    expect(scriptGuarda()).toMatch(/\bdebugger\b/);
    expect(scriptGuarda({ sondarPausa: true })).toBe(scriptGuarda());
  });

  it("sem a sonda, a coleta continua igual", () => {
    const html = paginaDesafio({ nonce: n, previa: {}, idioma: "pt-BR", sondarPausa: false });
    expect(html).toContain("console.table(tabela)");
    expect(scriptGuarda({ sondarPausa: false })).toContain("console.table(tabela)");
  });
});

describe("tela de desafio sem laço de recarga", () => {
  const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
  const pagina = (idioma: "pt-BR" | "en" = "pt-BR") => scriptDaPagina(paginaDesafio({ nonce: "x", previa: {}, idioma }));
  const esperar = () => new Promise((r) => setTimeout(r, 0));

  it("com cookies desligados avisa e não posta", async () => {
    const { registro } = rodar(pagina(), { ua: UA_MAC, chrome: {}, plugins: 5, cookieEnabled: false });
    await esperar();
    expect(registro.fetches).toBe(0);
    expect(registro.recargas).toBe(0);
    expect(registro.texto).toMatch(/cookies/);
    const en = rodar(pagina("en"), { ua: UA_MAC, chrome: {}, plugins: 5, cookieEnabled: false });
    expect(en.registro.texto).toMatch(/cookies/);
  });

  it("se o passe não gruda, para depois de duas tentativas e mostra a falha", async () => {
    const armazenamento = new Map<string, string>();
    let fetches = 0, recargas = 0, texto = "";
    for (let i = 0; i < 10; i++) {
      const { registro } = rodar(pagina(), { ua: UA_MAC, chrome: {}, plugins: 5, armazenamento, agora: 1_000_000 + i * 100 });
      await esperar();
      fetches += registro.fetches;
      recargas += registro.recargas;
      if (registro.recargas === 0) { texto = registro.texto; break; }
    }
    expect(fetches).toBe(2);
    expect(recargas).toBe(2);
    expect(texto).toBe("Não foi possível verificar. Recarregue a página.");
  });

  it("sem sessionStorage, conta pelo window.name e também para", async () => {
    let nome = "", fetches = 0, parou = false;
    for (let i = 0; i < 10; i++) {
      const { registro, caixa } = rodar(pagina(), { ua: UA_MAC, chrome: {}, plugins: 5, armazenamento: "bloqueado", nome, agora: 1_000_000 + i * 100 });
      await esperar();
      fetches += registro.fetches;
      nome = String(caixa.name);
      if (registro.recargas === 0) { parou = true; break; }
    }
    expect(parou).toBe(true);
    expect(fetches).toBe(2);
  });

  it("tentativa antiga não conta: o passe que vence depois de horas passa de novo", async () => {
    const armazenamento = new Map<string, string>();
    for (const agora of [1_000_000, 5_000_000, 9_000_000, 13_000_000]) {
      const { registro } = rodar(pagina(), { ua: UA_MAC, chrome: {}, plugins: 5, armazenamento, agora });
      await esperar();
      expect(registro.fetches).toBe(1);
      expect(registro.recargas).toBe(1);
    }
  });

  it("só recarrega com resposta 2xx; 400 mostra a falha", async () => {
    const { registro } = rodar(pagina(), { ua: UA_MAC, chrome: {}, plugins: 5, resposta: { ok: false, status: 400 } });
    await esperar();
    expect(registro.fetches).toBe(1);
    expect(registro.recargas).toBe(0);
    expect(registro.texto).toBe("Não foi possível verificar. Recarregue a página.");
  });
});
