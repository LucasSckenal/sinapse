import type { ActivationName } from '../core/activations';
import type { ColumnSelection, SplitPercent, Table } from '../core/dataset';
import type { Architecture } from '../core/network';
import type { NormalizationName } from '../core/normalization';
import type { Model } from '../core/persistence';
import type { EpochResult } from '../core/trainer';

export type ScreenName = 'dados' | 'arquitetura' | 'treino' | 'prever';

export type TrainStatus = 'parado' | 'rodando' | 'pausado' | 'fim' | 'erro';

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

export function resetTraining(): Partial<State> {
  return { status: 'parado', history: [], testMSE: undefined, splitCounts: null, trainError: '' };
}

export function architectureText(arch: Architecture): string {
  return [String(arch.inputs), ...arch.layers.map((l) => `${l.neurons} ${l.activation}`)].join(' → ');
}
