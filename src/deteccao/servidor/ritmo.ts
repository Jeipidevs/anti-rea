/**
 * Limite de navegações por IP numa janela de tempo.
 * Guarda no máximo limite+1 instantes por IP e varre os IPs inativos
 * no máximo uma vez por meia janela, para uma inundação de IPs não
 * custar CPU nem memória sem teto no caminho de cada pedido.
 */
export class Ritmo {
  private readonly pedidos = new Map<string, number[]>();
  private ultimaVarredura = Number.NEGATIVE_INFINITY;
  private totalVarreduras = 0;

  constructor(
    private readonly limite: number,
    private readonly janelaMs: number,
  ) {}

  /** Registra uma navegação; true quando o IP passou do limite na janela. */
  registrar(ip: string, agora: number): boolean {
    if (agora - this.ultimaVarredura >= this.janelaMs / 2) this.limpar(agora);
    const instantes = (this.pedidos.get(ip) ?? []).filter((t) => agora - t < this.janelaMs);
    instantes.push(agora);
    const teto = this.limite + 1;
    if (instantes.length > teto) instantes.splice(0, instantes.length - teto);
    this.pedidos.set(ip, instantes);
    return instantes.length > this.limite;
  }

  /** Quantas varreduras do mapa já rodaram (para teste). */
  get varreduras(): number {
    return this.totalVarreduras;
  }

  /** Quantos IPs estão guardados agora (para teste). */
  get ipsGuardados(): number {
    return this.pedidos.size;
  }

  /** Quantos instantes estão guardados para um IP (para teste). */
  instantesGuardados(ip: string): number {
    return this.pedidos.get(ip)?.length ?? 0;
  }

  private limpar(agora: number): void {
    this.ultimaVarredura = agora;
    this.totalVarreduras++;
    for (const [ip, instantes] of this.pedidos) {
      const ultimo = instantes[instantes.length - 1];
      if (ultimo === undefined || agora - ultimo >= this.janelaMs) this.pedidos.delete(ip);
    }
  }
}
