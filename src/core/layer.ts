import { getActivation, type Activation, type ActivationName } from './activations';
import { Neuron } from './neuron';

/**
 * Camada (requisito 1.2): agrupa neurônios com a mesma função de ativação,
 * recebe as saídas da camada anterior e entrega as suas para a próxima.
 */
export class Layer {
  readonly neurons: Neuron[];
  readonly activation: Activation;
  /** Entradas do último exemplo processado (necessárias para atualizar os pesos). */
  inputs: number[] = [];

  constructor(neurons: Neuron[], activation: ActivationName) {
    if (neurons.length < 1) throw new Error('Uma camada precisa de ao menos 1 neurônio.');
    this.neurons = neurons;
    this.activation = getActivation(activation);
  }

  get size(): number {
    return this.neurons.length;
  }

  get inputSize(): number {
    return this.neurons[0].weights.length;
  }

  forward(inputs: readonly number[]): number[] {
    this.inputs = inputs.slice();
    return this.neurons.map((n) => n.activate(inputs, this.activation));
  }

  outputs(): number[] {
    return this.neurons.map((n) => n.output);
  }

  update(learningRate: number): void {
    for (const n of this.neurons) n.update(this.inputs, learningRate);
  }
}
