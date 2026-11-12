import type { ActivationName } from './activations';
import { getActivation } from './activations';
import { INITIAL_BIAS, initWeights } from './initialization';
import { Layer } from './layer';
import { Neuron } from './neuron';
import { Random } from './random';

export interface LayerSpec {
  neurons: number;
  activation: ActivationName;
}

/** Arquitetura: nº de entradas + camadas (ocultas e, por último, a de saída). */
export interface Architecture {
  inputs: number;
  layers: LayerSpec[];
}

export function validateArchitecture(arch: Architecture): void {
  if (!Number.isInteger(arch.inputs) || arch.inputs < 1)
    throw new Error('A rede precisa de ao menos 1 entrada.');
  if (arch.layers.length < 1) throw new Error('A rede precisa de uma camada de saída.');
  arch.layers.forEach((l, i) => {
    if (!Number.isInteger(l.neurons) || l.neurons < 1)
      throw new Error(`A camada ${i + 1} precisa de ao menos 1 neurônio.`);
    getActivation(l.activation);
  });
}

/**
 * Rede neural MLP (requisito 1.3): compõe as camadas, faz a propagação direta (1.6)
 * e a retropropagação com atualização por descida do gradiente (1.8).
 */
export class Network {
  readonly inputCount: number;
  readonly layers: Layer[];

  constructor(inputCount: number, layers: Layer[]) {
    if (layers.length === 0) throw new Error('A rede precisa de uma camada de saída.');
    let expected = inputCount;
    layers.forEach((l, i) => {
      if (l.inputSize !== expected)
        throw new Error(`Camada ${i + 1}: esperava ${expected} pesos por neurônio, veio ${l.inputSize}.`);
      expected = l.size;
    });
    this.inputCount = inputCount;
    this.layers = layers;
  }

  /** Cria a rede com pesos aleatórios (Xavier ou He) a partir de uma semente. */
  static create(arch: Architecture, seed: number): Network {
    validateArchitecture(arch);
    const rng = new Random(seed);
    let fanIn = arch.inputs;
    const layers = arch.layers.map((spec) => {
      const neurons = Array.from(
        { length: spec.neurons },
        () => new Neuron(initWeights(rng, spec.activation, fanIn, spec.neurons), INITIAL_BIAS),
      );
      fanIn = spec.neurons;
      return new Layer(neurons, spec.activation);
    });
    return new Network(arch.inputs, layers);
  }

  get outputCount(): number {
    return this.layers[this.layers.length - 1].size;
  }

  get architecture(): Architecture {
    return {
      inputs: this.inputCount,
      layers: this.layers.map((l) => ({ neurons: l.size, activation: l.activation.name })),
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
   * Oculta:  δⱼ = f'(zⱼ) · Σₖ wₖⱼ · δₖ   (pesos ainda não alterados)
   */
  backward(targets: readonly number[]): void {
    if (targets.length !== this.outputCount)
      throw new Error(`A rede tem ${this.outputCount} saídas, recebeu ${targets.length} valores esperados.`);
    const last = this.layers[this.layers.length - 1];
    last.neurons.forEach((n, k) => {
      n.delta = (n.output - targets[k]) * n.derivative(last.activation);
    });
    for (let l = this.layers.length - 2; l >= 0; l--) {
      const layer = this.layers[l];
      const next = this.layers[l + 1];
      layer.neurons.forEach((n, j) => {
        let sum = 0;
        for (const m of next.neurons) sum += m.weights[j] * m.delta;
        n.delta = sum * n.derivative(layer.activation);
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
