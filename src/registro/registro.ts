import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Gravidade } from "../deteccao/servidor/ferramentas.js";

export type Evento = {
  quando: string;
  ip: string;
  dominio: string;
  caminho: string;
  agente: string;
  motivo: string;
  gravidade: Gravidade;
  destino: "sombra" | "recusado" | "registrado";
};

const DIA_MS = 86_400_000;
const NOME_DIA = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

function avisar(texto: string): void {
  process.stderr.write(`[anti-rea] registro: ${texto}\n`);
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

// Inicio do dia em UTC (ms) para "AAAA-MM-DD"; NaN se o dia nao existe no calendario.
function inicioDoDia(dia: string): number {
  const ms = Date.parse(`${dia}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== dia ? NaN : ms;
}

/**
 * Registro local em JSONL, um arquivo por dia: <pasta>/AAAA-MM-DD.jsonl.
 * O dia de cada arquivo e o dia UTC de evento.quando, e a retencao compara esse dia UTC com `agora`.
 * Escrita com appendFileSync: simples e segura para um processo so.
 */
export class Registro {
  constructor(
    private readonly pasta: string,
    private readonly retencaoMs: number,
  ) {
    mkdirSync(pasta, { recursive: true });
  }

  /** Acrescenta o evento ao arquivo do dia. Nunca lanca: erro vira uma linha no stderr. */
  gravar(e: Evento): void {
    try {
      const ms = Date.parse(e.quando);
      if (Number.isNaN(ms)) {
        avisar(`evento com data invalida, nao gravado: ${JSON.stringify(e.quando)}`);
        return;
      }
      const dia = new Date(ms).toISOString().slice(0, 10);
      // JSON.stringify escapa \n e \r dentro das strings: um evento ocupa sempre uma linha.
      appendFileSync(join(this.pasta, `${dia}.jsonl`), JSON.stringify(e) + "\n", "utf8");
    } catch (erro) {
      avisar(`falha ao gravar: ${mensagem(erro)}`);
    }
  }

  /** Eventos do dia "AAAA-MM-DD" (UTC). Arquivo ausente devolve []; linha malformada e pulada. */
  ler(dia: string): Evento[] {
    if (!DIA.test(dia)) return [];
    let conteudo: string;
    try {
      conteudo = readFileSync(join(this.pasta, `${dia}.jsonl`), "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "ENOENT") avisar(`falha ao ler ${dia}: ${mensagem(erro)}`);
      return [];
    }
    const eventos: Evento[] = [];
    for (const linha of conteudo.split("\n")) {
      if (linha.trim() === "") continue;
      try {
        const valor: unknown = JSON.parse(linha);
        if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) eventos.push(valor as Evento);
      } catch {
        // linha malformada: pula
      }
    }
    return eventos;
  }

  /**
   * Apaga os arquivos AAAA-MM-DD.jsonl cujo dia UTC terminou antes de `agora - retencao`
   * (um dia que ainda pode ter evento dentro da retencao fica). Nada mais na pasta e tocado.
   * Devolve quantos apagou. Nunca lanca: erro vai para o stderr.
   */
  apagarVencidos(agora: Date): number {
    const corte = agora.getTime() - this.retencaoMs;
    let nomes: string[];
    try {
      nomes = readdirSync(this.pasta, { withFileTypes: true })
        .filter((entrada) => entrada.isFile())
        .map((entrada) => entrada.name);
    } catch (erro) {
      avisar(`falha ao listar a pasta: ${mensagem(erro)}`);
      return 0;
    }
    let apagados = 0;
    for (const nome of nomes) {
      const achado = NOME_DIA.exec(nome);
      if (!achado) continue;
      const inicio = inicioDoDia(achado[1]!);
      if (Number.isNaN(inicio) || inicio + DIA_MS > corte) continue;
      try {
        unlinkSync(join(this.pasta, nome));
        apagados++;
      } catch (erro) {
        avisar(`falha ao apagar ${nome}: ${mensagem(erro)}`);
      }
    }
    return apagados;
  }
}
