import { describe, expect, it } from "vitest";
import { validarConfig, type Config } from "../../src/config/carregar.js";
import { Ritmo } from "../../src/deteccao/servidor/ritmo.js";
import { codigoDeDono, criarPasse } from "../../src/passe/passe.js";
import { decidir, type Decisao, type Pedido } from "../../src/porteiro/decidir.js";
import { criarMarcaPego, criarPasseDono } from "../../src/porteiro/passes.js";
import type { Confirmacao, Robo } from "../../src/robos/robos.js";

const SEGREDO = "s".repeat(43);
const AGORA = Date.UTC(2026, 10, 20, 12, 0, 0);
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const IP_GOOGLE = "66.249.66.1";
const IP_DUVIDA = "203.0.113.50";

function config(extra: Record<string, unknown> = {}): Config {
  return validarConfig({
    upstream: "http://localhost:3000",
    domains: ["seusite.com.br"],
    exempt: ["/api/webhook/*", "/health"],
    ...extra,
  });
}

type Ctx = Parameters<typeof decidir>[1];

function ctx(parcial: Partial<Ctx> = {}): Ctx & { robosPerguntados: string[] } {
  const robosPerguntados: string[] = [];
  return {
    cfg: config(),
    segredo: SEGREDO,
    versaoDono: 1,
    ritmo: new Ritmo(30, 10_000),
    confirmarRobo: async (r: Robo, ip: string): Promise<Confirmacao> => {
      robosPerguntados.push(`${r.nome}|${ip}`);
      if (ip === IP_GOOGLE) return "sim";
      if (ip === IP_DUVIDA) return "incerto";
      return "nao";
    },
    agora: AGORA,
    robosPerguntados,
    ...parcial,
  };
}

function pedido(parcial: Partial<Pedido> = {}): Pedido {
  return {
    metodo: "GET",
    caminho: "/",
    agente: CHROME,
    accept: HTML,
    ip: "203.0.113.7",
    dominio: "seusite.com.br",
    https: true,
    ...parcial,
  };
}

const SETE_DIAS = 7 * 86_400_000;
/** Passe recém-emitido, com a validade padrão (7 d): ainda não é hora de renovar. */
const passeVisitante = () => `anti_rea_passe=${criarPasse(SEGREDO, "visitante", SETE_DIAS, AGORA)}`;
const passeDono = (versao = 1) => `anti_rea_passe=${criarPasseDono(SEGREDO, versao, AGORA)}`;
const marcaPego = () => `anti_rea_pego=${criarMarcaPego(SEGREDO, AGORA)}`;

const repassar = (injetarGuarda: boolean): Decisao => ({ acao: "repassar", injetarGuarda });
/** Repasse cuja resposta é a mesma para todo mundo (isento ou mídia): a CDN pode guardar. */
const publico = (injetarGuarda: boolean): Decisao => ({ acao: "repassar", injetarGuarda, publico: true });
const sombra = (motivo: string, gravidade: "copia" | "varredura" | "ataque", status: 200 | 404): Decisao => ({
  acao: "sombra",
  sinal: { motivo, gravidade },
  status,
});

describe("decidir: link de dono", () => {
  it("código certo vale, errado e de versão antiga não valem", async () => {
    const certo = codigoDeDono(SEGREDO, 1);
    expect(await decidir(pedido({ caminho: `/.anti-rea/dono/${certo}` }), ctx())).toEqual({ acao: "dono", valido: true });
    expect(await decidir(pedido({ caminho: `/.anti-rea/dono/${certo}?utm=x` }), ctx())).toEqual({ acao: "dono", valido: true });
    expect(await decidir(pedido({ caminho: "/.anti-rea/dono/AAAAAAAAAAAAAAAAAAAAAAAA" }), ctx())).toEqual({ acao: "dono", valido: false });
    expect(await decidir(pedido({ caminho: "/.anti-rea/dono/" }), ctx())).toEqual({ acao: "dono", valido: false });
    expect(await decidir(pedido({ caminho: `/.anti-rea/dono/${certo}/x` }), ctx())).toEqual({ acao: "dono", valido: false });
    const antigo = codigoDeDono(SEGREDO, 1);
    expect(await decidir(pedido({ caminho: `/.anti-rea/dono/${antigo}` }), ctx({ versaoDono: 2 }))).toEqual({
      acao: "dono",
      valido: false,
    });
  });

  it("vale até para agente de ferramenta (o link é a senha)", async () => {
    const certo = codigoDeDono(SEGREDO, 1);
    expect(await decidir(pedido({ caminho: `/.anti-rea/dono/${certo}`, agente: "curl/8.7.1" }), ctx())).toEqual({
      acao: "dono",
      valido: true,
    });
  });
});

describe("decidir: rotas internas", () => {
  it("verificar, guarda.js e pego viram interno", async () => {
    expect(await decidir(pedido({ metodo: "POST", caminho: "/.anti-rea/verificar" }), ctx())).toEqual({ acao: "interno", rota: "verificar" });
    expect(await decidir(pedido({ caminho: "/.anti-rea/guarda.js" }), ctx())).toEqual({ acao: "interno", rota: "guarda" });
    expect(await decidir(pedido({ metodo: "POST", caminho: "/.anti-rea/pego" }), ctx())).toEqual({ acao: "interno", rota: "pego" });
    expect(await decidir(pedido({ caminho: "//.anti-rea//guarda.js?v=1" }), ctx())).toEqual({ acao: "interno", rota: "guarda" });
  });
});

describe("decidir: caminho do porteiro que não é rota", () => {
  it("tudo sob /.anti-rea/ que não é rota sai 404 e nunca vai ao site, com ou sem passe", async () => {
    for (const caminho of ["/.anti-rea/registro/2026-11-20.jsonl", "/.anti-rea/", "/.anti-rea", "/.ANTI-REA/x", "//.anti-rea//x", "/.anti-rea/guarda.js/x", "/.anti-rea/.env"]) {
      expect(await decidir(pedido({ caminho, accept: "*/*" }), ctx()), caminho).toEqual({ acao: "recusar", status: 404 });
      expect(await decidir(pedido({ caminho, cookie: passeDono() }), ctx()), caminho).toEqual({ acao: "recusar", status: 404 });
      expect(await decidir(pedido({ caminho, agente: "curl/8.7.1" }), ctx()), caminho).toEqual({ acao: "recusar", status: 404 });
    }
    expect(await decidir(pedido({ caminho: "/.anti-reax" }), ctx())).toEqual({ acao: "verificar" });
  });
});

describe("decidir: arquivos trancados", () => {
  it(".map vai à sombra 404 como cópia, com e sem passe", async () => {
    const esperado = sombra("mapa de código", "copia", 404);
    expect(await decidir(pedido({ caminho: "/app.js.map" }), ctx())).toEqual(esperado);
    expect(await decidir(pedido({ caminho: "/app.js.map", cookie: passeVisitante() }), ctx())).toEqual(esperado);
  });

  it("/.env sem passe é varredura; com passe de visitante sobe para cópia", async () => {
    expect(await decidir(pedido({ caminho: "/.env", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
    expect(await decidir(pedido({ caminho: "/.env", cookie: passeVisitante() }), ctx())).toEqual(sombra("arquivo sensível", "copia", 404));
  });

  it("passe de dono não destranca arquivo trancado, mas sai 404 sem evento (o F12 do dono busca o .map)", async () => {
    for (const caminho of ["/.env", "/api/.env", "/_next/static/app.js.map", "/backup.zip"]) {
      expect(await decidir(pedido({ caminho, cookie: passeDono(), accept: "*/*" }), ctx()), caminho).toEqual({ acao: "recusar", status: 404 });
    }
  });

  it(".env e backups em qualquer pasta, também em caminho isento e com passe de visitante", async () => {
    expect(await decidir(pedido({ caminho: "/api/webhook/.env", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
    expect(await decidir(pedido({ caminho: "/backend/.env", cookie: passeVisitante() }), ctx())).toEqual(sombra("arquivo sensível", "copia", 404));
    expect(await decidir(pedido({ caminho: "/uploads/backup-2026.tar.gz", cookie: passeVisitante() }), ctx())).toEqual(
      sombra("arquivo de backup", "varredura", 404),
    );
  });

  it("backup pedido com passe de visitante fica trancado, mas não vira cópia: pode ser um download do site", async () => {
    for (const caminho of ["/downloads/backup-manager.zip", "/docs/x.save", "/exemplos/schema.sql", "/a.bak"]) {
      expect(await decidir(pedido({ caminho, cookie: passeVisitante() }), ctx()), caminho).toEqual(
        sombra("arquivo de backup", "varredura", 404),
      );
    }
    // Segredo continua sendo cópia com passe: navegador nenhum pede .git ou wp-config.php.bak sozinho.
    for (const caminho of ["/.git/config", "/wp-config.php.bak"]) {
      expect(await decidir(pedido({ caminho, cookie: passeVisitante() }), ctx()), caminho).toEqual(sombra("arquivo sensível", "copia", 404));
    }
  });

  it("caminho normalizado não escapa: barras dobradas, %xx, ponto-ponto, query e barra invertida", async () => {
    for (const caminho of ["//.env", "/%2e%65nv", "/%2E%65NV", "/x/../.env", "/x/%2e%2e/.env", "/.env?x=1", "/a%2f..%2f.env", "/\\.env", "/%5c.git/config", "///.git//config"]) {
      const d = await decidir(pedido({ caminho, agente: "curl/8.7.1" }), ctx());
      expect(d, caminho).toEqual(sombra("arquivo sensível", "varredura", 404));
    }
    expect(await decidir(pedido({ caminho: "/%61pp.js.map" }), ctx())).toEqual(sombra("mapa de código", "copia", 404));
  });

  it("%xx malformado fica cru e não quebra", async () => {
    expect(await decidir(pedido({ caminho: "/%E0%A4%A", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("curl", "copia", 200));
  });
});

describe("decidir: passe de dono e isentos", () => {
  it("passe de dono passa até com agente curl, sem guarda", async () => {
    expect(await decidir(pedido({ agente: "curl/8.7.1", cookie: passeDono() }), ctx())).toEqual(repassar(false));
  });

  it("passe de dono de outra versão não vale", async () => {
    expect(await decidir(pedido({ agente: "curl/8.7.1", cookie: passeDono(1) }), ctx({ versaoDono: 2 }))).toEqual(sombra("curl", "copia", 200));
  });

  it("passe de visitante assinado com o segredo não vira passe de dono", async () => {
    const falso = `anti_rea_passe=${criarPasse(SEGREDO, "dono", 86_400_000, AGORA)}`;
    expect(await decidir(pedido({ agente: "curl/8.7.1", cookie: falso }), ctx())).toEqual(sombra("curl", "copia", 200));
  });

  it("isento /api/webhook/x com agente curl repassa sem guarda", async () => {
    expect(await decidir(pedido({ metodo: "POST", caminho: "/api/webhook/x", agente: "curl/8.7.1", accept: "*/*" }), ctx())).toEqual(publico(false));
    expect(await decidir(pedido({ caminho: "/health?x=1", agente: "curl/8.7.1", accept: "*/*" }), ctx())).toEqual(publico(false));
    expect(await decidir(pedido({ caminho: "/api/webhook/x;jsessionid=1", agente: "curl/8.7.1" }), ctx())).toEqual(publico(false));
  });

  it("isento não casa por prefixo solto nem por ponto-ponto", async () => {
    expect(await decidir(pedido({ caminho: "/healthz", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("curl", "copia", 200));
    expect(await decidir(pedido({ caminho: "/api/webhook/../../app.js", agente: "curl/8.7.1" }), ctx())).toEqual({ acao: "recusar", status: 400 });
    expect(await decidir(pedido({ caminho: "/api/webhook/%2e%2e/%2e%2e/app.js", accept: "*/*" }), ctx())).toEqual({ acao: "recusar", status: 400 });
    expect(await decidir(pedido({ caminho: "/API/webhook/x", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("curl", "copia", 200));
  });

  it("isento com query: o caminho casa igual e a query casa pelo começo (aviso de pagamento do WooCommerce)", async () => {
    const c = ctx({ cfg: config({ exempt: ["/?wc-api=*", "/loja/?acao=pago"] }) });
    const POST = { metodo: "POST", agente: "MercadoPago/1.0", accept: "*/*" };
    expect(await decidir(pedido({ ...POST, caminho: "/?wc-api=WC_WooMercadoPago_Basic_Gateway&source_news=webhooks" }), c)).toEqual(publico(false));
    expect(await decidir(pedido({ ...POST, caminho: "/loja/?acao=pago" }), c)).toEqual(publico(false));
    for (const caminho of ["/?x=1&wc-api=WC_X", "/", "/loja?wc-api=WC_X", "/app.js?wc-api=WC_X", "/loja/?acao=pago2", "/%3Fwc-api=x"]) {
      expect(await decidir(pedido({ ...POST, caminho }), c), caminho).toEqual({ acao: "recusar", status: 403 });
    }
  });

  it("isento só vale quando o caminho casa lido dos dois jeitos (%2F, barra dobrada e matriz não criam isento)", async () => {
    for (const caminho of ["/api%2Fwebhook%2Fx", "/api/webhook;x/y", "//api/webhook/x", "/api//webhook/x"]) {
      expect(await decidir(pedido({ caminho, agente: "curl/8.7.1" }), ctx()), caminho).toEqual(sombra("curl", "copia", 200));
    }
  });
});

describe("decidir: caminho ambíguo", () => {
  it("ponto-ponto que o site poderia resolver diferente vira 400, com ou sem passe", async () => {
    for (const caminho of ["/api/webhook/..;/app.js", "/api/webhook/a%2fb%2fc/../../../app.js", "/x/./y"]) {
      expect(await decidir(pedido({ caminho, agente: "curl/8.7.1" }), ctx()), caminho).toEqual({ acao: "recusar", status: 400 });
    }
    expect(await decidir(pedido({ caminho: "/x/a%2fb/../../app.js", cookie: passeVisitante() }), ctx())).toEqual({ acao: "recusar", status: 400 });
    expect(await decidir(pedido({ caminho: "/x/a%2fb/../../app.js", cookie: passeDono() }), ctx())).toEqual({ acao: "recusar", status: 400 });
  });

  it("arquivo trancado continua na sombra antes do 400", async () => {
    expect(await decidir(pedido({ caminho: "/.git;/config", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
    expect(await decidir(pedido({ caminho: "/x/../.env", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
    // Lido normalizado vira /api/webhook/.env: .env em qualquer pasta é trancado.
    expect(await decidir(pedido({ caminho: "/api/webhook/a%2fb%2fc/../../../.env", agente: "curl/8.7.1" }), ctx())).toEqual(
      sombra("arquivo sensível", "varredura", 404),
    );
  });

  it("parâmetro de matriz não transforma JS em imagem", async () => {
    expect(await decidir(pedido({ caminho: "/app.js;.png", accept: "*/*" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ caminho: "/logo.png;jsessionid=1", accept: "*/*" }), ctx())).toEqual(publico(false));
  });
});

describe("decidir: marca de pego", () => {
  it("marca válida manda à sombra, depois de dono e isento", async () => {
    expect(await decidir(pedido({ cookie: marcaPego() }), ctx())).toEqual(sombra("pego na verificação", "copia", 200));
    expect(await decidir(pedido({ cookie: `${marcaPego()}; ${passeVisitante()}` }), ctx())).toEqual(
      sombra("pego na verificação", "copia", 200),
    );
    expect(await decidir(pedido({ cookie: `${marcaPego()}; ${passeDono()}` }), ctx())).toEqual(repassar(false));
    expect(await decidir(pedido({ caminho: "/health", cookie: marcaPego() }), ctx())).toEqual(publico(false));
  });

  it("marca vencida ou adulterada não conta", async () => {
    const velha = `anti_rea_pego=${criarMarcaPego(SEGREDO, AGORA - 3_600_001)}`;
    expect(await decidir(pedido({ cookie: velha }), ctx())).toEqual({ acao: "verificar" });
    const passeComoMarca = `anti_rea_pego=${criarPasse(SEGREDO, "visitante", 86_400_000, AGORA)}`;
    expect(await decidir(pedido({ cookie: passeComoMarca }), ctx())).toEqual({ acao: "verificar" });
  });
});

describe("decidir: ferramentas e varredura", () => {
  it("Wget em / vai à sombra 200", async () => {
    expect(await decidir(pedido({ agente: "Wget/1.21.4" }), ctx())).toEqual(sombra("wget", "copia", 200));
  });

  it("scanner apontado vai à sombra 200 como ataque, até com passe de visitante", async () => {
    expect(await decidir(pedido({ agente: "sqlmap/1.8.4#stable (https://sqlmap.org)" }), ctx())).toEqual(sombra("sqlmap", "ataque", 200));
    expect(await decidir(pedido({ agente: "Mozilla/5.00 (Nikto/2.5.0)", cookie: passeVisitante() }), ctx())).toEqual(sombra("nikto", "ataque", 200));
    expect(await decidir(pedido({ agente: "masscan/1.3" }), ctx())).toEqual(sombra("masscan", "varredura", 200));
  });

  it("sem agente vai à sombra", async () => {
    expect(await decidir(pedido({ agente: undefined }), ctx())).toEqual(sombra("sem agente", "copia", 200));
  });

  it("caminho de varredura vai à sombra 200, mesmo com barras dobradas", async () => {
    expect(await decidir(pedido({ caminho: "/phpmyadmin/index.php" }), ctx())).toEqual(sombra("caminho de varredura", "varredura", 200));
    expect(await decidir(pedido({ caminho: "//phpMyAdmin" }), ctx())).toEqual(sombra("caminho de varredura", "varredura", 200));
  });

  it("passe de visitante não salva agente de ferramenta", async () => {
    expect(await decidir(pedido({ agente: "python-requests/2.32", cookie: passeVisitante() }), ctx())).toEqual(
      sombra("python-requests", "copia", 200),
    );
  });
});

describe("decidir: robôs declarados", () => {
  const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

  it("Googlebot confirmado repassa sem guarda", async () => {
    const c = ctx();
    expect(await decidir(pedido({ agente: GOOGLEBOT, ip: IP_GOOGLE }), c)).toEqual(repassar(false));
    expect(c.robosPerguntados).toEqual([`Googlebot|${IP_GOOGLE}`]);
  });

  it("Googlebot não confirmado vai à sombra", async () => {
    expect(await decidir(pedido({ agente: GOOGLEBOT, ip: "203.0.113.9" }), ctx())).toEqual(sombra("robô falso: Googlebot", "copia", 200));
  });

  it("Googlebot incerto repassa sem guarda e pede registro, sem sombra", async () => {
    expect(await decidir(pedido({ agente: GOOGLEBOT, ip: IP_DUVIDA }), ctx())).toEqual({
      acao: "repassar",
      injetarGuarda: false,
      registrar: { motivo: "robô não confirmado: Googlebot", gravidade: "copia" },
    });
  });

  it("robô da Meta segue a mesma regra", async () => {
    expect(await decidir(pedido({ agente: "facebookexternalhit/1.1", ip: IP_GOOGLE }), ctx())).toEqual(repassar(false));
    expect(await decidir(pedido({ agente: "facebookexternalhit/1.1", ip: "203.0.113.9" }), ctx())).toEqual(
      sombra("robô falso: facebookexternalhit", "copia", 200),
    );
  });

  it("robô vindo de IP interno (proxy sem trustProxy): não confere, passa e pede registro", async () => {
    const c = ctx();
    for (const ip of ["172.18.0.3", "10.0.1.7", "127.0.0.1", "::1"]) {
      expect(await decidir(pedido({ agente: GOOGLEBOT, ip }), c)).toEqual({
        acao: "repassar",
        injetarGuarda: false,
        registrar: { motivo: "robô não confirmado: Googlebot", gravidade: "copia" },
      });
    }
    expect(await decidir(pedido({ agente: "facebookexternalhit/1.1", ip: "10.0.1.7" }), c)).toMatchObject({ acao: "repassar" });
    expect(c.robosPerguntados).toEqual([]);
  });

  it("robô do Google a pedido (Search Console, leitura em voz alta) não confirmado segue como visitante, nunca sombra", async () => {
    const c = ctx();
    const VERIFICADOR = "Mozilla/5.0 (compatible; Google-Site-Verification/1.0)";
    expect(await decidir(pedido({ agente: VERIFICADOR, caminho: "/google1234.html", accept: "*/*", ip: IP_GOOGLE }), c)).toEqual(repassar(false));
    expect(await decidir(pedido({ agente: VERIFICADOR, caminho: "/google1234.html", accept: "*/*", ip: "203.0.113.9" }), c)).toEqual({
      acao: "recusar",
      status: 403,
    });
    const LEITURA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)";
    expect(await decidir(pedido({ agente: LEITURA, ip: "203.0.113.9" }), c)).toEqual({ acao: "verificar" });
    expect(c.robosPerguntados).toEqual([`Google-Site-Verification|${IP_GOOGLE}`, "Google-Site-Verification|203.0.113.9", "Google-Read-Aloud|203.0.113.9"]);
  });

  it("WhatsApp/2.24 em / vai a verificar; imagem de prévia passa", async () => {
    const c = ctx();
    expect(await decidir(pedido({ agente: "WhatsApp/2.24", accept: "*/*" }), c)).toEqual({ acao: "verificar" });
    expect(await decidir(pedido({ agente: "WhatsApp/2.24", caminho: "/og.png", accept: "image/*" }), c)).toEqual(publico(false));
    expect(await decidir(pedido({ agente: "TelegramBot (like TwitterBot)", caminho: "/app.js", accept: "*/*" }), c)).toEqual({ acao: "verificar" });
    expect(c.robosPerguntados).toEqual([]);
  });
});

describe("decidir: ritmo", () => {
  const RAPIDO = sombra("navegação rápida demais", "copia", 200);

  it("com passe, a 31ª navegação em 10 s do mesmo passe vai à sombra; outro passe segue livre", async () => {
    const c = ctx();
    const cookie = passeVisitante();
    for (let i = 0; i < 30; i++) {
      expect(await decidir(pedido({ cookie }), { ...c, agora: AGORA + i * 100 })).toEqual(repassar(true));
    }
    expect(await decidir(pedido({ cookie }), { ...c, agora: AGORA + 3_100 })).toEqual(RAPIDO);
    // Mesmo passe de outro IP continua contando: a chave é o passe.
    expect(await decidir(pedido({ cookie, ip: "203.0.113.8" }), { ...c, agora: AGORA + 3_150 })).toEqual(RAPIDO);
    expect(await decidir(pedido({ cookie: passeVisitante() }), { ...c, agora: AGORA + 3_200 })).toEqual(repassar(true));
  });

  it("muita gente atrás do mesmo IP (escritório, CGNAT, Wi-Fi de evento) não soma: cada passe conta sozinho", async () => {
    const c = ctx();
    for (let i = 0; i < 100; i++) {
      expect(await decidir(pedido({ cookie: passeVisitante() }), { ...c, agora: AGORA + i * 10 }), String(i)).toEqual(repassar(true));
    }
  });

  it("sem passe e com a verificação ligada, nada conta: o pedido só recebe a tela de verificação", async () => {
    const c = ctx();
    for (let i = 0; i < 100; i++) {
      expect(await decidir(pedido(), { ...c, agora: AGORA + i * 10 }), String(i)).toEqual({ acao: "verificar" });
    }
  });

  it("sem passe e com firstVisit false, conta pelo IP; IP interno fica de fora", async () => {
    const c = ctx({ cfg: config({ check: { firstVisit: false } }) });
    const comPasseNovo = { acao: "repassar", injetarGuarda: true, emitirPasse: true };
    for (let i = 0; i < 30; i++) expect(await decidir(pedido(), { ...c, agora: AGORA + i * 10 })).toEqual(comPasseNovo);
    expect(await decidir(pedido(), { ...c, agora: AGORA + 310 })).toEqual(RAPIDO);
    for (let i = 0; i < 40; i++) {
      expect(await decidir(pedido({ ip: "172.18.0.3" }), { ...c, agora: AGORA + i * 10 })).toEqual(comPasseNovo);
    }
  });

  it("pré-carga, pré-renderização e página em iframe não contam", async () => {
    const c = ctx();
    const cookie = passeVisitante();
    const naoContam: Array<Partial<Pedido>> = [
      { proposito: "prefetch" },
      { proposito: "prefetch;prerender" },
      { proposito: "preview" },
      { proposito: "Prefetch" },
      { destinoFetch: "iframe" },
      { destinoFetch: "frame" },
    ];
    for (let i = 0; i < 60; i++) {
      expect(await decidir(pedido({ cookie, ...naoContam[i % naoContam.length] }), c), String(i)).toEqual(repassar(true));
    }
    for (let i = 0; i < 30; i++) expect(await decidir(pedido({ cookie, destinoFetch: "document" }), c)).toEqual(repassar(true));
    expect(await decidir(pedido({ cookie }), c)).toEqual(RAPIDO);
  });

  it("pedido feito por script da página (fetch, Turbo Frames, htmx) não conta; sem Sec-Fetch-Dest vale o Accept", async () => {
    const c = ctx();
    const cookie = passeVisitante();
    // Página com 8 Turbo Frames aberta 4 vezes em 10 s: os quadros chegam com Accept text/html.
    for (let i = 0; i < 60; i++) {
      expect(await decidir(pedido({ cookie, destinoFetch: i % 2 ? "empty" : "Empty" }), c), String(i)).toEqual(repassar(true));
    }
    // Navegador antigo, sem Sec-Fetch-Dest: conta pelo Accept, como antes.
    for (let i = 0; i < 30; i++) expect(await decidir(pedido({ cookie }), c)).toEqual(repassar(true));
    expect(await decidir(pedido({ cookie, destinoFetch: "document" }), c)).toEqual(RAPIDO);
  });

  it("só navegação conta: imagens não gastam o ritmo", async () => {
    const c = ctx();
    const cookie = passeVisitante();
    for (let i = 0; i < 40; i++) {
      expect(await decidir(pedido({ caminho: `/f${i}.png`, accept: "image/*", cookie }), c)).toEqual(publico(true));
    }
    expect(await decidir(pedido({ cookie }), c)).toEqual(repassar(true));
  });
});

describe("decidir: passe de visitante e primeira visita", () => {
  it("passe de visitante repassa com guarda (se devtoolsIsCaught)", async () => {
    expect(await decidir(pedido({ cookie: passeVisitante() }), ctx())).toEqual(repassar(true));
    const semF12 = ctx({ cfg: config({ check: { devtoolsIsCaught: false } }) });
    expect(await decidir(pedido({ cookie: passeVisitante() }), semF12)).toEqual(repassar(false));
  });

  it("passe vencido ou adulterado conta como sem passe", async () => {
    const vencido = `anti_rea_passe=${criarPasse(SEGREDO, "visitante", 1_000, AGORA - 2_000)}`;
    expect(await decidir(pedido({ cookie: vencido }), ctx())).toEqual({ acao: "verificar" });
    const outro = `anti_rea_passe=${criarPasse("outro-segredo", "visitante", 86_400_000, AGORA)}`;
    expect(await decidir(pedido({ cookie: outro }), ctx())).toEqual({ acao: "verificar" });
  });

  it("passe com mais da metade da validade gasta é renovado na resposta (sem isso vencia com o visitante no meio do uso)", async () => {
    const velho = `anti_rea_passe=${criarPasse(SEGREDO, "visitante", SETE_DIAS, AGORA - 4 * 86_400_000)}`;
    expect(await decidir(pedido({ cookie: velho }), ctx())).toEqual({ acao: "repassar", injetarGuarda: true, emitirPasse: true });
    // Pedido de dados (fetch, service worker) também renova: PWA que abre as páginas do cache só manda esses.
    expect(await decidir(pedido({ cookie: velho, caminho: "/api/dados", accept: "*/*" }), ctx())).toEqual({
      acao: "repassar",
      injetarGuarda: true,
      emitirPasse: true,
    });
    // Mídia sai como pública para a CDN: nunca leva Set-Cookie.
    expect(await decidir(pedido({ cookie: velho, caminho: "/og.png", accept: "image/*" }), ctx())).toEqual(publico(true));
    // Na primeira metade, não renova.
    const novo = `anti_rea_passe=${criarPasse(SEGREDO, "visitante", SETE_DIAS, AGORA - 3 * 86_400_000)}`;
    expect(await decidir(pedido({ cookie: novo }), ctx())).toEqual(repassar(true));
    // Passe de dono não é renovado aqui (vale 1 ano).
    expect(await decidir(pedido({ cookie: passeDono() }), ctx())).toEqual(repassar(false));
  });

  it("acha o passe no meio de outros cookies", async () => {
    expect(await decidir(pedido({ cookie: `tema=escuro; ${passeVisitante()}; sessao=abc` }), ctx())).toEqual(repassar(true));
  });

  it("sem passe: / vira verificar, /og.png repassa, /app.js recusa 403", async () => {
    expect(await decidir(pedido(), ctx())).toEqual({ acao: "verificar" });
    expect(await decidir(pedido({ caminho: "/og.png", accept: "image/avif,image/webp,*/*" }), ctx())).toEqual(publico(false));
    for (const caminho of ["/a.JPG", "/b.jpeg", "/c.gif", "/d.webp", "/e.avif", "/f.svg", "/favicon.ico", "/g.woff", "/h.woff2"]) {
      expect(await decidir(pedido({ caminho, accept: "*/*" }), ctx()), caminho).toEqual(publico(false));
    }
    expect(await decidir(pedido({ caminho: "/app.js", accept: "*/*" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ metodo: "POST", caminho: "/", accept: HTML }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ metodo: "HEAD", caminho: "/", accept: HTML }), ctx())).toEqual({ acao: "recusar", status: 403 });
  });

  it("GET sem passe, sem extensão e sem dizer o formato (Accept ausente ou */*) recebe a tela de verificação", async () => {
    // Leitor de prévia que não pede HTML: Mattermost (sem Accept) e Zulip (*/*).
    for (const accept of [undefined, "", "*/*", " */* ", "*/*;q=0.8"]) {
      for (const caminho of ["/", "/produtos", "/blog/post-1", "/.well-known", "/feed/"]) {
        expect(await decidir(pedido({ caminho, accept, agente: "Mattermost-Bot/1.1" }), ctx()), `${caminho} ${accept}`).toEqual({ acao: "verificar" });
      }
    }
    // Arquivo com extensão, outro formato pedido e outro método seguem recusados.
    expect(await decidir(pedido({ caminho: "/app.js", accept: undefined }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ caminho: "/dados.json", accept: "*/*" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ caminho: "/api/produtos", accept: "application/json" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ caminho: "/api/produtos", accept: "*/*, application/json" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ metodo: "POST", caminho: "/produtos", accept: "*/*" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    expect(await decidir(pedido({ metodo: "HEAD", caminho: "/produtos", accept: undefined }), ctx())).toEqual({ acao: "recusar", status: 403 });
  });

  it("firstVisit false repassa com guarda e emite passe na navegação", async () => {
    const c = ctx({ cfg: config({ check: { firstVisit: false } }) });
    expect(await decidir(pedido(), c)).toEqual({ acao: "repassar", injetarGuarda: true, emitirPasse: true });
    expect(await decidir(pedido({ caminho: "/app.js", accept: "*/*" }), c)).toEqual(repassar(true));
    const semNada = ctx({ cfg: config({ check: { firstVisit: false, devtoolsIsCaught: false } }) });
    expect(await decidir(pedido(), semNada)).toEqual({ acao: "repassar", injetarGuarda: false, emitirPasse: true });
    expect(await decidir(pedido({ caminho: "/app.js", accept: "*/*" }), semNada)).toEqual(repassar(false));
    expect(await decidir(pedido({ cookie: passeVisitante() }), semNada)).toEqual(repassar(false));
  });
});

describe("decidir: pré-voo CORS", () => {
  const PRE_VOO: Decisao = { acao: "repassar", injetarGuarda: false, soCabecalhos: true };

  it("OPTIONS com Access-Control-Request-Method passa sem passe, sem guarda, sem registro e sem o corpo do site", async () => {
    const preVoo = (parcial: Partial<Pedido> = {}) =>
      pedido({ metodo: "OPTIONS", caminho: "/api/dados", accept: "*/*", corsMetodo: "POST", ...parcial });
    expect(await decidir(preVoo(), ctx())).toEqual(PRE_VOO);
    expect(await decidir(preVoo({ metodo: "options" }), ctx())).toEqual(PRE_VOO);
    expect(await decidir(preVoo({ cookie: marcaPego() }), ctx())).toEqual(PRE_VOO);
    expect(await decidir(preVoo({ caminho: "/api/webhook/x" }), ctx())).toEqual({ ...PRE_VOO, publico: true });
  });

  it("ferramenta conhecida no pré-voo vai à sombra antes da regra (curl não leva a página por OPTIONS)", async () => {
    const preVoo = (agente: string | undefined, caminho = "/pagina-de-produto") =>
      pedido({ metodo: "OPTIONS", caminho, agente, accept: "*/*", corsMetodo: "GET" });
    expect(await decidir(preVoo("curl/8.4.0"), ctx())).toEqual(sombra("curl", "copia", 200));
    expect(await decidir(preVoo(undefined), ctx())).toEqual(sombra("sem agente", "copia", 200));
    expect(await decidir(preVoo("python-requests/2.32", "/api/webhook/x"), ctx())).toEqual(sombra("python-requests", "copia", 200));
  });

  it("caminho trancado continua valendo e OPTIONS sem o cabeçalho continua recusado", async () => {
    const preVoo = (caminho: string) => pedido({ metodo: "OPTIONS", caminho, accept: "*/*", corsMetodo: "GET" });
    expect(await decidir(preVoo("/.env"), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
    expect(await decidir(preVoo("/app.js.map"), ctx())).toEqual(sombra("mapa de código", "copia", 404));
    expect(await decidir(preVoo("/x/../app.js"), ctx())).toEqual({ acao: "recusar", status: 400 });
    expect(await decidir(pedido({ metodo: "OPTIONS", caminho: "/api/dados", accept: "*/*" }), ctx())).toEqual({ acao: "recusar", status: 403 });
    // O cabeçalho só conta no OPTIONS.
    expect(await decidir(pedido({ caminho: "/app.js", accept: "*/*", corsMetodo: "GET" }), ctx())).toEqual({ acao: "recusar", status: 403 });
  });
});

describe("decidir: parâmetro de matriz na classificação", () => {
  it("/api/webhook/..;/app.js não é isento e /app.js.map;x=1 é trancado", async () => {
    expect(await decidir(pedido({ caminho: "/api/webhook/..;/app.js", agente: "curl/8.7.1", accept: "*/*" }), ctx())).toEqual({
      acao: "recusar",
      status: 400,
    });
    expect(await decidir(pedido({ caminho: "/api/webhook/..;/app.js", cookie: passeDono() }), ctx())).toEqual({ acao: "recusar", status: 400 });
    for (const caminho of ["/app.js.map;x=1", "/app.js.map;", "/static;v=2/app.js.map", "/%61pp.js.map;x=1?y=2"]) {
      expect(await decidir(pedido({ caminho, accept: "*/*" }), ctx()), caminho).toEqual(sombra("mapa de código", "copia", 404));
      expect(await decidir(pedido({ caminho, cookie: passeDono() }), ctx()), caminho).toEqual({ acao: "recusar", status: 404 });
    }
    expect(await decidir(pedido({ caminho: "/.env;x=1", agente: "curl/8.7.1" }), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
  });
});

describe("decidir: caminhos públicos padrão", () => {
  const PUBLICOS = [
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap-produtos.xml",
    "/sitemap_index.xml",
    "/ads.txt",
    "/app-ads.txt",
    "/favicon.ico",
    "/manifest.json",
    "/site.webmanifest",
    "/static/app.webmanifest",
    "/.well-known/security.txt",
    "/.well-known/assetlinks.json",
    "/.well-known/apple-app-site-association",
    "/.well-known/openid-configuration",
    "/robots.txt?x=1",
    // Feeds: leitor de RSS não roda JavaScript nem guarda cookie.
    "/rss.xml",
    "/feed.xml",
    "/atom.xml",
    "/blog/rss.xml",
    "/podcast.rss",
    "/noticias/index.atom",
  ];

  it("passam sem passe, sem guarda e sem registro, para qualquer agente", async () => {
    for (const caminho of PUBLICOS) {
      expect(await decidir(pedido({ caminho, accept: "*/*" }), ctx()), caminho).toEqual(publico(false));
      expect(await decidir(pedido({ caminho, agente: "Wget/1.21", accept: "*/*" }), ctx()), caminho).toEqual(publico(false));
      expect(await decidir(pedido({ caminho, cookie: marcaPego() }), ctx()), caminho).toEqual(publico(false));
    }
  });

  it("o caminho trancado vale antes", async () => {
    expect(await decidir(pedido({ caminho: "/robots.txt.bak", accept: "*/*" }), ctx())).toEqual(sombra("arquivo de backup", "varredura", 404));
    expect(await decidir(pedido({ caminho: "/.well-known/.git/config", accept: "*/*" }), ctx())).toEqual(sombra("arquivo sensível", "varredura", 404));
    expect(await decidir(pedido({ caminho: "/.well-known/app.js.map", accept: "*/*" }), ctx())).toEqual(sombra("mapa de código", "copia", 404));
  });

  it("ponto-ponto não sai de /.well-known/ e nada fora da lista vira público", async () => {
    for (const caminho of ["/.well-known/../app.js", "/.well-known/%2e%2e/app.js", "/.well-known/..;/app.js", "/.well-known\\..\\app.js"]) {
      expect(await decidir(pedido({ caminho, accept: "*/*" }), ctx()), caminho).toEqual({ acao: "recusar", status: 400 });
    }
    for (const caminho of ["/blog/sitemap.xml", "/blog/robots.txt", "/.well-known", "/.well-knownx/a", "/manifest.json.js", "/x.webmanifest.js", "/sitemap.xml/app.js", "//robots.txt", "/.well-known%2fx", "/feed", "/feed/", "/rss.xml/app.js", "/x.rss.js", "/myrss.xml"]) {
      expect(await decidir(pedido({ caminho, accept: "application/json" }), ctx()), caminho).toEqual({ acao: "recusar", status: 403 });
    }
  });
});
