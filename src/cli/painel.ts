import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dadosDoRegistro, montarPainel } from "../painel/painel.js";
import { Registro } from "../registro/registro.js";

export type OpcoesPainel = { registro: string; dia?: string; saida?: string; agora?: Date };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O `anti-rea painel`: grava o painel do registro num arquivo HTML (modo 0600: tem IP, que é dado
 * pessoal). Sem dia, o dia mais recente que tem registro. Devolve as linhas para o terminal.
 */
export function gravarPainel(op: OpcoesPainel): string[] {
  const pasta = resolve(op.registro);
  if (!existsSync(pasta) || !statSync(pasta).isDirectory()) {
    throw new Error(`Não achei a pasta do registro ${pasta}. Use --registro com a pasta que o porteiro usa.`);
  }
  if (op.dia !== undefined && !DIA.test(op.dia)) throw new Error(`Dia inválido: ${op.dia} (use AAAA-MM-DD).`);
  const agora = op.agora ?? new Date();
  const registro = new Registro(pasta, Number.POSITIVE_INFINITY);
  const dia = op.dia ?? registro.dias()[0] ?? agora.toISOString().slice(0, 10);
  const dados = dadosDoRegistro(registro, { dia }, agora, false);
  const saida = resolve(op.saida ?? `painel-${dia}.html`);
  writeFileSync(saida, montarPainel(dados), { mode: 0o600 });
  chmodSync(saida, 0o600);
  return [`Painel de ${dia}: ${dados.eventos.length} eventos.`, `Abra no navegador: ${saida}`];
}
