const UNIDADES_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Converte "30s", "5m", "1h" ou "7d" em milissegundos. */
export function duracaoMs(texto: string): number {
  const achou = /^(\d+)([smhd])$/.exec(texto);
  if (!achou) throw new Error(`duração inválida: ${texto}`);
  return Number(achou[1]) * UNIDADES_MS[achou[2]!]!;
}
