import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dadosDoRegistro, filtroDaQuery, montarPainel, type DadosPainel } from "../../src/painel/painel.js";
import { Registro, type Evento } from "../../src/registro/registro.js";

const AGORA = new Date("2026-11-22T15:00:00Z");

function evento(extra: Partial<Evento> = {}): Evento {
  return {
    quando: "2026-11-22T12:00:00.000Z",
    ip: "203.0.113.7",
    dominio: "seusite.com.br",
    caminho: "/.env",
    agente: "curl/8.7.1",
    motivo: "curl",
    gravidade: "copia",
    destino: "sombra",
    ...extra,
  };
}

function dados(extra: Partial<DadosPainel> = {}): DadosPainel {
  return {
    dias: [{ dia: "2026-11-22", total: 2 }],
    eventos: [evento(), evento({ ip: "203.0.113.9", motivo: "wget", destino: "recusado" })],
    filtro: { dia: "2026-11-22" },
    agora: AGORA,
    links: true,
    ...extra,
  };
}

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe("filtroDaQuery", () => {
  it("sem query, o dia de hoje em UTC e nenhum filtro", () => {
    expect(filtroDaQuery(null, AGORA)).toEqual({ dia: "2026-11-22" });
  });

  it("lê dia, ip, motivo e destino válidos", () => {
    const f = filtroDaQuery("dia=2026-11-20&ip=2001:db8::1&motivo=mapa%20de%20c%C3%B3digo&destino=recusado", AGORA);
    expect(f).toEqual({ dia: "2026-11-20", ip: "2001:db8::1", motivo: "mapa de código", destino: "recusado" });
  });

  it("joga fora o que não vale: dia fora do calendário, ip com letra estranha, destino inventado, motivo enorme", () => {
    const f = filtroDaQuery(`dia=2026-02-31&ip=<script>&destino=tudo&motivo=${"x".repeat(200)}`, AGORA);
    expect(f).toEqual({ dia: "2026-11-22" });
  });
});

describe("montarPainel", () => {
  it("mostra o resumo do dia, os principais IPs e motivos e a lista de eventos", () => {
    const html = montarPainel(dados());
    expect(html).toContain("<title>Painel do ANTI-REA</title>");
    expect(html).toContain("2026-11-22");
    expect(html).toMatch(/2<\/b>\s*<span>eventos/);
    expect(html).toContain("203.0.113.7");
    expect(html).toContain("203.0.113.9");
    expect(html).toContain("wget");
    expect(html).toContain('href="?dia=2026-11-22&amp;ip=203.0.113.7"');
    expect(html).not.toContain("<script");
  });

  it("escapa tudo que veio do registro: agente e caminho são do atacante", () => {
    const html = montarPainel(
      dados({ eventos: [evento({ agente: '<script>alert(1)</script>', caminho: '/"><img src=x onerror=alert(1)>', motivo: "a&b" })] }),
    );
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a&amp;b");
  });

  it("aguenta linha estranha no registro (campo faltando ou de outro tipo)", () => {
    const torto = { quando: 5, ip: null } as unknown as Evento;
    expect(() => montarPainel(dados({ eventos: [torto] }))).not.toThrow();
  });

  it("aplica o filtro e mostra como limpar", () => {
    const html = montarPainel(dados({ filtro: { dia: "2026-11-22", ip: "203.0.113.9" } }));
    expect(html).toContain("Filtro");
    expect(html).toContain('href="?dia=2026-11-22"');
    const tabela = html.slice(html.indexOf("<table"));
    expect(tabela).toContain("203.0.113.9");
    expect(tabela).not.toContain("203.0.113.7");
  });

  it("dia sem evento diz isso", () => {
    expect(montarPainel(dados({ eventos: [] }))).toContain("Nenhum evento neste dia.");
  });

  it("em arquivo (links: false) não tem link de filtro", () => {
    const html = montarPainel(dados({ links: false }));
    expect(html).not.toContain('href="?');
  });

  it("mostra só os 300 eventos mais recentes, do mais novo para o mais velho", () => {
    const muitos = Array.from({ length: 320 }, (_, i) =>
      evento({ quando: new Date(Date.parse("2026-11-22T00:00:00Z") + i * 1000).toISOString(), caminho: `/p${i}` }),
    );
    const html = montarPainel(dados({ eventos: muitos }));
    const tabela = html.slice(html.indexOf("<table"));
    expect(tabela).toContain("/p319");
    expect(tabela).not.toContain("/p19<");
    expect(tabela.indexOf("/p319")).toBeLessThan(tabela.indexOf("/p318"));
  });
});

describe("dadosDoRegistro", () => {
  it("lê os dias da pasta (mais novo primeiro, até 14) e os eventos do dia pedido", () => {
    const pasta = mkdtempSync(join(tmpdir(), "anti-rea-painel-"));
    pastas.push(pasta);
    const registro = new Registro(pasta, 30 * 86_400_000);
    registro.gravar(evento());
    registro.gravar(evento({ quando: "2026-11-21T10:00:00.000Z" }));
    registro.gravar(evento({ quando: "2026-11-21T11:00:00.000Z" }));
    writeFileSync(join(pasta, "lixo.txt"), "x");
    const d = dadosDoRegistro(registro, { dia: "2026-11-21" }, AGORA, true);
    expect(d.dias).toEqual([
      { dia: "2026-11-22", total: 1 },
      { dia: "2026-11-21", total: 2 },
    ]);
    expect(d.eventos).toHaveLength(2);
    expect(d.filtro).toEqual({ dia: "2026-11-21" });
  });
});
