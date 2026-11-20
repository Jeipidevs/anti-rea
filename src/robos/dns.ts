import { promises as dnsPromises } from "node:dns";
import { lerEndereco, mesmoEndereco, normalizarIp, type Confirmacao } from "./faixas-meta.js";

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
// Duas tentativas por servidor (600 ms na primeira); o total segue preso aos 2 s do comTempo.
const TEMPO_POR_TENTATIVA_MS = 600;

// Só estes códigos são resposta do DNS ("esse nome ou endereço não existe").
// Tempo esgotado, SERVFAIL, recusa e o resto são falha passageira.
const CODIGOS_DEFINITIVOS = new Set(["ENOTFOUND", "ENODATA"]);

function falhaDefinitiva(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && CODIGOS_DEFINITIVOS.has(codigo);
}

function comTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: NodeJS.Timeout | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(
      () => rejeitar(Object.assign(new Error(`DNS sem resposta em ${ms} ms`), { code: "ETIMEOUT" })),
      ms,
    );
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(relogio));
}

/**
 * Resolvedor sobre node:dns/promises, com tempo-limite por consulta (2 s por padrão).
 * `direto` pergunta IPv4 e IPv6 juntos e devolve o que vier. Sem nenhum endereço, o erro
 * repassa a falha passageira de uma das famílias, se houver; senão leva o código ENODATA.
 */
export function criarResolvedorDns(
  opcoes: { base?: BaseDns; tempoMs?: number } = {},
): Resolvedor {
  const base = opcoes.base ?? new dnsPromises.Resolver({ timeout: TEMPO_POR_TENTATIVA_MS, tries: 2 });
  const tempoMs = opcoes.tempoMs ?? TEMPO_PADRAO_MS;
  return {
    reverso: (ip) => comTempo(Promise.resolve().then(() => base.reverse(ip)), tempoMs),
    async direto(host) {
      const respostas = await Promise.allSettled([
        comTempo(Promise.resolve().then(() => base.resolve4(host)), tempoMs),
        comTempo(Promise.resolve().then(() => base.resolve6(host)), tempoMs),
      ]);
      const ips = respostas.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      if (ips.length > 0) return ips;
      for (const r of respostas) {
        if (r.status === "rejected" && !falhaDefinitiva(r.reason)) throw r.reason;
      }
      throw Object.assign(new Error(`sem endereço para ${host}`), { code: "ENODATA" });
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
  return (await verificarPorDns(ip, sufixos, r)) === "sim";
}

/**
 * Como `confirmarPorDns`, mas separa o negativo definitivo (sem nome reverso, nome de fora
 * dos sufixos, direto para outro IP) da falha passageira, que volta como "incerto".
 */
export async function verificarPorDns(
  ip: string,
  sufixos: string[],
  r: Resolvedor,
): Promise<Confirmacao> {
  const alvo = normalizarIp(ip);
  if (!lerEndereco(alvo)) return "nao";
  let nomes: string[];
  try {
    nomes = (await r.reverso(alvo)).filter((n) => nomeTerminaEm(n, sufixos));
  } catch (erro) {
    return falhaDefinitiva(erro) ? "nao" : "incerto";
  }
  let duvida = false;
  for (const nome of nomes) {
    try {
      const ips = await r.direto(nome.replace(/\.$/, ""));
      if (ips.some((outro) => mesmoEndereco(outro, alvo))) return "sim";
    } catch (erro) {
      // Tenta o próximo nome; uma falha passageira deixa o resultado em dúvida.
      if (!falhaDefinitiva(erro)) duvida = true;
    }
  }
  return duvida ? "incerto" : "nao";
}
