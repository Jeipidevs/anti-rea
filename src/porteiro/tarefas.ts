import type { Avisos } from "../avisos/avisos.js";
import type { Config } from "../config/carregar.js";
import type { Registro } from "../registro/registro.js";

// Tarefas periódicas do porteiro. Todo relógio fica com unref(): nenhum segura o processo aberto.

const DESCARGA_MS = 60_000;
const LIMPEZA_MS = 6 * 3_600_000;
const HORA_DO_RESUMO = 8;

/** Milissegundos até a próxima `hora`:00 no fuso do sistema (nunca zero: se é agora, é amanhã). */
export function msAteAHora(agora: number, hora: number): number {
  const alvo = new Date(agora);
  alvo.setHours(hora, 0, 0, 0);
  if (alvo.getTime() <= agora) alvo.setDate(alvo.getDate() + 1);
  return alvo.getTime() - agora;
}

function avisarFalha(tarefa: string, erro: unknown): void {
  const motivo = erro instanceof Error ? erro.message : String(erro);
  process.stderr.write(`[anti-rea] ${tarefa} falhou: ${motivo}\n`);
}

function seguro(tarefa: string, fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((erro: unknown) => avisarFalha(tarefa, erro));
  } catch (erro) {
    avisarFalha(tarefa, erro);
  }
}

/**
 * Agenda: `registro.apagarVencidos` agora e a cada 6 h; `avisos.descarregar` a cada 60 s; com
 * scans "dailySummary", `avisos.enviarResumo` às 08:00 do fuso do sistema. Devolve a função que
 * para tudo.
 */
export function agendarTarefas(deps: {
  scans: Config["alerts"]["scans"];
  registro: Pick<Registro, "apagarVencidos">;
  avisos: Pick<Avisos, "descarregar" | "enviarResumo">;
  agora: () => number;
}): () => void {
  const apagar = () => seguro("limpeza do registro", () => deps.registro.apagarVencidos(new Date(deps.agora())));
  apagar();
  const limpeza = setInterval(apagar, LIMPEZA_MS).unref();
  const descarga = setInterval(
    () => seguro("descarga dos avisos", () => deps.avisos.descarregar(deps.agora())),
    DESCARGA_MS,
  ).unref();

  let resumo: NodeJS.Timeout | undefined;
  const agendarResumo = () => {
    resumo = setTimeout(() => {
      seguro("resumo do dia", () => deps.avisos.enviarResumo());
      agendarResumo();
    }, msAteAHora(deps.agora(), HORA_DO_RESUMO)).unref();
  };
  if (deps.scans === "dailySummary") agendarResumo();

  return () => {
    clearInterval(limpeza);
    clearInterval(descarga);
    if (resumo) clearTimeout(resumo);
  };
}
