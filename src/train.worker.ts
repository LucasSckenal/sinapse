/// <reference lib="webworker" />
/**
 * Roda o treinamento fora da thread da tela, para a interface não travar.
 * Recebe a rede (JSON) e os conjuntos já divididos/normalizados; devolve o MSE de cada época,
 * fotos dos pesos para o desenho e, no fim, a rede treinada e o MSE do teste.
 */
import type { Split } from './core/dataset';
import { mse } from './core/loss';
import { deserialize, serialize, type SavedModel } from './core/persistence';
import { Trainer, type EpochResult, type TrainOptions } from './core/trainer';

export type ToWorker =
  | { type: 'start'; model: SavedModel; split: Split; options: TrainOptions }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'epochs'; results: EpochResult[]; snapshot?: SavedModel }
  | { type: 'done'; model: SavedModel; testMSE: number; stopped: boolean }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let trainer: Trainer | null = null;
let split: Split | null = null;
let normalization: SavedModel['normalizacao'] = null;
let columns: SavedModel['colunas'];
let paused = false;
let stopped = false;
let lastSnapshot = 0;

function finish(): void {
  if (!trainer || !split) return;
  const testMSE = mse(trainer.net, split.teste.inputs, split.teste.targets);
  const model = serialize({ net: trainer.net, normalization, columns });
  ctx.postMessage({ type: 'done', model, testMSE, stopped } satisfies FromWorker);
  trainer = null;
}

function loop(): void {
  if (!trainer || paused) return;
  try {
    const results: EpochResult[] = [];
    const start = performance.now();
    // roda épocas por até ~30 ms e devolve o lote, para a tela acompanhar sem ser inundada
    while (!trainer.done && !stopped && performance.now() - start < 30) results.push(trainer.step());
    const now = performance.now();
    const snapshot = now - lastSnapshot > 120 ? serialize({ net: trainer.net, normalization, columns }) : undefined;
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
      trainer = new Trainer(model.net, split.treino, split.validacao, msg.options);
      paused = false;
      stopped = false;
      lastSnapshot = 0;
      loop();
    } catch (e) {
      ctx.postMessage({ type: 'error', message: (e as Error).message } satisfies FromWorker);
    }
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
