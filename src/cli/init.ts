import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { canaisDoAmbiente } from "../avisos/avisos.js";
import { validarConfig } from "../config/carregar.js";
import { linkDeDono } from "./dono.js";

export type RespostasInit = {
  upstream: string;
  dominio: string;
  canal: "whatsapp" | "telegram" | "webhook" | "nenhum";
  isentos: string[];
  devtoolsIsCaught: boolean;
};

export const ARQUIVO_CONFIG = "anti-rea.config.yml";
export const ARQUIVO_ENV = ".env";

const DOMINIO = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/** Domínio público como o porteiro compara: só nome, sem protocolo, porta nem caminho. */
export function dominioValido(dominio: string): boolean {
  return DOMINIO.test(dominio);
}

/** Valor YAML de uma linha só, com aspas quando o texto pediria (`*`, ` #`, `: `...). */
function escalar(valor: string | boolean): string {
  return stringify(valor).trimEnd();
}

/** Linha com o comentário alinhado na coluna do exemplo. */
function comComentario(linha: string, comentario: string): string {
  return `${linha.padEnd(35)} # ${comentario}`;
}

/** anti-rea.config.yml no formato e com os comentários de examples/anti-rea.config.yml. */
export function textoDaConfig(r: RespostasInit): string {
  const lista = (itens: string[]) => itens.map((i) => `  - ${escalar(i)}`);
  const exempt =
    r.isentos.length === 0
      ? [comComentario("exempt: []", "caminhos de máquina, sem verificação")]
      : [comComentario("exempt:", "caminhos de máquina, sem verificação"), ...lista(r.isentos)];
  const canais = r.canal === "nenhum" ? "[]" : `[${r.canal}]`;
  return [
    "# Configuração do ANTI-REA. Cada linha tem a explicação ao lado.",
    "# Guia completo: docs/03-configurar.md",
    "",
    comComentario(`upstream: ${escalar(r.upstream)}`, "onde o seu site real roda"),
    "domains:",
    comComentario(`  - ${escalar(r.dominio)}`, "domínios que este porteiro protege"),
    comComentario("trustProxy: false", 'true atrás de nginx/Traefik; "cloudflare" atrás da Cloudflare'),
    "",
    "check:",
    comComentario("  firstVisit: true", "verificação de menos de 1 s na primeira visita"),
    comComentario(`  devtoolsIsCaught: ${escalar(r.devtoolsIsCaught)}`, "quem abre o F12 cai na sombra"),
    comComentario("  passDuration: 7d", "tempo que o visitante verificado navega livre"),
    "",
    ...exempt,
    "",
    "shadow:",
    "  language: pt-BR",
    '  title: "Ops. Pegamos você."',
    '  message: "Belo esforço com o seu robô. O código que você queria não mora aqui."',
    '  footer: "Que tal criar o seu? Dá menos trabalho e é mais divertido."',
    "  showIp: true",
    "",
    "alerts:",
    comComentario(`  channels: ${canais}`, "whatsapp, telegram, webhook"),
    comComentario("  groupByIp: 1h", "um aviso por IP por hora, com a contagem"),
    comComentario("  scans: panel", "varredura genérica: panel, dailySummary ou alert"),
    "",
    "log:",
    comComentario("  retention: 30d", "apaga registros mais velhos (LGPD)"),
    "",
  ].join("\n");
}

/** Variáveis que o canal precisa, na ordem do .env.example. */
function variaveisDoCanal(canal: RespostasInit["canal"]): string[] {
  // Com ambiente vazio, `faltando` é exatamente a lista de variáveis do canal.
  return canal === "nenhum" ? [] : canaisDoAmbiente({}, [canal]).faltando;
}

const NOME_DO_CANAL: Record<RespostasInit["canal"], string> = {
  whatsapp: "WhatsApp pela Evolution API",
  telegram: "Telegram",
  webhook: "Webhook",
  nenhum: "",
};

/** .env com o segredo, a versão do link de dono e as variáveis vazias do canal escolhido. */
export function textoDoEnv(segredo: string, canal: RespostasInit["canal"]): string {
  const linhas = [
    "# Gerado por anti-rea init. Nunca suba este arquivo para o git.",
    "",
    "# Segredo que assina os passes",
    `ANTI_REA_SECRET=${segredo}`,
    "",
    "# Versão do link de dono; anti-rea dono --novo soma 1 e o link antigo deixa de valer",
    "ANTI_REA_OWNER_VERSION=1",
  ];
  const variaveis = variaveisDoCanal(canal);
  if (variaveis.length > 0) linhas.push("", `# ${NOME_DO_CANAL[canal]}`, ...variaveis.map((v) => `${v}=`));
  return `${linhas.join("\n")}\n`;
}

/** Lança "já existe" se a config ou o .env já estão na pasta e `forcar` não foi pedido. */
export function conferirSobrescrita(pasta: string, forcar: boolean): void {
  if (forcar) return;
  for (const nome of [ARQUIVO_CONFIG, ARQUIVO_ENV]) {
    if (existsSync(join(pasta, nome))) {
      throw new Error(`${nome} já existe em ${pasta}. Use anti-rea init --forcar para sobrescrever.`);
    }
  }
}

/** Acrescenta `.env` ao .gitignore da pasta, se ele existir e ainda não ignorar o arquivo. */
function protegerNoGitignore(pasta: string): void {
  const caminho = join(pasta, ".gitignore");
  if (!existsSync(caminho)) return;
  const texto = readFileSync(caminho, "utf8");
  const linhas = texto.split(/\r?\n/).map((l) => l.trim());
  if (linhas.includes(".env") || linhas.includes("/.env")) return;
  appendFileSync(caminho, `${texto === "" || texto.endsWith("\n") ? "" : "\n"}.env\n`);
}

/**
 * Escreve anti-rea.config.yml e .env (modo 0600) na pasta e devolve o link de dono. Confere tudo antes
 * de escrever: resposta inválida ou arquivo já existente (sem `forcar`) lança sem tocar em nada.
 */
export function escreverInstalacao(
  pasta: string,
  r: RespostasInit,
  gerarSegredo: () => string = () => randomBytes(32).toString("base64url"),
  opcoes: { forcar?: boolean } = {},
): { linkDono: string } {
  r = { ...r, dominio: r.dominio.trim().toLowerCase() };
  if (!dominioValido(r.dominio)) {
    throw new Error(`Domínio público inválido: "${r.dominio}". Use só o nome, como seusite.com.br.`);
  }
  const config = textoDaConfig(r);
  validarConfig(parse(config));
  conferirSobrescrita(pasta, opcoes.forcar ?? false);

  const segredo = gerarSegredo();
  writeFileSync(join(pasta, ARQUIVO_CONFIG), config);
  const env = join(pasta, ARQUIVO_ENV);
  writeFileSync(env, textoDoEnv(segredo, r.canal), { mode: 0o600 });
  // O modo do writeFileSync só vale para arquivo novo; com --forcar o .env já existia.
  chmodSync(env, 0o600);
  protegerNoGitignore(pasta);
  return { linkDono: linkDeDono(r.dominio, segredo, 1) };
}

function enderecoValido(v: string): true | string {
  try {
    const { protocol } = new URL(v.trim());
    if (protocol === "http:" || protocol === "https:") return true;
  } catch {
    // cai na mensagem abaixo
  }
  return "Use uma URL http: ou https:, por exemplo http://localhost:3000";
}

/** Separa "a, b" em caminhos; vazio vira lista vazia. */
export function lerIsentos(texto: string): string[] {
  return texto
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/** As cinco perguntas da tela assets/telas/assistente.svg, nessa ordem. */
export async function perguntar(): Promise<RespostasInit> {
  const { confirm, input, select } = await import("@inquirer/prompts");
  const upstream = await input({ message: "Endereço do seu site?", default: "http://localhost:3000", validate: enderecoValido });
  const dominio = await input({
    message: "Domínio público?",
    validate: (v) => dominioValido(v.trim().toLowerCase()) || "Use só o nome, como seusite.com.br",
  });
  const canal = await select<RespostasInit["canal"]>({
    message: "Onde quer receber os avisos?",
    choices: [
      { name: "WhatsApp", value: "whatsapp" },
      { name: "Telegram", value: "telegram" },
      { name: "Webhook", value: "webhook" },
      { name: "Nenhum por enquanto", value: "nenhum" },
    ],
  });
  const isentos = await input({
    message: "Caminhos de máquina (webhook, API)?",
    default: "",
    validate: (v) =>
      lerIsentos(v).every((c) => c.startsWith("/")) || "Separe por vírgula, cada caminho começando com /, ou deixe vazio",
  });
  const devtoolsIsCaught = await confirm({ message: "Quem abre o F12 cai na sombra?", default: true });
  return {
    upstream: upstream.trim(),
    dominio: dominio.trim().toLowerCase(),
    canal,
    isentos: lerIsentos(isentos),
    devtoolsIsCaught,
  };
}

/** O `anti-rea init`: pergunta, escreve os arquivos na pasta e devolve as linhas finais. */
export async function rodarInit(pasta: string, forcar: boolean): Promise<string[]> {
  // Confere antes das perguntas para não fazer a pessoa responder à toa.
  conferirSobrescrita(pasta, forcar);
  console.log("ANTI-REA  ·  assistente de instalação");
  const r = await perguntar();
  const { linkDono } = escreverInstalacao(pasta, r, undefined, { forcar });
  const linhas = [
    "",
    `Pronto. Criei ${ARQUIVO_CONFIG} e ${ARQUIVO_ENV}`,
    "Seu link de dono (guarde, ele libera você):",
    linkDono,
    "",
  ];
  const variaveis = variaveisDoCanal(r.canal);
  if (variaveis.length > 0) linhas.push(`Preencha no .env: ${variaveis.join(", ")}`);
  linhas.push("Depois rode: npx anti-rea start");
  return linhas;
}
