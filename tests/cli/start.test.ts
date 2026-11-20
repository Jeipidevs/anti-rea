import http from "node:http";
import net from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { escreverInstalacao } from "../../src/cli/init.js";
import { analisarEnv, subirPorteiro, versaoDoDono, type OpcoesStart } from "../../src/cli/start.js";
import type { Porteiro } from "../../src/porteiro/servidor.js";
import type { Resolvedor } from "../../src/robos/dns.js";
import { FaixasMeta } from "../../src/robos/faixas-meta.js";

const semDns: Resolvedor = { reverso: async () => [], direto: async () => [] };

let dir: string;
const abertos: Porteiro[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anti-rea-start-"));
});
afterEach(async () => {
  while (abertos.length > 0) await abertos.pop()!.fechar();
  chmodSync(dir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

// Como root, chmod não tira a permissão: os testes de pasta sem permissão não fazem sentido.
const comoRoot = process.getuid?.() === 0;

function instalar(canal: "telegram" | "nenhum" = "telegram"): string {
  escreverInstalacao(
    dir,
    { upstream: "http://localhost:3000", dominio: "seusite.com.br", canal, isentos: [], devtoolsIsCaught: true },
    () => "s".repeat(43),
  );
  return join(dir, "anti-rea.config.yml");
}

/** Sobe o porteiro como o `anti-rea start`, sem rede, e devolve o que ele disse no terminal. */
async function rodarStart(opcoes: Partial<OpcoesStart> = {}): Promise<{ saida: string; porteiro: Porteiro }> {
  const linhas: string[] = [];
  const porteiro = await subirPorteiro(
    { config: join(dir, "anti-rea.config.yml"), porta: 0, registro: join(dir, "registro"), env: {}, ...opcoes },
    { dizer: (l) => linhas.push(l), host: "127.0.0.1", dns: semDns, meta: new FaixasMeta(async () => ["192.0.2.0/24"]) },
  );
  abertos.push(porteiro);
  return { saida: linhas.join("\n"), porteiro };
}

function pedir(porta: number, caminho: string): Promise<{ status: number; corpo: string }> {
  return new Promise((resolver, rejeitar) => {
    http
      .get({ host: "127.0.0.1", port: porta, path: caminho, headers: { "user-agent": "curl/8.0", host: "seusite.com.br" } }, (res) => {
        let corpo = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (corpo += c));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, corpo }));
      })
      .on("error", rejeitar);
  });
}

describe("start", () => {
  it("sobe sem canal configurado e lista o que falta", async () => {
    instalar();
    const { saida, porteiro } = await rodarStart();
    expect(porteiro.porta).toBeGreaterThan(0);
    expect(saida).toContain(`Porteiro no ar em :${porteiro.porta}, protegendo http://localhost:3000`);
    expect(saida).toContain("Falta ANTI_REA_TELEGRAM_TOKEN para o canal telegram");
    expect(saida).toContain("Falta ANTI_REA_TELEGRAM_CHAT para o canal telegram");
    // O segredo veio do .env ao lado da config.
    expect(saida).not.toContain("Sem ANTI_REA_SECRET");
  });

  it("variável já no ambiente vale mais que o .env", async () => {
    instalar();
    const { saida } = await rodarStart({ env: { ANTI_REA_TELEGRAM_TOKEN: "x", ANTI_REA_TELEGRAM_CHAT: "y" } });
    expect(saida).not.toContain("Falta");
  });

  it("sem segredo gera um efêmero e avisa", async () => {
    instalar("nenhum");
    writeFileSync(join(dir, ".env"), "# vazio\n");
    const { saida } = await rodarStart();
    expect(saida).toContain("Sem ANTI_REA_SECRET: os passes caem a cada reinício.");
    expect(saida).toContain("Porteiro no ar em");
  });

  it("resolve shadow.template relativo à pasta da config", async () => {
    const config = instalar("nenhum");
    writeFileSync(join(dir, "sombra.html"), "<p>SOMBRA PROPRIA {{path}}</p>");
    writeFileSync(config, readFileSync(config, "utf8").replace("  showIp: true", "  showIp: true\n  template: sombra.html"));
    const { porteiro } = await rodarStart();
    const r = await pedir(porteiro.porta, "/.env");
    expect(r.corpo).toContain("SOMBRA PROPRIA /.env");
  });

  it("resolve shadow.logo relativo à pasta da config", async () => {
    const config = instalar("nenhum");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>LOGO PROPRIO</title></svg>';
    writeFileSync(join(dir, "logo.svg"), svg);
    writeFileSync(config, readFileSync(config, "utf8").replace("  showIp: true", "  showIp: true\n  logo: logo.svg"));
    const { porteiro } = await rodarStart();
    const r = await pedir(porteiro.porta, "/.env");
    expect(r.corpo).toContain(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  });

  it("config inválida vira erro em português", async () => {
    writeFileSync(join(dir, "anti-rea.config.yml"), "upstream: nada\ndomains: []\n");
    await expect(rodarStart()).rejects.toThrow(/Configuração inválida/);
    await expect(rodarStart({ config: join(dir, "nao-existe.yml") })).rejects.toThrow(/Não consegui ler/);
  });

  it("porta em uso vira erro em português sobre a porta", async () => {
    instalar();
    const ocupado = net.createServer();
    await new Promise<void>((r) => ocupado.listen(0, "127.0.0.1", () => r()));
    const porta = (ocupado.address() as net.AddressInfo).port;
    try {
      await expect(rodarStart({ porta })).rejects.toThrow(`A porta ${porta} já está em uso. Escolha outra com --porta.`);
    } finally {
      await new Promise<void>((r) => ocupado.close(() => r()));
    }
  });

  it.skipIf(comoRoot)("pasta do registro que não pode ser criada vira erro sobre a pasta, não sobre a porta", async () => {
    instalar();
    const pai = join(dir, "trancada");
    mkdirSync(pai);
    chmodSync(pai, 0o555);
    const registro = join(pai, "registro");
    try {
      const erro = await rodarStart({ registro }).catch((e: unknown) => e as Error);
      expect(erro).toBeInstanceOf(Error);
      expect((erro as Error).message).toBe(`Sem permissão para criar a pasta do registro ${registro}.`);
    } finally {
      chmodSync(pai, 0o755);
    }
  });

  it.skipIf(comoRoot)("pasta do registro sem gravação: sobe e diz o que fazer", async () => {
    instalar();
    const registro = join(dir, "registro");
    mkdirSync(registro);
    chmodSync(registro, 0o555);
    try {
      const { saida } = await rodarStart({ registro });
      expect(saida).toContain("Porteiro no ar em");
      expect(saida).toContain(`Sem permissão para gravar na pasta do registro ${registro}`);
      expect(saida).toContain("sudo chown 1000:1000");
    } finally {
      chmodSync(registro, 0o755);
    }
  });

  it("versão de dono inválida vira erro em português", async () => {
    instalar();
    await expect(rodarStart({ env: { ANTI_REA_OWNER_VERSION: "abc" } })).rejects.toThrow(/ANTI_REA_OWNER_VERSION/);
  });
});

describe("analisarEnv", () => {
  it("lê KEY=VALUE, ignora comentário e linha vazia, tira aspas", () => {
    const env = analisarEnv(
      ["# comentário", "", "A=1", " B = dois ", 'C="com # dentro"', "D='simples'", "E=x # nota", "F=", "lixo", "G=a=b"].join("\n"),
    );
    expect(env).toEqual({ A: "1", B: "dois", C: "com # dentro", D: "simples", E: "x", F: "", G: "a=b" });
  });

  it("aceita fim de linha do Windows", () => {
    expect(analisarEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});

describe("versaoDoDono", () => {
  it("padrão 1, inteiro a partir de 1", () => {
    expect(versaoDoDono({})).toBe(1);
    expect(versaoDoDono({ ANTI_REA_OWNER_VERSION: "" })).toBe(1);
    expect(versaoDoDono({ ANTI_REA_OWNER_VERSION: "7" })).toBe(7);
    expect(() => versaoDoDono({ ANTI_REA_OWNER_VERSION: "0" })).toThrow(/ANTI_REA_OWNER_VERSION/);
    expect(() => versaoDoDono({ ANTI_REA_OWNER_VERSION: "1.5" })).toThrow(/ANTI_REA_OWNER_VERSION/);
  });
});

