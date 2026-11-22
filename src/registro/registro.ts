import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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

// `avisado`: a linha do teto já saiu naquele dia; `falhaAvisada`: a linha de falha de gravação já saiu.
type ContagemDoDia = { total: number; avisado: boolean; falhaAvisada: boolean };

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
 * Registro local em JSONL, um arquivo por dia: <pasta>/AAAA-MM-DD.jsonl. A pasta criada aqui sai 0700 e
 * cada arquivo novo sai 0600.
 * O dia de cada arquivo e o dia UTC de evento.quando, e a retencao compara esse dia UTC com `agora`.
 * Escrita com appendFileSync: simples e segura para um processo so.
 * Teto de `tetoPorDia` eventos gravados por dia: passado o teto, o evento so e contado
 * e o stderr recebe uma unica linha naquele dia. Falha de gravacao (pasta sem permissao, disco
 * cheio) tambem sai no stderr uma vez por dia, com o que fazer.
 * O construtor cria a pasta e lanca o erro do sistema quando nao consegue.
 */
export class Registro {
  private readonly contagens = new Map<string, ContagemDoDia>();

  constructor(
    private readonly pasta: string,
    private readonly retencaoMs: number,
    private readonly tetoPorDia: number = TETO_EVENTOS_POR_DIA,
  ) {
    // IP, caminho e agente são dado pessoal: só o usuário do porteiro lê. A pasta que já existia fica
    // como está (pode ser a pasta montada do Docker, de outro dono).
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
  }

  /** Eventos recebidos no dia "AAAA-MM-DD" (UTC), gravados ou so contados depois do teto. */
  contagem(dia: string): number {
    if (!DIA.test(dia)) return 0;
    return this.contagemDoDia(dia).total;
  }

  private contagemDoDia(dia: string): ContagemDoDia {
    let contagem = this.contagens.get(dia);
    if (!contagem) {
      contagem = { total: linhasNoArquivo(join(this.pasta, `${dia}.jsonl`)), avisado: false, falhaAvisada: false };
      this.contagens.set(dia, contagem);
      if (this.contagens.size > DIAS_CONTADOS) this.contagens.delete(this.contagens.keys().next().value!);
    }
    return contagem;
  }

  /**
   * A pasta aceita arquivo novo? Cria e apaga um arquivo de teste. null quando dá; senão, o erro.
   */
  podeGravar(): Error | null {
    const teste = join(this.pasta, `.anti-rea-teste-${process.pid}-${randomBytes(4).toString("hex")}`);
    try {
      writeFileSync(teste, "", { flag: "wx" });
      unlinkSync(teste);
      return null;
    } catch (erro) {
      return erro instanceof Error ? erro : new Error(String(erro));
    }
  }

  /**
   * Acrescenta o evento ao arquivo do dia, ate o teto do dia; depois so conta.
   * Nunca lanca: erro vira uma linha no stderr, no maximo uma por dia para falha de gravacao.
   */
  gravar(e: Evento): void {
    let contagem: ContagemDoDia | undefined;
    let dia = "";
    try {
      const ms = Date.parse(e.quando);
      if (Number.isNaN(ms)) {
        avisar(`evento com data inválida, não gravado: ${JSON.stringify(e.quando)}`);
        return;
      }
      dia = new Date(ms).toISOString().slice(0, 10);
      contagem = this.contagemDoDia(dia);
      contagem.total++;
      if (contagem.total > this.tetoPorDia) {
        if (!contagem.avisado) {
          contagem.avisado = true;
          avisar(`limite de ${this.tetoPorDia} eventos atingido em ${dia}; o resto do dia só conta.`);
        }
        return;
      }
      // JSON.stringify escapa \n e \r dentro das strings: um evento ocupa sempre uma linha.
      appendFileSync(join(this.pasta, `${dia}.jsonl`), JSON.stringify(e) + "\n", { encoding: "utf8", mode: 0o600 });
    } catch (erro) {
      if (contagem?.falhaAvisada) return;
      if (contagem) contagem.falhaAvisada = true;
      avisar(
        `falha ao gravar em ${this.pasta}: ${mensagem(erro)}. Os eventos ${dia ? `de ${dia} ` : ""}que falharem ` +
          "não ficam guardados (esta linha sai uma vez por dia). Confira se o usuário do porteiro pode gravar " +
          "na pasta; no Docker, a pasta do host precisa ser do uid 1000: sudo chown 1000:1000 registro.",
      );
    }
  }

  /** Dias com arquivo na pasta ("AAAA-MM-DD"), do mais novo para o mais velho. Nunca lança. */
  dias(): string[] {
    try {
      return readdirSync(this.pasta, { withFileTypes: true })
        .filter((entrada) => entrada.isFile())
        .map((entrada) => NOME_DIA.exec(entrada.name)?.[1])
        .filter((dia): dia is string => dia !== undefined && !Number.isNaN(inicioDoDia(dia)))
        .sort()
        .reverse();
    } catch (erro) {
      avisar(`falha ao listar a pasta: ${mensagem(erro)}`);
      return [];
    }
  }

  /** Eventos gravados no arquivo do dia (linhas), sem mexer na contagem do teto. */
  gravados(dia: string): number {
    return DIA.test(dia) ? linhasNoArquivo(join(this.pasta, `${dia}.jsonl`)) : 0;
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
