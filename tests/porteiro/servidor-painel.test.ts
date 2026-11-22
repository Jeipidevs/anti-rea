import { afterEach, describe, expect, it } from "vitest";
import { codigoDeDono } from "../../src/passe/passe.js";
import { HTML, SEGREDO, cookieDe, limparTudo, montar, pedir } from "./apoio-servidor.js";

afterEach(limparTudo);

async function donoDe(t: Awaited<ReturnType<typeof montar>>): Promise<string> {
  const r = await t.get(`/.anti-rea/dono/${codigoDeDono(SEGREDO, 1)}`);
  return cookieDe(r, "anti_rea_passe")!;
}

describe("porteiro: painel de registro", () => {
  it("sem passe de dono é 404, igual a rota que não existe, e não vira evento", async () => {
    const t = await montar();
    const r = await t.get("/.anti-rea/painel", { accept: HTML });
    expect(r.status).toBe(404);
    expect(r.texto).toBe("Não encontrado.");
    const visitante = await t.passe();
    const v = await t.get("/.anti-rea/painel", { accept: HTML, cookie: visitante });
    expect(v.status).toBe(404);
    expect(t.eventos()).toEqual([]);
  });

  it("com passe de dono mostra o registro do dia, sem script, sem cache e sem iframe", async () => {
    const t = await montar();
    await t.get("/.env", { "user-agent": "curl/8.7.1" });
    const dono = await donoDe(t);
    const r = await t.get("/.anti-rea/painel", { accept: HTML, cookie: dono });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.texto).toContain("Painel do ANTI-REA");
    expect(r.texto).toContain("/.env");
    expect(r.texto).not.toContain("<script");
    expect(r.texto).not.toContain("/.anti-rea/guarda.js");
    // Abrir o painel não vira evento.
    expect(t.eventos()).toHaveLength(1);
  });

  it("filtra pela query", async () => {
    const t = await montar();
    await t.get("/.env", { "user-agent": "curl/8.7.1" });
    await t.get("/pagina", { "user-agent": "Wget/1.21" });
    const dono = await donoDe(t);
    const hoje = new Date().toISOString().slice(0, 10);
    const r = await t.get(`/.anti-rea/painel?dia=${hoje}&motivo=wget`, { accept: HTML, cookie: dono });
    expect(r.status).toBe(200);
    const tabela = r.texto.slice(r.texto.indexOf("<table"));
    expect(tabela).toContain("/pagina");
    expect(tabela).not.toContain("/.env");
  });

  it("só GET e HEAD; outro método ou outro caminho sob /.anti-rea/painel é 404", async () => {
    const t = await montar();
    const dono = await donoDe(t);
    const post = await pedir(t.porteiro.porta, "/.anti-rea/painel", { metodo: "POST", headers: { cookie: dono }, corpo: "x" });
    expect(post.status).toBe(404);
    const head = await pedir(t.porteiro.porta, "/.anti-rea/painel", { metodo: "HEAD", headers: { cookie: dono } });
    expect(head.status).toBe(200);
    expect((await t.get("/.anti-rea/painel/x", { cookie: dono })).status).toBe(404);
  });
});
