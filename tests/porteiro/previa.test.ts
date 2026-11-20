import { describe, expect, it } from "vitest";
import { CachePrevia, extrairPrevia } from "../../src/porteiro/previa.js";

describe("extrairPrevia", () => {
  it("lê título, descrição e imagem das etiquetas og, com reserva no title e description", () => {
    const html = `<!doctype html><html><head>
      <title>  Loja   do João </title>
      <meta name="description" content="Descrição simples">
      <meta property="og:title" content="Loja &amp; Café">
      <meta content='Bolo &quot;caseiro&quot; &#233; bom' property='og:description'>
      <meta property="og:image" content="https://seusite.com.br/og.png">
      </head><body>oi</body></html>`;
    expect(extrairPrevia(html)).toEqual({
      titulo: "Loja & Café",
      descricao: 'Bolo "caseiro" é bom',
      imagem: "https://seusite.com.br/og.png",
    });
  });

  it("sem og usa title e description", () => {
    expect(extrairPrevia('<title>Só título</title><meta name="Description" content="só descrição">')).toEqual({
      titulo: "Só título",
      descricao: "só descrição",
    });
  });

  it("html vazio ou sem nada devolve objeto vazio", () => {
    expect(extrairPrevia("")).toEqual({});
    expect(extrairPrevia("<p>nada</p>")).toEqual({});
  });

  it("corta campos longos e ignora imagem que não é http, https ou caminho", () => {
    const longo = "x".repeat(1000);
    const p = extrairPrevia(`<title>${longo}</title><meta property="og:image" content="javascript:alert(1)">`);
    expect(p.titulo).toHaveLength(300);
    expect(p.imagem).toBeUndefined();
    expect(extrairPrevia('<meta property="og:image" content="/og.png">').imagem).toBe("/og.png");
  });
});

describe("CachePrevia", () => {
  it("guarda por caminho por 10 minutos", async () => {
    let agora = 0;
    let buscas = 0;
    const cache = new CachePrevia(() => agora);
    const buscar = async () => {
      buscas++;
      return `<title>T${buscas}</title>`;
    };
    expect(await cache.obter("/a", buscar)).toEqual({ titulo: "T1" });
    expect(await cache.obter("/a", buscar)).toEqual({ titulo: "T1" });
    agora = 10 * 60_000 - 1;
    expect(await cache.obter("/a", buscar)).toEqual({ titulo: "T1" });
    agora = 10 * 60_000;
    expect(await cache.obter("/a", buscar)).toEqual({ titulo: "T2" });
    expect(await cache.obter("/b", buscar)).toEqual({ titulo: "T3" });
  });

  it("erro na busca vira prévia vazia, sem lançar", async () => {
    const cache = new CachePrevia(() => 0);
    expect(await cache.obter("/a", async () => Promise.reject(new Error("fora do ar")))).toEqual({});
  });

  it("pedidos simultâneos do mesmo caminho fazem uma busca só", async () => {
    let buscas = 0;
    const cache = new CachePrevia(() => 0);
    const buscar = async () => {
      buscas++;
      await new Promise((r) => setTimeout(r, 5));
      return "<title>X</title>";
    };
    await Promise.all([cache.obter("/a", buscar), cache.obter("/a", buscar), cache.obter("/a", buscar)]);
    expect(buscas).toBe(1);
  });

  it("guarda no máximo 500 caminhos", async () => {
    const cache = new CachePrevia(() => 0);
    for (let i = 0; i < 520; i++) await cache.obter(`/p${i}`, async () => "");
    expect(cache.tamanho).toBe(500);
  });
});
