import type { ActivationName } from './activations';
import { getActivation } from './activations';
import { INITIAL_BIAS, initWeights } from './initialization';
import { Layer, type BlockSpec } from './layer';
import { Neuron } from './neuron';
import { Random } from './random';

export type { BlockSpec } from './layer';

/**
 * Uma camada da arquitetura. Sem `blocks`, é uma camada comum: `neurons` neurônios com a mesma
 * ativação, ligados a todas as saídas da camada anterior. Com `blocks`, a camada tem blocos em
 * paralelo (cada um com neurônios, ativação e origens próprias); aí `neurons` é a soma deles.
 */
export interface LayerSpec {
  neurons: number;
  activation: ActivationName;
  blocks?: BlockSpec[];
}

/** Arquitetura: nº de entradas + camadas (ocultas e, por último, a de saída). */
export interface Architecture {
  inputs: number;
  layers: LayerSpec[];
}

export function blocksOf(spec: LayerSpec): BlockSpec[] {
  return spec.blocks && spec.blocks.length ? spec.blocks : [{ neurons: spec.neurons, activation: spec.activation }];
}

/** Camada com blocos: `neurons` e `activation` passam a refletir os blocos. */
export function withBlocks(blocks: BlockSpec[]): LayerSpec {
  const simple = blocks.length === 1 && !blocks[0].from;
  return {
    neurons: blocks.reduce((s, b) => s + b.neurons, 0),
    activation: blocks[0].activation,
    ...(simple ? {} : { blocks }),
  };
}

/** Converte as origens de um bloco (índices de blocos, ou de entradas na 1ª camada) em índices de saídas. */
export function sourcesFor(block: BlockSpec, layerIndex: number, arch: Architecture): number[] | null {
  if (!block.from) return null;
  if (layerIndex === 0) return block.from.slice().sort((a, b) => a - b);
  const prev = blocksOf(arch.layers[layerIndex - 1]);
  const starts: number[] = [];
  let p = 0;
  for (const b of prev) {
    starts.push(p);
    p += b.neurons;
  }
  return block.from
    .slice()
    .sort((a, b) => a - b)
    .flatMap((k) => Array.from({ length: prev[k].neurons }, (_, i) => starts[k] + i));
}

export function validateArchitecture(arch: Architecture): void {
  if (!Number.isInteger(arch.inputs) || arch.inputs < 1) throw new Error('A rede precisa de ao menos 1 entrada.');
  if (arch.layers.length < 1) throw new Error('A rede precisa de uma camada de saída.');
  arch.layers.forEach((l, i) => {
    const blocks = blocksOf(l);
    const prevCount = i === 0 ? arch.inputs : blocksOf(arch.layers[i - 1]).length;
    const prevLabel = i === 0 ? 'entrada' : 'bloco';
    blocks.forEach((b, k) => {
      const where = blocks.length > 1 ? `Camada ${i + 1}, bloco ${k + 1}` : `A camada ${i + 1}`;
      if (!Number.isInteger(b.neurons) || b.neurons < 1) throw new Error(`${where} precisa de ao menos 1 neurônio.`);
      getActivation(b.activation);
      if (b.from) {
        if (b.from.length === 0) throw new Error(`${where} não recebe de nenhuma ${prevLabel}. Marque ao menos uma.`);
        if (b.from.some((f) => !Number.isInteger(f) || f < 0 || f >= prevCount))
          throw new Error(`${where} recebe de uma ${prevLabel} que não existe.`);
      }
    });
  });
}

/**
 * Rede neural MLP (requisito 1.3): compõe as camadas, faz a propagação direta (1.6)
 * e a retropropagação com atualização por descida do gradiente (1.8).
 * As camadas podem ter blocos em paralelo; a matemática é a mesma, só que cada neurônio
 * soma apenas as entradas que estão ligadas a ele.
 */
export class Network {
  readonly inputCount: number;
  readonly layers: Layer[];

  constructor(inputCount: number, layers: Layer[]) {
    if (layers.length === 0) throw new Error('A rede precisa de uma camada de saída.');
    let expected = inputCount;
    layers.forEach((l, i) => {
      l.neurons.forEach((n, k) => {
        const s = n.sources;
        if (s) {
          if (s.some((j) => !Number.isInteger(j) || j < 0 || j >= expected))
            throw new Error(`Camada ${i + 1}, neurônio ${k + 1}: recebe de uma saída que não existe (a camada anterior tem ${expected}).`);
        } else if (n.weights.length !== expected)
          throw new Error(`Camada ${i + 1}: esperava ${expected} pesos por neurônio, veio ${n.weights.length}.`);
      });
      expected = l.size;
    });
    this.inputCount = inputCount;
    this.layers = layers;
  }

  /** Cria a rede com pesos aleatórios (Xavier ou He) a partir de uma semente. */
  static create(arch: Architecture, seed: number): Network {
    validateArchitecture(arch);
    const rng = new Random(seed);
    let prevSize = arch.inputs;
    const layers = arch.layers.map((spec, li) => {
      const blocks = blocksOf(spec);
      const neurons = blocks.flatMap((b) => {
        const sources = sourcesFor(b, li, arch);
        const fanIn = sources ? sources.length : prevSize;
        const act = getActivation(b.activation);
        return Array.from({ length: b.neurons }, () => new Neuron(initWeights(rng, b.activation, fanIn, b.neurons), INITIAL_BIAS, act, sources));
      });
      prevSize = neurons.length;
      return new Layer(neurons, spec.blocks && spec.blocks.length ? blocks : undefined);
    });
    return new Network(arch.inputs, layers);
  }

  get outputCount(): number {
    return this.layers[this.layers.length - 1].size;
  }

  get architecture(): Architecture {
    return {
      inputs: this.inputCount,
      layers: this.layers.map((l) =>
        l.isParallel ? withBlocks(l.blocks.map((b) => ({ ...b, ...(b.from ? { from: b.from.slice() } : {}) }))) : { neurons: l.size, activation: l.activation.name },
      ),
    };
  }

  /** Propagação direta: as saídas de cada camada viram as entradas da seguinte. */
  forward(inputs: readonly number[]): number[] {
    if (inputs.length !== this.inputCount)
      throw new Error(`A rede espera ${this.inputCount} entradas, recebeu ${inputs.length}.`);
    let values = inputs as number[];
    for (const layer of this.layers) values = layer.forward(values);
    return values;
  }

  /**
   * Calcula os deltas de todos os neurônios para o último exemplo propagado.
   * Erro por exemplo: E = ½ Σₖ (oₖ − tₖ)².
   * Saída:   δₖ = (oₖ − tₖ) · f'(zₖ)
   * Oculta:  δⱼ = f'(zⱼ) · Σₖ wₖⱼ · δₖ   (só os k ligados a j; pesos ainda não alterados)
   */
  backward(targets: readonly number[]): void {
    if (targets.length !== this.outputCount)
      throw new Error(`A rede tem ${this.outputCount} saídas, recebeu ${targets.length} valores esperados.`);
    const last = this.layers[this.layers.length - 1];
    last.neurons.forEach((n, k) => {
      n.delta = (n.output - targets[k]) * n.derivative();
    });
    for (let l = this.layers.length - 2; l >= 0; l--) {
      const layer = this.layers[l];
      const next = this.layers[l + 1];
      const sum = new Float64Array(layer.size);
      for (const m of next.neurons) for (let p = 0; p < m.weights.length; p++) sum[m.sourceOf(p)] += m.weights[p] * m.delta;
      layer.neurons.forEach((n, j) => {
        n.delta = sum[j] * n.derivative();
      });
    }
  }

  /** Atualiza pesos e vieses de todas as camadas (só depois de todos os deltas calculados). */
  update(learningRate: number): void {
    for (const layer of this.layers) layer.update(learningRate);
  }

  /** Um passo de SGD com um único exemplo. */
  trainExample(inputs: readonly number[], targets: readonly number[], learningRate: number): number[] {
    const out = this.forward(inputs);
    this.backward(targets);
    this.update(learningRate);
    return out;
  }
}
