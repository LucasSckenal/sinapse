import { decode, encode, type Decoded } from './encoding';
import { normalizeRow, unscaleOutputs } from './normalization';
import type { Model } from './persistence';

/**
 * Previsão (requisito 1.12): confere a quantidade de valores, aplica a mesma
 * normalização do treino e faz só a propagação direta (os pesos não mudam).
 * Se as saídas foram normalizadas no treino, desfaz a conta: o valor volta na unidade do arquivo.
 */
export function predict(model: Model, values: readonly number[]): number[] {
  const n = model.net.inputCount;
  if (values.length !== n) throw new Error(`A rede espera ${n} valores de entrada, foram informados ${values.length}.`);
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new Error(`O valor ${i + 1} não é um número.`);
  });
  return unscaleOutputs(model.outputScaling, model.net.forward(normalizeRow(model.normalization, values)));
}

/**
 * Previsão por coluna do CSV: cada valor é um número ou o índice da classe (colunas de rótulos).
 * Codifica, prevê e devolve as saídas já juntas por coluna, com a classe vencedora.
 */
export function predictColumns(model: Model, values: readonly number[]): { raw: number[]; decoded: Decoded[] } {
  const c = model.codings;
  if (!c) {
    const raw = predict(model, values);
    return { raw, decoded: raw.map((valor, i) => ({ nome: model.columns?.saidas[i] ?? `Saída ${i + 1}`, tipo: 'numero', valor })) };
  }
  if (values.length !== c.entradas.length)
    throw new Error(`A rede espera ${c.entradas.length} valores de entrada, foram informados ${values.length}.`);
  const raw = predict(model, encode(c.entradas, values));
  return { raw, decoded: decode(c.saidas, raw) };
}
