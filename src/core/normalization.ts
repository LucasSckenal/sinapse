/**
 * Normalização dos atributos de entrada (requisito 1.9). Os parâmetros são
 * calculados só com o conjunto de treinamento e aplicados aos três conjuntos
 * e, depois, às entradas da previsão. As saídas esperadas não são normalizadas.
 */
export type NormalizationName = 'nenhuma' | 'minmax' | 'zscore';

export type Normalization =
  | { tipo: 'minmax'; min: number[]; max: number[] }
  | { tipo: 'zscore'; media: number[]; desvio: number[] };

export const NORMALIZATION_LABELS: Record<NormalizationName, string> = {
  nenhuma: 'Nenhuma',
  minmax: 'Min-Max',
  zscore: 'Z-score',
};

export function fitNormalization(
  name: NormalizationName,
  trainInputs: readonly number[][],
): Normalization | null {
  if (name === 'nenhuma') return null;
  if (trainInputs.length === 0) throw new Error('O conjunto de treinamento está vazio.');
  const cols = trainInputs[0].length;
  if (name === 'minmax') {
    const min = Array(cols).fill(Infinity);
    const max = Array(cols).fill(-Infinity);
    for (const row of trainInputs)
      row.forEach((v, j) => {
        if (v < min[j]) min[j] = v;
        if (v > max[j]) max[j] = v;
      });
    return { tipo: 'minmax', min, max };
  }
  const media = Array(cols).fill(0);
  for (const row of trainInputs) row.forEach((v, j) => (media[j] += v));
  media.forEach((_, j) => (media[j] /= trainInputs.length));
  const desvio = Array(cols).fill(0);
  for (const row of trainInputs) row.forEach((v, j) => (desvio[j] += (v - media[j]) ** 2));
  desvio.forEach((_, j) => (desvio[j] = Math.sqrt(desvio[j] / trainInputs.length)));
  return { tipo: 'zscore', media, desvio };
}

/** Aplica a normalização a uma linha. Coluna constante (amplitude 0) vira 0. */
export function normalizeRow(norm: Normalization | null, row: readonly number[]): number[] {
  if (!norm) return row.slice();
  if (norm.tipo === 'minmax')
    return row.map((v, j) => {
      const range = norm.max[j] - norm.min[j];
      return range === 0 ? 0 : (v - norm.min[j]) / range;
    });
  return row.map((v, j) => (norm.desvio[j] === 0 ? 0 : (v - norm.media[j]) / norm.desvio[j]));
}

export function normalizeRows(norm: Normalization | null, rows: readonly number[][]): number[][] {
  return rows.map((r) => normalizeRow(norm, r));
}

export function validateNormalization(norm: unknown, inputs: number): Normalization | null {
  if (norm === null || norm === undefined) return null;
  const n = norm as Record<string, unknown>;
  const ok = (a: unknown) =>
    Array.isArray(a) && a.length === inputs && a.every((v) => typeof v === 'number' && Number.isFinite(v));
  if (n.tipo === 'minmax' && ok(n.min) && ok(n.max))
    return { tipo: 'minmax', min: n.min as number[], max: n.max as number[] };
  if (n.tipo === 'zscore' && ok(n.media) && ok(n.desvio))
    return { tipo: 'zscore', media: n.media as number[], desvio: n.desvio as number[] };
  throw new Error('A normalização do arquivo está incompleta ou não bate com o número de entradas.');
}
