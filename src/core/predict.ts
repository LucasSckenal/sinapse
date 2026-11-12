import { normalizeRow } from './normalization';
import type { Model } from './persistence';

/**
 * Previsão (requisito 1.12): confere a quantidade de valores, aplica a mesma
 * normalização do treino e faz só a propagação direta (os pesos não mudam).
 */
export function predict(model: Model, values: readonly number[]): number[] {
  const n = model.net.inputCount;
  if (values.length !== n) throw new Error(`A rede espera ${n} valores de entrada, foram informados ${values.length}.`);
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new Error(`O valor ${i + 1} não é um número.`);
  });
  return model.net.forward(normalizeRow(model.normalization, values));
}
