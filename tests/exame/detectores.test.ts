import { describe, expect, it } from "vitest";
import { ClienteExame } from "../../src/exame/cliente.js";
import {
  chavesAparentes,
  mapaDeclarado,
  mascarar,
  pareceMapa,
  respostaAberta,
  rotasDeApi,
  scriptsDaPagina,
  SENSIVEIS,
} from "../../src/exame/detectores.js";

const sensivel = (caminho: string) => SENSIVEIS.find((s) => s.caminho === caminho)!;
const conferir = (caminho: string, texto: string) => sensivel(caminho).confere(texto, Buffer.from(texto));

describe("detectores do exame", () => {
  it("scripts: só da mesma origem, sem repetir, com pré-carga de módulo", () => {
    const html =
      '<script src="/a.js"></script><script defer src=\'/a.js\'></script><script src=b.js></script>' +
      '<script src="https://cdn.exemplo.net/c.js"></script><link rel="modulepreload" href="/d.mjs">' +
      '<link rel="preload" as="style" href="/e.css"><link rel="stylesheet" href="/f.js">';
    const urls = scriptsDaPagina(html, new URL("https://seusite.com.br/loja/")).map((u) => u.pathname);
    expect(urls).toEqual(["/a.js", "/loja/b.js", "/d.mjs"]);
  });

  it("mapa declarado: url, embutido ou nada", () => {
    expect(mapaDeclarado("x\n//# sourceMappingURL=app.js.map")).toEqual({ tipo: "url", url: "app.js.map" });
    expect(mapaDeclarado("x\n/*# sourceMappingURL=data:application/json;base64,eyJ9 */")).toEqual({ tipo: "embutido" });
    expect(mapaDeclarado("console.log(1)")).toBeNull();
  });

  it("mapa: confere pelo começo, mesmo cortado; página HTML não é mapa", () => {
    expect(pareceMapa('{"version":3,"sources":["a.ts"],"sourcesContent":["const a').mapa).toBe(true);
    expect(pareceMapa('{"version":3,"sources":["a.ts"],"sourcesContent":["x"]}').comFonte).toBe(true);
    expect(pareceMapa('{"version":3,"sources":["a.ts"],"mappings":"AA"}').comFonte).toBe(false);
    expect(pareceMapa(')]}\'\n{"version":3,"sections":[]}').mapa).toBe(true);
    expect(pareceMapa("<!doctype html><p>\"version\":3 \"sources\":</p>").mapa).toBe(false);
  });

  it("arquivos sensíveis: conteúdo de verdade conta; página HTML com 200 não", () => {
    expect(conferir("/.env", "DB_PASS=xyz\n")).toBe(true);
    expect(conferir("/.env", "export TOKEN=abc")).toBe(true);
    expect(conferir("/.env", "<!doctype html><html><body>APP=1</body></html>")).toBe(false);
    expect(conferir("/.git/HEAD", "ref: refs/heads/main\n")).toBe(true);
    expect(conferir("/.git/HEAD", "<html>ref: refs/heads</html>")).toBe(false);
    expect(conferir("/.git/config", "[core]\n\trepositoryformatversion = 0")).toBe(true);
    expect(conferir("/dump.sql", "CREATE TABLE usuarios (id int);")).toBe(true);
    expect(conferir("/dump.sql", "<!doctype html>CREATE TABLE")).toBe(false);
    expect(sensivel("/backup.zip").confere("", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]))).toBe(true);
    expect(conferir("/backup.zip", "<html>")).toBe(false);
  });

  it("rotas de API: sem molde, sem ação destrutiva, sem repetir", () => {
    const js = 'a("/api/usuarios");b(\'/api/usuarios\');c(`/api/itens/${id}`);d("/api/logout");e("/api/pedidos/:id");' +
      'f("/api/conta/excluir");g("/graphql");h("/rest/v1/produtos");i("/imagens/a.png")';
    expect(rotasDeApi(js)).toEqual(["/api/usuarios", "/graphql", "/rest/v1/produtos"]);
  });

  it("API aberta: JSON com dado; vazio, erro, HTML e sem 200 não contam", () => {
    expect(respostaAberta(200, "application/json", '[{"id":1}]')).toBe(true);
    expect(respostaAberta(200, "application/json; charset=utf-8", '{"nome":"Ana"}')).toBe(true);
    expect(respostaAberta(200, "application/json", "[]")).toBe(false);
    expect(respostaAberta(200, "application/json", "{}")).toBe(false);
    expect(respostaAberta(200, "application/json", '{"error":"login"}')).toBe(false);
    expect(respostaAberta(401, "application/json", '[{"id":1}]')).toBe(false);
    expect(respostaAberta(200, "text/html", "<html>")).toBe(false);
  });

  it("chaves: acha as secretas, separa a do Google, lê o papel do JWT e nunca guarda o valor inteiro", () => {
    const carga = (role: string) => Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url");
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${carga(role)}.${"a".repeat(30)}`;
    const google = ["AIza", "S".repeat(35)].join("");
    const texto = `x\nconst a="AKIAIOSFODNN7EXAMPLE";\nconst g="${google}";\nconst s="${jwt("service_role")}";const n="${jwt("anon")}";`;
    const achadas = chavesAparentes(texto);
    expect(achadas.map((k) => [k.tipo, k.grave, k.linha])).toEqual([
      ["chave da AWS", true, 2],
      ["chave do Google (confira se está restrita ao seu domínio)", false, 3],
      ["chave service_role do Supabase", true, 4],
    ]);
    expect(JSON.stringify(achadas)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(mascarar("AKIAIOSFODNN7EXAMPLE")).toBe("AKIAIO••••");
  });
});

describe("cliente do exame", () => {
  const resposta = (status: number, cabecalhos: Record<string, string> = {}) => new Response(status === 302 ? null : "ok", { status, headers: cabecalhos });

  it("não sai para outro host, nem seguindo redirecionamento", async () => {
    const vistos: string[] = [];
    const buscar = (async (url: URL) => {
      vistos.push(url.href);
      return url.pathname === "/vai" ? resposta(302, { location: "https://outro.exemplo/x" }) : resposta(200);
    }) as unknown as typeof fetch;
    const c = new ClienteExame(new URL("https://seusite.com.br/"), { agente: "t", buscar });
    expect(await c.pedir("https://outro.exemplo/y")).toBeNull();
    expect(await c.pedir("/vai")).toBeNull();
    expect(vistos).toEqual(["https://seusite.com.br/vai"]);
  });

  it("respeita o teto de pedidos e de bytes", async () => {
    const buscar = (async () => new Response("x".repeat(1000), { status: 200 })) as unknown as typeof fetch;
    const c = new ClienteExame(new URL("https://seusite.com.br/"), { agente: "t", buscar, maxPedidos: 2, maxBytes: 10 });
    expect((await c.pedir("/a"))!.bytes.length).toBe(10);
    await c.pedir("/b");
    expect(await c.pedir("/c")).toBeNull();
    expect(c.pedidos).toBe(2);
    expect(c.recusados).toBe(1);
  });
});
