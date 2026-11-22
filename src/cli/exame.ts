import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ErroDeProva, examinar } from "../exame/exame.js";
import { relatorioHtml, resumoTerminal } from "../exame/relatorio.js";
import { ARQUIVO_DOS_CODIGOS, CAMINHO_DA_PROVA, codigoDoHost, linhaDaProva } from "../exame/prova.js";

export type OpcoesExameCli = {
  url: string;
  dono?: string;
  /** Pasta onde ficam o arquivo dos códigos e o relatório (a pasta atual no terminal). */
  pasta: string;
  agora?: Date;
  buscar?: typeof fetch;
};

/** Versão do pacote, lida do package.json ao lado de dist/ (ou de src/ nos testes). */
export function versaoDoPacote(): string {
  try {
    const pacote = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof pacote.version === "string" ? pacote.version : "0";
  } catch {
    return "0";
  }
}

function lerUrl(bruta: string): URL {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(bruta) ? bruta : `https://${bruta}`);
  } catch {
    throw new Error(`Endereço inválido: ${bruta}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`O exame só lê http e https: ${bruta}`);
  if (url.username || url.password) throw new Error("Tire o usuário e a senha do endereço.");
  url.hash = "";
  return url;
}

/** Nome do arquivo do relatório: exame-<host>-<AAAA-MM-DD>.html, com o host só em [a-z0-9.-]. */
export function nomeDoRelatorio(host: string, agora: Date): string {
  const limpo = host.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  return `exame-${limpo}-${agora.toISOString().slice(0, 10)}.html`;
}

/** O `anti-rea exame`: devolve as linhas do terminal e o código de saída. */
export async function rodarExame(op: OpcoesExameCli): Promise<{ linhas: string[]; saida: number }> {
  const url = lerUrl(op.url);
  const agora = op.agora ?? new Date();
  const codigo = codigoDoHost(join(op.pasta, ARQUIVO_DOS_CODIGOS), url.host);
  const agente = `anti-rea-exame/${versaoDoPacote()} (+https://github.com/Jeipidevs/anti-rea)`;
  try {
    const r = await examinar({ url, codigo, dono: op.dono, agente, agora, buscar: op.buscar });
    const arquivo = join(op.pasta, nomeDoRelatorio(url.host, agora));
    writeFileSync(arquivo, relatorioHtml(r));
    return { linhas: resumoTerminal(r, arquivo), saida: 0 };
  } catch (erro) {
    if (!(erro instanceof ErroDeProva)) throw erro;
    const motivo =
      erro.resultado === "sem-resposta"
        ? `O site não respondeu em ${url.origin}${CAMINHO_DA_PROVA}.`
        : erro.resultado === "codigo-diferente"
          ? `O arquivo ${CAMINHO_DA_PROVA} existe, mas o código não confere.`
          : "Antes do exame, prove que o site é seu. O exame não roda em site dos outros.";
    return {
      saida: 1,
      linhas: [
        motivo,
        "",
        `Crie no site o arquivo ${url.origin}${CAMINHO_DA_PROVA} com esta linha:`,
        linhaDaProva(codigo),
        "",
        `Depois rode de novo: anti-rea exame ${url.href}`,
        `O código fica guardado em ${ARQUIVO_DOS_CODIGOS}, nesta pasta.`,
      ],
    };
  }
}
