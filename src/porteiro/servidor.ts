import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Avisos } from "../avisos/avisos.js";
import type { Config } from "../config/carregar.js";
import { criarNonce, paginaDesafio } from "../deteccao/navegador/desafio.js";
import { scriptGuarda } from "../deteccao/navegador/guarda.js";
import { caminhoTrancado } from "../deteccao/servidor/caminhos.js";
import type { Sinal } from "../deteccao/servidor/ferramentas.js";
import { Ritmo } from "../deteccao/servidor/ritmo.js";
import type { Evento, Registro } from "../registro/registro.js";
import { criarResolvedorDns, type Resolvedor } from "../robos/dns.js";
import { buscarFaixasMeta, FaixasMeta } from "../robos/faixas-meta.js";
import { confirmarRobo } from "../robos/robos.js";
import { paginaSombra } from "../sombra/sombra.js";
import { caminhoIsento, decidir, type Pedido } from "./decidir.js";
import { ipReal, pedidoHttps, proxyIgnorado } from "./ip.js";
import {
  COOKIE_PASSE,
  cookieDoPorteiro,
  criarPasseDono,
  criarPasseVisitante,
  DURACAO_PASSE_DONO_MS,
  lerCookies,
  passeDoPedido,
} from "./passes.js";
import { caminhoAmbiguo, caminhoDoAlvo, caminhoDoPorteiro, dominioDoHost, normalizarCaminho } from "./pedido.js";
import { buscarHtml, CachePrevia } from "./previa.js";
import { criarDestino, recusarUpgrade, repassarPedido, repassarUpgrade } from "./repasse.js";
import { enviar, responderDesafio, responderRecusa, responderSombra, responderTexto } from "./respostas.js";
import { rotaGuarda, rotaPego, rotaVerificar, type ContextoRota } from "./rotas.js";
import { agendarTarefas } from "./tarefas.js";

export type DepsPorteiro = {
  segredo: string;
  versaoDono: number;
  registro: Registro;
  avisos: Avisos;
  /** Padrão 8080; 0 escolhe uma porta livre. */
  porta?: number;
  /** Padrão "0.0.0.0". */
  host?: string;
  dns?: Resolvedor;
  meta?: FaixasMeta;
  agora?: () => number;
  /** Quanto o site tem para começar a responder; padrão TEMPO_SITE_MS (60 s). */
  tempoDoSiteMs?: number;
  /** Quanto o desligamento espera os pedidos em andamento; padrão PRAZO_DESLIGAR_MS (8 s). */
  prazoDesligarMs?: number;
};

export type Porteiro = { porta: number; fechar(): Promise<void> };

/** Mais de 30 navegações em 10 s com o mesmo passe (ou do mesmo IP, sem verificação) é rápido demais. */
export const RITMO_LIMITE = 30;
export const RITMO_JANELA_MS = 10_000;
/** Onde o navegador diz que o pedido é pré-carga ou pré-renderização. */
const CABECALHOS_DE_PROPOSITO = ["sec-purpose", "purpose", "x-purpose", "x-sec-purpose", "x-moz"];
/**
 * Conexão ociosa fica aberta mais que no proxy da frente (Traefik guarda 90 s): quem fecha é ele, e
 * ele nunca manda um pedido numa conexão que o porteiro acabou de fechar.
 */
export const KEEP_ALIVE_MS = 95_000;
/** Tempo para os cabeçalhos de um pedido chegarem; fica acima do keep-alive, como o Node pede. */
export const CABECALHOS_MS = 96_000;
/** O desligamento espera até 8 s pelos pedidos em andamento: o Docker mata o processo em 10 s. */
export const PRAZO_DESLIGAR_MS = 8_000;
/** Tamanho máximo de caminho e agente no evento do registro. */
const MAX_CAMPO_EVENTO = 300;

const SEM_PASSE: Sinal = { motivo: "sem passe", gravidade: "varredura" };
const AMBIGUO: Sinal = { motivo: "caminho ambíguo", gravidade: "varredura" };
const DONO_ERRADO: Sinal = { motivo: "link de dono errado", gravidade: "copia" };
const UPGRADE_NAO_SUPORTADO: Sinal = { motivo: "upgrade não suportado", gravidade: "varredura" };

function cortar(texto: string, max: number): string {
  const pontos = Array.from(texto);
  return pontos.length > max ? pontos.slice(0, max).join("") : texto;
}

/** Valor de cabeçalho como texto único (um nome repetido vira lista separada por vírgula). */
function cabecalhoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor.join(", ") : valor;
}

/** Upgrade que o porteiro repassa: só WebSocket. h2c e afins abririam um túnel que pula o porteiro. */
function ehWebSocket(upgrade: string | string[] | undefined): boolean {
  return (cabecalhoUnico(upgrade) ?? "").trim().toLowerCase() === "websocket";
}

const LIGUE_TRUST_PROXY =
  "[anti-rea] pedido de IP interno com X-Forwarded-For: ligue trustProxy (true atrás de nginx, Traefik, " +
  "EasyPanel ou Coolify; cloudflare atrás da Cloudflare). Sem ele, todo visitante fica com o IP do proxy. " +
  "Veja docs/02-instalar.md.\n";

function falhaInterna(erro: unknown): void {
  const motivo = erro instanceof Error ? erro.message : String(erro);
  process.stderr.write(`[anti-rea] erro ao atender um pedido: ${motivo}\n`);
}

/**
 * Sobe o porteiro: decide cada pedido, responde sombra, desafio ou recusa, ou repassa ao site em
 * fluxo. `fechar()` para o servidor, as tarefas periódicas e os túneis, espera os pedidos em andamento
 * (até PRAZO_DESLIGAR_MS) e manda os avisos pendentes.
 */
export async function iniciarPorteiro(cfg: Config, deps: DepsPorteiro): Promise<Porteiro> {
  const relogio = deps.agora ?? Date.now;
  const dns = deps.dns ?? criarResolvedorDns();
  const meta = deps.meta ?? new FaixasMeta(() => buscarFaixasMeta());
  const ritmo = new Ritmo(RITMO_LIMITE, RITMO_JANELA_MS);
  const destino = criarDestino(cfg.upstream, { tempoMs: deps.tempoDoSiteMs, agora: relogio });
  const previas = new CachePrevia(relogio);
  const fechamento = new AbortController();
  const tuneis = new Set<Duplex>();
  const guarda = scriptGuarda({ sondarPausa: cfg.check.devtoolsIsCaught });
  const dominios = new Set(cfg.domains.map((d) => d.toLowerCase()));
  const { segredo, versaoDono } = deps;
  /** Só atrás da Cloudflare o CF-Connecting-IP é dela e segue para o site. */
  const cloudflare = cfg.trustProxy === "cloudflare";
  let proxyAvisado = false;

  /** Uma linha no stderr, uma vez só, quando há um proxy na frente e o trustProxy está desligado. */
  function conferirProxy(req: IncomingMessage): void {
    if (proxyAvisado || !proxyIgnorado(req, cfg.trustProxy)) return;
    proxyAvisado = true;
    process.stderr.write(LIGUE_TRUST_PROXY);
  }

  function gravar(e: Evento, avisar: boolean): void {
    deps.registro.gravar(e);
    // Sem esperar: o canal pode levar segundos e o visitante não espera por isso.
    if (avisar) void deps.avisos.receber(e).catch(falhaInterna);
  }

  /** Host do pedido para buscar a prévia, só quando é um dos domínios configurados. */
  function hostDaPrevia(host: string | undefined): string | undefined {
    if (!host || !/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return undefined;
    return dominios.has(dominioDoHost(host)) ? host : undefined;
  }

  /**
   * Tela de verificação com a prévia do caminho. A prévia é buscada sem a query: link de uso único
   * (login por e-mail, troca de senha) leva o código na query e seria gasto antes da pessoa passar.
   */
  async function desafio(req: IncomingMessage, caminho: string, agora: number): Promise<string> {
    const host = hostDaPrevia(req.headers.host);
    const semQuery = caminho.split(/[?#]/, 1)[0] ?? "/";
    const previa = await previas.obter(`${host ?? ""} ${semQuery}`, () => buscarHtml(destino, semQuery, host, fechamento.signal));
    return paginaDesafio({
      nonce: criarNonce(segredo, agora),
      previa,
      idioma: cfg.shadow.language,
      sondarPausa: cfg.check.devtoolsIsCaught,
    });
  }

  /** O pedido como `decidir` o vê. */
  function lerPedido(req: IncomingMessage, caminho: string): Pedido {
    return {
      metodo: req.method ?? "GET",
      caminho,
      agente: req.headers["user-agent"],
      accept: req.headers.accept,
      cookie: req.headers.cookie,
      corsMetodo: cabecalhoUnico(req.headers["access-control-request-method"]),
      proposito: CABECALHOS_DE_PROPOSITO.map((nome) => cabecalhoUnico(req.headers[nome]) ?? "").join(" "),
      destinoFetch: cabecalhoUnico(req.headers["sec-fetch-dest"]),
      ip: ipReal(req, cfg.trustProxy),
      dominio: dominioDoHost(req.headers.host),
      https: pedidoHttps(req, cfg.trustProxy),
    };
  }

  function criarEvento(p: Pedido, agora: number, sinal: Sinal, destinoEvento: Evento["destino"]): Evento {
    return {
      quando: new Date(agora).toISOString(),
      ip: p.ip,
      dominio: p.dominio,
      caminho: cortar(p.caminho, MAX_CAMPO_EVENTO),
      agente: cortar(p.agente ?? "", MAX_CAMPO_EVENTO),
      motivo: sinal.motivo,
      gravidade: sinal.gravidade,
      destino: destinoEvento,
    };
  }

  async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    req.on("error", () => {});
    res.on("error", () => {});
    const agora = relogio();
    const caminho = caminhoDoAlvo(req.url ?? "");
    if (caminho === null) return responderTexto(res, 400, "Pedido inválido.");
    conferirProxy(req);
    const p = lerPedido(req, caminho);
    const { https } = p;
    const evento = (sinal: Sinal, destinoEvento: Evento["destino"]) => criarEvento(p, agora, sinal, destinoEvento);
    const sombra = (status: 200 | 404) =>
      responderSombra(res, paginaSombra(cfg.shadow, { ip: p.ip, caminho, quando: new Date(agora) }), status);

    const d = await decidir(p, {
      cfg,
      segredo,
      versaoDono,
      ritmo,
      agora,
      confirmarRobo: (robo, ip) => confirmarRobo(robo, ip, { dns, meta, agora }),
    });

    switch (d.acao) {
      case "sombra":
        gravar(evento(d.sinal, "sombra"), true);
        return sombra(d.status);
      case "recusar":
        if (d.status === 400) {
          gravar(evento(AMBIGUO, "recusado"), true);
          return responderTexto(res, 400, "Pedido inválido.");
        }
        // 404: rota do porteiro que não existe, ou arquivo trancado com passe de dono. Sem evento.
        if (d.status === 404) return responderTexto(res, 404, "Não encontrado.");
        gravar(evento(SEM_PASSE, "recusado"), true);
        return responderRecusa(res);
      case "verificar":
        return responderDesafio(res, await desafio(req, caminho, agora));
      case "dono": {
        if (!d.valido) {
          gravar(evento(DONO_ERRADO, "sombra"), true);
          return sombra(200);
        }
        const passe = cookieDoPorteiro(COOKIE_PASSE, criarPasseDono(segredo, versaoDono, agora), DURACAO_PASSE_DONO_MS, https);
        // Destino fixo: nada do pedido entra no Location.
        return enviar(res, 302, { location: "/", "set-cookie": [passe], "cache-control": "no-store" });
      }
      case "interno": {
        if (d.rota === "guarda") return rotaGuarda(req, res, guarda);
        const c: ContextoRota = {
          cfg,
          segredo,
          versaoDono,
          agora,
          https,
          registrar: (sinal) => gravar(evento(sinal, "sombra"), true),
        };
        return d.rota === "verificar" ? rotaVerificar(req, res, c) : rotaPego(req, res, c);
      }
      case "repassar": {
        // Robô não confirmado: passa e fica registrado, sem aviso.
        if (d.registrar) gravar(evento(d.registrar, "registrado"), false);
        const duracao = cfg.check.passDurationMs;
        const cookiesNovos = d.emitirPasse
          ? [cookieDoPorteiro(COOKIE_PASSE, criarPasseVisitante(segredo, duracao, agora), duracao, https)]
          : [];
        return repassarPedido(
          req,
          res,
          destino,
          { caminho, ip: p.ip, https, cloudflare },
          { injetarGuarda: d.injetarGuarda, cookiesNovos, privada: !d.publico, soCabecalhos: d.soCabecalhos === true },
        );
      }
    }
  }

  /**
   * Upgrade: só WebSocket, e só com passe válido (visitante ou dono) ou em caminho isento. Outro
   * valor (h2c e afins) recebe 400 e fica registrado como varredura. Arquivo trancado e o resto de
   * /.anti-rea/ recebem 404 e nunca chegam ao site, como no pedido comum.
   */
  function tratarUpgrade(req: IncomingMessage, socket: Duplex, cabeca: Buffer): void {
    socket.on("error", () => socket.destroy());
    const caminho = caminhoDoAlvo(req.url ?? "");
    const agora = relogio();
    if (!ehWebSocket(req.headers.upgrade)) {
      gravar(criarEvento(lerPedido(req, caminho ?? req.url ?? ""), agora, UPGRADE_NAO_SUPORTADO, "recusado"), true);
      recusarUpgrade(socket, "400 Bad Request", "Pedido inválido.");
      return;
    }
    const normalizado = caminho === null ? "" : normalizarCaminho(caminho);
    if (caminhoDoPorteiro(normalizado) || caminhoTrancado(normalizado) !== null) {
      recusarUpgrade(socket, "404 Not Found", "Não encontrado.");
      return;
    }
    const comPasse = passeDoPedido(lerCookies(req.headers.cookie), segredo, versaoDono, agora) !== null;
    const liberado = caminho !== null && !caminhoAmbiguo(caminho) && (comPasse || caminhoIsento(caminho, cfg.exempt));
    if (caminho === null || fechamento.signal.aborted || !liberado) {
      recusarUpgrade(socket, "403 Forbidden", "Acesso negado.");
      return;
    }
    const origem = { caminho, ip: ipReal(req, cfg.trustProxy), https: pedidoHttps(req, cfg.trustProxy), cloudflare };
    repassarUpgrade(req, socket, cabeca, destino, origem, tuneis);
  }

  const servidor = http.createServer((req, res) => {
    tratar(req, res).catch((erro: unknown) => {
      falhaInterna(erro);
      if (!res.headersSent) responderTexto(res, 500, "Erro interno.");
      else res.destroy();
    });
  });
  servidor.keepAliveTimeout = KEEP_ALIVE_MS;
  servidor.headersTimeout = CABECALHOS_MS;
  servidor.on("upgrade", (req: IncomingMessage, socket: Duplex, cabeca: Buffer) => {
    try {
      tratarUpgrade(req, socket, cabeca);
    } catch (erro) {
      falhaInterna(erro);
      socket.destroy();
    }
  });

  await new Promise<void>((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(deps.porta ?? 8080, deps.host ?? "0.0.0.0", () => {
      servidor.off("error", rejeitar);
      resolver();
    });
  });
  servidor.on("error", falhaInterna);

  meta.aquecer(relogio());
  const pararTarefas = agendarTarefas({ scans: cfg.alerts.scans, registro: deps.registro, avisos: deps.avisos, agora: relogio });

  /**
   * Para de aceitar conexões e fecha as ociosas na hora (e cada uma que fica ociosa depois); os pedidos
   * em andamento têm até o prazo para terminar, e o que sobrar é fechado. Os túneis de WebSocket caem
   * logo. Enquanto isso, os avisos pendentes saem (`avisos.encerrar`), dentro do mesmo prazo.
   */
  async function desligar(): Promise<void> {
    pararTarefas();
    fechamento.abort();
    for (const s of tuneis) s.destroy();
    const parado = new Promise<void>((resolver) => servidor.close(() => resolver()));
    servidor.closeIdleConnections();
    const ociosas = setInterval(() => servidor.closeIdleConnections(), 50);
    const avisosPendentes = deps.avisos.encerrar(relogio()).catch(falhaInterna);
    let prazo: NodeJS.Timeout | undefined;
    const esgotado = new Promise<void>((resolver) => {
      prazo = setTimeout(resolver, deps.prazoDesligarMs ?? PRAZO_DESLIGAR_MS);
    });
    await Promise.race([Promise.all([parado, avisosPendentes]), esgotado]);
    clearTimeout(prazo);
    clearInterval(ociosas);
    servidor.closeAllConnections();
    for (const s of tuneis) s.destroy();
    await parado;
    destino.agente.destroy();
  }

  let fechado: Promise<void> | undefined;
  return {
    porta: (servidor.address() as { port: number }).port,
    fechar(): Promise<void> {
      fechado ??= desligar();
      return fechado;
    },
  };
}
