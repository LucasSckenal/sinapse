/**
 * Gerador pseudoaleatório com semente (Mulberry32), para que a inicialização,
 * a divisão do dataset e a ordem do SGD sejam reproduzíveis.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  }

  /** Uniforme em [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Normal padrão N(0, 1) pelo método de Box-Muller. */
  gaussian(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Embaralha o vetor no lugar (Fisher-Yates). */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
