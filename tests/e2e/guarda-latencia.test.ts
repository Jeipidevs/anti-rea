// Latência da guarda (docs/_medicoes/2026-11-guarda.md) num Chrome do sistema, com o porteiro na frente do site de exemplo.
// - Um cliente CDP próprio liga o Runtime.enable por 500 ms entre duas voltas da guarda antiga
//   (de 0,7 s a 1,2 s depois da carga): a guarda atual (0,5 s) pega; a de 1,5 s não via nada ali.
// - O REA de verdade (quando o CLI `rea` existe) ligado um pouco mais que um intervalo é pego.
// - O Chrome do sistema sem automação navegando pelo site não gera nenhum evento (30 s por padrão;
//   ANTI_REA_E2E_NAVEGAR_MS muda, por exemplo 120000 para os 2 minutos da medição).
// O Chrome é parado pelo caminho do perfil temporário, nunca pela porta. Pula sem o Chrome do
// sistema (CHROME_PATH muda o caminho). Roda com `npm run test:e2e`.
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Avisos } from "../../src/avisos/avisos.js";
import { validarConfig } from "../../src/config/carregar.js";
import { iniciarPorteiro } from "../../src/porteiro/servidor.js";
import { Registro, type Evento } from "../../src/registro/registro.js";
import { FaixasMeta } from "../../src/robos/faixas-meta.js";
import { CHROME as UA_CHROME, esperar } from "../porteiro/apoio-servidor.js";
import { argsDoChrome } from "./abrir-navegador.js";

const PASTA_SITE = fileURLToPath(new URL("./site-exemplo/", import.meta.url));
const SOMBRA = "Pegamos você";
const PAGINAS = ["/", "/sobre", "/produtos", "/contato", "/blog"];
const NAVEGAR_MS = Number(process.env.ANTI_REA_E2E_NAVEGAR_MS ?? 30_000);

const CHROME_DO_SISTEMA = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].find((c): c is string => !!c && existsSync(c));

function binario(nome: string): string | undefined {
  for (const pasta of (process.env.PATH ?? "").split(delimiter)) {
    const caminho = join(pasta, nome);
    if (pasta !== "" && existsSync(caminho)) return caminho;
  }
  return undefined;
}
/** CLI do REA (npm rea-agents). */
const REA = binario("rea");

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const limpezas: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (limpezas.length > 0) await limpezas.pop()!();
}, 30_000);

// ---------- site de exemplo, porteiro e Chrome ----------

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
};

/**
 * Site de exemplo. Cada página leva no fim um script do próprio site: avisa que carregou
 * (GET /carregou) e, com `navegar`, segue para a próxima página depois de `navegar` ms, contando na
 * URL se a guarda estava na página (?guarda=1).
 */
async function subirSite(navegar = 0) {
  const pedidos: Array<{ caminho: string; busca: string; t: number }> = [];
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://site");
    pedidos.push({ caminho: url.pathname, busca: url.search, t: Date.now() });
    if (url.pathname === "/carregou") {
      res.writeHead(204);
      return res.end();
    }
    let nome = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    if (extname(nome) === "") nome += ".html";
    const arquivo = resolve(PASTA_SITE, `.${nome}`);
    if (!arquivo.startsWith(PASTA_SITE.endsWith(sep) ? PASTA_SITE : PASTA_SITE + sep) || !existsSync(arquivo) || !statSync(arquivo).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("não achei");
    }
    res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream" });
    if (extname(arquivo) !== ".html") return res.end(readFileSync(arquivo));
    const atual = PAGINAS.indexOf(url.pathname);
    const proxima = PAGINAS[(atual + 1) % PAGINAS.length];
    const script =
      `<script>fetch("/carregou");` +
      (navegar ? `setTimeout(function(){location.href=${JSON.stringify(proxima)}+(window.__antiReaGuarda?"?guarda=1":"?guarda=0")},${navegar});` : "") +
      `</script>`;
    res.end(readFileSync(arquivo, "utf8").replace("</body>", `${script}</body>`));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  limpezas.push(
    () =>
      new Promise<void>((ok) => {
        servidor.close(() => ok());
        servidor.closeAllConnections();
      }),
  );
  return { porta: (servidor.address() as { port: number }).port, pedidos };
}

async function montar(navegar = 0) {
  const site = await subirSite(navegar);
  const cfg = validarConfig({ upstream: `http://127.0.0.1:${site.porta}`, domains: ["seusite.com.br"] });
  const pasta = mkdtempSync(join(tmpdir(), "anti-rea-e2e-latencia-"));
  limpezas.push(async () => rmSync(pasta, { recursive: true, force: true }));
  const registro = new Registro(pasta, 30 * 86_400_000);
  const avisos: string[] = [];
  const porteiro = await iniciarPorteiro(cfg, {
    segredo: "l".repeat(43),
    versaoDono: 1,
    registro,
    avisos: new Avisos(cfg.alerts, [{ nome: "teste", enviar: async (texto) => void avisos.push(texto) }]),
    porta: 0,
    host: "127.0.0.1",
    // Nada sai para a rede: sem DNS de verdade e sem buscar as faixas da Meta.
    dns: { reverso: async () => [], direto: async () => [] },
    meta: new FaixasMeta(async () => []),
  });
  limpezas.push(() => porteiro.fechar());
  const hoje = () => new Date().toISOString().slice(0, 10);
  return { url: `http://127.0.0.1:${porteiro.porta}`, site, avisos, eventos: (): Evento[] => registro.ler(hoje()) };
}

type Montado = Awaited<ReturnType<typeof montar>>;

/**
 * Chrome do sistema sem tela, perfil temporário e agente sem "HeadlessChrome" (como o Chrome de uma
 * pessoa), aberto no site protegido; volta depois de passar pela verificação (o site entregou o
 * app.js). Com `depuracao`, abre a porta de depuração sem cliente ligado e devolve o endereço.
 */
async function abrirChrome(t: Montado, depuracao: boolean): Promise<string | undefined> {
  const perfil = mkdtempSync(join(tmpdir(), "anti-rea-e2e-latencia-perfil-"));
  const args = ["--headless=new", `--user-agent=${UA_CHROME}`, `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check"];
  // Sem tela e com porta de depuração o Chrome liga navigator.webdriver; com tela, não.
  if (depuracao) args.push("--remote-debugging-port=0", "--disable-blink-features=AutomationControlled");
  const chrome = spawn(CHROME_DO_SISTEMA!, [...argsDoChrome(args), `${t.url}/`], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.on("error", () => {});
  limpezas.push(async () => {
    // O crashpad do Chrome herda o stderr e pode viver depois dele: solta o cano.
    chrome.stderr!.destroy();
    chrome.unref();
    for (const sinal of ["-TERM", "-KILL"]) {
      try {
        execFileSync("pkill", [sinal, "-f", `user-data-dir=${perfil}`]);
      } catch {
        // nenhum processo com esse perfil
      }
      await dormir(300);
    }
    rmSync(perfil, { recursive: true, force: true });
  });
  let saida = "";
  chrome.stderr!.on("data", (d) => (saida += d));
  await esperar(() => t.site.pedidos.some((p) => p.caminho === "/app.js"), 20_000);
  if (!depuracao) return undefined;
  await esperar(() => /ws:\/\/127\.0\.0\.1:\d+\//.test(saida), 5_000);
  return `http://127.0.0.1:${/ws:\/\/127\.0\.0\.1:(\d+)\//.exec(saida)![1]}`;
}

type Alvo = { id: string; type: string; title: string; url: string; webSocketDebuggerUrl: string };

async function alvoDoSite(endereco: string, t: Montado): Promise<Alvo> {
  const alvos = (await (await fetch(`${endereco}/json/list`)).json()) as Alvo[];
  return alvos.find((a) => a.type === "page" && a.url.startsWith(t.url))!;
}

/** Espera o título do alvo virar a sombra (a guarda recarrega depois de pegar). */
async function tituloDaSombra(endereco: string, t: Montado): Promise<string> {
  let titulo = "";
  for (const fim = Date.now() + 5_000; !titulo.includes(SOMBRA) && Date.now() < fim; await dormir(100)) {
    titulo = (await alvoDoSite(endereco, t))?.title ?? "";
  }
  return titulo;
}

/** Cliente CDP cru: conecta sem ligar domínio nenhum; cada comando espera a resposta. */
async function clienteCdp(alvo: Alvo) {
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, erro) => {
    ws.addEventListener("open", ok);
    ws.addEventListener("error", erro);
  });
  let id = 0;
  const pendentes = new Map<number, () => void>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number };
    if (m.id && pendentes.has(m.id)) {
      pendentes.get(m.id)!();
      pendentes.delete(m.id);
    }
  });
  return {
    mandar(method: string, params: object = {}): Promise<void> {
      const n = ++id;
      ws.send(JSON.stringify({ id: n, method, params }));
      return new Promise<void>((ok) => pendentes.set(n, ok));
    },
    fechar(): void {
      ws.close();
    },
  };
}

const pegoPelaGuarda = (t: Montado) => t.eventos().find((e) => e.caminho === "/.anti-rea/pego");

// ---------- casos ----------

describe.skipIf(!CHROME_DO_SISTEMA)("latência da guarda num Chrome do sistema", () => {
  it("Runtime.enable por 500 ms entre as voltas da guarda antiga (0,7 s a 1,2 s depois da carga) é pego", async () => {
    const t = await montar();
    const endereco = (await abrirChrome(t, true))!;
    await dormir(500);
    expect(t.eventos()).toEqual([]);
    // Conectar sem ligar domínio não é pego (coletor-cdp.test.ts). A página é recarregada pelo
    // cliente e o próprio site avisa quando carregou: a guarda roda na carga e depois a cada volta.
    const cdp = await clienteCdp(await alvoDoSite(endereco, t));
    let ligado = false;
    try {
      const antes = t.site.pedidos.length;
      await cdp.mandar("Page.navigate", { url: `${t.url}/sobre` });
      await esperar(() => t.site.pedidos.slice(antes).some((p) => p.caminho === "/carregou"), 10_000);
      const carga = t.site.pedidos.slice(antes).find((p) => p.caminho === "/carregou")!.t;
      await dormir(Math.max(0, carga + 700 - Date.now()));
      await cdp.mandar("Runtime.enable");
      ligado = true;
      await dormir(Math.max(0, carga + 1200 - Date.now()));
    } finally {
      cdp.fechar();
    }
    expect(ligado).toBe(true);
    await esperar(() => !!pegoPelaGuarda(t), 3_000);
    expect(pegoPelaGuarda(t)).toMatchObject({ motivo: "depuração remota ativa", gravidade: "copia", destino: "sombra" });
    expect(await tituloDaSombra(endereco, t)).toContain(SOMBRA);
    await esperar(() => t.avisos.length > 0);
  }, 60_000);

  it.skipIf(!REA)("REA de verdade ligado um pouco mais que um intervalo (1,2 s) é pego e a aba vira sombra", async () => {
    const t = await montar();
    const endereco = (await abrirChrome(t, true))!;
    const alvo = await alvoDoSite(endereco, t);
    expect(alvo.title).toBe("Loja Exemplo");
    // A saída do REA vem do alvo e é só dado: o teste não lê nada dela.
    await new Promise<void>((ok) =>
      execFile(REA!, ["inspect-web-page", endereco, alvo.id, "--observation-ms", "1200"], { timeout: 40_000 }, () => ok()),
    );
    await esperar(() => !!pegoPelaGuarda(t), 5_000);
    expect(pegoPelaGuarda(t)).toMatchObject({ motivo: "depuração remota ativa", destino: "sombra" });
    expect(await tituloDaSombra(endereco, t)).toContain(SOMBRA);
  }, 60_000);

  it(`Chrome sem automação navegando ${NAVEGAR_MS / 1000} s pelo site não gera nenhum evento`, async () => {
    const t = await montar(3_000);
    await abrirChrome(t, false);
    await dormir(NAVEGAR_MS);
    const visitas = t.site.pedidos.filter((p) => p.busca.startsWith("?guarda="));
    // Uma página a cada ~3 s, e a guarda estava em todas.
    expect(visitas.length).toBeGreaterThanOrEqual(Math.floor(NAVEGAR_MS / 3_000) - 2);
    expect(visitas.every((p) => p.busca === "?guarda=1")).toBe(true);
    expect(t.eventos()).toEqual([]);
    expect(t.avisos).toEqual([]);
  }, NAVEGAR_MS + 60_000);
});
