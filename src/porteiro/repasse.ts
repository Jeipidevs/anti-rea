import http, { type ClientRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import https from "node:https";
import { pipeline, type Duplex } from "node:stream";
import { aceitaSoConhecidas, compressor, descompressor, ehHtml, InjetorGuarda } from "./injecao.js";
import { cookiesParaOSite } from "./passes.js";
import { responderIndisponivel } from "./respostas.js";

// Repasse ao site real: pedido e resposta em fluxo, HTML com a guarda e WebSocket.

/** O site real, fixo pela configuração (`upstream`): nada do visitante escolhe para onde o porteiro liga. */
export type Destino = {
  pedir: (opcoes: http.RequestOptions) => ClientRequest;
  host: string;
  porta: number;
  /** Caminho base do upstream, sem barra no fim ("" na raiz). */
  base: string;
  agente: http.Agent;
  /** Quanto o site tem para mandar os cabeçalhos da resposta, contado do último pedaço do pedido. */
  tempoMs: number;
  /** Uma linha no stderr sobre a falha do site (código ou tempo esgotado), no máximo uma por minuto. */
  falhou(motivo: string): void;
};

/** Tempo máximo até os cabeçalhos do site; passado isso, o visitante recebe 504. */
export const TEMPO_SITE_MS = 60_000;
/** Intervalo mínimo entre duas linhas de falha do site no stderr. */
export const INTERVALO_FALHA_MS = 60_000;

/**
 * O que o repasse precisa saber do pedido, já resolvido pelo servidor. `cloudflare`: trustProxy
 * "cloudflare", o único modo em que o CF-Connecting-IP do pedido é da Cloudflare e segue para o site.
 */
export type Origem = { caminho: string; ip: string; https: boolean; cloudflare: boolean };

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
// O que o visitante mandar nestes nomes seria mentira e nunca chega ao site. A primeira linha o porteiro
// escreve de novo; as outras, que o site ou o framework dele leriam como IP ou endereço verdadeiro, somem.
const DO_PORTEIRO = new Set([
  ...["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip"],
  ...["forwarded", "true-client-ip", "x-client-ip", "x-original-url", "x-rewrite-url"],
  ...["x-forwarded-port", "x-forwarded-prefix", "x-forwarded-server"],
  // Lidos como IP verdadeiro por frameworks e trechos comuns (Rails, o HTTP_CLIENT_IP do PHP).
  ...["client-ip", "x-cluster-client-ip", "fastly-client-ip", "x-forwarded", "forwarded-for"],
  ...["x-originating-ip", "x-remote-ip", "x-remote-addr"],
]);
// Não contam ao mundo o que roda atrás.
const SOMEM_DA_RESPOSTA = new Set(["server", "x-powered-by"]);
// Nomear estes no Connection não os tira: sem eles o corpo chegaria ao site sem enquadramento.
const NUNCA_DE_SALTO = new Set(["content-length", "host"]);

/** Segundos em português ("60", "0,3"). */
const segundos = (ms: number) => String(ms / 1000).replace(".", ",");

/**
 * O destino do `upstream`. `tempoMs` (padrão TEMPO_SITE_MS) e `agora` existem para os testes. A
 * linha de falha leva só protocolo, host e porta do site, nunca usuário e senha da URL.
 */
export function criarDestino(upstream: string, opcoes: { tempoMs?: number; agora?: () => number } = {}): Destino {
  const url = new URL(upstream);
  const seguro = url.protocol === "https:";
  const agora = opcoes.agora ?? Date.now;
  const endereco = `${url.protocol}//${url.host}`;
  let ultimaFalha = Number.NEGATIVE_INFINITY;
  return {
    pedir: seguro ? (o) => https.request(o) : (o) => http.request(o),
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    porta: url.port ? Number(url.port) : seguro ? 443 : 80,
    base: url.pathname.replace(/\/+$/, ""),
    agente: seguro ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false }),
    tempoMs: opcoes.tempoMs ?? TEMPO_SITE_MS,
    falhou(motivo) {
      const t = agora();
      if (t - ultimaFalha < INTERVALO_FALHA_MS) return;
      ultimaFalha = t;
      process.stderr.write(
        `[anti-rea] falha no site ${endereco}: ${motivo}. O visitante recebeu a página de indisponível ` +
          "(no máximo uma linha destas por minuto).\n",
      );
    },
  };
}

/** O código do erro de conexão (ECONNREFUSED, ENOTFOUND...), ou a mensagem quando não há código. */
function motivoDoErro(erro: Error): string {
  return (erro as NodeJS.ErrnoException).code ?? erro.message;
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
 * Cabeçalhos do pedido para o site: sem os de salto, sem os cookies do porteiro, sem os de IP e de
 * endereço vindos do visitante (CF-Connecting-IP só fica atrás da Cloudflare), com X-Forwarded-* e
 * X-Real-IP escritos pelo porteiro (o IP é o real, já resolvido) e o Host original. Corpo que veio em chunked
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
    if (nome === "cookie" || (nome === "cf-connecting-ip" && !origem.cloudflare)) continue;
    saida[nome] = valor;
  }
  if (!opcoes.upgrade && req.headers["transfer-encoding"] !== undefined) saida["transfer-encoding"] = "chunked";
  const cookie = cookiesParaOSite(req.headers.cookie);
  if (cookie) saida.cookie = cookie;
  if (origem.ip) {
    saida["x-forwarded-for"] = origem.ip;
    saida["x-real-ip"] = origem.ip;
  }
  saida["x-forwarded-proto"] = origem.https ? "https" : "http";
  if (req.headers.host) saida["x-forwarded-host"] = req.headers.host;
  if (opcoes.soCodificacoesConhecidas) {
    const aceita = aceitaSoConhecidas(req.headers["accept-encoding"]);
    if (aceita) saida["accept-encoding"] = aceita;
    else delete saida["accept-encoding"];
  }
  if (opcoes.upgrade) {
    // Só WebSocket chega aqui (o servidor recusa o resto); h2c e afins nunca vão ao site.
    saida.connection = "Upgrade";
    saida.upgrade = "websocket";
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
 * cookies do porteiro (só em resposta abaixo de 400). Resposta `privada` (liberada por passe ou por ser robô) não pode ir para
 * cache compartilhado: senão a CDN entrega o JS do visitante verificado a qualquer um.
 */
function cabecalhosParaOVisitante(resposta: IncomingMessage, opcoes: OpcoesRepasse): OutgoingHttpHeaders {
  const { privada } = opcoes;
  // Erro não leva passe; 204, 304 e redirecionamento levam (app de página única vive de 304).
  const cookiesNovos = (resposta.statusCode ?? 500) < 400 ? opcoes.cookiesNovos : [];
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

/**
 * Manda a resposta do site ao visitante, em fluxo. HTML que leva guarda é aberto, passa pelo injetor e
 * volta comprimido do jeito que o site mandou.
 */
function entregar(resposta: IncomingMessage, res: ServerResponse, injetar: boolean, opcoes: OpcoesRepasse): void {
  if (res.destroyed) {
    resposta.destroy();
    return;
  }
  const status = resposta.statusCode ?? 502;
  const cabecalhos = cabecalhosParaOVisitante(resposta, opcoes);
  if (opcoes.soCabecalhos) {
    // Pré-voo: o navegador nunca usa o corpo. 204 e 304 não levam Content-Length; o resto leva 0, e
    // sem corpo não há codificação a declarar.
    delete cabecalhos["content-length"];
    delete cabecalhos["content-encoding"];
    if (status !== 204 && status !== 304) cabecalhos["content-length"] = "0";
    res.writeHead(status, resposta.statusMessage, cabecalhos);
    res.end();
    resposta.on("error", () => {});
    resposta.destroy();
    return;
  }
  const podeInjetar = injetar && status === 200 && ehHtml(resposta);
  const abrir = podeInjetar ? descompressor(resposta.headers["content-encoding"]) : undefined;
  const aoTerminar = (erro: Error | null) => {
    if (erro && !res.writableFinished) res.destroy();
  };
  if (podeInjetar && abrir !== undefined) {
    // O HTML aberto volta comprimido na mesma codificação do site (o Content-Encoding e o Vary dele
    // ficam): sem isso a página ia aberta, várias vezes maior, a quem não tem outro proxy que comprima.
    const fechar = abrir ? compressor(resposta.headers["content-encoding"]) : null;
    if (!fechar) delete cabecalhos["content-encoding"];
    delete cabecalhos["content-length"];
    res.writeHead(status, resposta.statusMessage, cabecalhos);
    const etapas = [resposta, ...(abrir ? [abrir] : []), new InjetorGuarda(), ...(fechar ? [fechar] : []), res];
    pipeline(etapas, aoTerminar);
    return;
  }
  res.writeHead(status, resposta.statusMessage, cabecalhos);
  pipeline(resposta, res, aoTerminar);
}

/**
 * `privada`: a resposta dependeu de passe ou de robô e não vai para cache compartilhado.
 * `cookiesNovos`: cookies do porteiro, postos só se o site responder 200.
 * `soCabecalhos`: pré-voo CORS; vão só o status e os cabeçalhos do site, sem o corpo.
 */
export type OpcoesRepasse = { injetarGuarda: boolean; cookiesNovos: string[]; privada: boolean; soCabecalhos?: boolean };

/**
 * Repassa o pedido ao site com o corpo em fluxo. Site fora do ar ou falha de conexão: 502 simples
 * (sem evento nem aviso). Site que não manda os cabeçalhos em `destino.tempoMs` depois do último pedaço
 * do pedido: 504, com a mesma página. Os dois casos viram uma linha no stderr (`destino.falhou`).
 * Visitante que desiste: o pedido ao site é cortado, sem derrubar nada e sem linha no stderr.
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
  let esgotado = false;
  const relogio = setTimeout(() => {
    esgotado = true;
    destino.falhou(`sem resposta em ${segundos(destino.tempoMs)} s`);
    pedidoSite.destroy();
    responderIndisponivel(res, 504);
  }, destino.tempoMs);
  // Cada pedaço do corpo que chega renova o prazo: um envio longo não vira 504.
  const adiar = () => relogio.refresh();
  const pararRelogio = () => {
    clearTimeout(relogio);
    req.off("data", adiar);
  };
  req.on("data", adiar);
  pedidoSite.on("error", (erro) => {
    pararRelogio();
    // Depois do 504, ou com o visitante já fora, o erro é o próprio corte: nada a responder.
    if (esgotado || res.destroyed) return;
    if (!res.headersSent) {
      destino.falhou(motivoDoErro(erro));
      responderIndisponivel(res);
    } else if (!res.writableFinished) res.destroy();
  });
  pedidoSite.on("response", (resposta) => {
    pararRelogio();
    try {
      entregar(resposta, res, injetar, opcoes);
    } catch {
      resposta.destroy();
      if (!res.headersSent) responderIndisponivel(res);
      else res.destroy();
    }
  });
  res.on("close", () => {
    pararRelogio();
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
  pedidoSite.on("error", (erro) => {
    if (ligado || socket.destroyed) return;
    destino.falhou(motivoDoErro(erro));
    recusarUpgrade(socket, "502 Bad Gateway");
  });
  pedidoSite.end();
}
