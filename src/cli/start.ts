import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Avisos, canaisDoAmbiente } from "../avisos/avisos.js";
import { carregarConfig, type Config } from "../config/carregar.js";
import { Registro } from "../registro/registro.js";
import { iniciarPorteiro, type Porteiro } from "../porteiro/servidor.js";
import type { Resolvedor } from "../robos/dns.js";
import type { FaixasMeta } from "../robos/faixas-meta.js";

export type OpcoesStart = {
  /** Caminho do anti-rea.config.yml; o .env é lido da mesma pasta. */
  config: string;
  porta: number;
  /** Pasta do registro JSONL. */
  registro: string;
  /** Ambiente do processo; o que já está aqui vale mais que o .env. */
  env: NodeJS.ProcessEnv;
};

/** Ganchos para teste: saída, endereço de escuta e resolvedores sem rede. */
export type ExtrasStart = {
  dizer?: (linha: string) => void;
  host?: string;
  dns?: Resolvedor;
  meta?: FaixasMeta;
};

const CHAVE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Lê um .env: linhas KEY=VALUE, `#` no início é comentário, aspas simples ou duplas em volta do valor
 * saem. Sem aspas, ` #` em diante é comentário. Linha sem `=` ou com chave inválida é ignorada.
 */
export function analisarEnv(texto: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (linha === "" || linha.startsWith("#")) continue;
    const igual = linha.indexOf("=");
    if (igual <= 0) continue;
    const chave = linha.slice(0, igual).trim();
    if (!CHAVE.test(chave)) continue;
    let valor = linha.slice(igual + 1).trim();
    const aspas = valor[0];
    if ((aspas === '"' || aspas === "'") && valor.length >= 2 && valor.endsWith(aspas)) {
      valor = valor.slice(1, -1);
    } else {
      valor = valor.replace(/\s+#.*$/, "");
    }
    env[chave] = valor;
  }
  return env;
}

/** Caminho do .env que acompanha um arquivo de configuração. */
export function caminhoDoEnv(config: string): string {
  return join(dirname(resolve(config)), ".env");
}

/** Variáveis do .env ao lado da config por baixo do ambiente: o que já está em `env` nunca é trocado. */
export function ambienteComEnv(config: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let texto = "";
  try {
    texto = readFileSync(caminhoDoEnv(config), "utf8");
  } catch {
    // Sem .env: vale só o ambiente.
  }
  return { ...analisarEnv(texto), ...env };
}

/** ANTI_REA_OWNER_VERSION: inteiro a partir de 1; ausente ou vazio vale 1. */
export function versaoDoDono(env: NodeJS.ProcessEnv): number {
  const v = env.ANTI_REA_OWNER_VERSION;
  if (v === undefined || v === "") return 1;
  if (!/^[1-9]\d{0,8}$/.test(v)) {
    throw new Error(`ANTI_REA_OWNER_VERSION precisa ser um número inteiro a partir de 1 (está "${v}").`);
  }
  return Number(v);
}

/** Lê a config e resolve shadow.template e shadow.logo a partir da pasta do arquivo. */
function lerConfig(caminho: string): Config {
  const cfg = carregarConfig(caminho);
  const pasta = dirname(resolve(caminho));
  const naPasta = (p: string | undefined) => (p === undefined ? undefined : resolve(pasta, p));
  return { ...cfg, shadow: { ...cfg.shadow, template: naPasta(cfg.shadow.template), logo: naPasta(cfg.shadow.logo) } };
}

const codigoDoErro = (erro: unknown) => (erro as NodeJS.ErrnoException | undefined)?.code;
const mensagemDoErro = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));
/** Códigos de "sem permissão" para mexer numa pasta. */
const SEM_PERMISSAO = new Set(["EACCES", "EPERM", "EROFS"]);

function erroDeEscuta(erro: unknown, porta: number): Error {
  const codigo = codigoDoErro(erro);
  if (codigo === "EADDRINUSE") return new Error(`A porta ${porta} já está em uso. Escolha outra com --porta.`);
  if (codigo === "EACCES") return new Error(`Sem permissão para usar a porta ${porta}. Escolha outra com --porta.`);
  return erro instanceof Error ? erro : new Error(String(erro));
}

/** Cria a pasta do registro; erro vira mensagem em português sobre a pasta. */
function abrirRegistro(pasta: string, retencaoMs: number): Registro {
  try {
    return new Registro(pasta, retencaoMs);
  } catch (erro) {
    if (SEM_PERMISSAO.has(codigoDoErro(erro) ?? "")) throw new Error(`Sem permissão para criar a pasta do registro ${pasta}.`);
    throw new Error(`Não consegui criar a pasta do registro ${pasta}: ${mensagemDoErro(erro)}`);
  }
}

/** Linha para o terminal quando a pasta do registro existe mas não aceita arquivo novo. */
function semGravarNoRegistro(pasta: string, erro: Error): string {
  const inicio = SEM_PERMISSAO.has(codigoDoErro(erro) ?? "")
    ? `Sem permissão para gravar na pasta do registro ${pasta}`
    : `Não consigo gravar na pasta do registro ${pasta} (${erro.message})`;
  return (
    `${inicio}: as tentativas não ficam guardadas. Dê a pasta ao usuário que roda o porteiro; ` +
    "no Docker: mkdir -p registro && sudo chown 1000:1000 registro, depois docker compose up -d."
  );
}

/**
 * O `anti-rea start`: lê config e .env, sobe o porteiro e diz no terminal o que falta. Sobe desarmado:
 * sem canal configurado só registra; sem ANTI_REA_SECRET usa um segredo efêmero; pasta do registro que
 * não aceita gravação só é avisada. Erro de config, de criação da pasta do registro ou de porta lança
 * Error com a mensagem em português.
 */
export async function subirPorteiro(op: OpcoesStart, extras: ExtrasStart = {}): Promise<Porteiro> {
  const dizer = extras.dizer ?? ((linha: string) => console.log(linha));
  const cfg = lerConfig(op.config);
  const env = ambienteComEnv(op.config, op.env);
  const versaoDono = versaoDoDono(env);
  const segredo = env.ANTI_REA_SECRET || randomBytes(32).toString("base64url");

  const faltas = cfg.alerts.channels.flatMap((canal) =>
    canaisDoAmbiente(env, [canal]).faltando.map((variavel) => `Falta ${variavel} para o canal ${canal}`),
  );
  const { canais } = canaisDoAmbiente(env, cfg.alerts.channels);

  // Fora do try da escuta: erro da pasta do registro não pode virar mensagem sobre a porta.
  const pastaRegistro = resolve(op.registro);
  const registro = abrirRegistro(pastaRegistro, cfg.log.retentionMs);
  const semGravar = registro.podeGravar();
  const avisos = new Avisos(cfg.alerts, canais);

  let porteiro: Porteiro;
  try {
    porteiro = await iniciarPorteiro(cfg, {
      segredo,
      versaoDono,
      registro,
      avisos,
      porta: op.porta,
      host: extras.host,
      dns: extras.dns,
      meta: extras.meta,
    });
  } catch (erro) {
    throw erroDeEscuta(erro, op.porta);
  }

  dizer(`Porteiro no ar em :${porteiro.porta}, protegendo ${cfg.upstream}`);
  if (semGravar) dizer(semGravarNoRegistro(pastaRegistro, semGravar));
  for (const falta of faltas) dizer(falta);
  if (cfg.alerts.channels.length === 0) dizer("Sem canal de aviso: as tentativas ficam só no registro.");
  if (!env.ANTI_REA_SECRET) dizer("Sem ANTI_REA_SECRET: os passes caem a cada reinício.");
  return porteiro;
}
