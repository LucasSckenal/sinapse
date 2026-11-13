import type { ActivationName } from '../core/activations';
import type { ColumnSelection, SplitPercent, Table } from '../core/dataset';
import type { Architecture } from '../core/network';
import type { NormalizationName } from '../core/normalization';
import type { Model } from '../core/persistence';
import type { EpochResult } from '../core/trainer';

export type ScreenName = 'dados' | 'arquitetura' | 'treino' | 'prever' | 'lab';

export type TrainStatus = 'parado' | 'rodando' | 'pausado' | 'fim' | 'erro';

/** Uma execução de treino, guardada para comparar. */
export interface Run {
  id: number;
  quando: string;
  arquivo: string;
  arquitetura: string;
  taxa: number;
  epocas: number;
  feitas: number;
  melhorEpoca: number;
  normalizacao: string;
  divisao: string;
  treino: number;
  validacao: number;
  teste: number;
  acerto?: number;
  /** MSE da validação ao longo das épocas (reduzido), para o desenho pequeno. */
  curva: number[];
}

const RUNS_KEY = 'sinapse.execucoes';
function loadRuns(): Run[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    const list = raw ? (JSON.parse(raw) as Run[]) : [];
    return Array.isArray(list) ? list.slice(0, 30) : [];
  } catch {
    return [];
  }
}
export function saveRuns(runs: Run[]): void {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, 30)));
  } catch {
    /* sem armazenamento: o histórico vale só nesta aba */
  }
}

export interface State {
  screen: ScreenName;
  // dados
  table: Table | null;
  fileName: string;
  selection: ColumnSelection;
  percent: SplitPercent;
  splitSeed: number;
  normalization: NormalizationName;
  // arquitetura
  arch: Architecture;
  initSeed: number;
  // rede atual
  model: Model | null;
  modelName: string;
  modelTrained: boolean;
  // treino
  learningRate: number;
  epochs: number;
  trainSeed: number;
  status: TrainStatus;
  history: EpochResult[];
  testMSE: number | undefined;
  testAccuracy: number | undefined;
  /** Parada antecipada: épocas sem melhorar na validação antes de parar (0 = desligada). */
  patience: number;
  bestEpoch: number;
  earlyStopped: boolean;
  /** Execuções anteriores, para comparar. */
  runs: Run[];
  splitCounts: [number, number, number] | null;
  trainError: string;
}

export const DEFAULT_HIDDEN: ActivationName = 'tanh';

export const state: State = {
  screen: 'dados',
  table: null,
  fileName: '',
  selection: { inputs: [], outputs: [] },
  percent: { treino: 70, validacao: 15, teste: 15 },
  splitSeed: 42,
  normalization: 'minmax',
  arch: { inputs: 2, layers: [{ neurons: 4, activation: DEFAULT_HIDDEN }, { neurons: 1, activation: 'sigmoid' }] },
  initSeed: 42,
  model: null,
  modelName: '',
  modelTrained: false,
  learningRate: 0.05,
  epochs: 300,
  trainSeed: 42,
  status: 'parado',
  history: [],
  testMSE: undefined,
  testAccuracy: undefined,
  patience: 0,
  bestEpoch: 0,
  earlyStopped: false,
  runs: loadRuns(),
  splitCounts: null,
  trainError: '',
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Muda o estado e redesenha a tela. */
export function set(patch: Partial<State>): void {
  Object.assign(state, patch);
  listeners.forEach((l) => l());
}

/** Limpa o histórico do treino. Com um treino rodando não mexe em nada: a mudança vale no próximo. */
export function resetTraining(): Partial<State> {
  if (state.status === 'rodando' || state.status === 'pausado') return {};
  return { status: 'parado', history: [], testMSE: undefined, testAccuracy: undefined, bestEpoch: 0, earlyStopped: false, splitCounts: null, trainError: '' };
}

export function architectureText(arch: Architecture): string {
  return [
    String(arch.inputs),
    ...arch.layers.map((l) => (l.blocks && l.blocks.length > 1 ? `[${l.blocks.map((b) => `${b.neurons} ${b.activation}`).join(' ‖ ')}]` : `${l.neurons} ${l.activation}`)),
  ].join(' → ');
}
