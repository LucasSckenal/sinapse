import { describe, expect, it } from 'vitest';
import { ACTIVATIONS, ACTIVATION_NAMES } from '../src/core/activations';
import { checkCompatibility, parseCSV, selectColumns, splitDataset } from '../src/core/dataset';
import { initFor, initStd } from '../src/core/initialization';
import { mse } from '../src/core/loss';
import { Network, type Architecture } from '../src/core/network';
import { fitNormalization } from '../src/core/normalization';
import { fromJSON, toJSON } from '../src/core/persistence';
import { predict } from '../src/core/predict';
import { Random } from '../src/core/random';
import { Trainer } from '../src/core/trainer';

const arch: Architecture = {
  inputs: 3,
  layers: [
    { neurons: 5, activation: 'tanh' },
    { neurons: 4, activation: 'relu' },
    { neurons: 2, activation: 'sigmoid' },
  ],
};

describe('funções de ativação', () => {
  it('derivadas batem com a derivada numérica', () => {
    for (const name of ACTIVATION_NAMES) {
      const a = ACTIVATIONS[name];
      for (const z of [-2.3, -0.7, 0.4, 1.9]) {
        const h = 1e-6;
        const num = (a.f(z + h) - a.f(z - h)) / (2 * h);
        expect(a.df(z, a.f(z))).toBeCloseTo(num, 5);
      }
    }
  });
});

describe('inicialização', () => {
  it('usa He na ReLU e Xavier nas outras', () => {
    expect(initFor('relu')).toBe('he');
    expect(initFor('tanh')).toBe('xavier');
    expect(initFor('sigmoid')).toBe('xavier');
    expect(initFor('linear')).toBe('xavier');
    expect(initStd('he', 50, 10)).toBeCloseTo(Math.sqrt(2 / 50));
    expect(initStd('xavier', 50, 10)).toBeCloseTo(Math.sqrt(2 / 60));
  });

  it('a mesma semente gera os mesmos pesos; outra semente, pesos diferentes', () => {
    const a = toJSON({ net: Network.create(arch, 42), normalization: null });
    const b = toJSON({ net: Network.create(arch, 42), normalization: null });
    const c = toJSON({ net: Network.create(arch, 43), normalization: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('desvio-padrão empírico próximo do esperado (He)', () => {
    const net = Network.create({ inputs: 400, layers: [{ neurons: 200, activation: 'relu' }] }, 1);
    const w = net.layers[0].neurons.flatMap((n) => n.weights);
    const mean = w.reduce((s, v) => s + v, 0) / w.length;
    const std = Math.sqrt(w.reduce((s, v) => s + (v - mean) ** 2, 0) / w.length);
    expect(Math.abs(mean)).toBeLessThan(0.005);
    expect(std).toBeCloseTo(Math.sqrt(2 / 400), 2);
  });
});

describe('propagação e retropropagação', () => {
  it('rejeita arquiteturas e entradas inválidas', () => {
    expect(() => Network.create({ inputs: 0, layers: [{ neurons: 1, activation: 'linear' }] }, 1)).toThrow();
    expect(() => Network.create({ inputs: 2, layers: [] }, 1)).toThrow();
    expect(() => Network.create(arch, 1).forward([1, 2])).toThrow(/3 entradas/);
  });

  it('funciona com qualquer número de camadas', () => {
    for (const depth of [1, 2, 5]) {
      const net = Network.create(
        { inputs: 2, layers: [...Array(depth - 1).fill({ neurons: 3, activation: 'tanh' }), { neurons: 4, activation: 'linear' }] },
        7,
      );
      expect(net.forward([0.3, -0.2])).toHaveLength(4);
    }
  });

  it('gradientes analíticos (δ·x) batem com o gradiente numérico', () => {
    // linear na saída para a checagem cobrir as quatro funções
    const net = Network.create(
      {
        inputs: 3,
        layers: [
          { neurons: 4, activation: 'tanh' },
          { neurons: 3, activation: 'sigmoid' },
          { neurons: 3, activation: 'relu' },
          { neurons: 2, activation: 'linear' },
        ],
      },
      11,
    );
    const x = [0.5, -1.2, 0.8];
    const t = [0.3, -0.4];
    const loss = () => 0.5 * net.forward(x).reduce((s, o, k) => s + (o - t[k]) ** 2, 0);
    net.forward(x);
    net.backward(t);
    const analytic = net.layers.map((l) => l.neurons.map((n) => ({ w: n.weights.map((_, j) => n.delta * l.inputs[j]), b: n.delta })));
    const h = 1e-6;
    net.layers.forEach((l, li) =>
      l.neurons.forEach((n, ni) => {
        n.weights.forEach((_, j) => {
          const old = n.weights[j];
          n.weights[j] = old + h;
          const up = loss();
          n.weights[j] = old - h;
          const down = loss();
          n.weights[j] = old;
          expect(analytic[li][ni].w[j]).toBeCloseTo((up - down) / (2 * h), 5);
        });
        const ob = n.bias;
        n.bias = ob + h;
        const up = loss();
        n.bias = ob - h;
        const down = loss();
        n.bias = ob;
        expect(analytic[li][ni].b).toBeCloseTo((up - down) / (2 * h), 5);
      }),
    );
  });

  it('calcula todos os deltas antes de atualizar (ocultas usam os pesos da propagação)', () => {
    const net = Network.create({ inputs: 2, layers: [{ neurons: 3, activation: 'tanh' }, { neurons: 1, activation: 'linear' }] }, 3);
    const x = [1, -1];
    const t = [2];
    net.forward(x);
    const outW = net.layers[1].neurons[0].weights.slice();
    net.backward(t);
    const dOut = net.layers[1].neurons[0].delta;
    const expected = net.layers[0].neurons.map((n, j) => outW[j] * dOut * (1 - n.output ** 2));
    net.update(0.1);
    net.layers[0].neurons.forEach((n, j) => expect(n.delta).toBeCloseTo(expected[j], 12));
  });

  it('aprende o XOR', () => {
    const net = Network.create({ inputs: 2, layers: [{ neurons: 4, activation: 'tanh' }, { neurons: 1, activation: 'sigmoid' }] }, 5);
    const X = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const Y = [[0], [1], [1], [0]];
    const before = mse(net, X, Y);
    new Trainer(net, { inputs: X, targets: Y }, { inputs: X, targets: Y }, { learningRate: 0.5, epochs: 2000, seed: 1 }).run();
    expect(mse(net, X, Y)).toBeLessThan(0.01);
    expect(mse(net, X, Y)).toBeLessThan(before);
    X.forEach((x, i) => expect(Math.round(net.forward(x)[0])).toBe(Y[i][0]));
  });

  it('MSE é a média sobre exemplos e saídas', () => {
    const net = Network.create({ inputs: 1, layers: [{ neurons: 2, activation: 'linear' }] }, 1);
    net.layers[0].neurons.forEach((n) => ((n.weights[0] = 1), (n.bias = 0)));
    // saídas = [x, x]; alvos = [x+1, x-3] → erros 1 e 9 → média 5
    expect(mse(net, [[2], [5]], [[3, -1], [6, 2]])).toBeCloseTo(5);
  });
});

describe('treinamento', () => {
  it('a validação não altera os pesos e o treino reporta MSE por época', () => {
    const rng = new Random(9);
    const X = Array.from({ length: 40 }, () => [rng.next() * 2 - 1]);
    const Y = X.map(([x]) => [Math.sin(3 * x)]);
    const net = Network.create({ inputs: 1, layers: [{ neurons: 8, activation: 'tanh' }, { neurons: 1, activation: 'linear' }] }, 2);
    const twin = Network.create(net.architecture, 2);
    const valA = { inputs: [[0.1]], targets: [[0]] };
    const valB = { inputs: [[0.9], [-0.4]], targets: [[5], [-5]] };
    const ha = new Trainer(net, { inputs: X, targets: Y }, valA, { learningRate: 0.05, epochs: 30, seed: 4 }).run();
    const hb = new Trainer(twin, { inputs: X, targets: Y }, valB, { learningRate: 0.05, epochs: 30, seed: 4 }).run();
    expect(ha).toHaveLength(30);
    expect(ha.map((h) => h.trainMSE)).toEqual(hb.map((h) => h.trainMSE));
    expect(ha[29].trainMSE).toBeLessThan(ha[0].trainMSE);
  });
});

describe('datasets', () => {
  const csv = 'a;b;y\n1;10;0\n2;20;1\n3;30;0\n4;40;1\n5;50;0\n6;60;1\n7;70;0\n8;80;1\n9;90;0\n10;100;1\n';

  it('lê CSV com cabeçalho e separador ponto e vírgula', () => {
    const t = parseCSV(csv);
    expect(t.headers).toEqual(['a', 'b', 'y']);
    expect(t.rows).toHaveLength(10);
  });

  it('acusa linha com texto ou colunas a mais', () => {
    expect(() => parseCSV('a,b\n1,2\n3,x\n')).toThrow(/"x" não é um número/);
    expect(() => parseCSV('a,b\n1,2\n3,4,5\n')).toThrow(/3 colunas/);
  });

  it('confere a compatibilidade com a arquitetura', () => {
    expect(checkCompatibility({ inputs: 2, layers: [{ neurons: 1, activation: 'sigmoid' }] }, { inputs: [0, 1], outputs: [2] })).toEqual([]);
    expect(checkCompatibility({ inputs: 3, layers: [{ neurons: 2, activation: 'sigmoid' }] }, { inputs: [0, 1], outputs: [2] })).toHaveLength(2);
  });

  it('divide com semente, soma 100% e normaliza só com o treino', () => {
    const s = selectColumns(parseCSV(csv), { inputs: [0, 1], outputs: [2] });
    const a = splitDataset(s, { treino: 60, validacao: 20, teste: 20 }, 3, 'minmax');
    const b = splitDataset(s, { treino: 60, validacao: 20, teste: 20 }, 3, 'minmax');
    expect(a).toEqual(b);
    expect([a.treino.inputs.length, a.validacao.inputs.length, a.teste.inputs.length]).toEqual([6, 2, 2]);
    expect(() => splitDataset(s, { treino: 60, validacao: 30, teste: 20 }, 3, 'nenhuma')).toThrow(/100%/);
    // os parâmetros vêm só do treino (desnormalizado)
    const raw = splitDataset(s, { treino: 60, validacao: 20, teste: 20 }, 3, 'nenhuma');
    expect(a.normalizacao).toEqual(fitNormalization('minmax', raw.treino.inputs));
    for (const row of a.treino.inputs) row.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    // saídas não normalizadas
    expect(a.treino.targets).toEqual(raw.treino.targets);
  });

  it('z-score do treino tem média 0 e desvio 1', () => {
    const s = selectColumns(parseCSV(csv), { inputs: [0], outputs: [2] });
    const z = splitDataset(s, { treino: 100, validacao: 0, teste: 0 }, 1, 'zscore');
    const v = z.treino.inputs.map((r) => r[0]);
    const mean = v.reduce((x, y) => x + y, 0) / v.length;
    expect(mean).toBeCloseTo(0);
    expect(Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / v.length)).toBeCloseTo(1);
  });
});

describe('persistência e previsão', () => {
  it('rede salva e carregada dá as mesmas saídas, com a normalização', () => {
    const net = Network.create(arch, 8);
    const normalization = fitNormalization('zscore', [[1, 2, 3], [4, 5, 9], [0, 1, 1]]);
    const model = { net, normalization, columns: { entradas: ['a', 'b', 'c'], saidas: ['p', 'q'] } };
    const loaded = fromJSON(toJSON(model));
    expect(loaded.net.architecture).toEqual(net.architecture);
    expect(loaded.normalization).toEqual(normalization);
    for (const x of [[1, 2, 3], [-5, 0.25, 7]]) expect(predict(loaded, x)).toEqual(predict(model, x));
  });

  it('a previsão valida a quantidade de entradas e não muda os pesos', () => {
    const model = { net: Network.create(arch, 8), normalization: null };
    const before = toJSON(model);
    expect(() => predict(model, [1, 2])).toThrow(/espera 3/);
    predict(model, [1, 2, 3]);
    expect(toJSON(model)).toBe(before);
  });

  it('recusa arquivo quebrado com mensagem clara', () => {
    expect(() => fromJSON('{')).toThrow(/JSON válido/);
    expect(() => fromJSON('{"formato":"outro"}')).toThrow(/não é uma rede/);
    const bad = JSON.parse(toJSON({ net: Network.create(arch, 1), normalization: null }));
    bad.camadas[1].pesos[0].pop();
    expect(() => fromJSON(JSON.stringify(bad))).toThrow(/esperava 5 pesos/);
  });
});
