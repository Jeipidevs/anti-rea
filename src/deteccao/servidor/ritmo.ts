/** Limite de navegações por IP numa janela de tempo. */
export class Ritmo {
  private readonly pedidos = new Map<string, number[]>();

  constructor(
    private readonly limite: number,
    private readonly janelaMs: number,
  ) {}

  /** Registra uma navegação; true quando o IP passou do limite na janela. */
  registrar(ip: string, agora: number): boolean {
    this.limpar(agora);
    const instantes = (this.pedidos.get(ip) ?? []).filter((t) => agora - t < this.janelaMs);
    instantes.push(agora);
    this.pedidos.set(ip, instantes);
    return instantes.length > this.limite;
  }

  private limpar(agora: number): void {
    for (const [ip, instantes] of this.pedidos) {
      const ultimo = instantes[instantes.length - 1];
      if (ultimo === undefined || agora - ultimo >= this.janelaMs) this.pedidos.delete(ip);
    }
  }
}
