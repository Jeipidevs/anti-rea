import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avisos, canaisDoAmbiente } from "../../src/avisos/avisos.js";
import type { Evento } from "../../src/registro/registro.js";

const EVENTO: Evento = {
  quando: "2026-11-20T10:05:00Z",
  ip: "203.0.113.4",
  dominio: "seusite.com.br",
  caminho: "/",
  agente: "HTTrack",
  motivo: "ferramenta: httrack",
  gravidade: "copia",
  destino: "sombra",
};

type Chamada = { url: string; init: RequestInit };

function fetchFalso(status = 200): { fetchFn: typeof fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return new Response(status === 204 ? null : "ok", { status });
  }) as typeof fetch;
  return { fetchFn, chamadas };
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

const AMBIENTE_COMPLETO = {
  ANTI_REA_WHATSAPP_URL: "https://evolution.seusite.com.br/",
  ANTI_REA_WHATSAPP_INSTANCE: "avisos",
  ANTI_REA_WHATSAPP_TOKEN: "token-zap",
  ANTI_REA_WHATSAPP_TO: "5500000000000",
  ANTI_REA_TELEGRAM_TOKEN: "123:abc",
  ANTI_REA_TELEGRAM_CHAT: "-100200",
  ANTI_REA_WEBHOOK_URL: "https://seusite.com.br/gancho",
  ANTI_REA_WEBHOOK_SECRET: "segredo-do-gancho",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canaisDoAmbiente", () => {
  it("segue o exemplo do plano: canal incompleto não sobe e a falta é listada", () => {
    const { canais, faltando } = canaisDoAmbiente({ ANTI_REA_TELEGRAM_TOKEN: "1" }, ["telegram", "whatsapp"]);
    expect(canais).toHaveLength(0);
    expect(faltando).toEqual(expect.arrayContaining(["ANTI_REA_TELEGRAM_CHAT", "ANTI_REA_WHATSAPP_URL"]));
  });

  it("lista todas as variáveis ausentes de cada canal pedido, e só deles", () => {
    const { faltando } = canaisDoAmbiente({}, ["whatsapp", "webhook"]);
    expect(faltando).toEqual([
      "ANTI_REA_WHATSAPP_URL",
      "ANTI_REA_WHATSAPP_INSTANCE",
      "ANTI_REA_WHATSAPP_TOKEN",
      "ANTI_REA_WHATSAPP_TO",
      "ANTI_REA_WEBHOOK_URL",
      "ANTI_REA_WEBHOOK_SECRET",
    ]);
  });

  it("variável vazia conta como ausente", () => {
    const { canais, faltando } = canaisDoAmbiente(
      { ANTI_REA_TELEGRAM_TOKEN: "1", ANTI_REA_TELEGRAM_CHAT: "" },
      ["telegram"],
    );
    expect(canais).toHaveLength(0);
    expect(faltando).toEqual(["ANTI_REA_TELEGRAM_CHAT"]);
  });

  it("monta só os canais pedidos e completos, na ordem pedida", () => {
    const { canais, faltando } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["webhook", "telegram"]);
    expect(canais.map((c) => c.nome)).toEqual(["webhook", "telegram"]);
    expect(faltando).toEqual([]);
  });

  it("canal desconhecido vai para faltando", () => {
    const { canais, faltando } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram", "sinal"]);
    expect(canais.map((c) => c.nome)).toEqual(["telegram"]);
    expect(faltando).toEqual(["canal desconhecido: sinal"]);
  });

  it("canal pedido duas vezes sobe uma vez só", () => {
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram", "telegram"]);
    expect(canais).toHaveLength(1);
  });

  it("sem pedidos, nada sobe e nada falta", () => {
    expect(canaisDoAmbiente(AMBIENTE_COMPLETO, [])).toEqual({ canais: [], faltando: [] });
  });
});

describe("canal WhatsApp (Evolution API)", () => {
  it("faz POST em {URL sem barra final}/message/sendText/{INSTANCE} com apikey e corpo number e text", async () => {
    const { fetchFn, chamadas } = fetchFalso();
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["whatsapp"], fetchFn);
    await canais[0]!.enviar("olá", EVENTO);
    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0]!;
    expect(url).toBe("https://evolution.seusite.com.br/message/sendText/avisos");
    expect(init.method).toBe("POST");
    expect(cabecalhos(init)).toMatchObject({ apikey: "token-zap", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ number: "5500000000000", text: "olá" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resposta fora de 2xx vira erro", async () => {
    const { fetchFn } = fetchFalso(401);
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["whatsapp"], fetchFn);
    await expect(canais[0]!.enviar("olá", EVENTO)).rejects.toThrow(/401/);
  });
});

describe("canal Telegram", () => {
  it("faz POST em api.telegram.org/bot{TOKEN}/sendMessage com chat_id e text, sem parse_mode", async () => {
    const { fetchFn, chamadas } = fetchFalso();
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram"], fetchFn);
    await canais[0]!.enviar("aviso *simples*", EVENTO);
    const { url, init } = chamadas[0]!;
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(init.method).toBe("POST");
    expect(cabecalhos(init)).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "-100200", text: "aviso *simples*" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resposta fora de 2xx vira erro sem o token na mensagem", async () => {
    const { fetchFn } = fetchFalso(500);
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram"], fetchFn);
    const erro = await canais[0]!.enviar("x", EVENTO).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/500/);
    expect((erro as Error).message).not.toContain("123:abc");
  });

  it("texto acima do limite da Bot API (4096) é cortado antes do envio", async () => {
    const { fetchFn, chamadas } = fetchFalso();
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram"], fetchFn);
    await canais[0]!.enviar("B".repeat(5000), EVENTO);
    const { text } = JSON.parse(String(chamadas[0]!.init.body)) as { text: string };
    expect(text).toBe("B".repeat(4095) + "\u2026");
  });

  it("erro de rede que cite a URL não vaza o token", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      throw new TypeError(`falhou ao buscar ${String(url)}`);
    }) as typeof fetch;
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram"], fetchFn);
    const erro = (await canais[0]!.enviar("x", EVENTO).catch((e: Error) => e)) as Error;
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).not.toContain("123:abc");
  });
});

describe("canal webhook", () => {
  it("faz POST do evento em JSON com a assinatura HMAC-SHA256 do corpo exato", async () => {
    const { fetchFn, chamadas } = fetchFalso(204);
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["webhook"], fetchFn);
    await canais[0]!.enviar("texto ignorado", EVENTO);
    const { url, init } = chamadas[0]!;
    expect(url).toBe("https://seusite.com.br/gancho");
    expect(init.method).toBe("POST");
    const corpo = String(init.body);
    expect(corpo).toBe(JSON.stringify(EVENTO));
    const esperado = createHmac("sha256", "segredo-do-gancho").update(corpo).digest("hex");
    expect(cabecalhos(init)).toMatchObject({
      "content-type": "application/json",
      "x-anti-rea-signature": `sha256=${esperado}`,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resposta fora de 2xx vira erro", async () => {
    const { fetchFn } = fetchFalso(404);
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["webhook"], fetchFn);
    await expect(canais[0]!.enviar("x", EVENTO)).rejects.toThrow(/404/);
  });
});

describe("canais reais dentro de Avisos", () => {
  it("caminho enorme não derruba o Telegram nem cala os avisos seguintes do IP", async () => {
    const textos: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { text } = JSON.parse(String(init?.body)) as { text: string };
      textos.push(text);
      return new Response(null, { status: text.length > 4096 ? 400 : 200 });
    }) as typeof fetch;
    const linhas: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((texto: string | Uint8Array) => {
      linhas.push(String(texto));
      return true;
    });
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram"], fetchFn);
    let t = 0;
    const a = new Avisos({ channels: ["telegram"], groupByIpMs: 3_600_000, scans: "panel" }, canais, () => t);
    await a.receber({ ...EVENTO, caminho: "/.git/" + "A".repeat(8000) });
    for (let i = 0; i < 5; i++) await a.receber(EVENTO);
    t = 3_600_000;
    await a.receber({ ...EVENTO, caminho: "/.git/" + "A".repeat(8000) });
    expect(linhas).toEqual([]);
    expect(textos).toHaveLength(2);
    expect(textos[1]).toContain("Mais 5 tentativas deste IP");
  });

  it("falha de um canal real é registrada sem segredo e os outros recebem", async () => {
    const linhas: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((texto: string | Uint8Array) => {
      linhas.push(String(texto));
      return true;
    });
    const chamadas: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      chamadas.push(String(url));
      return new Response("", { status: String(url).includes("telegram") ? 403 : 200 });
    }) as typeof fetch;
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["telegram", "webhook"], fetchFn);
    const a = new Avisos({ channels: ["telegram", "webhook"], groupByIpMs: 3_600_000, scans: "panel" }, canais, () => 0);
    await a.receber(EVENTO);
    expect(chamadas).toHaveLength(2);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatch(/^\[anti-rea\] aviso telegram falhou: .*403/);
    for (const segredo of ["123:abc", "segredo-do-gancho", "token-zap"]) expect(linhas[0]).not.toContain(segredo);
  });
});

describe("resumo do dia pelos canais reais", () => {
  async function resumoPor(canal: string) {
    const { fetchFn, chamadas } = fetchFalso();
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, [canal], fetchFn);
    const a = new Avisos({ channels: [canal], groupByIpMs: 3_600_000, scans: "dailySummary" }, canais, () => 0);
    await a.receber({ ...EVENTO, gravidade: "varredura", motivo: "varredura: /.env" });
    expect(chamadas).toHaveLength(0);
    await a.enviarResumo();
    return chamadas;
  }
  const RESUMO = "Resumo do dia: 1 varredura barrada\nvarredura: /.env: 1";

  it("WhatsApp recebe o texto do resumo", async () => {
    const chamadas = await resumoPor("whatsapp");
    expect(chamadas).toHaveLength(1);
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({ number: "5500000000000", text: RESUMO });
  });

  it("Telegram recebe o texto do resumo", async () => {
    const chamadas = await resumoPor("telegram");
    expect(chamadas).toHaveLength(1);
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({ chat_id: "-100200", text: RESUMO });
  });

  it("webhook recebe tipo resumo, texto e quando em ISO, assinado igual", async () => {
    const chamadas = await resumoPor("webhook");
    expect(chamadas).toHaveLength(1);
    const corpo = String(chamadas[0]!.init.body);
    const json = JSON.parse(corpo) as { tipo: string; texto: string; quando: string };
    expect(Object.keys(json)).toEqual(["tipo", "texto", "quando"]);
    expect(json.tipo).toBe("resumo");
    expect(json.texto).toBe(RESUMO);
    expect(new Date(json.quando).toISOString()).toBe(json.quando);
    const esperado = createHmac("sha256", "segredo-do-gancho").update(corpo).digest("hex");
    expect(cabecalhos(chamadas[0]!.init)).toMatchObject({ "x-anti-rea-signature": `sha256=${esperado}` });
  });

  it("sem varreduras no dia, nenhum canal é chamado", async () => {
    const { fetchFn, chamadas } = fetchFalso();
    const { canais } = canaisDoAmbiente(AMBIENTE_COMPLETO, ["whatsapp", "telegram", "webhook"], fetchFn);
    await new Avisos({ channels: [], groupByIpMs: 1, scans: "dailySummary" }, canais, () => 0).enviarResumo();
    expect(chamadas).toHaveLength(0);
  });
});
