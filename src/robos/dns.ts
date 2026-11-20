import { promises as dnsPromises } from "node:dns";
import { lerEndereco, mesmoEndereco, normalizarIp } from "./faixas-meta.js";

// DNS reverso com confirmação direta: o nome do IP termina num sufixo do robô
// e esse nome, resolvido de volta, aponta para o mesmo IP.

export type Resolvedor = {
  reverso(ip: string): Promise<string[]>;
  direto(host: string): Promise<string[]>;
};

type BaseDns = {
  reverse(ip: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
};

const TEMPO_PADRAO_MS = 2_000;

function comTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: NodeJS.Timeout | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error(`DNS sem resposta em ${ms} ms`)), ms);
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(relogio));
}

/**
 * Resolvedor sobre node:dns/promises, com tempo-limite por consulta (2 s por padrão).
 * `direto` pergunta IPv4 e IPv6 juntos e devolve o que vier; nenhuma resposta vira erro.
 */
export function criarResolvedorDns(
  opcoes: { base?: BaseDns; tempoMs?: number } = {},
): Resolvedor {
  const base = opcoes.base ?? new dnsPromises.Resolver({ timeout: TEMPO_PADRAO_MS, tries: 1 });
  const tempoMs = opcoes.tempoMs ?? TEMPO_PADRAO_MS;
  return {
    reverso: (ip) => comTempo(Promise.resolve().then(() => base.reverse(ip)), tempoMs),
    async direto(host) {
      const respostas = await Promise.allSettled([
        comTempo(Promise.resolve().then(() => base.resolve4(host)), tempoMs),
        comTempo(Promise.resolve().then(() => base.resolve6(host)), tempoMs),
      ]);
      const ips = respostas.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (ips.length === 0) throw new Error(`sem endereço para ${host}`);
      return ips;
    },
  };
}

function nomeTerminaEm(nome: string, sufixos: string[]): boolean {
  const n = nome.toLowerCase().replace(/\.$/, "");
  return sufixos.some((s) => n.endsWith(s.toLowerCase()));
}

/** true só quando o reverso termina num dos sufixos e o direto desse nome volta ao mesmo IP. */
export async function confirmarPorDns(
  ip: string,
  sufixos: string[],
  r: Resolvedor,
): Promise<boolean> {
  try {
    const alvo = normalizarIp(ip);
    if (!lerEndereco(alvo)) return false;
    const nomes = (await r.reverso(alvo)).filter((n) => nomeTerminaEm(n, sufixos));
    for (const nome of nomes) {
      try {
        const ips = await r.direto(nome.replace(/\.$/, ""));
        if (ips.some((outro) => mesmoEndereco(outro, alvo))) return true;
      } catch {
        // Tenta o próximo nome; se nenhum confirmar, fica false.
      }
    }
    return false;
  } catch {
    return false;
  }
}
