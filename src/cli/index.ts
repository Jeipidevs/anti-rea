#!/usr/bin/env node
import { mostrarDono } from "./dono.js";
import { rodarExame } from "./exame.js";
import { rodarInit } from "./init.js";
import { gravarPainel } from "./painel.js";
import { subirPorteiro } from "./start.js";

const AJUDA = `ANTI-REA: porteiro contra engenharia reversa e cópia de sites.

Uso:
  anti-rea init [--forcar]                                   assistente: cria anti-rea.config.yml e o .env
                                                             (.env que já existe só ganha as ANTI_REA_ que faltam)
  anti-rea start [--config caminho] [--porta 8080] [--registro pasta]
                                                             sobe o porteiro
  anti-rea dono [--config caminho] [--novo]                  mostra o link de dono (--novo troca o link)
  anti-rea exame <endereço do site> [--dono link]            examina o seu site (só leitura, só em site provado);
                                                             com --dono, examina por trás do porteiro
  anti-rea painel [--registro pasta] [--dia AAAA-MM-DD] [--saida arquivo]
                                                             grava o painel do registro num arquivo HTML`;

/** Opções aceitas por comando; true = recebe valor, false = só a chave. */
const OPCOES: Record<string, Record<string, boolean>> = {
  init: { forcar: false },
  start: { config: true, porta: true, registro: true },
  dono: { config: true, novo: false },
  exame: { dono: true },
  painel: { registro: true, dia: true, saida: true },
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
  // O exame recebe o endereço do site antes das opções.
  const endereco = comando === "exame" && resto[0] !== undefined && !resto[0].startsWith("--") ? resto.shift() : undefined;
  const flags = lerFlags(comando, resto);
  const config = texto(flags, "config", "./anti-rea.config.yml");

  if (comando === "init") {
    for (const linha of await rodarInit(process.cwd(), flags.has("forcar"))) console.log(linha);
    return;
  }
  if (comando === "exame") {
    if (!endereco) throw new Error("Diga o endereço do site: anti-rea exame https://seusite.com.br");
    const dono = flags.get("dono");
    const { linhas, saida } = await rodarExame({ url: endereco, dono: typeof dono === "string" ? dono : undefined, pasta: process.cwd() });
    for (const linha of linhas) console.log(linha);
    process.exitCode = saida;
    return;
  }
  if (comando === "painel") {
    const dia = flags.get("dia");
    const saida = flags.get("saida");
    const linhas = gravarPainel({
      registro: texto(flags, "registro", "./registro"),
      dia: typeof dia === "string" ? dia : undefined,
      saida: typeof saida === "string" ? saida : undefined,
    });
    for (const linha of linhas) console.log(linha);
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
