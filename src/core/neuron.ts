import type { Activation } from './activations';

/**
 * Neurônio artificial (requisito 1.1).
 * Guarda pesos e viés e os valores intermediários do último exemplo:
 * z (soma ponderada), a saída f(z) e o delta δ = ∂E/∂z.
 *
 * `sources` diz de quais saídas da camada anterior ele recebe (blocos em paralelo).
 * null = de todas, como numa MLP comum; nesse caso weights[i] é o peso da entrada i.
 * Com origens, weights[p] é o peso da entrada sources[p].
 */
export class Neuron {
  weights: number[];
  bias: number;
  readonly sources: number[] | null;
  activation: Activation;
  z = 0;
  output = 0;
  delta = 0;

  constructor(weights: number[], bias: number, activation: Activation, sources: number[] | null = null) {
    if (sources && sources.length !== weights.length)
      throw new Error(`O neurônio tem ${weights.length} pesos para ${sources.length} origens.`);
    this.weights = weights;
    this.bias = bias;
    this.activation = activation;
    this.sources = sources;
  }

  /** Índice, na camada anterior, da entrada que o peso p recebe. */
  sourceOf(p: number): number {
    return this.sources ? this.sources[p] : p;
  }

  /** z = Σ wₚ·x[origem p] + b */
  weightedSum(inputs: readonly number[]): number {
    let z = this.bias;
    const s = this.sources;
    if (s) for (let p = 0; p < this.weights.length; p++) z += this.weights[p] * inputs[s[p]];
    else for (let i = 0; i < this.weights.length; i++) z += this.weights[i] * inputs[i];
    return z;
  }

  activate(inputs: readonly number[]): number {
    this.z = this.weightedSum(inputs);
    this.output = this.activation.f(this.z);
    return this.output;
  }

  /** f'(z), usada no cálculo do delta. */
  derivative(): number {
    return this.activation.df(this.z, this.output);
  }

  /** Descida do gradiente: w ← w − η·δ·x ; b ← b − η·δ */
  update(inputs: readonly number[], learningRate: number): void {
    const step = learningRate * this.delta;
    const s = this.sources;
    for (let p = 0; p < this.weights.length; p++) this.weights[p] -= step * inputs[s ? s[p] : p];
    this.bias -= step;
  }
}
