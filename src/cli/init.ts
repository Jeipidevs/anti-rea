import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { canaisDoAmbiente } from "../avisos/avisos.js";
import { validarConfig, type Config } from "../config/carregar.js";
import { linkDeDono } from "./dono.js";
import { analisarEnv, versaoDoDono } from "./start.js";

export type RespostasInit = {
  upstream: string;
  dominio: string;
  canal: "whatsapp" | "telegram" | "webhook" | "nenhum";
  isentos: string[];
  devtoolsIsCaught: boolean;
  /** O que fica na frente do porteiro: nada (false), proxy ou painel (true) ou Cloudflare. */
  trustProxy: Config["trustProxy"];
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
    comComentario(`trustProxy: ${escalar(r.trustProxy)}`, 'true atrás de nginx, Traefik ou painel; "cloudflare" atrás da Cloudflare'),
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

/** Lança "já existe" se a config já está na pasta e `forcar` não foi pedido. O .env nunca impede: é completado. */
export function conferirSobrescrita(pasta: string, forcar: boolean): void {
  if (forcar) return;
  if (existsSync(join(pasta, ARQUIVO_CONFIG))) {
    throw new Error(`${ARQUIVO_CONFIG} já existe em ${pasta}. Use anti-rea init --forcar para sobrescrever.`);
  }
}

/** Resultado de completar um .env que já existia. */
type EnvCompletado = { texto: string; segredo: string; versao: number; acrescentadas: string[] };

/**
 * Completa o .env que já existe na pasta (o do site, quase sempre): acrescenta no fim, sob um comentário
 * "# ANTI-REA", só as variáveis ANTI_REA_ que faltam. As outras linhas e as ANTI_REA_ que já estão lá
 * ficam como estão. ANTI_REA_SECRET vazio conta como faltando (a linha nova vem depois e vale, como no
 * start). Versão de dono inválida lança antes de qualquer escrita.
 */
export function completarEnv(texto: string, canal: RespostasInit["canal"], gerarSegredo: () => string): EnvCompletado {
  const atual = analisarEnv(texto);
  const versao = versaoDoDono(atual);
  const novas: string[] = [];
  let segredo = atual.ANTI_REA_SECRET ?? "";
  if (segredo === "") {
    segredo = gerarSegredo();
    novas.push(`ANTI_REA_SECRET=${segredo}`);
  }
  if (!("ANTI_REA_OWNER_VERSION" in atual)) novas.push(`ANTI_REA_OWNER_VERSION=${versao}`);
  for (const v of variaveisDoCanal(canal)) if (!(v in atual)) novas.push(`${v}=`);
  if (novas.length === 0) return { texto, segredo, versao, acrescentadas: [] };

  const fim = texto.includes("\r\n") ? "\r\n" : "\n";
  const antes = texto === "" ? "" : `${texto.endsWith("\n") ? "" : fim}${fim}`;
  const bloco = ["# ANTI-REA", ...novas].map((l) => `${l}${fim}`).join("");
  return {
    texto: `${texto}${antes}${bloco}`,
    segredo,
    versao,
    acrescentadas: novas.map((l) => l.slice(0, l.indexOf("="))),
  };
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

/** O que aconteceu com o .env: criado, completado com as variáveis que faltavam ou mantido como estava. */
export type ResultadoInstalacao = { linkDono: string; env: "criado" | "completado" | "mantido"; acrescentadas: string[] };

/**
 * Escreve anti-rea.config.yml e cuida do .env da pasta, e devolve o link de dono. Sem .env, cria um
 * (modo 0600). Com .env, só acrescenta as variáveis ANTI_REA_ que faltam e mantém o resto, o modo do
 * arquivo e o segredo e a versão de dono que já estão lá (o link de dono sai deles). Confere tudo antes
 * de escrever: resposta inválida, versão de dono inválida no .env ou config já existente (sem `forcar`)
 * lança sem tocar em nada.
 */
export function escreverInstalacao(
  pasta: string,
  r: RespostasInit,
  gerarSegredo: () => string = () => randomBytes(32).toString("base64url"),
  opcoes: { forcar?: boolean } = {},
): ResultadoInstalacao {
  r = { ...r, dominio: r.dominio.trim().toLowerCase() };
  if (!dominioValido(r.dominio)) {
    throw new Error(`Domínio público inválido: "${r.dominio}". Use só o nome, como seusite.com.br.`);
  }
  const config = textoDaConfig(r);
  validarConfig(parse(config));
  conferirSobrescrita(pasta, opcoes.forcar ?? false);

  const env = join(pasta, ARQUIVO_ENV);
  if (!existsSync(env)) {
    const segredo = gerarSegredo();
    writeFileSync(join(pasta, ARQUIVO_CONFIG), config);
    writeFileSync(env, textoDoEnv(segredo, r.canal), { mode: 0o600 });
    // O modo do writeFileSync só vale para arquivo novo; garante 0600 mesmo com umask estranha.
    chmodSync(env, 0o600);
    protegerNoGitignore(pasta);
    return { linkDono: linkDeDono(r.dominio, segredo, 1), env: "criado", acrescentadas: [] };
  }

  const antes = readFileSync(env, "utf8");
  const completo = completarEnv(antes, r.canal, gerarSegredo);
  writeFileSync(join(pasta, ARQUIVO_CONFIG), config);
  if (completo.acrescentadas.length > 0) writeFileSync(env, completo.texto);
  protegerNoGitignore(pasta);
  return {
    linkDono: linkDeDono(r.dominio, completo.segredo, completo.versao),
    env: completo.acrescentadas.length > 0 ? "completado" : "mantido",
    acrescentadas: completo.acrescentadas,
  };
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

/** As seis perguntas da tela assets/telas/assistente.svg, nessa ordem. */
export async function perguntar(): Promise<RespostasInit> {
  const { confirm, input, select } = await import("@inquirer/prompts");
  const upstream = await input({ message: "Endereço do seu site?", default: "http://localhost:3000", validate: enderecoValido });
  const dominio = await input({
    message: "Domínio público?",
    validate: (v) => dominioValido(v.trim().toLowerCase()) || "Use só o nome, como seusite.com.br",
  });
  // É daí que sai o IP de cada visitante: atrás de um proxy, sem trustProxy, todos teriam o IP dele.
  const trustProxy = await select<RespostasInit["trustProxy"]>({
    message: "O que fica na frente do porteiro?",
    choices: [
      { name: "Nada: a internet chega direto no porteiro", value: false, short: "nada" },
      { name: "nginx, Traefik ou painel (EasyPanel, Coolify)", value: true, short: "nginx, Traefik ou painel" },
      { name: "Cloudflare (com ou sem nginx ou painel no meio)", value: "cloudflare", short: "Cloudflare" },
    ],
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
    message: "Caminhos de máquina (ex.: /api/webhook/*)?",
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
    trustProxy,
  };
}

/** O `anti-rea init`: pergunta, escreve os arquivos na pasta e devolve as linhas finais. */
export async function rodarInit(pasta: string, forcar: boolean): Promise<string[]> {
  // Confere antes das perguntas para não fazer a pessoa responder à toa.
  conferirSobrescrita(pasta, forcar);
  console.log("ANTI-REA  ·  assistente de instalação");
  const r = await perguntar();
  const { linkDono, env, acrescentadas } = escreverInstalacao(pasta, r, undefined, { forcar });
  const sobreEnv = {
    criado: `Pronto. Criei ${ARQUIVO_CONFIG} e ${ARQUIVO_ENV}`,
    completado: `Pronto. Criei ${ARQUIVO_CONFIG} e acrescentei ao ${ARQUIVO_ENV} (sob # ANTI-REA): ${acrescentadas.join(", ")}`,
    mantido: `Pronto. Criei ${ARQUIVO_CONFIG}. O ${ARQUIVO_ENV} já tinha todas as variáveis do porteiro.`,
  }[env];
  const linhas = ["", sobreEnv, "Seu link de dono (guarde, ele libera você):", linkDono, ""];
  const valores = analisarEnv(readFileSync(join(pasta, ARQUIVO_ENV), "utf8"));
  const vazias = variaveisDoCanal(r.canal).filter((v) => !valores[v]);
  if (vazias.length > 0) linhas.push(`Preencha no .env: ${vazias.join(", ")}`);
  linhas.push("Depois rode: npx anti-rea start");
  return linhas;
}
