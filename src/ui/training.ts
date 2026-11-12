import { checkCompatibility, modelMeta, selectColumns, splitDataset, validatePercent, type Split } from '../core/dataset';
import { deserialize, serialize, type SavedModel } from '../core/persistence';
import { validateTrainOptions } from '../core/trainer';
import type { FromWorker, ToWorker, WeightRef } from '../train.worker';
import { toast } from './dom';
import { set, state } from './state';

/** Liga a tela ao worker de treino. */
let worker: Worker | null = null;

/** Divisão usada no treino atual (os exemplos que passam pela rede 3D vêm daqui). */
export let currentSplit: Split | null = null;

/** Fotos dos pesos ao longo do treino (todos os pesos em fila), para o caminho na superfície. */
const MAX_TRACK = 6000;
let track: Float32Array[] = [];
function flatWeights(m: SavedModel): Float32Array | null {
  const total = m.camadas.reduce((s, c) => s + c.pesos.reduce((x, w) => x + w.length, 0), 0);
  if (total > MAX_TRACK) return null;
  const out = new Float32Array(total);
  let p = 0;
  for (const c of m.camadas) for (const w of c.pesos) for (const v of w) out[p++] = v;
  return out;
}
function recordTrack(m: SavedModel): void {
  const f = flatWeights(m);
  if (!f) return;
  track.push(f);
  if (track.length > 400) track = track.filter((_, i) => i % 2 === 0 || i === track.length - 1);
}
function refOf(m: SavedModel, flat: number): WeightRef {
  let p = flat;
  for (let l = 0; l < m.camadas.length; l++)
    for (let i = 0; i < m.camadas[l].pesos.length; i++) {
      const n = m.camadas[l].pesos[i].length;
      if (p < n) return { layer: l, i, j: p };
      p -= n;
    }
  return { layer: 0, i: 0, j: 0 };
}

let surfaceId = 0;
const surfaceWaiters = new Map<number, (z: number[][]) => void>();

export interface SurfaceResult {
  xs: number[];
  ys: number[];
  z: number[][];
  path: [number, number][];
  a: WeightRef;
  b: WeightRef;
}

/**
 * Pede ao worker o MSE do treino variando os dois pesos que mais andaram desde o começo.
 * Devolve null se não há treino ou se a rede é grande demais para guardar o caminho.
 */
export function requestSurface(current: SavedModel, n = 34): Promise<SurfaceResult> | null {
  if (!worker || track.length < 2) return null;
  const first = track[0];
  const last = flatWeights(current);
  if (!last) return null;
  const moved = Array.from(last, (v, k) => ({ k, d: Math.abs(v - first[k]) })).sort((x, y) => y.d - x.d);
  const ka = moved[0].k;
  const kb = moved.find((m) => m.k !== ka)?.k ?? ka;
  const a = refOf(current, ka);
  const b = refOf(current, kb);
  const path: [number, number][] = [...track.map((t) => [t[ka], t[kb]] as [number, number]), [last[ka], last[kb]]];
  const span = (vals: number[]): [number, number] => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(0.25, (hi - lo) * 0.45);
    return [lo - pad, hi + pad];
  };
  const [x0, x1] = span(path.map((p) => p[0]));
  const [y0, y1] = span(path.map((p) => p[1]));
  const xs = Array.from({ length: n }, (_, i) => x0 + (i / (n - 1)) * (x1 - x0));
  const ys = Array.from({ length: n }, (_, i) => y0 + (i / (n - 1)) * (y1 - y0));
  const id = ++surfaceId;
  post({ type: 'surface', id, a, b, xs, ys });
  return new Promise((resolve) => surfaceWaiters.set(id, (z) => resolve({ xs, ys, z, path, a, b })));
}
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
    if (msg.type === 'surface') {
      surfaceWaiters.get(msg.id)?.(msg.z);
      surfaceWaiters.delete(msg.id);
      return;
    }
    if (msg.type === 'epochs') {
      state.history.push(...msg.results);
      if (msg.snapshot) recordTrack(msg.snapshot);
      progressListeners.forEach((l) => l(msg.snapshot));
    } else if (msg.type === 'done') {
      const model = deserialize(msg.model);
      recordTrack(msg.model);
      set({ model, modelTrained: true, status: 'fim', testMSE: msg.testMSE, testAccuracy: msg.testAccuracy });
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
  const p = checkCompatibility(state.model.net.architecture, state.table, state.selection);
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
    const model = serialize({ net: state.model.net, normalization: split.normalizacao, ...modelMeta(t, state.selection) });
    set({
      status: 'rodando',
      history: [],
      testMSE: undefined,
      testAccuracy: undefined,
      trainError: '',
      splitCounts: [split.treino.inputs.length, split.validacao.inputs.length, split.teste.inputs.length],
    });
    currentSplit = split;
    track = [];
    recordTrack(model);
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
