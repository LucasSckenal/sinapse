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
  /**
   * Parada antecipada: para quando o MSE da validação passa `patience` épocas sem melhorar
   * e devolve a rede aos pesos da melhor época. 0 ou ausente = desligada.
   */
  patience?: number;
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
  if (o.epochs > MAX_EPOCHS) throw new Error(`O máximo é ${MAX_EPOCHS.toLocaleString('pt-BR')} épocas.`);
}

/** Acima disso o histórico fica grande demais para o gráfico acompanhar. */
export const MAX_EPOCHS = 100_000;

/** Treina passo a passo: cada chamada de `step()` roda uma época. Permite pausar e acompanhar. */
export class Trainer {
  private readonly rng: Random;
  private readonly order: number[];
  epoch = 0;
  /** Melhor época pela validação (para a parada antecipada) e os pesos dela. */
  bestEpoch = 0;
  bestValMSE = Infinity;
  stoppedEarly = false;
  private bestParams: { w: number[]; b: number }[][] | null = null;
  private sinceBest = 0;

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
    return this.stoppedEarly || this.epoch >= this.options.epochs;
  }

  private get watching(): boolean {
    return (this.options.patience ?? 0) > 0 && this.validation.inputs.length > 0;
  }

  /** Volta a rede para os pesos e vieses da melhor época da validação. */
  restoreBest(): boolean {
    if (!this.bestParams) return false;
    this.net.layers.forEach((l, li) =>
      l.neurons.forEach((n, ni) => {
        const p = this.bestParams![li][ni];
        n.weights = p.w.slice();
        n.bias = p.b;
      }),
    );
    return true;
  }

  step(): EpochResult {
    this.rng.shuffle(this.order);
    for (const i of this.order)
      this.net.trainExample(this.train.inputs[i], this.train.targets[i], this.options.learningRate);
    this.epoch++;
    const trainMSE = mse(this.net, this.train.inputs, this.train.targets);
    if (!Number.isFinite(trainMSE))
      throw new Error('O erro explodiu (ficou infinito). Tente uma taxa de aprendizado menor ou normalizar as entradas.');
    const valMSE = mse(this.net, this.validation.inputs, this.validation.targets);
    if (this.watching) {
      if (valMSE < this.bestValMSE - 1e-12) {
        this.bestValMSE = valMSE;
        this.bestEpoch = this.epoch;
        this.bestParams = this.net.layers.map((l) => l.neurons.map((n) => ({ w: n.weights.slice(), b: n.bias })));
        this.sinceBest = 0;
      } else if (++this.sinceBest >= (this.options.patience ?? 0)) this.stoppedEarly = true;
    }
    return { epoch: this.epoch, trainMSE, valMSE };
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
