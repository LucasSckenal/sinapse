import type { Network } from './network';

/**
 * Erro Quadrático Médio (requisito 1.7):
 * MSE = (1 / (N·K)) · Σₙ Σₖ (oₙₖ − tₙₖ)²   — N exemplos, K saídas.
 * Só faz propagação direta; não altera a rede.
 */
export function mse(net: Network, inputs: readonly number[][], targets: readonly number[][]): number {
  if (inputs.length === 0) return NaN;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < inputs.length; i++) {
    const out = net.forward(inputs[i]);
    const t = targets[i];
    for (let k = 0; k < out.length; k++) {
      const d = out[k] - t[k];
      sum += d * d;
      count++;
    }
  }
  return sum / count;
}
