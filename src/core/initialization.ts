import type { ActivationName } from './activations';
import { Random } from './random';

/**
 * Inicialização dos pesos (requisito 1.5).
 * - Xavier/Glorot normal: σ = √(2 / (nEntradas + nSaídas)) — Linear, Sigmoid e Tanh.
 * - He normal: σ = √(2 / nEntradas) — ReLU.
 * Os vieses começam em 0 e são guardados junto com os pesos.
 */
export type InitName = 'xavier' | 'he';

export function initFor(activation: ActivationName): InitName {
  return activation === 'relu' ? 'he' : 'xavier';
}

export function initStd(init: InitName, fanIn: number, fanOut: number): number {
  return init === 'he' ? Math.sqrt(2 / fanIn) : Math.sqrt(2 / (fanIn + fanOut));
}

export function initWeights(
  rng: Random,
  activation: ActivationName,
  fanIn: number,
  fanOut: number,
): number[] {
  const std = initStd(initFor(activation), fanIn, fanOut);
  return Array.from({ length: fanIn }, () => rng.gaussian() * std);
}

export const INITIAL_BIAS = 0;
