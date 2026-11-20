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

/** Maximo de eventos gravados por dia; passado o teto, o registro so conta (protege o disco da VPS). */
export const TETO_EVENTOS_POR_DIA = 50_000;

const DIA_MS = 86_400_000;
// Quantos dias de contagem ficam na memoria (o dia corrente e o anterior, com folga).
const DIAS_CONTADOS = 3;
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

type ContagemDoDia = { total: number; avisado: boolean };

// Linhas ja gravadas num arquivo (0 se nao existe): o teto sobrevive a um reinicio do processo.
function linhasNoArquivo(caminho: string): number {
  let conteudo: Buffer;
  try {
    conteudo = readFileSync(caminho);
  } catch {
    return 0;
  }
  let linhas = 0;
  for (let i = conteudo.indexOf(10); i !== -1; i = conteudo.indexOf(10, i + 1)) linhas++;
  return linhas;
}

/**
 * Registro local em JSONL, um arquivo por dia: <pasta>/AAAA-MM-DD.jsonl.
 * O dia de cada arquivo e o dia UTC de evento.quando, e a retencao compara esse dia UTC com `agora`.
 * Escrita com appendFileSync: simples e segura para um processo so.
 * Teto de `tetoPorDia` eventos gravados por dia: passado o teto, o evento so e contado
 * e o stderr recebe uma unica linha naquele dia.
 */
export class Registro {
  private readonly contagens = new Map<string, ContagemDoDia>();

  constructor(
    private readonly pasta: string,
    private readonly retencaoMs: number,
    private readonly tetoPorDia: number = TETO_EVENTOS_POR_DIA,
  ) {
    mkdirSync(pasta, { recursive: true });
  }

  /** Eventos recebidos no dia "AAAA-MM-DD" (UTC), gravados ou so contados depois do teto. */
  contagem(dia: string): number {
    if (!DIA.test(dia)) return 0;
    return this.contagemDoDia(dia).total;
  }

  private contagemDoDia(dia: string): ContagemDoDia {
    let contagem = this.contagens.get(dia);
    if (!contagem) {
      contagem = { total: linhasNoArquivo(join(this.pasta, `${dia}.jsonl`)), avisado: false };
      this.contagens.set(dia, contagem);
      if (this.contagens.size > DIAS_CONTADOS) this.contagens.delete(this.contagens.keys().next().value!);
    }
    return contagem;
  }

  /**
   * Acrescenta o evento ao arquivo do dia, ate o teto do dia; depois so conta.
   * Nunca lanca: erro vira uma linha no stderr.
   */
  gravar(e: Evento): void {
    try {
      const ms = Date.parse(e.quando);
      if (Number.isNaN(ms)) {
        avisar(`evento com data invalida, nao gravado: ${JSON.stringify(e.quando)}`);
        return;
      }
      const dia = new Date(ms).toISOString().slice(0, 10);
      const contagem = this.contagemDoDia(dia);
      contagem.total++;
      if (contagem.total > this.tetoPorDia) {
        if (!contagem.avisado) {
          contagem.avisado = true;
          avisar(`limite de ${this.tetoPorDia} eventos atingido em ${dia}; o resto do dia so conta.`);
        }
        return;
      }
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
