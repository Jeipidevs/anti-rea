import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caminhoDeVarredura, caminhoTrancado } from "../src/deteccao/servidor/caminhos.js";
import { TETO_EVENTOS_POR_DIA } from "../src/registro/registro.js";

// O que a documentação promete tem de rodar hoje: comandos, montagens, limites conhecidos e imagens.
// Complementa tests/empacotamento.test.ts, que confere os números vindos do código.

const raiz = join(import.meta.dirname, "..");
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");
/** Texto corrido: a quebra de linha do Markdown vale como espaço. */
const corrido = (caminho: string) => ler(caminho).replace(/\s+/g, " ");
/** Blocos de código ```bash de um Markdown. */
const blocosBash = (caminho: string) => [...ler(caminho).matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
/** Seção de um Markdown, do título até o próximo título do mesmo nível ou maior. */
function secao(caminho: string, titulo: string): string {
  const texto = ler(caminho);
  const inicio = texto.indexOf(titulo);
  expect(inicio, `${caminho}: ${titulo}`).toBeGreaterThanOrEqual(0);
  const nivel = /^#+/.exec(titulo)![0];
  const resto = texto.slice(inicio + titulo.length);
  const fim = resto.search(new RegExp(`^#{1,${nivel.length}} `, "m"));
  return (fim < 0 ? resto : resto.slice(0, fim)).replace(/\s+/g, " ");
}

describe("instalar: README mostra o que roda hoje", () => {
  const instalar = { "README.md": "## Instalar em 3 passos", "README.en.md": "## Install in 3 steps" } as const;

  for (const [arquivo, titulo] of Object.entries(instalar)) {
    it(`${arquivo}: sem Docker, o clone com build e node dist/cli/index.js; com Docker, a imagem publicada com versão fixa; nunca npx anti-rea`, () => {
      const passo = secao(arquivo, titulo);
      expect(passo).not.toMatch(/npx anti-rea/);
      expect(passo).toContain("git clone https://github.com/Jeipidevs/anti-rea.git");
      expect(passo).toContain("npm ci && npm run build");
      expect(passo).toContain("node dist/cli/index.js init");
      expect(passo).toContain("node dist/cli/index.js start");
      expect(passo).toContain("image: ghcr.io/jeipidevs/anti-rea:v");
      expect(passo).not.toContain("docker build -t anti-rea .");
      expect(passo).not.toContain("image: anti-rea\n");
    });

    it(`${arquivo}: 127.0.0.1 só com o proxy na mesma máquina; Cloudflare direto vai ao firewall de docs/02`, () => {
      const passo = secao(arquivo, titulo);
      expect(passo).toContain('"127.0.0.1:8080:8080"');
      expect(passo).toMatch(/mesma máquina|same machine/);
      expect(passo).toContain("docs/02-instalar.md#atrás-da-cloudflare");
      expect(passo).not.toMatch(/EasyPanel, Cloudflare\), ligue `trustProxy` e deixe a porta/);
    });
  }

  it("README: a frase de hospedagem só cita o que docs/02 tem, sem VPS e sem 'com imagem'", () => {
    const r = corrido("README.md");
    expect(r).not.toMatch(/Passo a passo com imagem/);
    expect(r).not.toMatch(/\(VPS, EasyPanel/);
    const instalar = ler("docs/02-instalar.md");
    for (const titulo of ["### Em painéis como EasyPanel ou Coolify", "### Com nginx na frente", "### Atrás da Cloudflare"]) {
      expect(instalar).toContain(titulo);
    }
  });

  it("docs/02 diz que o porteiro fala HTTP simples na 8080 e que o HTTPS vem de quem fica na frente", () => {
    const passo = secao("docs/02-instalar.md", "## Último passo: apontar o domínio para o porteiro");
    expect(passo).toContain("HTTP simples na porta 8080");
  });

  it("roteiro não chama o assistente pelo pacote que ainda não está no npm", () => {
    expect(ler("README.md")).toContain("- [ ] Pacote publicado no npm");
    expect(ler("README.en.md")).toContain("- [ ] Published npm package");
  });
});

describe("instalar: painel (EasyPanel, Coolify)", () => {
  it("docs/02 diz como a configuração, as variáveis e o registro chegam ao contêiner", () => {
    const painel = secao("docs/02-instalar.md", "### Em painéis como EasyPanel ou Coolify");
    const cmd = /CMD \[([^\]]+)\]/.exec(ler("Dockerfile"))![1]!;
    const configNaImagem = /"--config", "([^"]+)"/.exec(cmd)![1]!;
    expect(configNaImagem).toBe("/app/anti-rea.config.yml");
    expect(painel).toContain(configNaImagem);
    expect(painel).toContain("`ANTI_REA_`");
    expect(painel).toContain("/app/registro");
    expect(painel).toContain("trustProxy: true");
  });

  it("docs/02: Cloudflare ligada direto no porteiro não usa 127.0.0.1, usa o firewall", () => {
    const cf = secao("docs/02-instalar.md", "### Atrás da Cloudflare");
    expect(cf).toContain("127.0.0.1");
    expect(cf).toMatch(/direto no porteiro/);
  });
});

describe("configurar", () => {
  it("docs/03 diz que na v0.1 todos os domínios de um porteiro vão ao mesmo upstream", () => {
    expect(corrido("docs/03-configurar.md")).toContain("todos os domínios de um porteiro vão para o mesmo `upstream`");
  });

  it("docs/03 mostra a linha do teto do registro como o registro escreve", () => {
    expect(ler("docs/03-configurar.md")).toContain(
      `[anti-rea] registro: limite de ${TETO_EVENTOS_POR_DIA} eventos atingido em AAAA-MM-DD; o resto do dia só conta.`,
    );
  });

  it("docs/04: o modelo próprio da sombra precisa ser autocontido, pela CSP da resposta", () => {
    const csp = /const CSP_SOMBRA = "([^"]+)"/.exec(ler("src/porteiro/respostas.ts"))![1]!;
    const sombra = corrido("docs/04-pagina-sombra.md");
    expect(sombra).toContain(csp);
    expect(sombra).toContain("autocontido");
  });
});

describe("perguntas frequentes e README", () => {
  it("'fica lento?' no README e na FAQ cita o custo medido da guarda", () => {
    const faq = ler("docs/perguntas-frequentes.md");
    const custo = /dá ([\d,]+% de CPU)/.exec(faq)![1]!;
    const readme = /Meu site fica mais lento\?<\/b><\/summary>([\s\S]*?)<\/details>/.exec(ler("README.md"))![1]!;
    expect(readme.replace(/\s+/g, " ")).toContain(custo);
    const lento = /\*\*Deixa o site lento\?\*\*([\s\S]*?)\n\n/.exec(faq)![1]!;
    expect(lento.replace(/\s+/g, " ")).toContain(custo);
  });

  it("Search Console: a FAQ diz que passa vindo de google.com e recomenda o registro TXT", () => {
    const seo = /\*\*Atrapalha SEO ou anúncios\?\*\*([\s\S]*?)\n\n/.exec(ler("docs/perguntas-frequentes.md"))![1]!.replace(/\s+/g, " ");
    expect(seo).not.toMatch(/verificação do Search Console\) .*são conferidos e passam/);
    expect(seo).toContain("`.google.com`");
    expect(seo).toContain("registro TXT");
  });

  it("limites conhecidos: script que lê o nonce e strict-dynamic", () => {
    const limites = secao("docs/perguntas-frequentes.md", "## Limites conhecidos");
    expect(limites).toContain("lê a tela de verificação");
    expect(limites).toContain("'strict-dynamic'");
    expect(limites).toContain("nonce da página");
  });

  it("glossário: o exemplo de varredura é um caminho que o porteiro pega", () => {
    const linha = ler("docs/glossario.md").split("\n").find((l) => l.startsWith("| **Varredura**"))!;
    const caminhos = [...linha.matchAll(/`(\/[^`]+)`/g)].map((m) => m[1]!);
    expect(caminhos.length).toBeGreaterThan(0);
    for (const caminho of caminhos) {
      expect((caminhoDeVarredura(caminho) ?? caminhoTrancado(caminho))?.gravidade, caminho).toBe("varredura");
    }
  });
});

describe("imagens", () => {
  it("como-funciona.svg: prévia de link vai para a tela de verificação, não para o site real", () => {
    const svg = ler("assets/diagramas/como-funciona.svg");
    expect(svg).not.toContain("Google, Meta, WhatsApp");
    expect(svg).toContain("Google, Bing, Meta");
    expect(svg).toContain(">Prévia de link<");
    expect(svg).toContain(">Tela de verificação<");
    const alt = /<img src="assets\/diagramas\/como-funciona\.svg" alt="([^"]+)"/.exec(ler("README.md"))![1]!;
    expect(alt).toContain("tela de verificação");
  });

  it("os comandos da tela do assistente rodam hoje", () => {
    const svg = ler("assets/telas/assistente.svg");
    expect(svg).not.toContain("npx anti-rea");
    expect(svg).toContain("node dist/cli/index.js init");
  });
});

describe("o bloco bash do README não tem comando que ainda não roda fora do exame", () => {
  it("só o exame (que o README marca como futuro) usa npx anti-rea", () => {
    for (const bloco of blocosBash("README.md")) {
      if (bloco.includes("npx anti-rea")) expect(bloco.trim()).toBe("npx anti-rea exame https://seusite.com.br");
    }
  });
});
