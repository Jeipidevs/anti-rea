import { describe, expect, it } from "vitest";
import { validarConfig } from "../../src/config/carregar.js";
import { paginaSombra } from "../../src/sombra/sombra.js";

const base = validarConfig({ upstream: "http://s", domains: ["a.com"] }).shadow;
const d = { ip: "203.0.113.42", caminho: "/painel", quando: new Date("2026-11-20T14:32:00Z") };
const dois = (n: number) => String(n).padStart(2, "0");
// Hora esperada calculada no fuso da própria máquina, para o teste não depender dele.
const q = d.quando;
const horaPt = `${dois(q.getDate())}/${dois(q.getMonth() + 1)}/${q.getFullYear()} ${dois(q.getHours())}:${dois(q.getMinutes())}`;
const horaEn = `${q.getFullYear()}-${dois(q.getMonth() + 1)}-${dois(q.getDate())} ${dois(q.getHours())}:${dois(q.getMinutes())}`;
const semArquivo = () => {
  throw new Error("sem arquivo");
};

describe("paginaSombra", () => {
  it("segue o exemplo do plano", () => {
    const h = paginaSombra(base, d);
    expect(h).toContain("Ops. Pegamos você.");
    expect(h).toContain("203.0.113.42");
    expect(h).not.toContain("<script");
    expect(paginaSombra({ ...base, showIp: false }, d)).not.toContain("203.0.113.42");
    expect(paginaSombra({ ...base, language: "en" }, d)).toContain("Oops. Caught you.");
    const t = paginaSombra({ ...base, template: "x.html" }, { ...d, caminho: "/<b>" }, () => "<p>{{ip}} {{path}}</p>");
    expect(t).toBe("<p>203.0.113.42 /&lt;b&gt;</p>");
  });

  it("traz os textos padrão em pt-BR", () => {
    const h = paginaSombra(base, d);
    expect(h).toContain('<html lang="pt-BR">');
    for (const s of [
      "Ops. Pegamos você.",
      "Belo esforço com o seu robô. O código que você queria não mora aqui.",
      "Que tal criar o seu? Dá menos trabalho e é mais divertido.",
      "tentativa",
      "registrada",
      "seu IP",
      "dono avisado",
      "agora mesmo",
      horaPt,
    ])
      expect(h).toContain(s);
  });

  it("traz os textos padrão em inglês", () => {
    const h = paginaSombra({ ...base, language: "en" }, d);
    expect(h).toContain('<html lang="en">');
    for (const s of [
      "Oops. Caught you.",
      "Nice try with your bot. The code you wanted doesn&#39;t live here.",
      "Why not build your own? It&#39;s less work and more fun.",
      "attempt",
      "logged",
      "your IP",
      "owner notified",
      "just now",
      horaEn,
    ])
      expect(h).toContain(s);
    expect(h).not.toContain("Pegamos");
  });

  it("idioma desconhecido cai no pt-BR", () => {
    const h = paginaSombra({ ...base, language: "fr" as never }, d);
    expect(h).toContain('<html lang="pt-BR">');
    expect(h).toContain("Ops. Pegamos você.");
  });

  it("title, message e footer da configuração trocam o padrão, com escape", () => {
    const h = paginaSombra({ ...base, title: "Bem-vindo <b>", message: "msg & cia", footer: 'rodapé "x"' }, d);
    expect(h).toContain("Bem-vindo &lt;b&gt;");
    expect(h).toContain("msg &amp; cia");
    expect(h).toContain("rodapé &quot;x&quot;");
    expect(h).not.toContain("Ops. Pegamos você.");
    expect(h).not.toContain("<b>");
  });

  it("tem noindex, CSP fechada e nenhum recurso de fora", () => {
    const h = paginaSombra(base, d);
    expect(h.startsWith("<!doctype html>")).toBe(true);
    expect(h).toContain('<meta name="robots" content="noindex">');
    expect(h).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
    );
    expect(h).not.toMatch(/<script/i);
    expect(h).not.toMatch(/<link/i);
    expect(h).not.toMatch(/https?:\/\//);
    expect(h).not.toMatch(/url\(/);
    expect(h).not.toMatch(/\son[a-z]+=/i);
    expect(h).toContain("#0B0C14");
  });

  it("escapa IP vindo do pedido", () => {
    const h = paginaSombra(base, { ...d, ip: '<img src=x onerror="alert(1)">' });
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("aceita accentColor #RGB e #RRGGBB, recusa o resto", () => {
    expect(paginaSombra({ ...base, accentColor: "#ff0044" }, d)).toContain("#ff0044");
    expect(paginaSombra({ ...base, accentColor: "#F04" }, d)).toContain("#F04");
    expect(paginaSombra(base, d)).toContain("#7C6CFF");
    for (const ruim of ["red; } body { display:none", "#12345", "#GGGGGG", "url(x)", "#7C6CFF;x:y"]) {
      const h = paginaSombra({ ...base, accentColor: ruim }, d);
      expect(h).not.toContain(ruim);
      expect(h).toContain("#7C6CFF");
    }
  });

  it("embute o logo SVG como data URI", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const lidos: string[] = [];
    const h = paginaSombra({ ...base, logo: "marca.svg" }, d, (p) => {
      lidos.push(p);
      return svg;
    });
    expect(lidos).toEqual(["marca.svg"]);
    expect(h).toContain(`src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"`);
  });

  it("embute logo PNG, JPG e WEBP com o MIME certo (lerArquivo devolve base64)", () => {
    const b64 = "iVBORw0KGgo=";
    expect(paginaSombra({ ...base, logo: "m.png" }, d, () => b64)).toContain(`src="data:image/png;base64,${b64}"`);
    expect(paginaSombra({ ...base, logo: "m.JPG" }, d, () => b64)).toContain(`src="data:image/jpeg;base64,${b64}"`);
    expect(paginaSombra({ ...base, logo: "m.jpeg" }, d, () => b64)).toContain(`src="data:image/jpeg;base64,${b64}"`);
    expect(paginaSombra({ ...base, logo: "m.webp" }, d, () => b64)).toContain(`src="data:image/webp;base64,${b64}"`);
  });

  it("logo com extensão desconhecida ou que não abre fica de fora sem estourar", () => {
    const h1 = paginaSombra({ ...base, logo: "m.gif" }, d, () => "R0lGOD");
    expect(h1).not.toContain("data:image");
    expect(h1).toContain("Ops. Pegamos você.");
    const h2 = paginaSombra({ ...base, logo: "m.png" }, d, semArquivo);
    expect(h2).not.toContain("data:image");
    expect(h2).toContain("Ops. Pegamos você.");
  });

  it("lê o logo do disco com o leitor padrão", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "anti-rea-sombra-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(dir, "m.png"), png);
    writeFileSync(join(dir, "m.svg"), "<svg/>");
    expect(paginaSombra({ ...base, logo: join(dir, "m.png") }, d)).toContain(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    expect(paginaSombra({ ...base, logo: join(dir, "m.svg") }, d)).toContain(
      `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
    );
    writeFileSync(join(dir, "t.html"), "<i>{{ip}}</i>");
    expect(paginaSombra({ ...base, template: join(dir, "t.html") }, d)).toBe("<i>203.0.113.42</i>");
  });

  it("template troca só ip, path e time, todas as ocorrências, com escape", () => {
    const tpl = "<h1>{{ip}}</h1>{{path}}|{{time}}|{{ip}}|{{title}}|{{ ip }}";
    const t = paginaSombra({ ...base, template: "t.html" }, { ...d, caminho: '/a"&\'' }, () => tpl);
    expect(t).toBe(`<h1>203.0.113.42</h1>/a&quot;&amp;&#39;|${horaPt}|203.0.113.42|{{title}}|{{ ip }}`);
  });

  it("template não reprocessa marcador que veio dentro de um valor", () => {
    const t = paginaSombra({ ...base, template: "t.html" }, { ...d, caminho: "/{{ip}}" }, () => "{{path}}");
    expect(t).toBe("/{{ip}}");
  });

  it("template usa a hora em inglês quando language é en", () => {
    const t = paginaSombra({ ...base, language: "en", template: "t.html" }, d, () => "{{time}}");
    expect(t).toBe(horaEn);
  });

  it("template com showIp false não mostra o IP", () => {
    const t = paginaSombra({ ...base, showIp: false, template: "t.html" }, d, () => "[{{ip}}]");
    expect(t).toBe("[]");
  });

  it("data inválida não estoura", () => {
    const h = paginaSombra(base, { ...d, quando: new Date(Number.NaN) });
    expect(h).toContain("Ops. Pegamos você.");
    expect(h).not.toContain("NaN");
  });

  it("template que não abre cai na página padrão", () => {
    const h = paginaSombra({ ...base, template: "sumiu.html" }, d, semArquivo);
    expect(h.startsWith("<!doctype html>")).toBe(true);
    expect(h).toContain("Ops. Pegamos você.");
  });
});
