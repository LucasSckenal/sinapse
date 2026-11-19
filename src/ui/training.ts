import { checkCompatibility, codingsFor, modelMeta, numericFlags, selectColumns, splitDataset, validatePercent, type OutputPlan, type Split } from '../core/dataset';
import { deserialize, serialize, type SavedModel } from '../core/persistence';
import { validateTrainOptions } from '../core/trainer';
import type { FromWorker, ToWorker, WeightRef } from '../train.worker';
import { toast } from './dom';
import { NORMALIZATION_LABELS } from '../core/normalization';
import { architectureText, saveRuns, set, state, type Run } from './state';

/** Resumo desta execução para o histórico (usa o estado do treino que acabou de terminar). */
function makeRun(testMSE: number, acerto: number | undefined, bestEpoch: number): Run {
  const h = state.history;
  const at = bestEpoch > 0 ? h[bestEpoch - 1] : h[h.length - 1];
  const step = Math.max(1, Math.floor(h.length / 60));
  return {
    id: Date.now(),
    quando: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
    arquivo: state.fileName,
    arquitetura: state.model ? architectureText(state.model.net.architecture) : '',
    taxa: state.learningRate,
    epocas: state.epochs,
    feitas: h.length,
    melhorEpoca: bestEpoch,
    normalizacao: NORMALIZATION_LABELS[state.normalization],
    divisao: `${state.percent.treino}/${state.percent.validacao}/${state.percent.teste}`,
    treino: at?.trainMSE ?? NaN,
    validacao: at?.valMSE ?? NaN,
    teste: testMSE,
    acerto,
    curva: h.filter((_, i) => i % step === 0).map((r) => r.valMSE),
  };
}

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
      const runs = [makeRun(msg.testMSE, msg.testAccuracy, msg.bestEpoch), ...state.runs].slice(0, 30);
      saveRuns(runs);
      set({ model, modelTrained: true, status: 'fim', testMSE: msg.testMSE, testMSEOriginal: msg.testMSEOriginal, testAccuracy: msg.testAccuracy, bestEpoch: msg.bestEpoch, earlyStopped: msg.earlyStopped, runs });
      progressListeners.forEach((l) => l(msg.model));
      toast(
        msg.earlyStopped
          ? `Parada antecipada na época ${state.history.length}: a rede voltou à época ${msg.bestEpoch}, a melhor na validação.`
          : msg.restored
            ? `Treino concluído. A rede ficou com a época ${msg.bestEpoch}, a melhor na validação.`
            : msg.stopped
              ? 'Treino parado. A rede ficou com os pesos atuais.'
              : 'Treino concluído',
      );
    } else if (msg.type === 'error') {
      set({ status: 'erro', trainError: msg.message });
    }
  };
  worker.onerror = (e) => set({ status: 'erro', trainError: e.message || 'O treino parou com um erro inesperado.' });
  return worker;
}

/** Quais saídas são número (normalizam) e a ativação de cada neurônio de saída da rede atual. */
function outputPlan(): OutputPlan | undefined {
  if (!state.model || !state.table) return undefined;
  const last = state.model.net.layers[state.model.net.layers.length - 1];
  return {
    numeric: numericFlags(codingsFor(state.table, state.selection.outputs)),
    activations: last.neurons.map((n) => n.activation.name),
  };
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
    const split = splitDataset(samples, state.percent, state.splitSeed, state.normalization, outputPlan());
    const t = state.table;
    const model = serialize({ net: state.model.net, normalization: split.normalizacao, outputScaling: split.saidas, ...modelMeta(t, state.selection) });
    set({
      status: 'rodando',
      history: [],
      testMSE: undefined,
      testMSEOriginal: undefined,
      testAccuracy: undefined,
      trainError: '',
      splitCounts: [split.treino.inputs.length, split.validacao.inputs.length, split.teste.inputs.length],
    });
    currentSplit = split;
    track = [];
    recordTrack(model);
    getWorker();
    post({ type: 'start', model, split, options: { learningRate: state.learningRate, epochs: state.epochs, seed: state.trainSeed, patience: state.patience } });
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

/** Um passo do SGD feito à mão: o que aconteceu com um exemplo. */
export interface StepResult {
  index: number;
  x: number[];
  t: number[];
  o: number[];
  erro: number;
  /** por camada de pesos: z, saída e δ de cada neurônio */
  layers: { z: number[]; out: number[]; delta: number[]; activation: string[] }[];
  /** maiores mudanças de peso: camada, neurônio, entrada, antes, depois */
  changes: { layer: number; i: number; j: number; before: number; after: number }[];
  biasChanges: { layer: number; i: number; before: number; after: number }[];
  acts: number[][];
  deltas: number[][];
}

let stepOrder: number[] = [];
let stepPos = 0;

/**
 * Prepara a divisão (e a normalização) como o treino faria, sem treinar. A rede passa a usar
 * a normalização do treino. Devolve o erro, se houver.
 */
export function ensureSplit(): string | null {
  if (currentSplit) return null;
  const blockers = trainBlockers();
  if (blockers.length || !state.model || !state.table) return blockers[0] ?? 'Sem rede ou sem dados.';
  try {
    const split = splitDataset(selectColumns(state.table, state.selection), state.percent, state.splitSeed, state.normalization, outputPlan());
    currentSplit = split;
    state.model.normalization = split.normalizacao;
    state.model.outputScaling = split.saidas;
    Object.assign(state.model, modelMeta(state.table, state.selection));
    state.splitCounts = [split.treino.inputs.length, split.validacao.inputs.length, split.teste.inputs.length];
    stepOrder = [];
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Faz um passo do SGD com o próximo exemplo do treino e devolve todos os números. Muda os pesos de verdade. */
export function stepOnce(): StepResult | string {
  const err = ensureSplit();
  if (err) return err;
  const net = state.model!.net;
  const tr = currentSplit!.treino;
  if (stepPos >= stepOrder.length) {
    // nova "época" do passo a passo: ordem embaralhada como no SGD
    stepOrder = tr.inputs.map((_, i) => i);
    for (let i = stepOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [stepOrder[i], stepOrder[j]] = [stepOrder[j], stepOrder[i]];
    }
    stepPos = 0;
  }
  const k = stepOrder[stepPos++];
  const x = tr.inputs[k];
  const t = tr.targets[k];
  const before = net.layers.map((l) => l.neurons.map((n) => ({ w: n.weights.slice(), b: n.bias })));
  const o = net.forward(x);
  net.backward(t);
  const layers = net.layers.map((l) => ({
    z: l.neurons.map((n) => n.z),
    out: l.neurons.map((n) => n.output),
    delta: l.neurons.map((n) => n.delta),
    activation: l.neurons.map((n) => n.activation.label),
  }));
  const acts = [x.slice(), ...net.layers.map((l) => l.outputs())];
  const deltas = net.layers.map((l) => l.neurons.map((n) => n.delta));
  net.update(state.learningRate);
  const changes: StepResult['changes'] = [];
  const biasChanges: StepResult['biasChanges'] = [];
  net.layers.forEach((l, li) =>
    l.neurons.forEach((n, i) => {
      n.weights.forEach((w, p) => changes.push({ layer: li, i, j: n.sourceOf(p), before: before[li][i].w[p], after: w }));
      biasChanges.push({ layer: li, i, before: before[li][i].b, after: n.bias });
    }),
  );
  changes.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  biasChanges.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  return {
    index: k,
    x: x.slice(),
    t: t.slice(),
    o,
    erro: 0.5 * o.reduce((s2, v, i) => s2 + (v - t[i]) ** 2, 0),
    layers,
    changes: changes.slice(0, 6),
    biasChanges: biasChanges.slice(0, 3),
    acts,
    deltas,
  };
}
