import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Avisos, type Canal } from "../../src/avisos/avisos.js";
import { nomeDoRelatorio, rodarExame } from "../../src/cli/exame.js";
import { validarConfig } from "../../src/config/carregar.js";
import { examinar, ErroDeProva, type Relatorio } from "../../src/exame/exame.js";
import { codigoDeDono } from "../../src/passe/passe.js";
import { iniciarPorteiro } from "../../src/porteiro/servidor.js";
import { Registro } from "../../src/registro/registro.js";
import { FaixasMeta } from "../../src/robos/faixas-meta.js";

const CODIGO = "0123456789abcdef0123456789abcdef";
const SEGREDO = "s".repeat(43);
const AGENTE = "anti-rea-exame/teste";
// Chave de exemplo da documentação da AWS; as outras são montadas aqui para nenhuma ficar escrita inteira.
const CHAVE_AWS = "AKIAIOSFODNN7EXAMPLE";
const CHAVE_STRIPE = ["sk", "live", "x".repeat(24)].join("_");

const limpezas: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (limpezas.length > 0) await limpezas.pop()!();
});

type Pedido = { metodo: string; caminho: string; agente: string };
const SPA = '<!doctype html><html><head><title>Loja</title></head><body><div id="app"></div></body></html>';

async function subirSite(modo: "sujo" | "limpo", prova: string | null = `anti-rea=${CODIGO}`) {
  const pedidos: Pedido[] = [];
  const servidor = http.createServer((req, res) => {
    const caminho = req.url ?? "/";
    pedidos.push({ metodo: req.method!, caminho, agente: String(req.headers["user-agent"] ?? "") });
    const html = (corpo: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(corpo);
    };
    const texto = (tipo: string, corpo: string | Buffer, status = 200) => {
      res.writeHead(status, { "content-type": tipo });
      res.end(corpo);
    };
    if (caminho === "/.well-known/anti-rea.txt") return prova === null ? texto("text/plain", "não", 404) : texto("text/plain", `${prova}\n`);
    if (modo === "limpo") {
      if (caminho === "/") return html(`${SPA.replace("</body>", '<script src="/static/app.js"></script></body>')}`);
      if (caminho === "/static/app.js") return texto("text/javascript", 'fetch("/api/pedidos")');
      if (caminho === "/api/pedidos") return texto("application/json", '{"error":"login"}', 401);
      return html(SPA);
    }
    switch (caminho) {
      case "/":
        return html(
          '<!doctype html><html><head><link rel="modulepreload" href="/static/mod.js">' +
            `<script>window.cfg={stripe:"${CHAVE_STRIPE}"}</script></head><body>` +
            '<script src="/static/app.js"></script><script src="https://cdn.exemplo.net/x.js"></script></body></html>',
        );
      case "/static/app.js":
        return texto(
          "text/javascript",
          `const k="${CHAVE_AWS}";fetch("/api/usuarios");fetch("/api/logout");fetch(\`/api/itens/\${id}\`);\n//# sourceMappingURL=app.js.map`,
        );
      case "/static/app.js.map":
        return texto("application/json", JSON.stringify({ version: 3, sources: ["src/a.ts"], sourcesContent: ["const a = 1;"], mappings: "AAAA" }));
      case "/static/mod.js":
        return texto("text/javascript", "export const x = 1;");
      case "/.env":
        return texto("text/plain", "DB_PASS=xyz\nAPI_KEY=abc\n");
      case "/.git/HEAD":
        return texto("text/plain", "ref: refs/heads/main\n");
      case "/api/usuarios":
        return texto("application/json", '[{"nome":"Ana"}]');
      default:
        // Página única: qualquer caminho devolve a página inicial com 200.
        return html(SPA);
    }
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const porta = (servidor.address() as { port: number }).port;
  limpezas.push(() => new Promise<void>((r) => servidor.close(() => r())));
  return { porta, pedidos, url: new URL(`http://127.0.0.1:${porta}/`) };
}

async function porteiroNaFrente(portaDoSite: number) {
  const cfg = validarConfig({ upstream: `http://127.0.0.1:${portaDoSite}`, domains: ["seusite.com.br"] });
  const pasta = mkdtempSync(join(tmpdir(), "anti-rea-exame-"));
  const registro = new Registro(pasta, 30 * 86_400_000);
  const enviados: string[] = [];
  const canal: Canal = { nome: "teste", enviar: async (t) => void enviados.push(t) };
  const porteiro = await iniciarPorteiro(cfg, {
    segredo: SEGREDO,
    versaoDono: 1,
    registro,
    avisos: new Avisos(cfg.alerts, [canal]),
    porta: 0,
    host: "127.0.0.1",
    dns: { reverso: async () => [], direto: async () => [] },
    meta: new FaixasMeta(async () => []),
  });
  limpezas.push(async () => {
    await porteiro.fechar();
    rmSync(pasta, { recursive: true, force: true });
  });
  const hoje = () => new Date().toISOString().slice(0, 10);
  return { url: new URL(`http://127.0.0.1:${porteiro.porta}/`), eventos: () => registro.ler(hoje()), enviados };
}

const titulos = (r: Relatorio) => r.achados.map((a) => `${a.nivel} ${a.item} ${a.titulo}${a.onde ? ` @ ${a.onde}` : ""}`);

describe("exame: prova de dono", () => {
  it("sem o arquivo da prova não faz nenhum outro pedido", async () => {
    const site = await subirSite("sujo", null);
    await expect(examinar({ url: site.url, codigo: CODIGO, agente: AGENTE })).rejects.toThrow(ErroDeProva);
    expect(site.pedidos.map((p) => p.caminho)).toEqual(["/.well-known/anti-rea.txt"]);
  });

  it("com outro código no arquivo também para", async () => {
    const site = await subirSite("sujo", "anti-rea=ffffffffffffffffffffffffffffffff");
    await expect(examinar({ url: site.url, codigo: CODIGO, agente: AGENTE })).rejects.toMatchObject({ resultado: "codigo-diferente" });
    expect(site.pedidos).toHaveLength(1);
  });
});

describe("exame: site sem porteiro", () => {
  it("acha mapa, arquivos sensíveis, API aberta e chaves, sem falso positivo na página única", async () => {
    const site = await subirSite("sujo");
    const r = await examinar({ url: site.url, codigo: CODIGO, agente: AGENTE });
    expect(r.porteiro).toBe(false);
    expect(r.parouNaPorta).toBe(false);
    const t = titulos(r);
    expect(t).toContain("grave mapas Mapa de código público, com o código original inteiro @ /static/app.js.map");
    expect(t).toContain("grave sensiveis Arquivo sensível no ar @ /.env");
    expect(t).toContain("grave sensiveis Arquivo sensível no ar @ /.git/HEAD");
    expect(t).toContain("atencao api API responde sem login @ GET /api/usuarios");
    expect(t).toContain("atencao porteiro Sem porteiro na frente do site");
    expect(t.some((x) => x.startsWith("grave chaves Chave aparente no código (chave da AWS) @ /static/app.js linha 1: AKIA"))).toBe(true);
    expect(t.some((x) => x.startsWith("grave chaves Chave aparente no código (chave secreta do Stripe) @ / linha 1:"))).toBe(true);
    // Só os dois arquivos que existem de verdade; o 200 da página única não conta.
    expect(r.achados.filter((a) => a.item === "sensiveis")).toHaveLength(2);
    // O valor da chave nunca aparece inteiro.
    expect(JSON.stringify(r)).not.toContain(CHAVE_AWS);
    expect(JSON.stringify(r)).not.toContain(CHAVE_STRIPE);
    expect(r.achados[0]!.nivel).toBe("grave");
  });

  it("só lê: GET, HEAD e OPTIONS, nunca rota com nome de ação, nunca outro host, sempre com o agente do exame", async () => {
    const site = await subirSite("sujo");
    await examinar({ url: site.url, codigo: CODIGO, agente: AGENTE });
    expect(site.pedidos.every((p) => ["GET", "HEAD", "OPTIONS"].includes(p.metodo))).toBe(true);
    expect(site.pedidos.every((p) => p.agente === AGENTE)).toBe(true);
    const caminhos = site.pedidos.map((p) => p.caminho);
    expect(caminhos).not.toContain("/api/logout");
    expect(caminhos.some((c) => c.includes("${"))).toBe(false);
    expect(caminhos).toContain("/static/mod.js");
    expect(site.pedidos.length).toBeLessThanOrEqual(150);
  });

  it("site limpo: tudo ok, menos o porteiro que falta", async () => {
    const site = await subirSite("limpo");
    const r = await examinar({ url: site.url, codigo: CODIGO, agente: AGENTE });
    expect(r.achados.filter((a) => a.nivel === "grave")).toEqual([]);
    expect(titulos(r)).toEqual([
      "atencao porteiro Sem porteiro na frente do site",
      "ok mapas Nenhum mapa de código público",
      "ok sensiveis Nenhum arquivo sensível no ar",
      "ok api Nenhuma API aberta entre as citadas no JavaScript",
      "ok chaves Nenhuma chave aparente no código",
    ]);
  });
});

describe("exame: site com o porteiro do ANTI-REA na frente", () => {
  it("sem link de dono para na porta e não gera evento nem aviso", async () => {
    const site = await subirSite("sujo");
    const p = await porteiroNaFrente(site.porta);
    const r = await examinar({ url: p.url, codigo: CODIGO, agente: AGENTE });
    expect(r.porteiro).toBe(true);
    expect(r.parouNaPorta).toBe(true);
    expect(titulos(r)).toEqual(["ok porteiro Porteiro ANTI-REA ativo"]);
    expect(p.eventos()).toEqual([]);
    expect(p.enviados).toEqual([]);
  });

  it("com o link de dono examina o site por trás, sem gerar evento", async () => {
    const site = await subirSite("sujo");
    const p = await porteiroNaFrente(site.porta);
    const dono = new URL(`/.anti-rea/dono/${codigoDeDono(SEGREDO, 1)}`, p.url).href;
    const r = await examinar({ url: p.url, codigo: CODIGO, agente: AGENTE, dono });
    expect(r.comoDono).toBe(true);
    const t = titulos(r);
    // O porteiro tranca .map, .env e .git para todo mundo; a chave no script continua lá.
    expect(t).toContain("ok mapas Nenhum mapa de código público");
    expect(t).toContain("ok sensiveis Nenhum arquivo sensível no ar");
    expect(t).toContain("ok porteiro Porteiro ANTI-REA ativo");
    expect(t).toContain("atencao api API responde sem login @ GET /api/usuarios");
    expect(t.some((x) => x.startsWith("grave chaves"))).toBe(true);
    expect(p.eventos()).toEqual([]);
    expect(p.enviados).toEqual([]);
  });

  it("link de dono de outro site ou errado vira mensagem clara", async () => {
    const site = await subirSite("sujo");
    const p = await porteiroNaFrente(site.porta);
    await expect(examinar({ url: p.url, codigo: CODIGO, agente: AGENTE, dono: "https://outro.exemplo/.anti-rea/dono/x" })).rejects.toThrow(
      "O link de dono precisa ser deste site",
    );
    await expect(examinar({ url: p.url, codigo: CODIGO, agente: AGENTE, dono: new URL("/.anti-rea/dono/errado", p.url).href })).rejects.toThrow(
      "O link de dono não deu o passe",
    );
  });
});

describe("anti-rea exame (comando)", () => {
  it("sem prova: mostra a linha para pôr no site e guarda o código só para o usuário", async () => {
    const site = await subirSite("sujo", null);
    const pasta = mkdtempSync(join(tmpdir(), "anti-rea-exame-cli-"));
    limpezas.push(() => rmSync(pasta, { recursive: true, force: true }));
    const { linhas, saida } = await rodarExame({ url: site.url.href, pasta });
    expect(saida).toBe(1);
    const arquivo = join(pasta, ".anti-rea-exame.json");
    const codigo = (JSON.parse(readFileSync(arquivo, "utf8")) as Record<string, string>)[site.url.host]!;
    expect(codigo).toMatch(/^[0-9a-f]{32}$/);
    expect(linhas).toContain(`anti-rea=${codigo}`);
    expect(linhas.join("\n")).toContain(`${site.url.origin}/.well-known/anti-rea.txt`);
    expect(statSync(arquivo).mode & 0o777).toBe(0o600);
  });

  it("com prova: grava o relatório HTML e devolve o resumo do terminal", async () => {
    const site = await subirSite("sujo");
    const pasta = mkdtempSync(join(tmpdir(), "anti-rea-exame-cli-"));
    limpezas.push(() => rmSync(pasta, { recursive: true, force: true }));
    const agora = new Date("2026-11-22T12:00:00Z");
    // O código que o site serve já está guardado.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(pasta, ".anti-rea-exame.json"), JSON.stringify({ [site.url.host]: CODIGO }));
    const { linhas, saida } = await rodarExame({ url: site.url.href, pasta, agora });
    expect(saida).toBe(0);
    expect(linhas[0]).toBe("Dono confirmado pelo arquivo /.well-known/anti-rea.txt");
    expect(linhas).toContain("O que um curioso consegue ver do seu site");
    expect(linhas.some((l) => /^\d+ graves? {2}· {2}\d+ atenção {2}· {2}\d+ ok$/.test(l))).toBe(true);
    const arquivo = join(pasta, nomeDoRelatorio(site.url.host, agora));
    expect(linhas.at(-1)).toBe(arquivo);
    const html = readFileSync(arquivo, "utf8");
    expect(html).toContain("O que fazer.");
    expect(html).toContain("/.env");
    expect(html).not.toContain("<script");
    expect(html).not.toContain(CHAVE_AWS);
  });

  it("nome do relatório só com letras seguras", () => {
    expect(nomeDoRelatorio("Seusite.com.br:8443", new Date("2026-11-20T10:00:00Z"))).toBe("exame-seusite.com.br-8443-2026-11-20.html");
  });
});
