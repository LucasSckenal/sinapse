import { getActivation, type Activation, type ActivationName } from './activations';
import { Neuron } from './neuron';

/**
 * Um bloco de neurônios dentro de uma camada: mesma ativação, mesmas origens.
 * `from` = de onde o bloco recebe: na primeira camada, os índices das entradas; nas outras,
 * os índices dos blocos da camada anterior. Sem `from`, recebe de tudo.
 */
export interface BlockSpec {
  neurons: number;
  activation: ActivationName;
  from?: number[];
}

/**
 * Camada (requisito 1.2): agrupa neurônios, recebe as saídas da camada anterior e entrega as
 * suas para a próxima. Pode ter vários blocos lado a lado (em paralelo), cada um com a sua
 * função de ativação e as suas origens; as saídas dos blocos ficam em sequência.
 */
export class Layer {
  readonly neurons: Neuron[];
  readonly blocks: BlockSpec[];
  /** Entradas do último exemplo processado (necessárias para atualizar os pesos). */
  inputs: number[] = [];

  constructor(neurons: Neuron[], blocks?: BlockSpec[]) {
    if (neurons.length < 1) throw new Error('Uma camada precisa de ao menos 1 neurônio.');
    this.neurons = neurons;
    this.blocks = blocks ?? [{ neurons: neurons.length, activation: neurons[0].activation.name }];
    const total = this.blocks.reduce((s, b) => s + b.neurons, 0);
    if (total !== neurons.length) throw new Error(`Os blocos somam ${total} neurônios, mas a camada tem ${neurons.length}.`);
  }

  /** Camada comum (um bloco só, ligada a tudo). */
  static dense(neurons: Neuron[]): Layer {
    return new Layer(neurons);
  }

  get size(): number {
    return this.neurons.length;
  }

  /** Ativação do primeiro bloco (a da camada inteira quando há um bloco só). */
  get activation(): Activation {
    return getActivation(this.blocks[0].activation);
  }

  get isParallel(): boolean {
    return this.blocks.length > 1 || this.blocks.some((b) => b.from);
  }

  /** Início e fim (exclusivo) de cada bloco dentro da camada. */
  blockRanges(): [number, number][] {
    let p = 0;
    return this.blocks.map((b) => {
      const r: [number, number] = [p, p + b.neurons];
      p += b.neurons;
      return r;
    });
  }

  forward(inputs: readonly number[]): number[] {
    this.inputs = inputs.slice();
    return this.neurons.map((n) => n.activate(inputs));
  }

  outputs(): number[] {
    return this.neurons.map((n) => n.output);
  }

  update(learningRate: number): void {
    for (const n of this.neurons) n.update(this.inputs, learningRate);
  }
}
