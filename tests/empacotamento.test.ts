import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Confere a embalagem da v0.1: imagem Docker, CI, roteiro do README e a FAQ. O que a imagem faz de
// verdade (subir e dizer "Porteiro no ar em :8080") se confere com docker build e docker run.

const raiz = join(import.meta.dirname, "..");
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");
const TRAVESSAO = "—";

type Passo = { run?: string; uses?: string; with?: Record<string, unknown> };
type Fluxo = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, { steps: Passo[] }> };

function passos(fluxo: Fluxo): Passo[] {
  return Object.values(fluxo.jobs).flatMap((j) => j.steps);
}

function arquivosDe(pasta: string): string[] {
  return readdirSync(join(raiz, pasta)).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(join(raiz, caminho)).isDirectory()) return nome === "_historico" ? [] : arquivosDe(caminho);
    return nome.endsWith(".md") ? [caminho] : [];
  });
}

describe("Dockerfile", () => {
  it("tem dois estágios node:22-alpine, build com npm ci e final só com produção e usuário não root", () => {
    const d = ler("Dockerfile");
    expect(d.match(/^FROM node:22-alpine/gm)).toHaveLength(2);
    expect(d).toMatch(/RUN npm ci && npm run build/);
    expect(d).toMatch(/npm ci --omit=dev/);
    expect(d).toMatch(/COPY --from=\S+ \/app\/dist \.\/dist/);
    expect(d).toMatch(/^WORKDIR \/app$/m);
    expect(d).toMatch(/^EXPOSE 8080$/m);
    expect(d).toMatch(/^USER node$/m);
    expect(d).toMatch(/\/app\/registro/);
    expect(d).toContain('CMD ["node", "dist/cli/index.js", "start", "--config", "/app/anti-rea.config.yml"]');
  });

  it(".dockerignore deixa de fora o que a imagem não usa", () => {
    const linhas = ler(".dockerignore").split("\n").map((l) => l.trim());
    for (const item of ["node_modules", "dist", ".git", ".superpowers", "registro", "video", "tests", "docs", "assets", "*.md", ".env"]) {
      expect(linhas).toContain(item);
    }
  });
});

describe("GitHub Actions", () => {
  it("ci.yml roda typecheck, testes e ponta a ponta com Node 22 em push e pull request", () => {
    const fluxo = parse(ler(".github/workflows/ci.yml")) as Fluxo;
    expect(Object.keys(fluxo.on)).toEqual(expect.arrayContaining(["push", "pull_request"]));
    const lista = passos(fluxo);
    const node = lista.find((p) => p.uses?.startsWith("actions/setup-node@"));
    expect(String(node?.with?.["node-version"])).toBe("22");
    const comandos = lista.flatMap((p) => (p.run ? [p.run.trim()] : []));
    expect(comandos).toEqual([
      "npm ci",
      "npm run typecheck",
      "npm test",
      "npx playwright install --with-deps chromium",
      "npm run test:e2e",
    ]);
  });

  it("imagem.yml publica no GHCR com a tag e latest só em tag v*", () => {
    const texto = ler(".github/workflows/imagem.yml");
    const fluxo = parse(texto) as Fluxo;
    expect(Object.keys(fluxo.on)).toEqual(["push"]);
    expect((fluxo.on.push as { tags: string[] }).tags).toEqual(["v*"]);
    expect(fluxo.permissions?.packages).toBe("write");
    const envio = passos(fluxo).find((p) => p.uses?.startsWith("docker/build-push-action@"));
    expect(envio?.with?.push).toBe(true);
    const tags = String(envio?.with?.tags);
    expect(tags).toContain("ghcr.io/jeipidevs/anti-rea:${{ github.ref_name }}");
    expect(tags).toContain("ghcr.io/jeipidevs/anti-rea:latest");
  });
});

describe("README e roteiro", () => {
  const prontos = [
    "Porteiro (proxy reverso) com regras no servidor",
    "Verificação do navegador na primeira visita",
    "Confirmação de robôs oficiais",
    "Página sombra configurável",
    "Avisos: WhatsApp (Evolution API), Telegram e webhook",
    "Assistente `npx anti-rea init`",
  ];
  const ready = [
    "Reverse proxy with server-side rules",
    "First-visit browser check",
    "Official bot verification",
    "Configurable shadow page",
    "Alerts: WhatsApp (Evolution API), Telegram, webhook",
    "`npx anti-rea init` wizard",
  ];

  it("README.md marca só o que tem teste passando e troca o aviso de construção", () => {
    const r = ler("README.md");
    for (const item of prontos) expect(r).toContain(`- [x] ${item}`);
    for (const item of ["Imagem Docker publicada", "Exame do próprio site", "Painel de registro"]) {
      expect(r).toContain(`- [ ] ${item}`);
    }
    expect(r).toContain("Versão 0.1: o porteiro funciona. O exame do próprio site e o painel vêm a seguir.");
    expect(r).not.toMatch(/em construção|em%20constru/);
  });

  it("README.en.md segue o mesmo roteiro", () => {
    const r = ler("README.en.md");
    for (const item of ready) expect(r).toContain(`- [x] ${item}`);
    for (const item of ["Published Docker image", "Self-scan", "Log panel"]) expect(r).toContain(`- [ ] ${item}`);
    expect(r).toContain("Version 0.1: the gatekeeper works. The self-scan and the log panel come next.");
    expect(r).not.toMatch(/under construction|under%20construction/);
  });

  it("nenhum texto de README.md, README.en.md e docs/ tem o travessão longo", () => {
    for (const arquivo of ["README.md", "README.en.md", ...arquivosDe("docs")]) {
      expect(ler(arquivo).includes(TRAVESSAO), arquivo).toBe(false);
    }
  });
});

describe("Perguntas frequentes", () => {
  it("explica o F12 em janela separada, as tabelas no console e a prévia do DuckDuckGo", () => {
    const faq = ler("docs/perguntas-frequentes.md");
    expect(faq).toMatch(/janela separada/);
    expect(faq).toMatch(/depuração remota ativa/);
    expect(faq).toMatch(/duas tabelas/);
    expect(faq).toMatch(/DuckDuckGo/);
  });

  it("docs/05-avisos.md fala do teto global e cita só caminho que o porteiro trata como varredura", () => {
    const avisos = ler("docs/05-avisos.md");
    expect(avisos).toContain("6 avisos a cada 5 minutos");
    expect(avisos).toContain("Muitas tentativas ao mesmo tempo");
    // /wp-login.php não está na lista de varredura (pode ser um WordPress de verdade).
    expect(avisos).not.toContain("/wp-login.php");
  });
});

describe("Docker: assistente e troca do link de dono", () => {
  // O env_file do compose só é lido quando o contêiner é criado: `docker compose restart` mantém o
  // ANTI_REA_OWNER_VERSION antigo e o link velho continua valendo. O contêiner também não tem
  // /app/.env, então init e dono rodam no host (Node) ou pela imagem com a pasta montada.
  const comImagem = 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work';

  it("docs/02-instalar.md não diz que o Docker basta e mostra init e dono pela imagem", () => {
    const instalar = ler("docs/02-instalar.md");
    expect(instalar).not.toContain("Um dos dois basta");
    expect(instalar).toContain(`${comImagem} ghcr.io/jeipidevs/anti-rea:latest node /app/dist/cli/index.js init`);
    expect(instalar).toMatch(/node \/app\/dist\/cli\/index\.js dono --novo/);
  });

  it("docs/02 e docs/07 mandam recriar o contêiner com up -d depois do dono --novo, não restart", () => {
    for (const arquivo of ["docs/02-instalar.md", "docs/07-modo-dono.md"]) {
      const texto = ler(arquivo);
      expect(texto, arquivo).toMatch(/dono --novo[\s\S]*docker compose up -d/);
      expect(texto, arquivo).toContain("não relê o `.env`");
    }
  });

  it("README.md avisa do up -d junto do docker-compose.yml", () => {
    const r = ler("README.md");
    expect(r).toContain("docker compose up -d");
    expect(r).toContain("não relê o `.env`");
  });
});
