/**
 * Limite de navegações por chave numa janela de tempo. Quem chama escolhe a chave (o porteiro usa o
 * id do passe de visitante, ou o IP quando não há verificação; veja porteiro/decidir.ts).
 * Guarda no máximo limite+1 instantes por chave e varre as chaves inativas
 * no máximo uma vez por meia janela, para uma inundação de chaves não
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

  /** Registra uma navegação; true quando a chave passou do limite na janela. */
  registrar(chave: string, agora: number): boolean {
    if (agora - this.ultimaVarredura >= this.janelaMs / 2) this.limpar(agora);
    const instantes = (this.pedidos.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    instantes.push(agora);
    const teto = this.limite + 1;
    if (instantes.length > teto) instantes.splice(0, instantes.length - teto);
    this.pedidos.set(chave, instantes);
    return instantes.length > this.limite;
  }

  /** Quantas varreduras do mapa já rodaram (para teste). */
  get varreduras(): number {
    return this.totalVarreduras;
  }

  /** Quantas chaves estão guardadas agora (para teste). */
  get chavesGuardadas(): number {
    return this.pedidos.size;
  }

  /** Quantos instantes estão guardados para uma chave (para teste). */
  instantesGuardados(chave: string): number {
    return this.pedidos.get(chave)?.length ?? 0;
  }

  private limpar(agora: number): void {
    this.ultimaVarredura = agora;
    this.totalVarreduras++;
    for (const [chave, instantes] of this.pedidos) {
      const ultimo = instantes[instantes.length - 1];
      if (ultimo === undefined || agora - ultimo >= this.janelaMs) this.pedidos.delete(chave);
    }
  }
}
