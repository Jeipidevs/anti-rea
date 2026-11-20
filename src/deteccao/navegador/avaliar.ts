import type { Sinal } from "../servidor/ferramentas.js";

/** Sinais coletados no navegador pelo coletor (`COLETOR` em desafio.ts). */
export type SinaisNavegador = {
  webdriver: boolean;
  headlessUA: boolean;
  semPlugins: boolean;
  temWindowChrome: boolean;
  uaChrome: boolean;
  cdp: boolean;
  devtoolsAberto: boolean;
  linguas: number;
  nonce: string;
};

function copia(motivo: string): Sinal {
  return { motivo, gravidade: "copia" };
}

/**
 * Só sinal forte pega. Na dúvida, deixa passar.
 * `linguas` é coletado para registro, mas sozinho nunca pega.
 */
export function avaliarNavegador(s: SinaisNavegador, opcoes: { devtoolsIsCaught: boolean }): Sinal | null {
  if (s.webdriver) return copia("navegador automatizado");
  if (s.headlessUA) return copia("navegador sem tela");
  if (s.cdp) return copia("depuração remota ativa");
  if (s.devtoolsAberto && opcoes.devtoolsIsCaught) return copia("ferramentas de desenvolvedor abertas");
  // window.chrome só tem sentido quando o agente diz ser Chrome de computador.
  if (s.uaChrome && !s.temWindowChrome && s.semPlugins) return copia("Chrome falso");
  return null;
}
