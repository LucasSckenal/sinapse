import { encode, expandedNames, totalWidth, type ColumnCoding } from './encoding';
import type { Architecture } from './network';
import { fitNormalization, normalizeRows, type Normalization, type NormalizationName } from './normalization';
import { Random } from './random';

/**
 * Leitura e preparação de datasets (requisito 1.9).
 * O CSV chega limpo; aqui só lemos, separamos colunas, dividimos e (opcionalmente) normalizamos.
 */
export interface Table {
  headers: string[];
  /** Número da célula; nas colunas de texto, o índice da classe em `classes[coluna]`. */
  rows: number[][];
  /** null = coluna numérica; lista = coluna de rótulos (classes em ordem). */
  classes: (string[] | null)[];
}

const MAX_CLASSES = 50;

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function detectSeparator(line: string): string {
  const counts = [',', ';', '\t'].map((s) => [s, line.split(s).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

function toNumber(cell: string): number {
  if (cell === '') return NaN;
  return Number(cell);
}

/**
 * Lê um CSV. Se a primeira linha não for numérica, vira o cabeçalho. Coluna toda em texto vira
 * coluna de rótulos (classes); coluna que mistura números e texto é acusada com a linha.
 */
export function parseCSV(text: string): Table {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('O arquivo está vazio.');
  const sep = detectSeparator(lines[0]);
  const first = splitLine(lines[0], sep);
  const body0 = lines.slice(1).map((l) => splitLine(l, sep));
  // cabeçalho: a primeira linha tem texto onde as outras linhas, em sua maioria, têm número
  const numericShare = (col: number) => body0.filter((r) => Number.isFinite(toNumber(r[col] ?? ''))).length / Math.max(1, body0.length);
  const hasHeader = body0.length === 0 ? first.some((c) => Number.isNaN(toNumber(c))) : first.some((c, j) => Number.isNaN(toNumber(c)) && (numericShare(j) > 0.5 || body0.every((r) => r[j] !== c)));
  const headers = hasHeader ? first.map((h, i) => h || `coluna ${i + 1}`) : first.map((_, i) => `coluna ${i + 1}`);
  const cellsRows = hasHeader ? body0 : [first, ...body0];
  if (cellsRows.length === 0) throw new Error('O arquivo só tem o cabeçalho, sem nenhuma linha de dados.');
  const lineNo = (i: number) => i + (hasHeader ? 2 : 1);
  cellsRows.forEach((cells, i) => {
    if (cells.length !== headers.length)
      throw new Error(`Linha ${lineNo(i)}: tem ${cells.length} colunas, o esperado era ${headers.length}.`);
    cells.forEach((c, j) => {
      if (c === '') throw new Error(`Linha ${lineNo(i)}, coluna "${headers[j]}": célula vazia.`);
    });
  });
  const classes: (string[] | null)[] = headers.map((_, j) => {
    const texts = cellsRows.map((r, i) => [r[j], i] as const).filter(([c]) => !Number.isFinite(toNumber(c)));
    if (texts.length === 0) return null;
    if (texts.length < cellsRows.length) {
      // coluna misturada: número e texto juntos é erro de digitação, não rótulo
      const [c, i] = texts[0];
      throw new Error(`Linha ${lineNo(i)}, coluna "${headers[j]}": "${c}" não é um número (a coluna mistura números e texto).`);
    }
    const list = [...new Set(cellsRows.map((r) => r[j]))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    if (list.length > MAX_CLASSES)
      throw new Error(`A coluna "${headers[j]}" tem ${list.length} textos diferentes; o máximo de classes é ${MAX_CLASSES}.`);
    return list;
  });
  const rows = cellsRows.map((cells) => cells.map((c, j) => (classes[j] ? classes[j]!.indexOf(c) : toNumber(c))));
  return { headers, rows, classes };
}

/** Como cada coluna escolhida vira números para a rede. */
export function codingsFor(table: Table, cols: readonly number[]): ColumnCoding[] {
  return cols.map((c) => {
    const k = table.classes[c];
    return k ? { nome: table.headers[c], tipo: 'classe', classes: k } : { nome: table.headers[c], tipo: 'numero' };
  });
}

export interface ColumnSelection {
  inputs: number[];
  outputs: number[];
}

export interface Samples {
  inputs: number[][];
  targets: number[][];
}

export function selectColumns(table: Table, sel: ColumnSelection): Samples {
  if (sel.inputs.length === 0) throw new Error('Escolha ao menos uma coluna de entrada.');
  if (sel.outputs.length === 0) throw new Error('Escolha ao menos uma coluna de saída.');
  if (sel.inputs.some((c) => sel.outputs.includes(c)))
    throw new Error('Uma coluna não pode ser entrada e saída ao mesmo tempo.');
  const ci = codingsFor(table, sel.inputs);
  const co = codingsFor(table, sel.outputs);
  return {
    inputs: table.rows.map((r) => encode(ci, sel.inputs.map((c) => r[c]))),
    targets: table.rows.map((r) => encode(co, sel.outputs.map((c) => r[c]))),
  };
}

/** Verifica se os dados combinam com a arquitetura. Devolve a lista de problemas (vazia = ok). */
/** Quantas posições as colunas escolhidas ocupam (coluna de rótulos = uma por classe). */
export function selectionWidths(table: Table, sel: ColumnSelection): { inputs: number; outputs: number } {
  return { inputs: totalWidth(codingsFor(table, sel.inputs)), outputs: totalWidth(codingsFor(table, sel.outputs)) };
}

export function checkCompatibility(arch: Pick<Architecture, 'inputs' | 'layers'>, table: Table, sel: ColumnSelection): string[] {
  const problems: string[] = [];
  const outs = arch.layers[arch.layers.length - 1]?.neurons ?? 0;
  const w = selectionWidths(table, sel);
  const extra = (cols: number[]) => (cols.some((c) => table.classes[c]) ? ' (cada coluna de rótulos conta uma por classe)' : '');
  if (arch.inputs !== w.inputs)
    problems.push(`A rede tem ${arch.inputs} entradas e o dataset pede ${w.inputs}${extra(sel.inputs)}.`);
  if (outs !== w.outputs)
    problems.push(`A rede tem ${outs} saídas e o dataset pede ${w.outputs}${extra(sel.outputs)}.`);
  return problems;
}

export interface SplitPercent {
  treino: number;
  validacao: number;
  teste: number;
}

export interface Split {
  treino: Samples;
  validacao: Samples;
  teste: Samples;
  normalizacao: Normalization | null;
}

export function validatePercent(p: SplitPercent): void {
  const vals = [p.treino, p.validacao, p.teste];
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Os percentuais não podem ser negativos.');
  if (Math.abs(vals.reduce((a, b) => a + b, 0) - 100) > 1e-9)
    throw new Error(`Os percentuais somam ${vals.reduce((a, b) => a + b, 0)}%; precisam somar 100%.`);
  if (p.treino <= 0) throw new Error('O treinamento precisa de uma parte maior que 0%.');
}

/** Quantos exemplos vão para cada conjunto (arredondamento que preserva o total). */
export function splitSizes(n: number, p: SplitPercent): [number, number, number] {
  const treino = Math.round((n * p.treino) / 100);
  const validacao = Math.min(n - treino, Math.round((n * p.validacao) / 100));
  return [treino, validacao, n - treino - validacao];
}

/**
 * Divide aleatoriamente (com semente) em treino, validação e teste e, depois da divisão,
 * normaliza as entradas com parâmetros calculados só no treino.
 */
export function splitDataset(
  samples: Samples,
  percent: SplitPercent,
  seed: number,
  normalization: NormalizationName,
): Split {
  validatePercent(percent);
  const n = samples.inputs.length;
  const idx = new Random(seed).shuffle(Array.from({ length: n }, (_, i) => i));
  const [a, b] = splitSizes(n, percent);
  if (a === 0) throw new Error('Com esse percentual o treinamento ficou sem nenhum exemplo.');
  const pick = (ids: number[]): Samples => ({
    inputs: ids.map((i) => samples.inputs[i].slice()),
    targets: ids.map((i) => samples.targets[i].slice()),
  });
  const treino = pick(idx.slice(0, a));
  const validacao = pick(idx.slice(a, a + b));
  const teste = pick(idx.slice(a + b));
  const normalizacao = fitNormalization(normalization, treino.inputs);
  for (const s of [treino, validacao, teste]) s.inputs = normalizeRows(normalizacao, s.inputs);
  return { treino, validacao, teste, normalizacao };
}

/** Nomes e codificação das colunas escolhidas, guardados junto com a rede. */
export function modelMeta(table: Table, sel: ColumnSelection) {
  const entradas = codingsFor(table, sel.inputs);
  const saidas = codingsFor(table, sel.outputs);
  return {
    columns: { entradas: expandedNames(entradas), saidas: expandedNames(saidas) },
    codings: { entradas, saidas },
  };
}
