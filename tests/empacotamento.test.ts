import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Avisos, TETO_AVISOS, TETO_JANELA_MS } from "../src/avisos/avisos.js";
import { INTERVALO_MAX_MS, INTERVALO_MS } from "../src/deteccao/navegador/guarda.js";
import {
  caminhoDeVarredura,
  caminhoTrancado,
  COMECOS_DE_BACKUP,
  COMECOS_TRANCADOS,
  COMPACTADOS,
  NOMES_DE_SITE,
  SEGMENTOS_TRANCADOS,
  SUFIXOS_TRANCADOS,
} from "../src/deteccao/servidor/caminhos.js";
import { RITMO_JANELA_MS, RITMO_LIMITE } from "../src/porteiro/servidor.js";
import type { Evento } from "../src/registro/registro.js";

// Confere a embalagem da v0.1: imagem Docker, CI, roteiro do README e a FAQ. Número que a documentação
// cita vem das constantes do código, para a doc não ficar errada com o teste verde. O que a imagem faz
// de verdade (subir e dizer "Porteiro no ar em :8080") se confere com docker build e docker run.

const raiz = join(import.meta.dirname, "..");
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");
const TRAVESSAO = "\u2014";

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
      "sudo apt-get update\nsudo apt-get install -y wget httrack",
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

  it("README.md marca só o que tem teste passando e não se diz em construção", () => {
    const r = ler("README.md");
    for (const item of prontos) expect(r).toContain(`- [x] ${item}`);
    for (const item of ["Imagem Docker publicada", "Exame do próprio site", "Painel de registro"]) {
      expect(r).toContain(`- [ ] ${item}`);
    }
    expect(r).not.toMatch(/em construção|em%20constru/);
  });

  it("README.en.md segue o mesmo roteiro", () => {
    const r = ler("README.en.md");
    for (const item of ready) expect(r).toContain(`- [x] ${item}`);
    for (const item of ["Published Docker image", "Self-scan", "Log panel"]) expect(r).toContain(`- [ ] ${item}`);
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

  it("lista os limites conhecidos: revogação em memória, CSP sem 'self', og:image dinâmico e inspeção curta", () => {
    const faq = ler("docs/perguntas-frequentes.md");
    expect(faq).toMatch(/Limites conhecidos/);
    expect(faq).toMatch(/só na memória/);
    expect(faq).toMatch(/1 hora/);
    expect(faq).toContain("script-src");
    expect(faq).toContain("'self'");
    expect(faq).toContain("og:image");
    expect(faq).toContain("exempt");
    expect(faq).toMatch(/inspeção curta/);
  });

  it("docs/01-o-que-e.md não diz que o REA é pego pelo agente e conta o que de fato pega", () => {
    const doc = ler("docs/01-o-que-e.md");
    expect(doc).not.toMatch(/ferramenta conhecida \(REA/);
    expect(doc).toMatch(/verificação/);
    expect(doc).toMatch(/guarda/);
    expect(doc).toMatch(/mapas? de código/);
    expect(doc).toContain("403");
  });

});

/** O aviso agrupado que o código manda quando o teto global estoura. */
async function avisoAgrupado(): Promise<string> {
  const enviados: string[] = [];
  const a = new Avisos({ channels: ["telegram"], groupByIpMs: 3_600_000, scans: "panel" }, [
    { nome: "teste", enviar: async (t) => void enviados.push(t) },
  ], () => 0);
  const evento: Evento = {
    quando: "2026-11-20T10:00:00Z",
    ip: "",
    dominio: "seusite.com.br",
    caminho: "/",
    agente: "curl/8.7.1",
    motivo: "curl",
    gravidade: "copia",
    destino: "sombra",
  };
  for (let i = 0; i <= TETO_AVISOS; i++) await a.receber({ ...evento, ip: `198.51.100.${i}` });
  await a.descarregar(TETO_JANELA_MS);
  return enviados.at(-1)!;
}

describe("números da documentação vêm do código", () => {
  it("teto de avisos: docs/05 e README citam TETO_AVISOS por TETO_JANELA_MS e o texto do aviso agrupado", async () => {
    const minutos = TETO_JANELA_MS / 60_000;
    expect(ler("docs/05-avisos.md")).toContain(`${TETO_AVISOS} avisos a cada ${minutos} minutos`);
    expect(ler("README.md")).toContain(`${TETO_AVISOS} a cada ${minutos} minutos`);
    const agrupado = await avisoAgrupado();
    expect(ler("docs/05-avisos.md")).toContain(agrupado.slice(0, agrupado.indexOf(":") + 1));
  });

  it("docs/05 cita como varredura genérica só caminho que o porteiro trata como varredura", () => {
    const linha = ler("docs/05-avisos.md").split("\n").find((l) => l.includes("Varredura genérica ("))!;
    const caminhos = [...linha.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1]!);
    expect(caminhos.length).toBeGreaterThan(0);
    for (const caminho of caminhos) {
      expect((caminhoDeVarredura(caminho) ?? caminhoTrancado(caminho))?.gravidade, caminho).toBe("varredura");
    }
  });

  it("ritmo de navegação: docs/03 cita o limite e a janela de servidor.ts", () => {
    expect(ler("docs/03-configurar.md").replace(/\s+/g, " ")).toContain(
      `Mais de ${RITMO_LIMITE} navegações em ${RITMO_JANELA_MS / 1000} s com o mesmo passe`,
    );
  });

  it("arquivos trancados: README, README.en, docs/01 e docs/03 listam cada item de caminhos.ts", () => {
    // Código entre crases (Markdown) ou em <code> (a tabela do README), sem diferença de maiúsculas.
    const temCodigo = (texto: string, item: string) => texto.includes("`" + item) || texto.includes("<code>" + item);
    const itens = [
      ...SEGMENTOS_TRANCADOS,
      ...COMECOS_TRANCADOS.map((c) => `${c}*`),
      ...SUFIXOS_TRANCADOS,
      ...COMPACTADOS,
      ...COMECOS_DE_BACKUP,
      ...NOMES_DE_SITE,
      ".map",
    ];
    for (const arquivo of ["README.md", "README.en.md", "docs/01-o-que-e.md", "docs/03-configurar.md"]) {
      const texto = ler(arquivo).toLowerCase();
      for (const item of itens) expect(temCodigo(texto, item), `${arquivo}: ${item}`).toBe(true);
    }
  });

  it("ritmo da guarda: README, README.en, docs/01 e a FAQ citam o intervalo, o recuo e o teto do recuo de guarda.ts", () => {
    const pt = (ms: number) => `${String(ms / 1000).replace(".", ",")} s`;
    const en = (ms: number) => `${ms / 1000} s`;
    // Texto corrido: a quebra de linha do Markdown vale como espaço.
    const corrido = (arquivo: string) => ler(arquivo).replace(/\s+/g, " ");
    const recuo = INTERVALO_MS * 2;
    for (const arquivo of ["README.md", "docs/01-o-que-e.md", "docs/perguntas-frequentes.md"]) {
      const texto = corrido(arquivo);
      expect(texto, arquivo).toContain(`a cada ${pt(INTERVALO_MS)}`);
      expect(texto, arquivo).toContain(`recua para ${pt(recuo)} e depois ${pt(INTERVALO_MAX_MS)}`);
    }
    const ingles = corrido("README.en.md");
    expect(ingles).toContain(`every ${en(INTERVALO_MS)}`);
    expect(ingles).toContain(`backs off to ${en(recuo)} and then ${en(INTERVALO_MAX_MS)}`);
  });
});

/** Blocos ```yaml de um Markdown que descrevem um docker-compose (têm `services:`), já lidos. */
function composesDe(arquivo: string): Array<{ services: Record<string, Record<string, unknown>> }> {
  return [...ler(arquivo).matchAll(/```yaml\n([\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((bloco) => /^services:/m.test(bloco))
    .map((bloco) => parse(bloco) as { services: Record<string, Record<string, unknown>> });
}

describe("docker-compose dos documentos", () => {
  // A imagem roda como o usuário node do node:22-alpine (uid 1000), e a pasta do registro montada do
  // host nasce do root: sem o chown o porteiro sobe e perde todos os eventos.
  const uidDaImagem = 1000;

  for (const arquivo of ["README.md", "docs/02-instalar.md"]) {
    it(`${arquivo}: reinício automático e pasta do registro com o dono da imagem`, () => {
      const composes = composesDe(arquivo);
      expect(composes.length, arquivo).toBeGreaterThan(0);
      for (const c of composes) {
        for (const servico of Object.values(c.services)) {
          expect(servico.restart, arquivo).toBe("unless-stopped");
          const volumes = (servico.volumes ?? []) as string[];
          if (volumes.some((v) => v.startsWith("./registro:"))) {
            expect(ler(arquivo), arquivo).toContain(`chown ${uidDaImagem}:${uidDaImagem} registro`);
          }
        }
      }
      expect(ler("Dockerfile")).toMatch(/^USER node$/m);
    });
  }
});

describe("Docker: assistente e troca do link de dono", () => {
  // O env_file do compose só é lido quando o contêiner é criado: `docker compose restart` mantém o
  // ANTI_REA_OWNER_VERSION antigo e o link velho continua valendo. O contêiner também não tem
  // /app/.env, então init e dono rodam no host (Node) ou pela imagem com a pasta montada.
  // O caminho do CLI na imagem sai do Dockerfile (WORKDIR + o arquivo do CMD).
  const dockerfile = ler("Dockerfile");
  const cliNaImagem = `node ${/^WORKDIR (\S+)$/m.exec(dockerfile)![1]}/${/CMD \["node", "([^"]+)"/.exec(dockerfile)![1]}`;
  const comImagem = 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work';

  it("docs/02-instalar.md roda init e dono pela imagem, com a pasta montada e o CLI que o Dockerfile monta", () => {
    const instalar = ler("docs/02-instalar.md");
    expect(instalar).toContain(`${comImagem} ghcr.io/jeipidevs/anti-rea:latest ${cliNaImagem} init`);
    expect(instalar).toContain(`${cliNaImagem} dono --novo`);
  });

  it("docs/02 e docs/07 recriam o contêiner com up -d depois do dono --novo", () => {
    for (const arquivo of ["docs/02-instalar.md", "docs/07-modo-dono.md"]) {
      expect(ler(arquivo), arquivo).toMatch(/dono --novo[\s\S]*docker compose up -d/);
    }
    expect(ler("README.md")).toContain("docker compose up -d");
  });
});
