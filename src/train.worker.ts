/// <reference lib="webworker" />
/**
 * Roda o treinamento fora da thread da tela, para a interface não travar.
 * Recebe a rede (JSON) e os conjuntos já divididos/normalizados; devolve o MSE de cada época,
 * fotos dos pesos para o desenho e, no fim, a rede treinada e o MSE do teste.
 */
import type { Split } from './core/dataset';
import { accuracy } from './core/encoding';
import { mse } from './core/loss';
import { deserialize, serialize, type SavedModel } from './core/persistence';
import { Trainer, type EpochResult, type TrainOptions } from './core/trainer';

export type ToWorker =
  | { type: 'start'; model: SavedModel; split: Split; options: TrainOptions }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'surface'; id: number; a: WeightRef; b: WeightRef; xs: number[]; ys: number[] };

/** Um peso: camada, neurônio de destino e entrada. */
export interface WeightRef {
  layer: number;
  i: number;
  j: number;
}

export type FromWorker =
  | { type: 'epochs'; results: EpochResult[]; snapshot?: SavedModel }
  | { type: 'done'; model: SavedModel; testMSE: number; testAccuracy?: number; stopped: boolean; earlyStopped: boolean; bestEpoch: number; restored: boolean }
  | { type: 'error'; message: string }
  | { type: 'surface'; id: number; z: number[][] };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let trainer: Trainer | null = null;
/** A última rede treinada fica aqui depois do fim, para a superfície do erro. */
let lastNet: Trainer['net'] | null = null;
let split: Split | null = null;
let normalization: SavedModel['normalizacao'] = null;
let columns: SavedModel['colunas'];
let codings: SavedModel['codificacao'];

function acc(set: { inputs: number[][]; targets: number[][] }): number | undefined {
  if (!trainer || set.inputs.length === 0) return undefined;
  return accuracy(set.inputs.map((x) => trainer!.net.forward(x)), set.targets, codings?.saidas);
}
let paused = false;
let stopped = false;
let lastSnapshot = 0;

function finish(): void {
  if (!trainer || !split) return;
  // com a parada antecipada ligada, a rede volta para a melhor época da validação
  const restored = (trainer.options.patience ?? 0) > 0 ? trainer.restoreBest() : false;
  const testMSE = mse(trainer.net, split.teste.inputs, split.teste.targets);
  const testAccuracy = acc(split.teste);
  const model = serialize({ net: trainer.net, normalization, columns, codings });
  ctx.postMessage({ type: 'done', model, testMSE, testAccuracy, stopped, earlyStopped: trainer.stoppedEarly, bestEpoch: trainer.bestEpoch, restored } satisfies FromWorker);
  lastNet = trainer.net;
  trainer = null;
}

function loop(): void {
  if (!trainer || paused) return;
  try {
    const results: EpochResult[] = [];
    const start = performance.now();
    // roda épocas por até ~30 ms e devolve o lote, para a tela acompanhar sem ser inundada
    while (!trainer.done && !stopped && performance.now() - start < 30) {
      const r = trainer.step();
      results.push({ ...r, valAccuracy: split ? acc(split.validacao) : undefined });
    }
    const now = performance.now();
    const snapshot = now - lastSnapshot > 120 ? serialize({ net: trainer.net, normalization, columns, codings }) : undefined;
    if (snapshot) lastSnapshot = now;
    if (results.length || snapshot) ctx.postMessage({ type: 'epochs', results, snapshot } satisfies FromWorker);
    if (trainer.done || stopped) finish();
    else setTimeout(loop, 0);
  } catch (e) {
    trainer = null;
    ctx.postMessage({ type: 'error', message: (e as Error).message } satisfies FromWorker);
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'start') {
    try {
      const model = deserialize(msg.model);
      split = msg.split;
      normalization = msg.split.normalizacao;
      columns = msg.model.colunas;
      codings = msg.model.codificacao;
      trainer = new Trainer(model.net, split.treino, split.validacao, msg.options);
      lastNet = null;
      paused = false;
      stopped = false;
      lastSnapshot = 0;
      loop();
    } catch (e) {
      ctx.postMessage({ type: 'error', message: (e as Error).message } satisfies FromWorker);
    }
  } else if (msg.type === 'surface') {
    // MSE do treino com só dois pesos variando; os outros ficam como estão agora
    const net = trainer?.net ?? lastNet;
    if (!net || !split) return;
    const wa = net.layers[msg.a.layer].neurons[msg.a.i].weights;
    const wb = net.layers[msg.b.layer].neurons[msg.b.i].weights;
    const keepA = wa[msg.a.j];
    const keepB = wb[msg.b.j];
    const n = split.treino.inputs.length;
    const stepS = Math.max(1, Math.floor(n / 240));
    const xsIn = split.treino.inputs.filter((_, k) => k % stepS === 0);
    const ysT = split.treino.targets.filter((_, k) => k % stepS === 0);
    const z = msg.ys.map((vb) =>
      msg.xs.map((va) => {
        wa[msg.a.j] = va;
        wb[msg.b.j] = vb;
        return mse(net, xsIn, ysT);
      }),
    );
    wa[msg.a.j] = keepA;
    wb[msg.b.j] = keepB;
    ctx.postMessage({ type: 'surface', id: msg.id, z } satisfies FromWorker);
  } else if (msg.type === 'pause') paused = true;
  else if (msg.type === 'resume') {
    if (paused) {
      paused = false;
      loop();
    }
  } else if (msg.type === 'stop') {
    stopped = true;
    if (paused && trainer) finish();
  }
};
