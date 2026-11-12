import { checkCompatibility, selectColumns, splitDataset, validatePercent } from '../core/dataset';
import { deserialize, serialize, type SavedModel } from '../core/persistence';
import { validateTrainOptions } from '../core/trainer';
import type { FromWorker, ToWorker } from '../train.worker';
import { toast } from './dom';
import { set, state } from './state';

/** Liga a tela ao worker de treino. */
let worker: Worker | null = null;
const progressListeners = new Set<(snapshot?: SavedModel) => void>();

export function onProgress(fn: (snapshot?: SavedModel) => void): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

function post(msg: ToWorker): void {
  worker?.postMessage(msg);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../train.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    if (msg.type === 'epochs') {
      state.history.push(...msg.results);
      progressListeners.forEach((l) => l(msg.snapshot));
    } else if (msg.type === 'done') {
      const model = deserialize(msg.model);
      set({ model, modelTrained: true, status: 'fim', testMSE: msg.testMSE });
      progressListeners.forEach((l) => l(msg.model));
      toast(msg.stopped ? 'Treino parado. A rede ficou com os pesos atuais.' : 'Treino concluído');
    } else if (msg.type === 'error') {
      set({ status: 'erro', trainError: msg.message });
    }
  };
  worker.onerror = (e) => set({ status: 'erro', trainError: e.message || 'O treino parou com um erro inesperado.' });
  return worker;
}

/** Problemas que impedem começar o treino (lista vazia = pode treinar). */
export function trainBlockers(): string[] {
  if (!state.model) return ['Crie ou abra uma rede.'];
  if (!state.table) return ['Carregue um dataset na tela Dados.'];
  if (!state.selection.inputs.length || !state.selection.outputs.length) return ['Escolha as colunas de entrada e saída na tela Dados.'];
  const p = checkCompatibility(state.model.net.architecture, state.selection);
  if (p.length) return p;
  try {
    validatePercent(state.percent);
    validateTrainOptions({ learningRate: state.learningRate, epochs: state.epochs, seed: state.trainSeed });
  } catch (e) {
    return [(e as Error).message];
  }
  return [];
}

export function startTraining(): void {
  const blockers = trainBlockers();
  if (blockers.length || !state.model || !state.table) {
    toast(blockers[0], 'err');
    return;
  }
  try {
    const samples = selectColumns(state.table, state.selection);
    const split = splitDataset(samples, state.percent, state.splitSeed, state.normalization);
    const t = state.table;
    const columns = {
      entradas: state.selection.inputs.map((c) => t.headers[c]),
      saidas: state.selection.outputs.map((c) => t.headers[c]),
    };
    const model = serialize({ net: state.model.net, normalization: split.normalizacao, columns });
    set({
      status: 'rodando',
      history: [],
      testMSE: undefined,
      trainError: '',
      splitCounts: [split.treino.inputs.length, split.validacao.inputs.length, split.teste.inputs.length],
    });
    getWorker();
    post({ type: 'start', model, split, options: { learningRate: state.learningRate, epochs: state.epochs, seed: state.trainSeed } });
  } catch (e) {
    set({ status: 'erro', trainError: (e as Error).message });
  }
}

export function pauseTraining(): void {
  post({ type: 'pause' });
  set({ status: 'pausado' });
}

export function resumeTraining(): void {
  post({ type: 'resume' });
  set({ status: 'rodando' });
}

export function stopTraining(): void {
  post({ type: 'stop' });
}
