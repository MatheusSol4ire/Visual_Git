// Pedidos de páginas da lista de commits ainda em andamento, de UMA tela.
// Separado do CommitsViewProvider para poder ser testado sem o VS Code.

/**
 * Cada pedido vem com o número (`gen`) da lista que a tela está montando. A tela só aceita respostas
 * do número atual e o número só aumenta, então quando chega um pedido com outro número os anteriores
 * já não servem para nada: são cancelados (os processos do Git deles são encerrados).
 * Pedidos do mesmo número (ex.: "carregar mais" da lista que está na tela) seguem normalmente.
 */
export class PageRequests {
  private readonly active = new Map<AbortController, number>();

  /** Começa um pedido da lista `gen`. Chame `done` quando ele terminar (dando certo ou não). */
  start(gen: number): { signal: AbortSignal; done: () => void } {
    for (const [controller, other] of this.active) {
      if (other !== gen) {
        controller.abort();
        this.active.delete(controller);
      }
    }
    const controller = new AbortController();
    this.active.set(controller, gen);
    return { signal: controller.signal, done: () => this.active.delete(controller) };
  }

  /** A tela foi fechada: nada do que ela pediu precisa terminar. */
  cancelAll(): void {
    for (const controller of this.active.keys()) controller.abort();
    this.active.clear();
  }

  /** Quantos pedidos ainda estão em andamento. */
  get size(): number {
    return this.active.size;
  }
}
