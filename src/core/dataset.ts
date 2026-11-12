import type { Architecture } from './network';
import { fitNormalization, normalizeRows, type Normalization, type NormalizationName } from './normalization';
import { Random } from './random';

/**
 * Leitura e preparação de datasets (requisito 1.9).
 * O CSV chega limpo; aqui só lemos, separamos colunas, dividimos e (opcionalmente) normalizamos.
 */
export interface Table {
  headers: string[];
  rows: number[][];
}

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

/** Lê um CSV numérico. Se a primeira linha não for numérica, vira o cabeçalho. */
export function parseCSV(text: string): Table {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('O arquivo está vazio.');
  const sep = detectSeparator(lines[0]);
  const first = splitLine(lines[0], sep);
  const hasHeader = first.some((c) => Number.isNaN(toNumber(c)));
  const headers = hasHeader ? first.map((h, i) => h || `coluna ${i + 1}`) : first.map((_, i) => `coluna ${i + 1}`);
  const body = hasHeader ? lines.slice(1) : lines;
  if (body.length === 0) throw new Error('O arquivo só tem o cabeçalho, sem nenhuma linha de dados.');
  const rows = body.map((line, i) => {
    const cells = splitLine(line, sep);
    if (cells.length !== headers.length)
      throw new Error(`Linha ${i + (hasHeader ? 2 : 1)}: tem ${cells.length} colunas, o esperado era ${headers.length}.`);
    return cells.map((c, j) => {
      const v = toNumber(c);
      if (!Number.isFinite(v))
        throw new Error(`Linha ${i + (hasHeader ? 2 : 1)}, coluna "${headers[j]}": "${c}" não é um número.`);
      return v;
    });
  });
  return { headers, rows };
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
  return {
    inputs: table.rows.map((r) => sel.inputs.map((c) => r[c])),
    targets: table.rows.map((r) => sel.outputs.map((c) => r[c])),
  };
}

/** Verifica se os dados combinam com a arquitetura. Devolve a lista de problemas (vazia = ok). */
export function checkCompatibility(arch: Pick<Architecture, 'inputs' | 'layers'>, sel: ColumnSelection): string[] {
  const problems: string[] = [];
  const outs = arch.layers[arch.layers.length - 1]?.neurons ?? 0;
  if (arch.inputs !== sel.inputs.length)
    problems.push(`A rede tem ${arch.inputs} entradas e o dataset tem ${sel.inputs.length} colunas de entrada.`);
  if (outs !== sel.outputs.length)
    problems.push(`A rede tem ${outs} saídas e o dataset tem ${sel.outputs.length} colunas de saída.`);
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
