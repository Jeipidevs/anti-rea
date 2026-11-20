// Prova empírica do coletor e da guarda num Chrome de verdade (Chrome 157 na gravação):
// sem cliente de depuração nada pega; com Runtime.enable pega `cdp`; com o Debugger parando
// no `debugger;` pega `devtoolsAberto` (F12), nunca `cdp`.
// Pula quando não há Chrome na máquina (CHROME_PATH muda o caminho). Roda com `npm run test:e2e`.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { avaliarNavegador, type SinaisNavegador } from "../../src/deteccao/navegador/avaliar.js";
import { COLETOR, paginaDesafio } from "../../src/deteccao/navegador/desafio.js";
import { scriptGuarda } from "../../src/deteccao/navegador/guarda.js";
import { argsDoChrome } from "./abrir-navegador.js";

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((c): c is string => !!c && existsSync(c));

const UA_NORMAL =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";

type Medida = SinaisNavegador & { ms: number };

/** Página que roda o coletor uma vez, como a tela de desafio, e posta o resultado em /r. */
const PAGINA_COLETOR = `<!doctype html><meta charset="utf-8"><body><script>
var t0 = performance.now();
var s = (${COLETOR})("teste", true);
s.ms = performance.now() - t0;
fetch("/r", { method: "POST", body: JSON.stringify(s) });
</script>`;

/** Página com a guarda, como o porteiro injeta no site real. */
const PAGINA_GUARDA = `<!doctype html><meta charset="utf-8"><body><p>site</p><script>${scriptGuarda()}</script>`;
/** Guarda com `devtoolsIsCaught: false` (sem a sonda de pausa). */
const PAGINA_GUARDA_SEM_PAUSA = `<!doctype html><meta charset="utf-8"><body><p>site</p><script>${scriptGuarda({ sondarPausa: false })}</script>`;

function limite<T>(p: Promise<T>, ms: number, rotulo: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, erro) => setTimeout(() => erro(new Error("tempo esgotado: " + rotulo)), ms))]);
}

/** Servidor local: entrega a página e guarda o primeiro POST (em /r ou /.anti-rea/pego). */
function servidor(pagina: string): Promise<{ url: string; post: Promise<{ caminho: string; corpo: Medida }>; fechar: () => void }> {
  return new Promise((pronto) => {
    let entregar!: (p: { caminho: string; corpo: Medida }) => void;
    const post = new Promise<{ caminho: string; corpo: Medida }>((r) => (entregar = r));
    const s = http.createServer((req, res) => {
      if (req.method === "POST") {
        let corpo = "";
        req.on("data", (d) => (corpo += d));
        req.on("end", () => {
          res.statusCode = req.url === "/.anti-rea/pego" ? 204 : 200;
          res.end();
          entregar({ caminho: req.url ?? "", corpo: JSON.parse(corpo) });
        });
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(pagina);
    });
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      pronto({ url: `http://127.0.0.1:${port}/`, post, fechar: () => s.close() });
    });
  });
}

/**
 * Abre o Chrome sem tela e espera o primeiro POST da página (ou `null` depois de `esperaMs`).
 * `dominios === null`: a página vem pela linha de comando e nenhum cliente se conecta (linha de
 * base limpa). Senão, um cliente CDP cru liga cada domínio antes de navegar e retoma o Debugger
 * 150 ms depois de cada pausa.
 */
type Comando = string | [string, object];

async function abrir(pagina: string, dominios: Comando[] | null, esperaMs = 20_000) {
  const srv = await servidor(pagina);
  const perfil = mkdtempSync(join(tmpdir(), "anti-rea-e2e-"));
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check"];
  const p = spawn(CHROME!, [...argsDoChrome(args), dominios ? "about:blank" : srv.url], { stdio: ["ignore", "ignore", "pipe"] });
  let ws: WebSocket | undefined;
  try {
    const porta = await limite(
      new Promise<string>((ok) => {
        let buf = "";
        p.stderr!.on("data", (d) => {
          buf += d;
          const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
          if (m) ok(m[1]!);
        });
      }),
      15_000,
      "porta de depuração",
    );
    if (dominios) {
      const alvos = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const cliente = new WebSocket(alvos.find((a) => a.type === "page")!.webSocketDebuggerUrl);
      ws = cliente;
      await limite(new Promise((ok) => cliente.addEventListener("open", ok)), 5_000, "websocket");
      let id = 0;
      const pendentes = new Map<number, () => void>();
      const mandar = (method: string, params: object = {}) => {
        cliente.send(JSON.stringify({ id: ++id, method, params }));
        return id;
      };
      cliente.addEventListener("message", (ev) => {
        const m = JSON.parse(String(ev.data));
        if (m.id && pendentes.has(m.id)) {
          pendentes.get(m.id)!();
          pendentes.delete(m.id);
        }
        if (m.method === "Debugger.paused") setTimeout(() => mandar("Debugger.resume"), 150);
      });
      for (const d of dominios) {
        const [metodo, params] = typeof d === "string" ? [d, {}] : d;
        const n = mandar(metodo, params);
        await limite(new Promise<void>((ok) => pendentes.set(n, ok)), 5_000, metodo);
      }
      mandar("Page.navigate", { url: srv.url });
    }
    return await Promise.race([srv.post, new Promise<null>((ok) => setTimeout(() => ok(null), esperaMs))]);
  } finally {
    ws?.close();
    p.kill("SIGKILL");
    srv.fechar();
    await new Promise((ok) => setTimeout(ok, 300));
    rmSync(perfil, { recursive: true, force: true });
  }
}

async function coletar(dominios: Comando[] | null): Promise<Medida> {
  const r = await abrir(PAGINA_COLETOR, dominios);
  if (!r) throw new Error("a página não respondeu");
  return r.corpo;
}

describe.skipIf(!CHROME)("coletor num Chrome de verdade", () => {
  it("sem cliente de depuração: nada pega e a coleta cabe na tela de menos de um segundo", async () => {
    for (let i = 0; i < 3; i++) {
      const s = await coletar(null);
      expect(s.cdp, JSON.stringify(s)).toBe(false);
      expect(s.devtoolsAberto).toBe(false);
      // Medido no Mac de 2026 com carga alta: 9 a 46 ms na primeira coleta, uns 4 ms nas seguintes; na
      // CI de 4 núcleos, com a suíte em paralelo, 225 ms. O limite é o da tela: a coleta, o envio e a
      // recarga cabem em menos de 1 s.
      expect(s.ms, JSON.stringify(s)).toBeLessThan(500);
    }
  }, 90_000);

  it("CPU 6 vezes mais lenta (celular fraco) sem depuração não pega", async () => {
    for (let i = 0; i < 3; i++) {
      const s = await coletar([["Emulation.setCPUThrottlingRate", { rate: 6 }]]);
      expect(s.cdp, JSON.stringify(s)).toBe(false);
      expect(s.devtoolsAberto).toBe(false);
    }
  }, 90_000);

  it("CPU 6 vezes mais lenta com Runtime.enable ainda pega cdp", async () => {
    const s = await coletar([["Emulation.setCPUThrottlingRate", { rate: 6 }], "Runtime.enable"]);
    expect(s.cdp, JSON.stringify(s)).toBe(true);
  }, 30_000);

  it("cliente conectado sem domínio ligado não pega", async () => {
    const s = await coletar([]);
    expect(s.cdp, JSON.stringify(s)).toBe(false);
    expect(s.devtoolsAberto).toBe(false);
  }, 30_000);

  it("Runtime.enable (automação, REA) pega cdp", async () => {
    for (let i = 0; i < 3; i++) {
      const s = await coletar(["Runtime.enable"]);
      expect(s.cdp, JSON.stringify(s)).toBe(true);
      expect(s.devtoolsAberto).toBe(false);
    }
  }, 90_000);

  it("Debugger parando no debugger; é F12, nunca cdp", async () => {
    const soDebugger = await coletar(["Debugger.enable"]);
    expect(soDebugger.devtoolsAberto).toBe(true);
    expect(soDebugger.cdp).toBe(false);
    const comoF12 = await coletar(["Runtime.enable", "Debugger.enable"]);
    expect(comoF12.devtoolsAberto).toBe(true);
    expect(comoF12.cdp).toBe(false);
    // O Chrome deste teste é sem tela e tem porta de depuração (webdriver true); a pessoa com F12 não.
    const pessoaComF12 = { ...comoF12, webdriver: false, headlessUA: false };
    expect(avaliarNavegador(pessoaComF12, { devtoolsIsCaught: false })).toBeNull();
    expect(avaliarNavegador(pessoaComF12, { devtoolsIsCaught: true })?.motivo).toBe("ferramentas de desenvolvedor abertas");
  }, 60_000);

  it("Playwright disfarçado (sem webdriver nem HeadlessChrome) cai por depuração remota", async () => {
    const srv = await servidor(PAGINA_COLETOR);
    const navegador = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      ignoreDefaultArgs: ["--enable-automation"],
      args: argsDoChrome(["--disable-blink-features=AutomationControlled"]),
      timeout: 20_000,
    });
    try {
      const pagina = await (await navegador.newContext({ userAgent: UA_NORMAL })).newPage();
      void pagina.goto(srv.url).catch(() => {});
      const { corpo } = await limite(srv.post, 20_000, "playwright");
      expect(corpo.webdriver).toBe(false);
      expect(corpo.headlessUA).toBe(false);
      expect(avaliarNavegador(corpo, { devtoolsIsCaught: true })?.motivo).toBe("depuração remota ativa");
    } finally {
      await limite(navegador.close(), 10_000, "fechar playwright").catch(() => {});
      srv.fechar();
    }
  }, 60_000);
});

describe.skipIf(!CHROME)("guarda num Chrome de verdade", () => {
  it("sem cliente de depuração não avisa", async () => {
    expect(await abrir(PAGINA_GUARDA, null, 4_000)).toBeNull();
  }, 30_000);

  it("Runtime.enable avisa em /.anti-rea/pego com cdp", async () => {
    const r = await abrir(PAGINA_GUARDA, ["Runtime.enable"], 10_000);
    expect(r?.caminho).toBe("/.anti-rea/pego");
    expect(r?.corpo.cdp).toBe(true);
  }, 30_000);

  it("Debugger parando avisa em /.anti-rea/pego com devtoolsAberto", async () => {
    const r = await abrir(PAGINA_GUARDA, ["Debugger.enable"], 10_000);
    expect(r?.caminho).toBe("/.anti-rea/pego");
    expect(r?.corpo.devtoolsAberto).toBe(true);
    expect(r?.corpo.cdp).toBe(false);
  }, 30_000);
});

/**
 * Abre a página num Chrome sem tela e sem cliente de depuração, com o log do Chrome no stderr, e
 * devolve as linhas CONSOLE (o texto de cada mensagem do console que o Chrome guarda e repassa).
 */
async function linhasDoConsole(pagina: string, ms: number): Promise<string[]> {
  const srv = await servidor(pagina);
  const perfil = mkdtempSync(join(tmpdir(), "anti-rea-e2e-"));
  const args = ["--headless=new", `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check", "--enable-logging=stderr", "--v=0"];
  const p = spawn(CHROME!, [...argsDoChrome(args), srv.url], { stdio: ["ignore", "ignore", "pipe"] });
  let saida = "";
  p.stderr!.on("data", (d) => (saida += d));
  try {
    await new Promise((ok) => setTimeout(ok, ms));
    return saida.split("\n").filter((l) => l.includes(":CONSOLE"));
  } finally {
    p.kill("SIGKILL");
    srv.fechar();
    await new Promise((ok) => setTimeout(ok, 300));
    rmSync(perfil, { recursive: true, force: true });
  }
}

/** Página que anima a cada quadro gastando 40 ms (canvas pesado, celular fraco): sem tempo ocioso. */
const PAGINA_OCUPADA = `<!doctype html><meta charset="utf-8"><body><p>site</p><script>
function quadro() { var t = performance.now(); while (performance.now() - t < 40) {} requestAnimationFrame(quadro); }
requestAnimationFrame(quadro);
</script><script>${scriptGuarda()}</script>`;

/**
 * Abre a página com um cliente CDP conectado e sem domínio ligado, liga o Runtime.enable só de
 * `de` a `ate` ms depois da entrega da página e desliga. Devolve o aviso da guarda, ou null.
 */
async function janelaDeRuntime(pagina: string, de: number, ate: number): Promise<{ corpo: Medida; ms: number } | null> {
  let entregue = 0;
  let entregar!: (r: { corpo: Medida; ms: number }) => void;
  const aviso = new Promise<{ corpo: Medida; ms: number }>((r) => (entregar = r));
  const s = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", () => {
      if (req.method === "POST") {
        res.statusCode = 200;
        res.end();
        if (req.url === "/.anti-rea/pego") entregar({ corpo: JSON.parse(corpo), ms: Date.now() - entregue });
        return;
      }
      entregue = Date.now();
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(pagina);
    });
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const { port } = s.address() as { port: number };
  const perfil = mkdtempSync(join(tmpdir(), "anti-rea-e2e-"));
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check"];
  const p = spawn(CHROME!, [...argsDoChrome(args), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let ws: WebSocket | undefined;
  try {
    const porta = await limite(
      new Promise<string>((ok) => {
        let buf = "";
        p.stderr!.on("data", (d) => {
          buf += d;
          const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
          if (m) ok(m[1]!);
        });
      }),
      15_000,
      "porta de depuração",
    );
    const alvos = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const cliente = new WebSocket(alvos.find((a) => a.type === "page")!.webSocketDebuggerUrl);
    ws = cliente;
    await limite(new Promise((ok) => cliente.addEventListener("open", ok)), 5_000, "websocket");
    let id = 0;
    const mandar = (method: string) => cliente.send(JSON.stringify({ id: ++id, method, params: method === "Page.navigate" ? { url: `http://127.0.0.1:${port}/` } : {} }));
    mandar("Page.navigate");
    await limite(
      (async () => {
        while (!entregue) await new Promise((ok) => setTimeout(ok, 10));
      })(),
      10_000,
      "página entregue",
    );
    await new Promise((ok) => setTimeout(ok, Math.max(0, entregue + de - Date.now())));
    mandar("Runtime.enable");
    await new Promise((ok) => setTimeout(ok, Math.max(0, entregue + ate - Date.now())));
    mandar("Runtime.disable");
    return await Promise.race([aviso, new Promise<null>((ok) => setTimeout(() => ok(null), 3_000))]);
  } finally {
    ws?.close();
    p.kill("SIGKILL");
    s.close();
    await new Promise((ok) => setTimeout(ok, 300));
    rmSync(perfil, { recursive: true, force: true });
  }
}

describe.skipIf(!CHROME)("guarda numa página ocupada num Chrome de verdade", () => {
  it("Runtime.enable por 800 ms (1,3 s a 2,1 s depois da carga) numa página que anima a cada quadro é pego", async () => {
    // A guarda de 1 s esperava o intervalo e depois até mais 1 s pelo tempo ocioso: numa página sem
    // folga conferia em ~1 s e ~3 s e não via essa janela. Com ritmo fixo de 0,5 s (no máximo
    // ~0,65 s entre voltas numa página assim), vê.
    for (let i = 0; i < 2; i++) {
      const r = await janelaDeRuntime(PAGINA_OCUPADA, 1_300, 2_100);
      expect(r?.corpo.cdp).toBe(true);
    }
  }, 60_000);
});

describe.skipIf(!CHROME)("texto que o Chrome guarda do console da guarda", () => {
  it("sem depuração, cada console.table vira texto curto (antes: 16 mil caracteres por chamada)", async () => {
    // O V8 guarda as mensagens do console (com o texto, a 2 bytes por caractere) até 10 MiB por
    // página, mesmo com o DevTools fechado; o Chrome guarda outra cópia e manda o texto ao processo
    // principal. A tabela como lista dava "[object Object]," 1000 vezes por chamada.
    const linhas = await linhasDoConsole(PAGINA_GUARDA, 4_500);
    expect(linhas.length).toBeGreaterThanOrEqual(4);
    for (const l of linhas) expect(l.length).toBeLessThan(400);
  }, 30_000);
});

describe.skipIf(!CHROME)("sonda de pausa desligada num Chrome de verdade", () => {
  it("guarda sem a sonda: com o Debugger ligado (F12) não para nem avisa", async () => {
    expect(await abrir(PAGINA_GUARDA_SEM_PAUSA, ["Debugger.enable"], 7_000)).toBeNull();
  }, 30_000);
});

describe.skipIf(!CHROME)("tela de desafio sem laço de recarga num Chrome de verdade", () => {
  it("passe que nunca gruda: no máximo duas tentativas e a página para na falha", async () => {
    let gets = 0;
    let posts = 0;
    const s = http.createServer((req, res) => {
      if (req.method === "POST") {
        posts++;
        req.resume();
        req.on("end", () => {
          res.setHeader("content-type", "application/json");
          res.end('{"ok":true}');
        });
        return;
      }
      if (req.url === "/") gets++;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(paginaDesafio({ nonce: "x", previa: {}, idioma: "pt-BR", sondarPausa: false }));
    });
    await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
    const { port } = s.address() as { port: number };
    const navegador = await chromium.launch({ executablePath: CHROME, headless: true, args: argsDoChrome(), timeout: 20_000 });
    try {
      const pagina = await navegador.newPage();
      await pagina.goto(`http://127.0.0.1:${port}/`);
      await new Promise((ok) => setTimeout(ok, 3_000));
      expect(posts).toBe(2);
      expect(gets).toBe(3);
      expect(await pagina.textContent("#m")).toBe("Não foi possível verificar. Recarregue a página.");
    } finally {
      await limite(navegador.close(), 10_000, "fechar playwright").catch(() => {});
      s.close();
    }
  }, 40_000);
});
