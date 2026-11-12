import type { Activation } from './activations';

/**
 * Neurônio artificial (requisito 1.1).
 * Guarda pesos e viés e os valores intermediários do último exemplo:
 * z (soma ponderada), a saída f(z) e o delta δ = ∂E/∂z.
 */
export class Neuron {
  weights: number[];
  bias: number;
  z = 0;
  output = 0;
  delta = 0;

  constructor(weights: number[], bias: number) {
    this.weights = weights;
    this.bias = bias;
  }

  /** z = Σ wᵢ·xᵢ + b */
  weightedSum(inputs: readonly number[]): number {
    let z = this.bias;
    for (let i = 0; i < this.weights.length; i++) z += this.weights[i] * inputs[i];
    return z;
  }

  activate(inputs: readonly number[], activation: Activation): number {
    this.z = this.weightedSum(inputs);
    this.output = activation.f(this.z);
    return this.output;
  }

  /** f'(z), usada no cálculo do delta. */
  derivative(activation: Activation): number {
    return activation.df(this.z, this.output);
  }

  /** Descida do gradiente: w ← w − η·δ·x ; b ← b − η·δ */
  update(inputs: readonly number[], learningRate: number): void {
    const step = learningRate * this.delta;
    for (let i = 0; i < this.weights.length; i++) this.weights[i] -= step * inputs[i];
    this.bias -= step;
  }
}
