import { describe, expect, it } from "vitest";
import { ferramentaConhecida } from "../../src/deteccao/servidor/ferramentas.js";
import { caminhoDeVarredura, caminhoTrancado } from "../../src/deteccao/servidor/caminhos.js";
import { Ritmo } from "../../src/deteccao/servidor/ritmo.js";

describe("ferramentaConhecida", () => {
  it("classifica ferramentas por agente", () => {
    expect(ferramentaConhecida("Wget/1.21")?.gravidade).toBe("copia");
    expect(ferramentaConhecida("Mozilla/5.0 (compatible; HTTrack 3.0x)")?.motivo).toMatch(/httrack/i);
    expect(ferramentaConhecida("sqlmap/1.8")?.gravidade).toBe("varredura");
    expect(ferramentaConhecida(undefined)?.motivo).toBe("sem agente");
    expect(ferramentaConhecida("")?.motivo).toBe("sem agente");
    expect(ferramentaConhecida("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36")).toBeNull();
  });
  it("cobre java/ e headlesschrome", () => {
    expect(ferramentaConhecida("Java/17.0.1")?.motivo).toBe("java/");
    expect(ferramentaConhecida("HeadlessChrome/130")?.gravidade).toBe("copia");
  });
});

describe("caminhoTrancado", () => {
  it("tranca mapas e arquivos sensíveis", () => {
    expect(caminhoTrancado("/_next/static/chunks/app.js.map")?.gravidade).toBe("copia");
    expect(caminhoTrancado("/_next/static/chunks/app.js.map")?.motivo).toBe("mapa de código");
    expect(caminhoTrancado("/.env.production")?.gravidade).toBe("varredura");
    expect(caminhoTrancado("/.env")?.motivo).toBe("arquivo sensível");
    expect(caminhoTrancado("/repo/.git/config")).not.toBeNull();
    expect(caminhoTrancado("/dump.sql.gz")).not.toBeNull();
    expect(caminhoTrancado("/a/.DS_Store")).not.toBeNull();
    expect(caminhoTrancado("/APP.JS.MAP?v=1")?.gravidade).toBe("copia");
  });
  it("deixa passar o resto", () => {
    expect(caminhoTrancado("/app.js")).toBeNull();
    expect(caminhoTrancado("/wp-login.php")).toBeNull();
    expect(caminhoTrancado("/.environment")).toBeNull();
    expect(caminhoTrancado("/.github/workflows")).toBeNull();
  });

  it("tranca .env, configuração e backups em qualquer pasta (spec 3.5)", () => {
    const trancados = [
      // .env em qualquer profundidade
      "/api/.env",
      "/backend/.env.production",
      "/laravel/.env.local",
      "/api/config/.env",
      "/.envrc",
      "/app/.envrc",
      "/.env.example",
      "/.env/segredo",
      // configuração
      "/.htpasswd",
      "/admin/.htpasswd",
      "/.htaccess",
      "/blog/.htaccess",
      "/.npmrc",
      "/front/.npmrc",
      "/.git-credentials",
      "/.ssh/id_rsa",
      "/home/.ssh/authorized_keys",
      "/.aws/credentials",
      "/x/.aws/config",
      "/wp-config.php.bak",
      "/blog/wp-config.php.save",
      "/wp-config.php.swp",
      "/wp-config.php.old",
      // sufixos de cópia do editor e de backup
      "/index.php~",
      "/config/app.yml~",
      "/settings.py.save",
      "/.index.php.swo",
      "/a.bak",
      "/a.old",
      "/a.orig",
      "/a.swp",
      "/banco.sql",
      "/banco.sql.gz",
      // compactado com nome de backup em qualquer pasta
      "/backup.zip",
      "/backups.tar.gz",
      "/uploads/backup-2026-11-20.tar.gz",
      "/wp-content/bkp_site.7z",
      "/BACKUP.RAR",
      "/x/backup.tgz",
      "/x/bkp.tar",
      "/x/backup.gz",
      // compactado com nome de site, na raiz
      "/site.zip",
      "/www.tar.gz",
      "/web.tgz",
      "/html.7z",
      "/public_html.zip",
      "/htdocs.rar",
      "/wwwroot.tar",
      "/db.gz",
      "/database.zip",
      "/dump.tar.gz",
      "/SITE.ZIP",
    ];
    for (const caminho of trancados) {
      expect(caminhoTrancado(caminho), caminho).toEqual({ motivo: "arquivo sensível", gravidade: "varredura" });
    }
  });

  it("não tranca o que só parece: nome de site fora da raiz, compactado comum e wp-config.php em si", () => {
    const livres = [
      "/downloads/site.zip",
      "/arquivos/db.gz",
      "/catalogo.zip",
      "/meu-backup.zip",
      "/backup",
      "/backup.html",
      "/backups/",
      "/site.html",
      "/wp-config.php",
      "/wp-config-sample.php",
      "/.environment",
      "/.envy",
      "/.sshd",
      "/.awsome",
      "/app.save.js",
      "/blog/~joao",
    ];
    for (const caminho of livres) expect(caminhoTrancado(caminho), caminho).toBeNull();
  });
});

describe("caminhoDeVarredura", () => {
  it("pega caminhos de varredura", () => {
    expect(caminhoDeVarredura("/phpmyadmin/index.php")?.gravidade).toBe("varredura");
    expect(caminhoDeVarredura("/PMA")?.motivo).toBe("caminho de varredura");
    expect(caminhoDeVarredura("/HNAP1")).not.toBeNull();
    expect(caminhoDeVarredura("/cgi-bin/x?a=1")).not.toBeNull();
    expect(caminhoDeVarredura("/wp-admin")).toBeNull();
    expect(caminhoDeVarredura("/pmaster")).toBeNull();
  });
});

describe("Ritmo", () => {
  it("conta por IP dentro da janela", () => {
    const r = new Ritmo(3, 10_000);
    expect([1, 2, 3].map((t) => r.registrar("203.0.113.1", t))).toEqual([false, false, false]);
    expect(r.registrar("203.0.113.1", 4)).toBe(true);
    expect(r.registrar("203.0.113.1", 20_000)).toBe(false);
    expect(r.registrar("203.0.113.2", 5)).toBe(false);
  });
  it("guarda no maximo limite+1 instantes por IP", () => {
    const r = new Ritmo(3, 10_000);
    const respostas = Array.from({ length: 1000 }, (_, i) => r.registrar("203.0.113.1", i));
    expect(r.instantesGuardados("203.0.113.1")).toBeLessThanOrEqual(4);
    expect(respostas.slice(0, 3)).toEqual([false, false, false]);
    expect(respostas.slice(3).every((x) => x)).toBe(true);
    expect(r.registrar("203.0.113.1", 10_995)).toBe(true);
    expect(r.registrar("203.0.113.1", 10_998)).toBe(false);
    expect(r.registrar("203.0.113.1", 50_000)).toBe(false);
  });
  it("varre IPs inativos no maximo uma vez por meia janela", () => {
    const r = new Ritmo(3, 10_000);
    for (let i = 0; i < 10_000; i++) r.registrar(`10.0.${i >> 8}.${i & 255}`, i % 5_000);
    expect(r.varreduras).toBeLessThanOrEqual(1);
    expect(r.chavesGuardadas).toBe(10_000);
    r.registrar("203.0.113.9", 4_999);
    expect(r.varreduras).toBeLessThanOrEqual(1);
    r.registrar("203.0.113.9", 30_000);
    expect(r.varreduras).toBe(2);
    expect(r.chavesGuardadas).toBe(1);
  });
});
