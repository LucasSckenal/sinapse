import { mse } from './loss';
import type { Network } from './network';
import type { Samples } from './dataset';
import { Random } from './random';

/**
 * Treinamento com SGD (requisito 1.10): para cada exemplo do treino, propaga,
 * calcula os deltas e atualiza pesos e vieses. Ao fim de cada época calcula
 * o MSE do treino e da validação. A validação nunca altera a rede; o teste
 * fica guardado para a avaliação final.
 */
export interface TrainOptions {
  learningRate: number;
  epochs: number;
  /** Semente da ordem em que os exemplos são apresentados a cada época. */
  seed: number;
}

export interface EpochResult {
  epoch: number;
  trainMSE: number;
  valMSE: number;
  /** Taxa de acerto na validação, quando a saída é de classificação (calculada fora do núcleo). */
  valAccuracy?: number;
}

export function validateTrainOptions(o: TrainOptions): void {
  if (!(o.learningRate > 0) || !Number.isFinite(o.learningRate))
    throw new Error('A taxa de aprendizado precisa ser um número maior que 0.');
  if (!Number.isInteger(o.epochs) || o.epochs < 1) throw new Error('O número de épocas precisa ser inteiro e maior que 0.');
}

/** Treina passo a passo: cada chamada de `step()` roda uma época. Permite pausar e acompanhar. */
export class Trainer {
  private readonly rng: Random;
  private readonly order: number[];
  epoch = 0;

  constructor(
    readonly net: Network,
    readonly train: Samples,
    readonly validation: Samples,
    readonly options: TrainOptions,
  ) {
    validateTrainOptions(options);
    if (train.inputs.length === 0) throw new Error('O conjunto de treinamento está vazio.');
    this.rng = new Random(options.seed);
    this.order = train.inputs.map((_, i) => i);
  }

  get done(): boolean {
    return this.epoch >= this.options.epochs;
  }

  step(): EpochResult {
    this.rng.shuffle(this.order);
    for (const i of this.order)
      this.net.trainExample(this.train.inputs[i], this.train.targets[i], this.options.learningRate);
    this.epoch++;
    const trainMSE = mse(this.net, this.train.inputs, this.train.targets);
    if (!Number.isFinite(trainMSE))
      throw new Error('O erro explodiu (ficou infinito). Tente uma taxa de aprendizado menor ou normalizar as entradas.');
    return {
      epoch: this.epoch,
      trainMSE,
      valMSE: mse(this.net, this.validation.inputs, this.validation.targets),
    };
  }

  run(onEpoch?: (r: EpochResult) => void): EpochResult[] {
    const history: EpochResult[] = [];
    while (!this.done) {
      const r = this.step();
      history.push(r);
      onEpoch?.(r);
    }
    return history;
  }
}
