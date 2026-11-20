// Ponta a ponta com ferramentas de verdade contra o site de exemplo (tests/e2e/site-exemplo) atrás
// do porteiro. Cada caso pego termina em "recebeu a sombra, 403 ou 404, e o registro tem o evento".
// curl, wget e httrack rodam pelo child_process e o caso pula quando o binário falta. O navegador é
// o Chrome do sistema (channel "chrome") ou, sem ele, o Chromium do Playwright; sem nenhum, falha no
// CI e pula com o motivo fora dele.
// Com tela só quando ANTI_REA_E2E_HEADED=1. O caso do REA roda o CLI `rea` (npm rea-agents) de
// verdade e pula quando ele ou o Chrome do sistema faltam. Roda com `npm run test:e2e`.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContextOptions, type LaunchOptions } from "playwright";
import { afterEach, describe, expect, it, type TestContext } from "vitest";
import { Avisos, type Canal } from "../../src/avisos/avisos.js";
import { validarConfig } from "../../src/config/carregar.js";
import { iniciarPorteiro } from "../../src/porteiro/servidor.js";
import { Registro, type Evento } from "../../src/registro/registro.js";
import { FaixasMeta } from "../../src/robos/faixas-meta.js";
import { abrirComReserva, argsDoChrome, emCI, type CanalNavegador } from "./abrir-navegador.js";
// SINAIS_LIMPOS é a fixture tests/fixtures/sinais/chrome.json sem "manual" e "nonce".
import { CHROME, HTML, SINAIS_LIMPOS, cookieDe, esperar, pedir } from "../porteiro/apoio-servidor.js";

const PASTA_SITE = fileURLToPath(new URL("./site-exemplo/", import.meta.url));
const SEGREDO = "e".repeat(43);
/** Texto que só a página sombra tem (título "Ops. Pegamos você."). */
const SOMBRA = "Pegamos você";
/** Texto que só as páginas reais do site de exemplo têm (fora das etiquetas og da prévia). */
const DO_SITE = "Conteúdo real";
/** Constante que só o código do site (app.js e o mapa) tem. */
const DO_CODIGO = "receita-da-casa";
const PAGINAS: Array<[string, string]> = [
  ["/", "Conteúdo real da página inicial"],
  ["/sobre", "Conteúdo real da página sobre"],
  ["/produtos", "Conteúdo real da página de produtos"],
  ["/contato", "Conteúdo real da página de contato"],
  ["/blog", "Conteúdo real do blog"],
];
const NONCE = /\("(\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",(?:true|false)\)/;

// ---------- binários e navegador ----------

/** Caminho do binário no PATH, ou undefined. */
function binario(nome: string): string | undefined {
  for (const pasta of (process.env.PATH ?? "").split(delimiter)) {
    const caminho = join(pasta, nome);
    if (pasta !== "" && existsSync(caminho)) return caminho;
  }
  return undefined;
}

const CURL = binario("curl");
const WGET = binario("wget");
const HTTRACK = binario("httrack");
/** CLI do REA (npm rea-agents). */
const REA = binario("rea");
const CHROME_DO_SISTEMA = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].find((c): c is string => !!c && existsSync(c));

type Saida = { codigo: number | string | null; saida: string };

function rodar(comando: string, args: string[], ms = 30_000): Promise<Saida> {
  return new Promise((resolver) => {
    execFile(comando, args, { timeout: ms, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" }, (erro, saida) => {
      resolver({ codigo: erro ? (erro.code ?? null) : 0, saida });
    });
  });
}

/**
 * Chrome do sistema primeiro, depois o Chromium do Playwright. Sem nenhum: no CI o caso falha com o
 * último erro; fora do CI ele pula com o motivo (ver abrir-navegador.ts).
 */
async function abrirNavegador(ctx: TestContext, opcoes: LaunchOptions): Promise<Browser> {
  const lancar = (canal: CanalNavegador) => chromium.launch({ timeout: 20_000, ...opcoes, args: argsDoChrome(opcoes.args), ...canal });
  const r = await abrirComReserva(lancar, [{ channel: "chrome" }, {}], emCI());
  if (!r.navegador) return ctx.skip(r.motivo);
  const navegador = r.navegador;
  limpezas.push(() => navegador.close().catch(() => {}));
  return navegador;
}

// ---------- site de exemplo e porteiro ----------

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
};

type Site = { porta: number; pedidos: string[]; fechar(): Promise<void> };

/** Servidor estático da pasta site-exemplo: "/" é index.html e "/sobre" é sobre.html. */
async function subirSite(): Promise<Site> {
  const pedidos: string[] = [];
  const servidor = http.createServer((req, res) => {
    const caminho = new URL(req.url ?? "/", "http://site").pathname;
    pedidos.push(caminho);
    let nome = caminho.endsWith("/") ? `${caminho}index.html` : caminho;
    if (extname(nome) === "") nome += ".html";
    const arquivo = resolve(PASTA_SITE, `.${nome}`);
    if (!arquivo.startsWith(PASTA_SITE.endsWith(sep) ? PASTA_SITE : PASTA_SITE + sep) || !existsSync(arquivo) || !statSync(arquivo).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("não achei");
    }
    res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream" });
    res.end(readFileSync(arquivo));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  return {
    porta: (servidor.address() as { port: number }).port,
    pedidos,
    fechar: () =>
      new Promise<void>((ok) => {
        servidor.close(() => ok());
        servidor.closeAllConnections();
      }),
  };
}

const limpezas: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (limpezas.length > 0) await limpezas.pop()!();
}, 30_000);

/** Pasta temporária apagada no fim do caso. */
function pastaTemporaria(prefixo: string): string {
  const pasta = mkdtempSync(join(tmpdir(), prefixo));
  limpezas.push(async () => rmSync(pasta, { recursive: true, force: true }));
  return pasta;
}

/** Site de exemplo com o porteiro na frente, registro em pasta temporária e um canal de aviso de teste. */
async function montar() {
  const site = await subirSite();
  const cfg = validarConfig({ upstream: `http://127.0.0.1:${site.porta}`, domains: ["seusite.com.br"] });
  const pasta = pastaTemporaria("anti-rea-e2e-registro-");
  const registro = new Registro(pasta, 30 * 86_400_000);
  const avisos: string[] = [];
  const canal: Canal = {
    nome: "teste",
    enviar: async (texto) => {
      avisos.push(texto);
    },
  };
  const porteiro = await iniciarPorteiro(cfg, {
    segredo: SEGREDO,
    versaoDono: 1,
    registro,
    avisos: new Avisos(cfg.alerts, [canal]),
    porta: 0,
    host: "127.0.0.1",
    // Nada sai para a rede: sem DNS de verdade e sem buscar as faixas da Meta.
    dns: { reverso: async () => [], direto: async () => [] },
    meta: new FaixasMeta(async () => []),
  });
  limpezas.push(async () => {
    await porteiro.fechar();
    await site.fechar();
  });
  const hoje = () => new Date().toISOString().slice(0, 10);
  return { url: `http://127.0.0.1:${porteiro.porta}`, porta: porteiro.porta, site, avisos, eventos: (): Evento[] => registro.ler(hoje()) };
}

type Montado = Awaited<ReturnType<typeof montar>>;

/** Confere que o registro tem o evento e que o aviso saiu. */
async function conferirPego(t: Montado, evento: Partial<Evento>, avisa = true): Promise<void> {
  expect(t.eventos()).toContainEqual(expect.objectContaining(evento));
  if (avisa) await esperar(() => t.avisos.length > 0);
}

/** Todos os arquivos de uma pasta, recursivo. */
function arquivosDe(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, encoding: "utf8" })
    .map((nome) => join(pasta, nome))
    .filter((caminho) => statSync(caminho).isFile());
}

// ---------- ferramentas de linha de comando ----------

describe.skipIf(!CURL)("curl", () => {
  it("curl em / recebe a sombra, nada chega ao site, o registro tem o evento e o aviso sai", async () => {
    const t = await montar();
    const r = await rodar(CURL!, ["-sS", "-w", "\n%{http_code}", `${t.url}/`]);
    const status = r.saida.slice(r.saida.lastIndexOf("\n") + 1);
    expect(status).toBe("200");
    expect(r.saida).toContain(SOMBRA);
    expect(r.saida).not.toContain(DO_SITE);
    expect(t.site.pedidos).toEqual([]);
    await conferirPego(t, { caminho: "/", motivo: "curl", gravidade: "copia", destino: "sombra" });
  }, 60_000);

  it("curl disfarçado de Chrome pedindo o app.js sem passe recebe 403 e fica registrado", async () => {
    const t = await montar();
    const r = await rodar(CURL!, ["-sS", "-A", CHROME, "-w", "\n%{http_code}", `${t.url}/app.js`]);
    expect(r.saida.slice(r.saida.lastIndexOf("\n") + 1)).toBe("403");
    expect(r.saida).not.toContain(DO_CODIGO);
    expect(t.site.pedidos).toEqual([]);
    // Recusa sem passe é varredura: vai para o registro e para o painel, sem aviso imediato.
    await conferirPego(t, { caminho: "/app.js", motivo: "sem passe", gravidade: "varredura", destino: "recusado" }, false);
  }, 60_000);
});

describe.skipIf(!WGET)("wget", () => {
  it("wget em / recebe a sombra e o registro tem o evento", async () => {
    const t = await montar();
    const r = await rodar(WGET!, ["-q", "-O", "-", `${t.url}/`]);
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain(SOMBRA);
    expect(r.saida).not.toContain(DO_SITE);
    expect(t.site.pedidos).toEqual([]);
    await conferirPego(t, { caminho: "/", motivo: "wget", gravidade: "copia", destino: "sombra" });
  }, 60_000);
});

describe.skipIf(!HTTRACK)("httrack", () => {
  it("httrack copiando o site leva só a sombra e o registro tem o evento", async () => {
    const t = await montar();
    const destino = pastaTemporaria("anti-rea-e2e-httrack-");
    // -q sem perguntas, -Q sem log, -r2 profundidade 2, -E30 no máximo 30 s, -s0 ignora o robots.txt.
    await rodar(HTTRACK!, [`${t.url}/`, "-O", destino, "-q", "-Q", "-r2", "-E30", "-s0"], 45_000);
    const textos = arquivosDe(destino).map((a) => readFileSync(a, "utf8"));
    expect(textos.some((x) => x.includes(SOMBRA))).toBe(true);
    for (const x of textos) {
      expect(x).not.toContain(DO_SITE);
      expect(x).not.toContain(DO_CODIGO);
    }
    expect(t.site.pedidos).toEqual([]);
    await conferirPego(t, { motivo: "httrack", gravidade: "copia", destino: "sombra" });
  }, 60_000);
});

// ---------- Playwright ----------

/** Esconde o webdriver: tira a chave de automação e o AutomationControlled do Blink. */
const SEM_WEBDRIVER: LaunchOptions = { ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"] };

/**
 * Abre `/` num Chromium do Playwright e espera a página virar sombra (verificação, marca de pego e
 * recarga). O código do site nunca chega ao navegador e o registro tem o evento com o motivo.
 */
async function ateASombra(ctx: TestContext, lancar: LaunchOptions, contexto: BrowserContextOptions, motivo: string) {
  const navegador = await abrirNavegador(ctx, lancar);
  const t = await montar();
  const pagina = await (await navegador.newContext(contexto)).newPage();
  await pagina.goto(`${t.url}/`);
  await pagina.getByText(SOMBRA).waitFor({ timeout: 20_000 });
  expect(await pagina.textContent("body")).not.toContain(DO_SITE);
  expect(t.site.pedidos).not.toContain("/app.js");
  await conferirPego(t, { motivo, gravidade: "copia", destino: "sombra" });
}

describe("Playwright", () => {
  it("sem tela, do jeito que vem: sombra já no primeiro pedido pelo agente HeadlessChrome", async (ctx) => {
    const navegador = await abrirNavegador(ctx, { headless: true });
    const t = await montar();
    const pagina = await navegador.newPage();
    const r = await pagina.goto(`${t.url}/`);
    expect(r?.status()).toBe(200);
    expect(await pagina.textContent("body")).toContain(SOMBRA);
    expect(t.site.pedidos).toEqual([]);
    await conferirPego(t, { caminho: "/", motivo: "headlesschrome", gravidade: "copia", destino: "sombra" });
  }, 60_000);

  it("sem tela e com agente de Chrome: a verificação pega webdriver e a página vira sombra", (ctx) =>
    ateASombra(ctx, { headless: true }, { userAgent: CHROME }, "navegador automatizado"), 60_000);

  it("sem tela, sem webdriver e com o agente trocado só no cabeçalho: pega navegador sem tela", (ctx) =>
    ateASombra(ctx, { headless: true, ...SEM_WEBDRIVER }, { extraHTTPHeaders: { "user-agent": CHROME } }, "navegador sem tela"), 60_000);

  it("disfarce completo (sem webdriver, agente de Chrome): pega a depuração remota, como no REA", (ctx) =>
    ateASombra(ctx, { headless: true, ...SEM_WEBDRIVER }, { userAgent: CHROME }, "depuração remota ativa"), 60_000);

  it.skipIf(process.env.ANTI_REA_E2E_HEADED !== "1")("com tela: a verificação pega webdriver e a página vira sombra", (ctx) =>
    ateASombra(ctx, { headless: false }, {}, "navegador automatizado"), 60_000);
});

// ---------- visitante com passe ----------

/** Passa pela verificação com a fixture chrome.json e devolve o cookie de passe. */
async function passeLegitimo(t: Montado): Promise<string> {
  const desafio = await pedir(t.porta, "/", { headers: { accept: HTML } });
  expect(desafio.status).toBe(200);
  expect(desafio.texto).toContain("Verificando seu navegador");
  const nonce = NONCE.exec(desafio.texto)?.[1];
  expect(nonce, "nonce na tela de verificação").toBeDefined();
  const r = await pedir(t.porta, "/.anti-rea/verificar", {
    metodo: "POST",
    headers: { "content-type": "application/json" },
    corpo: JSON.stringify({ ...SINAIS_LIMPOS, nonce }),
  });
  expect(r.status).toBe(200);
  expect(JSON.parse(r.texto)).toEqual({ ok: true });
  return cookieDe(r, "anti_rea_passe")!;
}

describe("visitante com passe", () => {
  it("fluxo legítimo: verificar com a fixture chrome.json e navegar 5 páginas sem nenhuma sombra", async () => {
    const t = await montar();
    const passe = await passeLegitimo(t);
    for (const [caminho, texto] of PAGINAS) {
      const r = await pedir(t.porta, caminho, { headers: { accept: HTML, cookie: passe } });
      expect(r.status, caminho).toBe(200);
      expect(r.texto, caminho).toContain(texto);
      expect(r.texto, caminho).toContain('<script src="/.anti-rea/guarda.js" defer></script>');
      expect(r.texto, caminho).not.toContain(SOMBRA);
    }
    const js = await pedir(t.porta, "/app.js", { headers: { accept: "*/*", cookie: passe } });
    expect(js.status).toBe(200);
    expect(js.texto).toContain(DO_CODIGO);
    const imagem = await pedir(t.porta, "/og.png", { headers: { accept: "image/*", cookie: passe } });
    expect(imagem.status).toBe(200);
    expect(imagem.headers["content-type"]).toBe("image/png");
    expect(t.eventos()).toEqual([]);
    expect(t.avisos).toEqual([]);
  }, 60_000);

  it("/app.js.map com passe válido: sombra 404, o mapa nunca sai do site e o evento é cópia", async () => {
    const t = await montar();
    const passe = await passeLegitimo(t);
    const r = await pedir(t.porta, "/app.js.map", { headers: { accept: "*/*", cookie: passe } });
    expect(r.status).toBe(404);
    expect(r.texto).toContain(SOMBRA);
    expect(r.texto).not.toContain(DO_CODIGO);
    expect(t.site.pedidos).not.toContain("/app.js.map");
    await conferirPego(t, { caminho: "/app.js.map", motivo: "mapa de código", gravidade: "copia", destino: "sombra" });
  }, 60_000);

  it.skipIf(!CHROME_DO_SISTEMA)("Chrome do sistema sem automação passa pela verificação e recebe o site real", async () => {
    const t = await montar();
    await abrirChromeDoSistema(t, false);
    // A guarda roda na carga e depois a cada 1 s: cinco voltas sem nada.
    await new Promise((ok) => setTimeout(ok, 4_500));
    expect(t.eventos()).toEqual([]);
    expect(t.avisos).toEqual([]);
  }, 60_000);
});

/**
 * Chrome do sistema sem tela e sem automação, com o agente sem "HeadlessChrome" (como o Chrome de
 * uma pessoa), aberto no site protegido. Volta quando ele já passou pela verificação: o site só
 * entrega o app.js para quem tem passe e abriu a página real. Com `depuracao`, abre também uma
 * porta de depuração (sem cliente ligado) e devolve o endereço dela.
 */
async function abrirChromeDoSistema(t: Montado, depuracao: boolean): Promise<string | undefined> {
  const perfil = pastaTemporaria("anti-rea-e2e-perfil-");
  const args = ["--headless=new", `--user-agent=${CHROME}`, `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check"];
  // Sem tela e com porta de depuração, o Chrome liga navigator.webdriver (com tela, não). A chave
  // desliga isso, para ficar como o Chrome com tela que a pessoa abre para o REA.
  if (depuracao) args.push("--remote-debugging-port=0", "--disable-blink-features=AutomationControlled");
  const chrome = spawn(CHROME_DO_SISTEMA!, [...argsDoChrome(args), `${t.url}/`], { stdio: ["ignore", "ignore", "pipe"] });
  limpezas.push(async () => {
    chrome.kill("SIGKILL");
    await new Promise((ok) => setTimeout(ok, 300));
  });
  let saida = "";
  chrome.stderr!.on("data", (d) => (saida += d));
  await esperar(() => t.site.pedidos.includes("/app.js"), 20_000);
  if (!depuracao) return undefined;
  await esperar(() => /ws:\/\/127\.0\.0\.1:\d+\//.test(saida), 5_000);
  return `http://127.0.0.1:${/ws:\/\/127\.0\.0\.1:(\d+)\//.exec(saida)![1]}`;
}

type AlvoCdp = { id: string; type: string; title: string; url: string };

/** Página do site protegido na lista de alvos da porta de depuração (só HTTP, sem ligar domínio). */
async function alvoDoSite(endereco: string, t: Montado): Promise<AlvoCdp> {
  const alvos = (await (await fetch(`${endereco}/json/list`)).json()) as AlvoCdp[];
  return alvos.find((a) => a.type === "page" && a.url.startsWith(t.url))!;
}

// ---------- REA de verdade ----------

describe.skipIf(!REA || !CHROME_DO_SISTEMA)("REA", () => {
  it("inspect-web-page de 5 s num Chrome que já passou: a guarda pega, a página vira sombra e o aviso sai", async () => {
    const t = await montar();
    const endereco = (await abrirChromeDoSistema(t, true))!;
    expect(t.eventos()).toEqual([]);
    const alvo = await alvoDoSite(endereco, t);
    expect(alvo.title).toBe("Loja Exemplo");
    // A saída do REA vem do alvo e é só dado: o teste não lê nada dela. Com a página trocada no meio
    // da observação, o REA sai com erro (target_changed) e não guarda nada.
    await rodar(REA!, ["inspect-web-page", endereco, alvo.id, "--observation-ms", "5000"], 40_000);
    await esperar(() => t.eventos().some((e) => e.motivo === "depuração remota ativa"), 10_000);
    await conferirPego(t, { caminho: "/.anti-rea/pego", motivo: "depuração remota ativa", gravidade: "copia", destino: "sombra" });
    // A guarda recarrega e a volta já é a sombra; o título na lista de alvos acompanha.
    await esperar(() => t.eventos().some((e) => e.motivo === "pego na verificação"), 10_000);
    let titulo = "";
    for (const fim = Date.now() + 5_000; !titulo.includes(SOMBRA) && Date.now() < fim; ) {
      titulo = (await alvoDoSite(endereco, t)).title;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    expect(titulo).toContain(SOMBRA);
  }, 60_000);
});
