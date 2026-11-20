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


// DIAGNÓSTICO TEMPORÁRIO (sai no próximo commit): números da sonda de CDP nesta máquina.
const PAGINA_DIAG = `<!doctype html><meta charset="utf-8"><body><script>
var linhas = [], tabela = {};
for (var i = 0; i < 1000; i++) { linhas.push({ a: i, b: "x" + i, c: i % 7 }); tabela[i] = linhas[i]; }
var agora = function () { return performance.now(); };
var res = [];
for (var r = 0; r < 5; r++) {
  var t0 = agora(), voltas = 0, tempos = [];
  do { var tv = agora(); JSON.parse(JSON.stringify(linhas)); tempos.push(agora() - tv); voltas++; } while (agora() - t0 < 2 && voltas < 200);
  var media = (agora() - t0) / voltas, min = Math.min.apply(null, tempos);
  var c = []; for (var k = 0; k < 2; k++) { var t1 = agora(); console.table(tabela); c.push(agora() - t1); }
  res.push([voltas, +media.toFixed(3), +min.toFixed(3), +tempos[0].toFixed(3), +c[0].toFixed(2), +c[1].toFixed(2)]);
}
fetch("/r", { method: "POST", body: JSON.stringify({ res: res, ua: navigator.userAgent, nucleos: navigator.hardwareConcurrency }) });
</script>`;

describe.skipIf(!CHROME)("diagnóstico da sonda", () => {
  it("mede base e custo com e sem Runtime.enable", async () => {
    const saida: Record<string, unknown[]> = { cdp: [], limpo: [] };
    for (let i = 0; i < 8; i++) {
      const a = await abrir(PAGINA_DIAG, ["Runtime.enable"]);
      saida.cdp!.push(a?.corpo ?? null);
      const b = await abrir(PAGINA_DIAG, null);
      saida.limpo!.push(b?.corpo ?? null);
    }
    throw new Error("DIAG " + JSON.stringify(saida));
  }, 300_000);
});
