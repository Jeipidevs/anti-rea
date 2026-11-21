import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resolvedor } from "../../src/robos/dns.js";
import { CHROME, HTML, esperar, limparTudo, montar, pedir } from "./apoio-servidor.js";

// Operação do porteiro: site lento ou fora do ar, conexões ociosas e desligamento.

afterEach(async () => {
  vi.restoreAllMocks();
  await limparTudo();
});

/** Linhas que o porteiro escreve no stderr sobre falha do site. */
function espiarFalhasDoSite(): string[] {
  const linhas: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  vi.spyOn(process.stderr, "write").mockImplementation(((texto: string | Uint8Array, ...resto: never[]) => {
    if (String(texto).includes("falha no site")) {
      linhas.push(String(texto));
      return true;
    }
    return original(texto, ...resto);
  }) as typeof process.stderr.write);
  return linhas;
}

/** Pedido que só resolve com o status ou com o erro da conexão. */
function pedirStatus(porta: number, caminho: string, headers: http.OutgoingHttpHeaders): Promise<number | string> {
  return new Promise((resolver) => {
    const r = http.request({ host: "127.0.0.1", port: porta, path: caminho, headers: { "user-agent": CHROME, ...headers }, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolver(res.statusCode!));
      res.on("error", (e: NodeJS.ErrnoException) => resolver(e.code ?? e.message));
    });
    r.on("error", (e: NodeJS.ErrnoException) => resolver(e.code ?? e.message));
    r.end();
  });
}

describe("porteiro: site lento ou fora do ar", () => {
  it("site que aceita e não responde: 504 com a página de indisponível no tempo máximo, e uma linha no stderr", async () => {
    const linhas = espiarFalhasDoSite();
    const t = await montar({}, { tempoDoSiteMs: 300 });
    const passe = await t.passe();
    const inicio = Date.now();
    const r = await t.get("/mudo", { cookie: passe });
    expect(r.status).toBe(504);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(280);
    expect(r.texto).toContain("Site temporariamente indisponível");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(linhas).toEqual([
      `[anti-rea] falha no site http://127.0.0.1:${t.site.porta}: sem resposta em 0,3 s. O visitante recebeu a página de indisponível (no máximo uma linha destas por minuto).\n`,
    ]);
    expect(t.eventos()).toEqual([]);
  });

  it("upstreamTimeout da configuração é o prazo do site", async () => {
    espiarFalhasDoSite();
    const t = await montar({ upstreamTimeout: "1s" });
    const passe = await t.passe();
    const inicio = Date.now();
    const r = await t.get("/mudo", { cookie: passe });
    const levou = Date.now() - inicio;
    expect(r.status).toBe(504);
    expect(levou).toBeGreaterThanOrEqual(950);
    expect(levou).toBeLessThan(4_000);
    // A página que leva 1,5 s passa com um prazo maior.
    const folgado = await montar({ upstreamTimeout: "3s" });
    expect((await folgado.get("/lento", { cookie: await folgado.passe() })).status).toBe(200);
  });

  it("corpo que chega devagar renova o tempo: o envio longo não vira 504", async () => {
    const t = await montar({}, { tempoDoSiteMs: 1_000 });
    const status = await new Promise<number>((resolver, rejeitar) => {
      const r = http.request(
        { host: "127.0.0.1", port: t.porteiro.porta, path: "/api/webhook/x", method: "POST", headers: { "content-type": "application/json" }, agent: false },
        (res) => {
          res.resume();
          resolver(res.statusCode!);
        },
      );
      r.on("error", rejeitar);
      let partes = 0;
      const enviar = setInterval(() => {
        r.write("x".repeat(100));
        if (++partes === 6) {
          clearInterval(enviar);
          r.end();
        }
      }, 300);
    });
    expect(status).toBe(200);
  });

  it("site fora do ar: 502 e uma linha no stderr com o código, no máximo uma por minuto", async () => {
    const linhas = espiarFalhasDoSite();
    let agora = Date.now();
    const t = await montar({}, { agora: () => agora });
    const passe = await t.passe();
    await t.site.fechar();
    expect((await t.get("/a", { cookie: passe })).status).toBe(502);
    expect((await t.get("/b", { cookie: passe })).status).toBe(502);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain(": ECONNREFUSED.");
    agora += 59_999;
    expect((await t.get("/c", { cookie: passe })).status).toBe(502);
    expect(linhas).toHaveLength(1);
    agora += 1;
    expect((await t.get("/d", { cookie: passe })).status).toBe(502);
    expect(linhas).toHaveLength(2);
  });

  it("visitante que desiste antes da resposta não vira linha no stderr", async () => {
    const linhas = espiarFalhasDoSite();
    const t = await montar({}, { tempoDoSiteMs: 5_000 });
    const passe = await t.passe();
    const r = http.request({ host: "127.0.0.1", port: t.porteiro.porta, path: "/mudo", headers: { "user-agent": CHROME, cookie: passe }, agent: false });
    r.on("error", () => {});
    r.end();
    await esperar(() => t.site.recebidos.some((p) => p.url === "/mudo"));
    r.destroy();
    await new Promise((ok) => setTimeout(ok, 100));
    expect(linhas).toEqual([]);
  });
});

/** Conexão crua com keep-alive: manda um pedido e devolve o texto da resposta. */
async function conexaoViva(porta: number) {
  const socket = net.connect(porta, "127.0.0.1");
  await once(socket, "connect");
  let recebido = "";
  let fechada = false;
  socket.on("data", (d: Buffer) => (recebido += d.toString("latin1")));
  socket.on("close", () => (fechada = true));
  socket.on("error", () => {});
  return {
    socket,
    fechada: () => fechada,
    /** Pede a guarda.js e espera a resposta inteira (cabeçalhos e o corpo do Content-Length). */
    async pedir(): Promise<void> {
      const antes = recebido.length;
      socket.write("GET /.anti-rea/guarda.js HTTP/1.1\r\nHost: seusite.com.br\r\nConnection: keep-alive\r\n\r\n");
      await esperar(() => {
        const resposta = recebido.slice(antes);
        const fim = resposta.indexOf("\r\n\r\n");
        const tamanho = Number(/content-length: (\d+)/i.exec(resposta.slice(0, fim))?.[1]);
        return fim >= 0 && resposta.length >= fim + 4 + tamanho;
      });
    },
  };
}

describe("porteiro: conexões ociosas", () => {
  it("guarda a conexão ociosa por mais que o padrão do Node (5 s): o proxy da frente é quem fecha", async () => {
    const t = await montar();
    const c = await conexaoViva(t.porteiro.porta);
    await c.pedir();
    await new Promise((ok) => setTimeout(ok, 6_500));
    expect(c.fechada()).toBe(false);
    await c.pedir();
    c.socket.destroy();
  }, 15_000);
});

describe("porteiro: desligamento", () => {
  it("fecha a conexão ociosa na hora e espera o pedido em andamento terminar", async () => {
    const t = await montar();
    const passe = await t.passe();
    const ociosa = await conexaoViva(t.porteiro.porta);
    await ociosa.pedir();
    const emAndamento = pedir(t.porteiro.porta, "/lento", { headers: { cookie: passe } });
    await esperar(() => t.site.recebidos.some((p) => p.url === "/lento"));
    const inicio = Date.now();
    const fechado = t.porteiro.fechar();
    await esperar(() => ociosa.fechada(), 500);
    const r = await emAndamento;
    expect(r.status).toBe(200);
    expect(r.texto).toBe("tarde");
    await fechado;
    expect(Date.now() - inicio).toBeLessThan(5_000);
    expect(await pedirStatus(t.porteiro.porta, "/", {})).toBe("ECONNREFUSED");
  });

  it("passado o prazo, fecha o que ainda está aberto", async () => {
    const t = await montar({}, { prazoDesligarMs: 300 });
    const passe = await t.passe();
    const preso = pedirStatus(t.porteiro.porta, "/mudo", { cookie: passe });
    await esperar(() => t.site.recebidos.some((p) => p.url === "/mudo"));
    const inicio = Date.now();
    await t.porteiro.fechar();
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(await preso).toBe("ECONNRESET");
  });

  it("descarrega os avisos pendentes: o agrupado do teto sai antes de parar", async () => {
    const t = await montar({ trustProxy: true });
    for (let i = 0; i < 7; i++) await t.get("/", { "user-agent": "Wget/1.21", "x-forwarded-for": `198.51.100.${i}` });
    await esperar(() => t.enviados.length === 6);
    await new Promise((ok) => setTimeout(ok, 50));
    expect(t.enviados).toHaveLength(6);
    await t.porteiro.fechar();
    expect(t.enviados).toHaveLength(7);
    expect(t.enviados[6]).toMatch(/^Muitas tentativas ao mesmo tempo: 1 tentativas de 1 IPs desde /);
  });

  it("a tentativa que termina durante a espera também conta: a contagem do repetido sai antes de parar", async () => {
    let soltarDns: (() => void) | undefined;
    const dnsPreso: Resolvedor = {
      reverso: () =>
        new Promise((ok) => {
          soltarDns = () => ok(["mentira.example.com"]);
        }),
      direto: async () => [],
    };
    const t = await montar({ trustProxy: true }, { dns: dnsPreso, prazoDesligarMs: 3_000 });
    const IP = "198.51.100.240";
    await t.get("/", { "user-agent": "Wget/1.21", "x-forwarded-for": IP });
    await esperar(() => t.enviados.length === 1);
    // Googlebot falso do mesmo IP: a conferência do DNS ainda corre quando o porteiro começa a parar.
    const falso = pedirStatus(t.porteiro.porta, "/", { "user-agent": "Googlebot/2.1", "x-forwarded-for": IP });
    await esperar(() => soltarDns !== undefined);
    const fechado = t.porteiro.fechar();
    await new Promise((ok) => setTimeout(ok, 50));
    soltarDns!();
    await falso;
    await fechado;
    expect(t.enviados.at(-1), t.enviados.join(" | ")).toMatch(/^Mais 1 tentativas de 198\.51\.100\.240 em .* desde /);
  });
});

describe("porteiro: prévia na tela de verificação", () => {
  const WHATSAPP = "WhatsApp/2.23.20.0";

  it("gente espera a prévia no máximo 300 ms; a busca termina em segundo plano e serve o próximo pedido", async () => {
    const t = await montar();
    const inicio = Date.now();
    const r1 = await t.get("/devagar", { accept: HTML });
    // O site leva 1,5 s; a tela saiu bem antes, sem a prévia.
    expect(Date.now() - inicio).toBeLessThan(1_200);
    expect(r1.texto).toContain("Verificando seu navegador");
    expect(r1.texto).not.toContain("Página Devagar");
    // A busca terminou em segundo plano: um pedido seguinte leva a prévia, sem buscar de novo.
    let texto = "";
    for (const fim = Date.now() + 5_000; !texto.includes("Página Devagar") && Date.now() < fim; ) {
      texto = (await t.get("/devagar", { accept: HTML })).texto;
    }
    expect(texto).toContain('<meta property="og:title" content="Página Devagar">');
    expect(t.site.recebidos.filter((p) => p.url === "/devagar")).toHaveLength(1);
  });

  it("leitor de prévia fora da lista, que não pede HTML, também espera a busca inteira", async () => {
    // O gerador de prévia da Evolution (Baileys) e outros leitores de link sem agente conhecido.
    const t = await montar();
    const inicio = Date.now();
    const r = await t.get("/devagar-leitor", { "user-agent": "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)", accept: "*/*" });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1_400);
    expect(r.texto).toContain('<meta property="og:title" content="Página Devagar">');
  });

  it("robô de prévia conhecido espera a busca e leva a prévia já no primeiro pedido", async () => {
    const t = await montar();
    const inicio = Date.now();
    const r = await t.get("/devagar-robo", { "user-agent": WHATSAPP, accept: HTML });
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1_400);
    expect(r.texto).toContain('<meta property="og:title" content="Página Devagar">');
  });

  it("site com erro 5xx na prévia: a falha fica guardada só 30 s", async () => {
    let agora = Date.now();
    const t = await montar({}, { agora: () => agora });
    const buscas = () => t.site.recebidos.filter((p) => p.url === "/quebrado").length;
    const r = await t.get("/quebrado", { accept: HTML });
    expect(r.texto).not.toContain("Erro do proxy");
    await esperar(() => buscas() === 1);
    agora += 29_000;
    await t.get("/quebrado", { accept: HTML });
    expect(buscas()).toBe(1);
    agora += 1_100;
    await t.get("/quebrado", { accept: HTML });
    await esperar(() => buscas() === 2);
  });
});
