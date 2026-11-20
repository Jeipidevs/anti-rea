// Abre o navegador dos casos e2e tentando cada canal em ordem. Uma falha ao abrir nunca some calada:
// no CI ela derruba o caso; fora do CI o caso pula com o motivo (regra 61: o Mac com macOS 13 não
// instala o Chromium do Playwright).

export type CanalNavegador = { channel?: string };
export type Abertura<B> = { navegador: B } | { navegador: null; motivo: string };

/** Verdadeiro quando a variável CI tem valor e não é "0" nem "false". */
export function emCI(env: NodeJS.ProcessEnv = process.env): boolean {
  const valor = (env.CI ?? "").trim().toLowerCase();
  return valor !== "" && valor !== "0" && valor !== "false";
}

/**
 * Devolve o primeiro canal que abre. Sem nenhum: no CI lança o último erro, para o caso falhar em
 * vez de virar "pulado"; fora do CI devolve o motivo com esse erro, para o caso pular dizendo por quê.
 */
export async function abrirComReserva<B>(
  lancar: (canal: CanalNavegador) => Promise<B>,
  canais: CanalNavegador[],
  ci: boolean,
): Promise<Abertura<B>> {
  let ultimo: unknown = new Error("nenhum canal de navegador para tentar");
  for (const canal of canais) {
    try {
      return { navegador: await lancar(canal) };
    } catch (erro) {
      ultimo = erro;
    }
  }
  if (ci) throw ultimo;
  const texto = ultimo instanceof Error ? ultimo.message : String(ultimo);
  return { navegador: null, motivo: `navegador não abriu: ${texto.split("\n")[0]}` };
}
