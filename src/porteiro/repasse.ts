import http, { type ClientRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import https from "node:https";
import { pipeline, type Duplex } from "node:stream";
import { aceitaSoConhecidas, descompressor, InjetorGuarda } from "./injecao.js";
import { cookiesParaOSite } from "./passes.js";
import { responderIndisponivel } from "./respostas.js";

// Repasse ao site real: pedido e resposta em fluxo, HTML com a guarda, WebSocket e a busca da prévia.

/** O site real, fixo pela configuração (`upstream`): nada do visitante escolhe para onde o porteiro liga. */
export type Destino = {
  pedir: (opcoes: http.RequestOptions) => ClientRequest;
  host: string;
  porta: number;
  /** Caminho base do upstream, sem barra no fim ("" na raiz). */
  base: string;
  agente: http.Agent;
};

/** O que o repasse precisa saber do pedido, já resolvido pelo servidor. */
export type Origem = { caminho: string; ip: string; https: boolean };

const TEMPO_PREVIA_MS = 5_000;
const MAX_PREVIA = 512 * 1024;

// Cabeçalhos de salto (RFC 9110): valem só entre dois pontos e nunca são repassados.
const SALTO = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "http2-settings",
  // O porteiro já respondeu o 100-continue ao visitante.
  "expect",
]);
// O porteiro escreve estes do zero: o que o visitante mandar seria mentira.
const DO_PORTEIRO = new Set(["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"]);
// Não contam ao mundo o que roda atrás.
const SOMEM_DA_RESPOSTA = new Set(["server", "x-powered-by"]);
// Nomear estes no Connection não os tira: sem eles o corpo chegaria ao site sem enquadramento.
const NUNCA_DE_SALTO = new Set(["content-length", "host"]);

export function criarDestino(upstream: string): Destino {
  const url = new URL(upstream);
  const seguro = url.protocol === "https:";
  return {
    pedir: seguro ? (o) => https.request(o) : (o) => http.request(o),
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    porta: url.port ? Number(url.port) : seguro ? 443 : 80,
    base: url.pathname.replace(/\/+$/, ""),
    agente: seguro ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false }),
  };
}

/** Nomes listados no cabeçalho Connection (também são de salto). */
function listadosNoConnection(valor: string | string[] | undefined): Set<string> {
  const texto = Array.isArray(valor) ? valor.join(",") : (valor ?? "");
  return new Set(
    texto
      .split(",")
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n !== ""),
  );
}

/**
 * Cabeçalhos do pedido para o site: sem os de salto, sem os cookies do porteiro, com X-Forwarded-*
 * escritos pelo porteiro (o IP é o real, já resolvido) e o Host original. Corpo que veio em chunked
 * vai em chunked: o Node não enquadra sozinho o corpo de GET, HEAD, DELETE e OPTIONS, e o corpo
 * cru viraria um segundo pedido no site.
 */
export function cabecalhosParaOSite(
  req: IncomingMessage,
  origem: Origem,
  opcoes: { upgrade?: boolean; soCodificacoesConhecidas?: boolean } = {},
): OutgoingHttpHeaders {
  const saida: OutgoingHttpHeaders = {};
  const doConnection = listadosNoConnection(req.headers.connection);
  for (const [nome, valor] of Object.entries(req.headers)) {
    if (valor === undefined || SALTO.has(nome) || DO_PORTEIRO.has(nome)) continue;
    if (doConnection.has(nome) && !NUNCA_DE_SALTO.has(nome)) continue;
    if (nome === "cookie") continue;
    saida[nome] = valor;
  }
  if (!opcoes.upgrade && req.headers["transfer-encoding"] !== undefined) saida["transfer-encoding"] = "chunked";
  const cookie = cookiesParaOSite(req.headers.cookie);
  if (cookie) saida.cookie = cookie;
  if (origem.ip) saida["x-forwarded-for"] = origem.ip;
  saida["x-forwarded-proto"] = origem.https ? "https" : "http";
  if (req.headers.host) saida["x-forwarded-host"] = req.headers.host;
  if (opcoes.soCodificacoesConhecidas) {
    const aceita = aceitaSoConhecidas(req.headers["accept-encoding"]);
    if (aceita) saida["accept-encoding"] = aceita;
    else delete saida["accept-encoding"];
  }
  if (opcoes.upgrade) {
    saida.connection = "Upgrade";
    saida.upgrade = req.headers.upgrade ?? "websocket";
  }
  return saida;
}

/**
 * Cache-Control que só o navegador guarda: tira `public` e `s-maxage` e acrescenta `private`
 * (sem cabeçalho, fica só `private`). `no-store` já basta e fica como veio.
 */
export function cacheSoDoNavegador(valor: string | string[] | undefined): string {
  const diretivas = (Array.isArray(valor) ? valor.join(",") : (valor ?? ""))
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "" && !/^public$/i.test(d) && !/^s-maxage\s*=/i.test(d));
  if (diretivas.some((d) => /^(private|no-store)$/i.test(d))) return diretivas.join(", ");
  return ["private", ...diretivas].join(", ");
}

/**
 * Cabeçalhos da resposta para o visitante: sem os de salto, sem Server e X-Powered-By, mais os
 * cookies do porteiro. Resposta `privada` (liberada por passe ou por ser robô) não pode ir para
 * cache compartilhado: senão a CDN entrega o JS do visitante verificado a qualquer um.
 */
function cabecalhosParaOVisitante(resposta: IncomingMessage, cookiesNovos: string[], privada: boolean): OutgoingHttpHeaders {
  const saida: OutgoingHttpHeaders = {};
  const doConnection = listadosNoConnection(resposta.headers.connection);
  for (const [nome, valor] of Object.entries(resposta.headers)) {
    if (valor === undefined || SALTO.has(nome) || doConnection.has(nome) || SOMEM_DA_RESPOSTA.has(nome)) continue;
    saida[nome] = valor;
  }
  if (privada) {
    saida["cache-control"] = cacheSoDoNavegador(resposta.headers["cache-control"]);
    saida["cdn-cache-control"] = "no-store";
    saida["cloudflare-cdn-cache-control"] = "no-store";
  }
  if (cookiesNovos.length > 0) {
    const doSite = saida["set-cookie"];
    const lista = doSite === undefined ? [] : Array.isArray(doSite) ? doSite : [String(doSite)];
    saida["set-cookie"] = [...lista, ...cookiesNovos];
  }
  return saida;
}

function ehHtml(resposta: IncomingMessage): boolean {
  return /^\s*text\/html\b/i.test(String(resposta.headers["content-type"] ?? ""));
}

/** Manda a resposta do site ao visitante, em fluxo; HTML que leva guarda passa pelo injetor. */
function entregar(resposta: IncomingMessage, res: ServerResponse, injetar: boolean, opcoes: OpcoesRepasse): void {
  if (res.destroyed) {
    resposta.destroy();
    return;
  }
  const status = resposta.statusCode ?? 502;
  const cabecalhos = cabecalhosParaOVisitante(resposta, opcoes.cookiesNovos, opcoes.privada);
  const podeInjetar = injetar && status === 200 && ehHtml(resposta);
  const abrir = podeInjetar ? descompressor(resposta.headers["content-encoding"]) : undefined;
  const aoTerminar = (erro: Error | null) => {
    if (erro && !res.writableFinished) res.destroy();
  };
  if (podeInjetar && abrir !== undefined) {
    delete cabecalhos["content-encoding"];
    delete cabecalhos["content-length"];
    res.writeHead(status, resposta.statusMessage, cabecalhos);
    const etapas = abrir ? [resposta, abrir, new InjetorGuarda(), res] : [resposta, new InjetorGuarda(), res];
    pipeline(etapas, aoTerminar);
    return;
  }
  res.writeHead(status, resposta.statusMessage, cabecalhos);
  pipeline(resposta, res, aoTerminar);
}

/** `privada`: a resposta dependeu de passe ou de robô e não vai para cache compartilhado. */
export type OpcoesRepasse = { injetarGuarda: boolean; cookiesNovos: string[]; privada: boolean };

/**
 * Repassa o pedido ao site com o corpo em fluxo. Site fora do ar ou falha de conexão: 502 simples
 * (sem evento nem aviso). Visitante que desiste: o pedido ao site é cortado, sem derrubar nada.
 */
export function repassarPedido(
  req: IncomingMessage,
  res: ServerResponse,
  destino: Destino,
  origem: Origem,
  opcoes: OpcoesRepasse,
): void {
  // O visitante foi embora enquanto o porteiro decidia: nada a repassar.
  if (res.destroyed) return;
  const metodo = req.method ?? "GET";
  const injetar = opcoes.injetarGuarda && metodo === "GET";
  let pedidoSite: ClientRequest;
  try {
    pedidoSite = destino.pedir({
      host: destino.host,
      port: destino.porta,
      method: metodo,
      path: destino.base + origem.caminho,
      headers: cabecalhosParaOSite(req, origem, { soCodificacoesConhecidas: injetar }),
      agent: destino.agente,
    });
  } catch {
    responderIndisponivel(res);
    return;
  }
  pedidoSite.on("error", () => {
    if (!res.headersSent) responderIndisponivel(res);
    else if (!res.writableFinished) res.destroy();
  });
  pedidoSite.on("response", (resposta) => {
    try {
      entregar(resposta, res, injetar, opcoes);
    } catch {
      resposta.destroy();
      if (!res.headersSent) responderIndisponivel(res);
      else res.destroy();
    }
  });
  res.on("close", () => {
    if (!res.writableFinished) pedidoSite.destroy();
  });
  req.on("error", () => pedidoSite.destroy());
  // pipe e não pipeline: se o site cair, o pedido do visitante continua vivo para levar o 502.
  req.pipe(pedidoSite);
}

/** Responde a um pedido de upgrade com status e texto, e fecha o socket. */
export function recusarUpgrade(socket: Duplex, status: string, texto = ""): void {
  if (socket.destroyed) return;
  const corpo = Buffer.from(texto, "utf8");
  const cabeca =
    `HTTP/1.1 ${status}\r\nConnection: close\r\nCache-Control: no-store\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${corpo.length}\r\n\r\n`;
  socket.end(Buffer.concat([Buffer.from(cabeca, "latin1"), corpo]), () => socket.destroy());
}

/**
 * Upgrade (WebSocket): pede o upgrade ao site e, com 101, liga os dois sockets direto. `tuneis`
 * guarda os sockets abertos para o `fechar()` do porteiro derrubar.
 */
export function repassarUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  cabeca: Buffer,
  destino: Destino,
  origem: Origem,
  tuneis: Set<Duplex>,
): void {
  const acompanhar = (s: Duplex) => {
    tuneis.add(s);
    s.once("close", () => tuneis.delete(s));
  };
  acompanhar(socket);
  let ligado = false;
  const pedidoSite = destino.pedir({
    host: destino.host,
    port: destino.porta,
    method: req.method ?? "GET",
    path: destino.base + origem.caminho,
    headers: cabecalhosParaOSite(req, origem, { upgrade: true }),
    agent: false,
  });
  socket.on("error", () => socket.destroy());
  socket.once("close", () => {
    if (!ligado) pedidoSite.destroy();
  });

  pedidoSite.on("upgrade", (resposta: IncomingMessage, socketSite: Duplex, cabecaSite: Buffer) => {
    ligado = true;
    acompanhar(socketSite);
    socketSite.on("error", () => socketSite.destroy());
    if (socket.destroyed) {
      socketSite.destroy();
      return;
    }
    let linhas = `HTTP/1.1 ${resposta.statusCode ?? 101} ${resposta.statusMessage ?? ""}\r\n`;
    for (let i = 0; i + 1 < resposta.rawHeaders.length; i += 2) {
      const nome = resposta.rawHeaders[i]!;
      if (SOMEM_DA_RESPOSTA.has(nome.toLowerCase())) continue;
      linhas += `${nome}: ${resposta.rawHeaders[i + 1]}\r\n`;
    }
    socket.write(linhas + "\r\n");
    if (cabecaSite.length > 0) socket.write(cabecaSite);
    if (cabeca.length > 0) socketSite.write(cabeca);
    socket.once("close", () => socketSite.destroy());
    socketSite.once("close", () => socket.destroy());
    socketSite.pipe(socket);
    socket.pipe(socketSite);
  });
  pedidoSite.on("response", (resposta) => {
    resposta.resume();
    recusarUpgrade(socket, `${resposta.statusCode ?? 502} ${resposta.statusMessage ?? ""}`.trim());
  });
  pedidoSite.on("error", () => {
    if (!ligado) recusarUpgrade(socket, "502 Bad Gateway");
  });
  pedidoSite.end();
}

function decodificar(bytes: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * HTML do mesmo caminho no site, para a prévia: GET com accept text/html, sem cookie de ninguém,
 * 5 s no máximo, lê até 512 KB (já descomprimido). Fora de 200 + HTML devolve "".
 */
export function buscarHtml(destino: Destino, caminho: string, hostDoSite: string | undefined, sinal: AbortSignal): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const cabecalhos: OutgoingHttpHeaders = { accept: "text/html" };
    if (hostDoSite) cabecalhos.host = hostDoSite;
    const pedido = destino.pedir({
      host: destino.host,
      port: destino.porta,
      method: "GET",
      path: destino.base + caminho,
      headers: cabecalhos,
      agent: destino.agente,
      signal: sinal,
    });
    const relogio = setTimeout(() => pedido.destroy(new Error("prévia sem resposta em 5 s")), TEMPO_PREVIA_MS);
    relogio.unref();
    const terminar = (erro: Error | null, texto = "") => {
      clearTimeout(relogio);
      if (erro) rejeitar(erro);
      else resolver(texto);
    };
    pedido.on("error", (erro) => terminar(erro));
    pedido.on("response", (resposta) => {
      const tipo = String(resposta.headers["content-type"] ?? "");
      const abrir = descompressor(resposta.headers["content-encoding"]);
      if (resposta.statusCode !== 200 || !ehHtml(resposta) || abrir === undefined) {
        resposta.resume();
        terminar(null);
        return;
      }
      const partes: Buffer[] = [];
      let total = 0;
      resposta.on("error", (erro) => terminar(erro));
      const fonte = abrir ? resposta.pipe(abrir) : resposta;
      abrir?.on("error", (erro) => terminar(erro));
      fonte.on("data", (pedaco: Buffer) => {
        if (total >= MAX_PREVIA) return;
        partes.push(pedaco);
        total += pedaco.length;
        if (total >= MAX_PREVIA) {
          terminar(null, decodificar(Buffer.concat(partes).subarray(0, MAX_PREVIA), tipo));
          pedido.destroy();
        }
      });
      fonte.on("end", () => terminar(null, decodificar(Buffer.concat(partes), tipo)));
    });
    pedido.end();
  });
}
