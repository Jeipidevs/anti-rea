#!/usr/bin/env node
import { mostrarDono } from "./dono.js";
import { rodarInit } from "./init.js";
import { subirPorteiro } from "./start.js";

const AJUDA = `ANTI-REA: porteiro contra engenharia reversa e cópia de sites.

Uso:
  anti-rea init [--forcar]                                   assistente: cria anti-rea.config.yml e o .env
                                                             (.env que já existe só ganha as ANTI_REA_ que faltam)
  anti-rea start [--config caminho] [--porta 8080] [--registro pasta]
                                                             sobe o porteiro
  anti-rea dono [--config caminho] [--novo]                  mostra o link de dono (--novo troca o link)`;

/** Opções aceitas por comando; true = recebe valor, false = só a chave. */
const OPCOES: Record<string, Record<string, boolean>> = {
  init: { forcar: false },
  start: { config: true, porta: true, registro: true },
  dono: { config: true, novo: false },
};

type Flags = Map<string, string | true>;

/** Lê `--nome valor`, `--nome=valor` e `--chave`, só as opções que o comando conhece. */
function lerFlags(comando: string, args: string[]): Flags {
  const aceitas = OPCOES[comando]!;
  const flags: Flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
    if (!m || !Object.hasOwn(aceitas, m[1]!)) throw new Error(`Opção desconhecida para ${comando}: ${arg}`);
    const nome = m[1]!;
    if (!aceitas[nome]) {
      if (m[2] !== undefined) throw new Error(`--${nome} não recebe valor.`);
      flags.set(nome, true);
      continue;
    }
    const valor = m[2] ?? args[++i];
    if (valor === undefined || valor === "") throw new Error(`--${nome} precisa de um valor.`);
    flags.set(nome, valor);
  }
  return flags;
}

function texto(flags: Flags, nome: string, padrao: string): string {
  const v = flags.get(nome);
  return typeof v === "string" ? v : padrao;
}

function lerPorta(valor: string): number {
  if (!/^\d{1,5}$/.test(valor) || Number(valor) > 65535) throw new Error(`Porta inválida: ${valor}`);
  return Number(valor);
}

async function principal(argv: string[]): Promise<void> {
  const [comando, ...resto] = argv;
  if (comando === undefined || comando === "--ajuda" || comando === "--help" || comando === "ajuda") {
    console.log(AJUDA);
    return;
  }
  if (!Object.hasOwn(OPCOES, comando)) {
    console.error(`Comando desconhecido: ${comando}\n\n${AJUDA}`);
    process.exitCode = 1;
    return;
  }
  const flags = lerFlags(comando, resto);
  const config = texto(flags, "config", "./anti-rea.config.yml");

  if (comando === "init") {
    for (const linha of await rodarInit(process.cwd(), flags.has("forcar"))) console.log(linha);
    return;
  }
  if (comando === "dono") {
    for (const linha of mostrarDono(config, flags.has("novo"))) console.log(linha);
    return;
  }
  const porteiro = await subirPorteiro({
    config,
    porta: lerPorta(texto(flags, "porta", "8080")),
    registro: texto(flags, "registro", "./registro"),
    env: process.env,
  });
  const parar = () => {
    void porteiro.fechar().then(() => process.exit(0));
  };
  process.once("SIGINT", parar);
  process.once("SIGTERM", parar);
}

principal(process.argv.slice(2)).catch((erro: unknown) => {
  if (erro instanceof Error && erro.name === "ExitPromptError") {
    console.error("Cancelado.");
  } else {
    console.error(erro instanceof Error ? erro.message : String(erro));
  }
  process.exitCode = 1;
});
