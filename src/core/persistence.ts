import { getActivation, type ActivationName } from './activations';
import { validateCodings, type ColumnCoding } from './encoding';
import { Layer } from './layer';
import { Network, blocksOf, sourcesFor, validateArchitecture, type Architecture } from './network';
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
  /**
   * pesos[i][p] = peso do neurônio i para a sua p-ésima entrada. Numa camada comum, é a entrada p
   * da camada anterior; num bloco com `origem`, são as saídas dos blocos de origem, em ordem.
   */
  pesos: number[][];
  vieses: number[];
  /**
   * Opcional: blocos em paralelo, na ordem dos neurônios. `origem` = índices das entradas (1ª camada)
   * ou dos blocos da camada anterior de onde o bloco recebe; sem `origem`, recebe de tudo.
   */
  blocos?: { neuronios: number; ativacao: ActivationName; origem?: number[] }[];
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
  /** Como cada coluna do CSV virou números: "numero" passa direto, "classe" vira uma posição por classe. */
  codificacao?: { entradas: ColumnCoding[]; saidas: ColumnCoding[] };
}

export interface Model {
  net: Network;
  normalization: Normalization | null;
  columns?: { entradas: string[]; saidas: string[] };
  codings?: { entradas: ColumnCoding[]; saidas: ColumnCoding[] };
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
      ...(l.isParallel
        ? { blocos: l.blocks.map((b) => ({ neuronios: b.neurons, ativacao: b.activation, ...(b.from ? { origem: b.from.slice() } : {}) })) }
        : {}),
    })),
    normalizacao: model.normalization,
    ...(model.columns ? { colunas: model.columns } : {}),
    ...(model.codings ? { codificacao: model.codings } : {}),
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
  // reconstrói a arquitetura (com os blocos) para saber de onde cada neurônio recebe
  const arch: Architecture = {
    inputs: d.entradas as number,
    layers: d.camadas.map((c, i) => {
      if (Array.isArray(c.blocos) && c.blocos.length) {
        const blocks = c.blocos.map((b) => ({
          neurons: b.neuronios,
          activation: b.ativacao,
          ...(Array.isArray(b.origem) ? { from: b.origem.slice() } : {}),
        }));
        const total = blocks.reduce((s, b) => s + b.neurons, 0);
        if (total !== c.neuronios) throw new Error(`Camada ${i + 1}: os blocos somam ${total} neurônios, mas a camada tem ${c.neuronios}.`);
        return { neurons: c.neuronios, activation: blocks[0].activation, blocks };
      }
      return { neurons: c.neuronios, activation: c.ativacao };
    }),
  };
  validateArchitecture(arch);
  let fanIn = d.entradas as number;
  const layers = d.camadas.map((c, i) => {
    const where = `Camada ${i + 1}`;
    if (!Array.isArray(c.pesos) || !Array.isArray(c.vieses) || c.pesos.length !== c.neuronios || c.vieses.length !== c.neuronios)
      throw new Error(`${where}: o número de pesos ou vieses não bate com ${c.neuronios} neurônios.`);
    const spec = arch.layers[i];
    const neurons: Neuron[] = [];
    let j = 0;
    for (const b of blocksOf(spec)) {
      const sources = sourcesFor(b, i, arch);
      const need = sources ? sources.length : fanIn;
      const act = getActivation(b.activation);
      for (let k = 0; k < b.neurons; k++, j++) {
        const w = c.pesos[j];
        if (!Array.isArray(w) || w.length !== need || !w.every(isNum))
          throw new Error(`${where}, neurônio ${j + 1}: esperava ${need} pesos numéricos.`);
        if (!isNum(c.vieses[j])) throw new Error(`${where}, neurônio ${j + 1}: viés inválido.`);
        neurons.push(new Neuron(w.slice(), c.vieses[j], act, sources));
      }
    }
    fanIn = c.neuronios;
    return new Layer(neurons, spec.blocks);
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
  const codings = d.codificacao
    ? {
        entradas: validateCodings(d.codificacao.entradas, net.inputCount, 'entradas'),
        saidas: validateCodings(d.codificacao.saidas, net.outputCount, 'saídas'),
      }
    : undefined;
  return { net, normalization: validateNormalization(d.normalizacao, net.inputCount), columns, codings };
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
