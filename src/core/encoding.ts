/**
 * Codificação das colunas: número passa direto; coluna de texto (rótulo de classe) vira
 * one-hot, uma posição por classe. Na saída, a classe prevista é a de maior valor.
 */
export type ColumnCoding = { nome: string; tipo: 'numero' } | { nome: string; tipo: 'classe'; classes: string[] };

export function codingWidth(c: ColumnCoding): number {
  return c.tipo === 'classe' ? c.classes.length : 1;
}

export function totalWidth(codings: readonly ColumnCoding[]): number {
  return codings.reduce((s, c) => s + codingWidth(c), 0);
}

/** Nomes das posições já expandidas: "especie = setosa". */
export function expandedNames(codings: readonly ColumnCoding[]): string[] {
  return codings.flatMap((c) => (c.tipo === 'classe' ? c.classes.map((k) => `${c.nome} = ${k}`) : [c.nome]));
}

/** values[i] é o número da coluna i, ou o índice da classe se ela for de texto. */
export function encode(codings: readonly ColumnCoding[], values: readonly number[]): number[] {
  const out: number[] = [];
  codings.forEach((c, i) => {
    if (c.tipo === 'numero') out.push(values[i]);
    else for (let k = 0; k < c.classes.length; k++) out.push(k === values[i] ? 1 : 0);
  });
  return out;
}

export type Decoded =
  | { nome: string; tipo: 'numero'; valor: number }
  | { nome: string; tipo: 'classe'; classe: string; indice: number; valores: { classe: string; valor: number }[] };

export function argmax(v: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

/** Junta as saídas expandidas de volta por coluna; nas de classe, escolhe a de maior valor. */
export function decode(codings: readonly ColumnCoding[], out: readonly number[]): Decoded[] {
  let p = 0;
  return codings.map((c) => {
    if (c.tipo === 'numero') return { nome: c.nome, tipo: 'numero', valor: out[p++] };
    const vals = out.slice(p, p + c.classes.length);
    p += c.classes.length;
    const indice = argmax(vals);
    return {
      nome: c.nome,
      tipo: 'classe',
      classe: c.classes[indice],
      indice,
      valores: c.classes.map((classe, k) => ({ classe, valor: vals[k] })),
    };
  });
}

export function validateCodings(data: unknown, width: number, label: string): ColumnCoding[] {
  if (!Array.isArray(data)) throw new Error(`A codificação das ${label} está inválida.`);
  const list = data.map((c) => {
    const o = c as Record<string, unknown>;
    if (typeof o?.nome !== 'string') throw new Error(`A codificação das ${label} está inválida.`);
    if (o.tipo === 'numero') return { nome: o.nome, tipo: 'numero' } as ColumnCoding;
    if (o.tipo === 'classe' && Array.isArray(o.classes) && o.classes.length > 0 && o.classes.every((k) => typeof k === 'string'))
      return { nome: o.nome, tipo: 'classe', classes: o.classes as string[] } as ColumnCoding;
    throw new Error(`A codificação das ${label} está inválida.`);
  });
  if (totalWidth(list) !== width)
    throw new Error(`A codificação das ${label} soma ${totalWidth(list)} posições, mas a rede tem ${width}.`);
  return list;
}

/**
 * Taxa de acerto, quando a saída é de classificação: colunas de texto (maior valor = classe)
 * ou colunas só com 0 e 1 (uma coluna: corte em 0,5; várias: a de maior valor).
 * Devolve undefined quando a saída é numérica (regressão).
 */
export function accuracy(
  outputs: readonly number[][],
  targets: readonly number[][],
  codings: readonly ColumnCoding[] | undefined,
): number | undefined {
  if (outputs.length === 0) return undefined;
  const groups: { start: number; width: number }[] = [];
  if (codings && codings.some((c) => c.tipo === 'classe')) {
    let p = 0;
    for (const c of codings) {
      const w = codingWidth(c);
      if (c.tipo === 'classe') groups.push({ start: p, width: w });
      p += w;
    }
  } else {
    const binary = targets.every((t) => t.every((v) => v === 0 || v === 1));
    if (!binary) return undefined;
    groups.push({ start: 0, width: targets[0].length });
  }
  let hits = 0;
  let total = 0;
  for (let i = 0; i < outputs.length; i++)
    for (const g of groups) {
      const o = outputs[i].slice(g.start, g.start + g.width);
      const t = targets[i].slice(g.start, g.start + g.width);
      const ok = g.width === 1 ? o[0] >= 0.5 === t[0] >= 0.5 : argmax(o) === argmax(t);
      hits += ok ? 1 : 0;
      total++;
    }
  return hits / total;
}

export interface Confusion {
  labels: string[];
  /** m[real][previsto] = quantos exemplos. */
  m: number[][];
}

/**
 * Matriz de confusão da primeira saída de classificação: coluna de rótulos (classe de maior valor),
 * uma saída 0/1 (corte em 0,5) ou várias saídas 0/1 (a de maior valor). undefined = regressão.
 */
export function confusionMatrix(
  outputs: readonly number[][],
  targets: readonly number[][],
  codings: readonly ColumnCoding[] | undefined,
  outNames?: readonly string[],
): Confusion | undefined {
  if (outputs.length === 0) return undefined;
  let start = 0;
  let labels: string[];
  if (codings && codings.some((c) => c.tipo === 'classe')) {
    let p = 0;
    const c = codings.find((x) => {
      if (x.tipo === 'classe') return true;
      p += codingWidth(x);
      return false;
    }) as Extract<ColumnCoding, { tipo: 'classe' }>;
    start = p;
    labels = c.classes;
  } else {
    if (!targets.every((t) => t.every((v) => v === 0 || v === 1))) return undefined;
    const w = targets[0].length;
    labels = w === 1 ? ['1', '0'] : Array.from({ length: w }, (_, k) => outNames?.[k] ?? `saída ${k + 1}`);
  }
  const width = labels.length === 2 && targets[0].length === 1 ? 1 : labels.length;
  const idx = (v: readonly number[]) => {
    const part = v.slice(start, start + width);
    return width === 1 ? (part[0] >= 0.5 ? 0 : 1) : argmax(part);
  };
  const m = labels.map(() => labels.map(() => 0));
  outputs.forEach((o, i) => m[idx(targets[i])][idx(o)]++);
  return { labels, m };
}
