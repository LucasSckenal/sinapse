import { getActivation, type ActivationName } from './activations';
import { Layer } from './layer';
import { Network } from './network';
import { Neuron } from './neuron';
import { validateNormalization, type Normalization } from './normalization';

/**
 * Persistência em JSON (requisito 1.11). O formato está documentado no README.
 */
export const FORMAT = 'sinapse-mlp';
export const FORMAT_VERSION = 1;

export interface SavedLayer {
  neuronios: number;
  ativacao: ActivationName;
  /** pesos[i][j] = peso do neurônio i para a entrada j. */
  pesos: number[][];
  vieses: number[];
}

export interface SavedModel {
  formato: typeof FORMAT;
  versao: number;
  entradas: number;
  quantidadeCamadas: number;
  camadas: SavedLayer[];
  normalizacao: Normalization | null;
  /** Nomes das colunas, só para a interface rotular os campos. */
  colunas?: { entradas: string[]; saidas: string[] };
}

export interface Model {
  net: Network;
  normalization: Normalization | null;
  columns?: { entradas: string[]; saidas: string[] };
}

export function serialize(model: Model): SavedModel {
  return {
    formato: FORMAT,
    versao: FORMAT_VERSION,
    entradas: model.net.inputCount,
    quantidadeCamadas: model.net.layers.length,
    camadas: model.net.layers.map((l) => ({
      neuronios: l.size,
      ativacao: l.activation.name,
      pesos: l.neurons.map((n) => n.weights.slice()),
      vieses: l.neurons.map((n) => n.bias),
    })),
    normalizacao: model.normalization,
    ...(model.columns ? { colunas: model.columns } : {}),
  };
}

export function toJSON(model: Model): string {
  return JSON.stringify(serialize(model), null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function deserialize(data: unknown): Model {
  const d = data as Partial<SavedModel>;
  if (!d || typeof d !== 'object' || d.formato !== FORMAT)
    throw new Error('Este arquivo não é uma rede salva pelo Sinapse.');
  if (d.versao !== FORMAT_VERSION) throw new Error(`Versão do arquivo não suportada: ${d.versao}.`);
  if (!Number.isInteger(d.entradas) || (d.entradas as number) < 1) throw new Error('Quantidade de entradas inválida.');
  if (!Array.isArray(d.camadas) || d.camadas.length === 0) throw new Error('O arquivo não tem camadas.');
  let fanIn = d.entradas as number;
  const layers = d.camadas.map((c, i) => {
    const where = `Camada ${i + 1}`;
    getActivation(c.ativacao);
    if (!Array.isArray(c.pesos) || !Array.isArray(c.vieses) || c.pesos.length !== c.neuronios || c.vieses.length !== c.neuronios)
      throw new Error(`${where}: o número de pesos ou vieses não bate com ${c.neuronios} neurônios.`);
    const neurons = c.pesos.map((w, j) => {
      if (!Array.isArray(w) || w.length !== fanIn || !w.every(isNum))
        throw new Error(`${where}, neurônio ${j + 1}: esperava ${fanIn} pesos numéricos.`);
      if (!isNum(c.vieses[j])) throw new Error(`${where}, neurônio ${j + 1}: viés inválido.`);
      return new Neuron(w.slice(), c.vieses[j]);
    });
    fanIn = c.neuronios;
    return new Layer(neurons, c.ativacao);
  });
  const net = new Network(d.entradas as number, layers);
  const columns =
    d.colunas &&
    Array.isArray(d.colunas.entradas) &&
    Array.isArray(d.colunas.saidas) &&
    d.colunas.entradas.length === net.inputCount &&
    d.colunas.saidas.length === net.outputCount
      ? d.colunas
      : undefined;
  return { net, normalization: validateNormalization(d.normalizacao, net.inputCount), columns };
}

export function fromJSON(text: string): Model {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  return deserialize(data);
}
