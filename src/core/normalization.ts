/**
 * Normalização (requisito 1.9). Os parâmetros são calculados só com o conjunto de
 * treinamento e aplicados aos três conjuntos e, depois, à previsão.
 * Entradas: Min-Max ou Z-score, como o usuário escolher.
 * Saídas numéricas: Min-Max para a faixa da ativação da saída (ver `fitOutputScaling`);
 * a previsão desfaz a conta e devolve o valor na unidade do arquivo.
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

/**
 * Normalização das saídas: cada posição de saída vai de [min, max] (medidos no treino) para
 * [lo, hi], a faixa que a ativação daquela saída alcança. Posição de classe (one-hot) fica com
 * min = lo e max = hi, ou seja, passa sem mudar.
 */
export interface OutputScaling {
  min: number[];
  max: number[];
  lo: number[];
  hi: number[];
}

/** Faixa que cada ativação de saída alcança (Linear e ReLU usam 0 a 1, como o Min-Max). */
export function activationRange(name: string): [number, number] {
  return name === 'tanh' ? [-1, 1] : [0, 1];
}

/**
 * Calcula a normalização das saídas com os alvos do treino.
 * `numeric[k]` diz se a posição k é número (normaliza) ou classe (passa direto).
 */
export function fitOutputScaling(trainTargets: readonly number[][], numeric: readonly boolean[], activations: readonly string[]): OutputScaling | null {
  if (!numeric.some(Boolean)) return null;
  if (trainTargets.length === 0) throw new Error('O conjunto de treinamento está vazio.');
  const k = numeric.length;
  const lo = activations.map((a) => activationRange(a)[0]);
  const hi = activations.map((a) => activationRange(a)[1]);
  const min = lo.slice();
  const max = hi.slice();
  for (let j = 0; j < k; j++) {
    if (!numeric[j]) continue;
    min[j] = Infinity;
    max[j] = -Infinity;
    for (const row of trainTargets) {
      if (row[j] < min[j]) min[j] = row[j];
      if (row[j] > max[j]) max[j] = row[j];
    }
  }
  return { min, max, lo, hi };
}

/** Alvo do arquivo → escala da rede. Coluna constante vai para o meio da faixa. */
export function scaleTargets(s: OutputScaling | null | undefined, row: readonly number[]): number[] {
  if (!s) return row.slice();
  return row.map((v, j) => {
    const range = s.max[j] - s.min[j];
    return range === 0 ? (s.lo[j] + s.hi[j]) / 2 : s.lo[j] + ((v - s.min[j]) / range) * (s.hi[j] - s.lo[j]);
  });
}

/** Saída da rede → unidade do arquivo (desfaz `scaleTargets`). */
export function unscaleOutputs(s: OutputScaling | null | undefined, row: readonly number[]): number[] {
  if (!s) return row.slice();
  return row.map((v, j) => {
    const range = s.max[j] - s.min[j];
    return range === 0 ? s.min[j] : s.min[j] + ((v - s.lo[j]) / (s.hi[j] - s.lo[j])) * range;
  });
}

export function validateOutputScaling(s: unknown, outputs: number): OutputScaling | null {
  if (s === null || s === undefined) return null;
  const n = s as Record<string, unknown>;
  const ok = (a: unknown) =>
    Array.isArray(a) && a.length === outputs && a.every((v) => typeof v === 'number' && Number.isFinite(v));
  if (ok(n.min) && ok(n.max) && ok(n.lo) && ok(n.hi) && (n.lo as number[]).every((v, j) => v < (n.hi as number[])[j]))
    return { min: n.min as number[], max: n.max as number[], lo: n.lo as number[], hi: n.hi as number[] };
  throw new Error('A normalização das saídas do arquivo está incompleta ou não bate com o número de saídas.');
}

/** Texto curto da normalização das saídas: "preco: 100 a 500 → 0 a 1". Só as posições numéricas. */
export function describeOutputScaling(s: OutputScaling | null | undefined, names?: readonly string[]): string {
  if (!s) return '';
  const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return s.min
    .map((_, j) => (s.min[j] === s.lo[j] && s.max[j] === s.hi[j] ? '' : `${names?.[j] ?? `saída ${j + 1}`}: ${n(s.min[j])} a ${n(s.max[j])} → ${n(s.lo[j])} a ${n(s.hi[j])}`))
    .filter(Boolean)
    .join('; ');
}
