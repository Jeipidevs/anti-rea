import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkDeDono, mostrarDono } from "../../src/cli/dono.js";
import { escreverInstalacao, type RespostasInit } from "../../src/cli/init.js";
import { ambienteComEnv, versaoDoDono } from "../../src/cli/start.js";
import { carregarConfig } from "../../src/config/carregar.js";
import { codigoDeDono } from "../../src/passe/passe.js";

const SEGREDO = "s".repeat(43);
const respostas: RespostasInit = {
  upstream: "http://localhost:3000",
  dominio: "seusite.com.br",
  canal: "telegram",
  isentos: ["/api/webhook/*"],
  devtoolsIsCaught: true,
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anti-rea-init-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ler = (nome: string) => readFileSync(join(dir, nome), "utf8");

describe("escreverInstalacao", () => {
  it("escreve config válida, .env do canal e devolve o link de dono", () => {
    const { linkDono } = escreverInstalacao(dir, respostas, () => SEGREDO);
    expect(linkDono).toMatch(/^https:\/\/seusite\.com\.br\/\.anti-rea\/dono\/[A-Za-z0-9_-]{24}$/);
    expect(linkDono).toBe(`https://seusite.com.br/.anti-rea/dono/${codigoDeDono(SEGREDO, 1)}`);

    const cfg = carregarConfig(join(dir, "anti-rea.config.yml"));
    expect(cfg.upstream).toBe("http://localhost:3000");
    expect(cfg.domains).toEqual(["seusite.com.br"]);
    expect(cfg.exempt).toEqual(["/api/webhook/*"]);
    expect(cfg.alerts.channels).toEqual(["telegram"]);
    expect(cfg.check.devtoolsIsCaught).toBe(true);

    const env = ler(".env");
    expect(env).toMatch(/ANTI_REA_TELEGRAM_TOKEN=\n/);
    expect(env).toMatch(/ANTI_REA_TELEGRAM_CHAT=\n/);
    expect(env).toContain(`ANTI_REA_SECRET=${SEGREDO}\n`);
    expect(env).toContain("ANTI_REA_OWNER_VERSION=1\n");
    expect(env).not.toContain("WHATSAPP");
  });

  it("mantém os comentários em português do exemplo", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    const yml = ler("anti-rea.config.yml");
    expect(yml).toContain("# onde o seu site real roda");
    expect(yml).toContain("# quem abre o F12 cai na sombra");
    expect(yml).toContain("# caminhos de máquina, sem verificação");
    expect(yml).toContain("# apaga registros mais velhos (LGPD)");
    expect(yml).not.toContain("\u2014");
  });

  it("grava o .env só para o dono (modo 0600)", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("recusa sobrescrever sem forcar e sobrescreve com forcar", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    expect(() => escreverInstalacao(dir, respostas)).toThrow(/já existe/);
    expect(ler(".env")).toContain(SEGREDO);

    const { linkDono } = escreverInstalacao(dir, { ...respostas, canal: "webhook" }, () => "t".repeat(43), { forcar: true });
    expect(linkDono).toContain(codigoDeDono("t".repeat(43), 1));
    expect(ler(".env")).toMatch(/ANTI_REA_WEBHOOK_URL=\n/);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("recusa quando só o .env já existe, sem escrever a config", () => {
    writeFileSync(join(dir, ".env"), "ANTI_REA_SECRET=antigo\n");
    expect(() => escreverInstalacao(dir, respostas)).toThrow(/\.env já existe/);
    expect(() => statSync(join(dir, "anti-rea.config.yml"))).toThrow();
  });

  it("sem canal e sem caminhos isentos, a config fica vazia nesses campos", () => {
    escreverInstalacao(dir, { ...respostas, canal: "nenhum", isentos: [], devtoolsIsCaught: false }, () => SEGREDO);
    const cfg = carregarConfig(join(dir, "anti-rea.config.yml"));
    expect(cfg.alerts.channels).toEqual([]);
    expect(cfg.exempt).toEqual([]);
    expect(cfg.check.devtoolsIsCaught).toBe(false);
    expect(ler(".env")).not.toMatch(/TELEGRAM|WHATSAPP|WEBHOOK/);
  });

  it("caminho com caractere especial do YAML continua o mesmo depois de lido", () => {
    escreverInstalacao(dir, { ...respostas, isentos: ["*/x", "/a #b", "/c: d"] }, () => SEGREDO);
    expect(carregarConfig(join(dir, "anti-rea.config.yml")).exempt).toEqual(["*/x", "/a #b", "/c: d"]);
  });

  it("acrescenta .env ao .gitignore existente uma vez só", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/");
    escreverInstalacao(dir, respostas, () => SEGREDO);
    expect(ler(".gitignore")).toBe("node_modules/\n.env\n");
    escreverInstalacao(dir, respostas, () => SEGREDO, { forcar: true });
    expect(ler(".gitignore")).toBe("node_modules/\n.env\n");
  });

  it("não cria .gitignore quando a pasta não tem um", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    expect(() => statSync(join(dir, ".gitignore"))).toThrow();
  });

  it("domínio em maiúsculas vira minúsculas", () => {
    const { linkDono } = escreverInstalacao(dir, { ...respostas, dominio: " SeuSite.COM.br " }, () => SEGREDO);
    expect(linkDono.startsWith("https://seusite.com.br/")).toBe(true);
    expect(carregarConfig(join(dir, "anti-rea.config.yml")).domains).toEqual(["seusite.com.br"]);
  });

  it("recusa endereço e domínio inválidos sem escrever nada", () => {
    expect(() => escreverInstalacao(dir, { ...respostas, upstream: "localhost:3000" })).toThrow(/upstream/);
    expect(() => escreverInstalacao(dir, { ...respostas, dominio: "https://seusite.com.br/" })).toThrow(/Domínio/);
    expect(() => statSync(join(dir, ".env"))).toThrow();
  });
});

describe("dono", () => {
  it("mostra o link atual e, com --novo, soma 1 na versão do .env", () => {
    writeFileSync(join(dir, ".gitignore"), ".env\n");
    escreverInstalacao(dir, respostas, () => SEGREDO);
    const config = join(dir, "anti-rea.config.yml");

    expect(mostrarDono(config, false, {})).toContain(linkDeDono("seusite.com.br", SEGREDO, 1));

    const linhas = mostrarDono(config, true, {});
    expect(linhas).toContain(linkDeDono("seusite.com.br", SEGREDO, 2));
    expect(ler(".env")).toContain("ANTI_REA_OWNER_VERSION=2\n");
    expect(ler(".env")).not.toContain("ANTI_REA_OWNER_VERSION=1");
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);

    expect(mostrarDono(config, false, {})).toContain(linkDeDono("seusite.com.br", SEGREDO, 2));
  });

  it("--novo lembra que no Docker o contêiner precisa ser recriado (o restart não relê o .env)", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    const linhas = mostrarDono(join(dir, "anti-rea.config.yml"), true, {});
    expect(linhas).toContain(
      "No Docker, rode docker compose up -d: ele recria o contêiner. O docker compose restart não relê o .env.",
    );
  });

  it("--novo com a versão repetida no .env deixa uma linha só e a versão nova vale de fato", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    const config = join(dir, "anti-rea.config.yml");
    // Quem cola o .env.example por cima do .env fica com a chave duas vezes; a última vence.
    writeFileSync(join(dir, ".env"), `${ler(".env")}ANTI_REA_OWNER_VERSION=3\n`);
    expect(mostrarDono(config, false, {})).toContain(linkDeDono("seusite.com.br", SEGREDO, 3));

    const linhas = mostrarDono(config, true, {});
    expect(linhas[0]).toMatch(/versão 4/);
    expect(linhas).toContain(linkDeDono("seusite.com.br", SEGREDO, 4));
    expect(ler(".env").match(/ANTI_REA_OWNER_VERSION/g)).toHaveLength(1);
    expect(ler(".env")).toContain("ANTI_REA_OWNER_VERSION=4\n");
    expect(versaoDoDono(ambienteComEnv(config, {}))).toBe(4);
    expect(ler(".env")).toContain(`ANTI_REA_SECRET=${SEGREDO}`);

    expect(mostrarDono(config, true, {})[0]).toMatch(/versão 5/);
    expect(versaoDoDono(ambienteComEnv(config, {}))).toBe(5);
  });

  it("--novo troca a linha com espaços e CRLF e não mexe na linha comentada", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    const config = join(dir, "anti-rea.config.yml");
    writeFileSync(
      join(dir, ".env"),
      `ANTI_REA_SECRET=${SEGREDO}\r\n# ANTI_REA_OWNER_VERSION=9\r\n  ANTI_REA_OWNER_VERSION = 2\r\nANTI_REA_OWNER_VERSION=7\r\n`,
    );
    expect(mostrarDono(config, true, {})[0]).toMatch(/versão 8/);
    expect(ler(".env")).toBe(`ANTI_REA_SECRET=${SEGREDO}\r\n# ANTI_REA_OWNER_VERSION=9\r\nANTI_REA_OWNER_VERSION=8\r\n`);
    expect(versaoDoDono(ambienteComEnv(config, {}))).toBe(8);
  });

  it("--novo acrescenta a versão quando o .env não tem a linha", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    writeFileSync(join(dir, ".env"), `ANTI_REA_SECRET=${SEGREDO}`);
    mostrarDono(join(dir, "anti-rea.config.yml"), true, {});
    expect(ler(".env")).toBe(`ANTI_REA_SECRET=${SEGREDO}\nANTI_REA_OWNER_VERSION=2\n`);
  });

  it("sem ANTI_REA_SECRET explica o que falta", () => {
    escreverInstalacao(dir, respostas, () => SEGREDO);
    writeFileSync(join(dir, ".env"), "ANTI_REA_SECRET=\n");
    expect(() => mostrarDono(join(dir, "anti-rea.config.yml"), false, {})).toThrow(/ANTI_REA_SECRET/);
  });
});
