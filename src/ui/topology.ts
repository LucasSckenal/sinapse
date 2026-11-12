import { blocksOf, sourcesFor, type Architecture } from '../core/network';

/**
 * Forma da rede para os desenhos: tamanho de cada camada, blocos (início, tamanho, ativação)
 * e de onde cada neurônio recebe (null = de tudo). Camada 0 = entradas.
 */
export interface Topology {
  sizes: number[];
  blocks: { start: number; count: number; activation: string }[][];
  /** sources[l][i]: origens do neurônio i da camada de pesos l (l = 0 é a 1ª camada oculta). */
  sources: (number[] | null)[][];
}

export function topology(arch: Architecture): Topology {
  const sizes = [arch.inputs, ...arch.layers.map((l) => blocksOf(l).reduce((s, b) => s + b.neurons, 0))];
  const blocks = [
    [{ start: 0, count: arch.inputs, activation: 'entrada' }],
    ...arch.layers.map((l) => {
      let p = 0;
      return blocksOf(l).map((b) => {
        const r = { start: p, count: b.neurons, activation: b.activation as string };
        p += b.neurons;
        return r;
      });
    }),
  ];
  const sources = arch.layers.map((l, li) => blocksOf(l).flatMap((b) => Array.from({ length: b.neurons }, () => sourcesFor(b, li, arch))));
  return { sizes, blocks, sources };
}

/** Quais neurônios de cada bloco aparecem no desenho (no máximo `cap` por bloco). */
export function shownUnits(t: Topology, cap: number): number[][] {
  return t.blocks.map((layer) => layer.flatMap((b) => Array.from({ length: Math.min(b.count, cap) }, (_, k) => b.start + k)));
}
