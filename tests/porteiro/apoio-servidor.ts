import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib, { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { expect } from "vitest";
import { Avisos, type Canal } from "../../src/avisos/avisos.js";
import { validarConfig } from "../../src/config/carregar.js";
import { iniciarPorteiro } from "../../src/porteiro/servidor.js";
import { Registro } from "../../src/registro/registro.js";
import type { Resolvedor } from "../../src/robos/dns.js";
import { FaixasMeta } from "../../src/robos/faixas-meta.js";

// Apoio dos testes do servidor: cliente HTTP cru, site de teste e o porteiro montado na frente.

export const SEGREDO = "s".repeat(43);
export const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const GUARDA = '<script src="/.anti-rea/guarda.js" defer></script>';
export const PAGINA =
  '<!doctype html><html><head><meta charset="utf-8"><title>Site de teste</title>' +
  '<meta property="og:title" content="Loja de Teste"></head><body><h1>Olá do site real</h1></body></html>';
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

export const SINAIS_LIMPOS = (() => {
  const { manual: _m, nonce: _n, ...s } = JSON.parse(readFileSync(new URL("../fixtures/sinais/chrome.json", import.meta.url), "utf8"));
  return s as Record<string, unknown>;
})();

// ---------- cliente HTTP cru (sem normalizar caminho, cookies na mão) ----------

export type Resposta = { status: number; headers: http.IncomingHttpHeaders; corpo: Buffer; texto: string };

export function pedir(
  porta: number,
  caminho: string,
  o: { metodo?: string; headers?: http.OutgoingHttpHeaders; corpo?: Buffer | string } = {},
): Promise<Resposta> {
  return new Promise((resolver, rejeitar) => {
    const r = http.request(
      {
        host: "127.0.0.1",
        port: porta,
        path: caminho,
        method: o.metodo ?? "GET",
        headers: { "user-agent": CHROME, ...o.headers },
        agent: false,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const corpo = Buffer.concat(partes);
          resolver({ status: res.statusCode!, headers: res.headers, corpo, texto: corpo.toString("utf8") });
        });
        res.on("error", rejeitar);
      },
    );
    r.on("error", rejeitar);
    r.end(o.corpo);
  });
}

/** "nome=valor" do Set-Cookie da resposta, ou undefined. */
export function cookieDe(r: Resposta, nome: string): string | undefined {
  const linha = (r.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${nome}=`));
  return linha?.split(";")[0];
}

export function linhaCookie(r: Resposta, nome: string): string | undefined {
  return (r.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${nome}=`));
}

export async function esperar(condicao: () => boolean, ms = 3_000): Promise<void> {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando a condição");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------- site de teste ----------

type Recebido = { metodo: string; url: string; headers: http.IncomingHttpHeaders; bytes: number };

/** Compressão do site de teste para cada Content-Encoding (x-gzip é gzip com outro nome). */
export const COMPRIMIR: Record<string, (b: Buffer) => Buffer> = {
  gzip: (b) => gzipSync(b),
  "x-gzip": (b) => gzipSync(b),
  deflate: (b) => deflateSync(b),
  br: (b) => brotliCompressSync(b),
};

/** Descompressão do lado do visitante, para conferir o que o porteiro entregou. */
export function abrirCorpo(codificacao: string | undefined, corpo: Buffer): string {
  if (codificacao === "gzip" || codificacao === "x-gzip") return zlib.gunzipSync(corpo).toString("utf8");
  if (codificacao === "deflate") return zlib.inflateSync(corpo).toString("utf8");
  if (codificacao === "br") return zlib.brotliDecompressSync(corpo).toString("utf8");
  return corpo.toString("utf8");
}

/** Compressor em fluxo do site de teste. */
function compressorDoSite(cod: string): zlib.Gzip | zlib.Deflate | zlib.BrotliCompress {
  if (cod === "br") return zlib.createBrotliCompress();
  if (cod === "deflate") return zlib.createDeflate();
  return zlib.createGzip();
}

async function subirSite() {
  const recebidos: Recebido[] = [];
  const progresso = { bytes: 0 };
  /** /fluxo deixa a página pela metade até o teste chamar `soltar`. */
  const fluxo = { soltar: () => {} };
  const tuneis = new Set<Duplex>();
  const servidor = http.createServer((req, res) => {
    const registro: Recebido = { metodo: req.method!, url: req.url!, headers: req.headers, bytes: 0 };
    recebidos.push(registro);
    req.on("data", (p: Buffer) => {
      registro.bytes += p.length;
      progresso.bytes += p.length;
    });
    req.on("end", () => {
      const comum = { server: "site-teste/1.0", "x-powered-by": "PHP/8.3" };
      const html = { ...comum, "content-type": "text/html; charset=utf-8" };
      // Roteia como os roteadores baseados em WHATWG URL (Hono, Bun, Deno): resolve "." e ".." sem
      // decodificar %2F. É o caso em que o caminho do site e o do porteiro podiam divergir.
      const url = new URL(req.url!, "http://site");
      switch (url.pathname) {
        case "/":
        case "/pagina":
          res.writeHead(200, { ...html, "set-cookie": "sessao=abc; Path=/" });
          return res.end(PAGINA);
        case "/comprimido":
          if (String(req.headers["accept-encoding"] ?? "").includes("br")) {
            res.writeHead(200, { ...html, "content-encoding": "br", vary: "Accept-Encoding" });
            return res.end(brotliCompressSync(Buffer.from(PAGINA)));
          }
          res.writeHead(200, html);
          return res.end(PAGINA);
        case "/codificado": {
          // A página na codificação pedida pelo teste (?cod=gzip, x-gzip, deflate ou br).
          const cod = url.searchParams.get("cod") ?? "gzip";
          res.writeHead(200, { ...html, "content-encoding": cod, vary: "Accept-Encoding" });
          return res.end(COMPRIMIR[cod]!(Buffer.from(PAGINA)));
        }
        case "/fluxo": {
          // Comprimida em fluxo: manda o começo (com </head>), dá flush e espera o teste soltar o resto.
          const cod = url.searchParams.get("cod") ?? "gzip";
          const z = compressorDoSite(cod);
          res.writeHead(200, { ...html, "content-encoding": cod, vary: "Accept-Encoding" });
          z.pipe(res);
          z.write('<!doctype html><html><head><title>Fluxo</title></head><body><p>Primeira parte</p>');
          z.flush();
          fluxo.soltar = () => z.end("<p>Segunda parte</p></body></html>");
          return;
        }
        case "/sem-head":
          res.writeHead(200, html);
          return res.end('<!doctype html><body class="x"><p>sem cabeça</p></body>');
        case "/og.png":
          res.writeHead(200, { ...comum, "content-type": "image/png" });
          return res.end(PNG);
        case "/app.js":
          res.writeHead(200, { ...comum, "content-type": "text/javascript", "cache-control": "public, max-age=31536000" });
          return res.end("console.log(1)");
        case "/.env":
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("DB_PASS=xyz");
        case "/upload":
        case "/api/webhook/x":
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ bytes: registro.bytes }));
        case "/pre-voo": {
          // Site que responde OPTIONS com a página inteira (PHP, app.all do Express), comprimida.
          const corpo = gzipSync(Buffer.from(PAGINA));
          res.writeHead(200, { ...html, "content-encoding": "gzip", "content-length": corpo.length, "access-control-allow-origin": "*" });
          return res.end(corpo);
        }
        case "/pre-voo-204":
          res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST" });
          return res.end();
        case "/pre-voo-304":
          res.writeHead(304, { etag: '"x"' });
          return res.end();
        case "/eco":
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(req.headers));
        case "/lento":
          setTimeout(() => {
            if (!res.destroyed) res.end("tarde");
          }, 1_500);
          return;
        default:
          res.writeHead(404, { "content-type": "text/plain" });
          return res.end("não achei");
      }
    });
  });
  servidor.on("upgrade", (req, socket: Duplex, cabeca: Buffer) => {
    recebidos.push({ metodo: req.method!, url: req.url!, headers: req.headers, bytes: 0 });
    tuneis.add(socket);
    socket.on("close", () => tuneis.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nServer: site-teste\r\n\r\n");
    if (cabeca.length > 0) socket.write(cabeca);
    socket.pipe(socket);
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  let fechado: Promise<void> | undefined;
  return {
    porta: (servidor.address() as { port: number }).port,
    recebidos,
    progresso,
    fluxo,
    fechar(): Promise<void> {
      fechado ??= new Promise<void>((r) => {
        for (const t of tuneis) t.destroy();
        servidor.close(() => r());
        servidor.closeAllConnections();
      });
      return fechado;
    },
  };
}

// ---------- porteiro na frente ----------

const limpezas: Array<() => Promise<void>> = [];

/** Fecha os porteiros e sites abertos pelo teste (no afterEach de cada arquivo). */
export async function limparTudo(): Promise<void> {
  while (limpezas.length > 0) await limpezas.pop()!();
}

/** IP público do Google nos testes: chega pelo X-Forwarded-For, com trustProxy true. */
export const IP_GOOGLE = "66.249.66.1";

const dnsDoGoogle: Resolvedor = {
  reverso: async () => ["crawl-66-249-66-1.googlebot.com"],
  direto: async () => [IP_GOOGLE],
};

export async function montar(extra: Record<string, unknown> = {}, opcoes: { dns?: Resolvedor } = {}) {
  const site = await subirSite();
  const cfg = validarConfig({
    upstream: `http://127.0.0.1:${site.porta}`,
    domains: ["seusite.com.br"],
    exempt: ["/api/webhook/*"],
    ...extra,
  });
  const pasta = mkdtempSync(join(tmpdir(), "anti-rea-porteiro-"));
  const registro = new Registro(pasta, 30 * 86_400_000);
  const enviados: string[] = [];
  const canal: Canal = {
    nome: "teste",
    enviar: async (texto) => {
      enviados.push(texto);
    },
  };
  const avisos = new Avisos(cfg.alerts, [canal]);
  const porteiro = await iniciarPorteiro(cfg, {
    segredo: SEGREDO,
    versaoDono: 1,
    registro,
    avisos,
    porta: 0,
    host: "127.0.0.1",
    dns: opcoes.dns ?? dnsDoGoogle,
    meta: new FaixasMeta(async () => ["192.0.2.0/24"]),
  });
  limpezas.push(async () => {
    await porteiro.fechar();
    await site.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });
  const hoje = () => new Date().toISOString().slice(0, 10);
  const get = (caminho: string, headers: http.OutgoingHttpHeaders = {}) => pedir(porteiro.porta, caminho, { headers });
  const post = (caminho: string, corpo: Buffer | string, headers: http.OutgoingHttpHeaders = {}) =>
    pedir(porteiro.porta, caminho, { metodo: "POST", corpo, headers: { "content-type": "application/json", ...headers } });

  /** Abre a tela de desafio, tira o nonce e posta os sinais. */
  async function verificar(sinais: Record<string, unknown> = SINAIS_LIMPOS, headers: http.OutgoingHttpHeaders = {}) {
    const desafio = await get("/", { accept: HTML, ...headers });
    const nonce = /\("(\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",(?:true|false)\)/.exec(desafio.texto)?.[1];
    expect(nonce, "nonce na tela de desafio").toBeDefined();
    return post("/.anti-rea/verificar", JSON.stringify({ ...sinais, nonce }), headers);
  }

  async function passe(): Promise<string> {
    const r = await verificar();
    expect(r.status).toBe(200);
    return cookieDe(r, "anti_rea_passe")!;
  }

  return { site, cfg, registro, enviados, porteiro, get, post, verificar, passe, eventos: () => registro.ler(hoje()) };
}
