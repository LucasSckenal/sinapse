import { describe, expect, it } from 'vitest';
import { ACTIVATIONS, ACTIVATION_NAMES } from '../src/core/activations';
import { checkCompatibility, codingsFor, parseCSV, selectColumns, selectionWidths, splitDataset } from '../src/core/dataset';
import { accuracy, confusionMatrix, decode, type ColumnCoding } from '../src/core/encoding';
import { initFor, initStd } from '../src/core/initialization';
import { mse } from '../src/core/loss';
import { Network, withBlocks, type Architecture } from '../src/core/network';
import { fitNormalization } from '../src/core/normalization';
import { fromJSON, toJSON } from '../src/core/persistence';
import { predict, predictColumns } from '../src/core/predict';
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

  it('lê CSV com \r, ponto e vírgula e vírgula decimal (formato do Excel em português)', () => {
    const t = parseCSV('comp;larg;especie\r5,1;3,5;setosa\r7,0;3,2;versicolor\r6,3;3,3;virginica\r');
    expect(t.headers).toEqual(['comp', 'larg', 'especie']);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0][0]).toBeCloseTo(5.1);
    expect(t.classes[0]).toBeNull();
    expect(t.classes[2]).toEqual(['setosa', 'versicolor', 'virginica']);
    const tab = parseCSV('a\tb\n1,5\t2\n3\t4,25\n');
    expect(tab.rows[1][1]).toBeCloseTo(4.25);
    // com vírgula como separador, a vírgula não é decimal
    expect(parseCSV('a,b\n1.5,2\n').rows[0]).toEqual([1.5, 2]);
  });

  it('lê ponto de milhar do Excel em português quando o separador é ;', () => {
    const t = parseCSV('renda;idade\n1.234,5;30\n12.345.678;41\n1.5;2,25\n');
    expect(t.rows[0][0]).toBeCloseTo(1234.5);
    expect(t.rows[1][0]).toBe(12345678);
    expect(t.rows[2]).toEqual([1.5, 2.25]); // um ponto só, sem vírgula: é decimal
  });

  it('acusa linha com texto ou colunas a mais', () => {
    expect(() => parseCSV('a,b\n1,2\n3,x\n')).toThrow(/"x" não é um número/);
    expect(() => parseCSV('a,b\n1,2\n3,4,5\n')).toThrow(/3 colunas/);
    expect(() => parseCSV('a,b\n1,2\n3,\n')).toThrow(/vazia/);
  });

  it('coluna de texto vira classes (one-hot) e conta uma saída por classe', () => {
    const t = parseCSV('x;y;especie\n1;2;setosa\n3;4;virginica\n5;6;setosa\n7;8;versicolor\n');
    expect(t.classes[2]).toEqual(['setosa', 'versicolor', 'virginica']);
    expect(t.rows[1][2]).toBe(2);
    const s = selectColumns(t, { inputs: [0, 1], outputs: [2] });
    expect(s.targets[0]).toEqual([1, 0, 0]);
    expect(s.targets[3]).toEqual([0, 1, 0]);
    expect(selectionWidths(t, { inputs: [0, 1], outputs: [2] })).toEqual({ inputs: 2, outputs: 3 });
    expect(checkCompatibility({ inputs: 2, layers: [{ neurons: 1, activation: 'sigmoid' }] }, t, { inputs: [0, 1], outputs: [2] })[0]).toMatch(/pede 3/);
    // texto também pode ser entrada
    expect(selectColumns(t, { inputs: [2], outputs: [0] }).inputs[3]).toEqual([0, 1, 0]);
  });

  it('decodifica a classe vencedora e mede a taxa de acerto', () => {
    const codings: ColumnCoding[] = [{ nome: 'especie', tipo: 'classe', classes: ['a', 'b', 'c'] }];
    const d = decode(codings, [0.1, 0.7, 0.2])[0];
    expect(d.tipo === 'classe' && d.classe).toBe('b');
    expect(accuracy([[0.1, 0.7, 0.2], [0.9, 0.05, 0.05]], [[0, 1, 0], [0, 0, 1]], codings)).toBe(0.5);
    expect(accuracy([[0.8], [0.3]], [[1], [1]], undefined)).toBe(0.5);
    expect(accuracy([[0.8]], [[0.37]], undefined)).toBeUndefined();
  });

  it('rede com rótulos salva e abre com as classes e prevê pelo nome', () => {
    const t = parseCSV('x;especie\n0;a\n1;b\n');
    const codings = { entradas: codingsFor(t, [0]), saidas: codingsFor(t, [1]) };
    const model = { net: Network.create({ inputs: 1, layers: [{ neurons: 2, activation: 'sigmoid' }] }, 1), normalization: null, codings };
    const loaded = fromJSON(toJSON(model));
    expect(loaded.codings).toEqual(codings);
    const r = predictColumns(loaded, [1]);
    expect(r.decoded[0].tipo).toBe('classe');
    expect(predictColumns(model, [1]).raw).toEqual(r.raw);
    const bad = JSON.parse(toJSON(model));
    bad.codificacao.saidas[0].classes.push('c');
    expect(() => fromJSON(JSON.stringify(bad))).toThrow(/soma 3 posições/);
  });

  it('confere a compatibilidade com a arquitetura', () => {
    const t = parseCSV(csv);
    expect(checkCompatibility({ inputs: 2, layers: [{ neurons: 1, activation: 'sigmoid' }] }, t, { inputs: [0, 1], outputs: [2] })).toEqual([]);
    expect(checkCompatibility({ inputs: 3, layers: [{ neurons: 2, activation: 'sigmoid' }] }, t, { inputs: [0, 1], outputs: [2] })).toHaveLength(2);
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

describe('blocos em paralelo', () => {
  const parallel: Architecture = {
    inputs: 4,
    layers: [
      withBlocks([
        { neurons: 3, activation: 'tanh', from: [0, 1] },
        { neurons: 2, activation: 'relu', from: [2, 3] },
      ]),
      withBlocks([
        { neurons: 2, activation: 'sigmoid', from: [0] },
        { neurons: 2, activation: 'linear' },
      ]),
      { neurons: 2, activation: 'linear' },
    ],
  };

  it('cada bloco só recebe das origens escolhidas', () => {
    const net = Network.create(parallel, 3);
    expect(net.layers[0].neurons[0].sources).toEqual([0, 1]);
    expect(net.layers[0].neurons[0].weights).toHaveLength(2);
    expect(net.layers[0].neurons[4].sources).toEqual([2, 3]);
    // bloco 0 da camada 2 recebe só do bloco A (neurônios 0..2)
    expect(net.layers[1].neurons[0].sources).toEqual([0, 1, 2]);
    expect(net.layers[1].neurons[3].sources).toBeNull();
    // mudar uma entrada que o bloco A não usa não muda a saída dele
    net.forward([0.3, -0.4, 1, 1]);
    const a = net.layers[0].outputs().slice(0, 3);
    net.forward([0.3, -0.4, -5, 9]);
    expect(net.layers[0].outputs().slice(0, 3)).toEqual(a);
    expect(net.architecture).toEqual(parallel);
  });

  it('gradientes com blocos batem com o gradiente numérico', () => {
    const net = Network.create(parallel, 5);
    const x = [0.5, -1.2, 0.8, 0.3];
    const t = [0.2, -0.6];
    const loss = () => 0.5 * net.forward(x).reduce((s, o, k) => s + (o - t[k]) ** 2, 0);
    net.forward(x);
    net.backward(t);
    const analytic = net.layers.map((l) => l.neurons.map((n) => n.weights.map((_, p) => n.delta * l.inputs[n.sourceOf(p)])));
    const h = 1e-6;
    net.layers.forEach((l, li) =>
      l.neurons.forEach((n, ni) =>
        n.weights.forEach((_, p) => {
          const old = n.weights[p];
          n.weights[p] = old + h;
          const up = loss();
          n.weights[p] = old - h;
          const down = loss();
          n.weights[p] = old;
          expect(analytic[li][ni][p]).toBeCloseTo((up - down) / (2 * h), 5);
        }),
      ),
    );
  });

  it('salva e abre com os blocos e dá as mesmas saídas', () => {
    const model = { net: Network.create(parallel, 9), normalization: null };
    const loaded = fromJSON(toJSON(model));
    expect(loaded.net.architecture).toEqual(parallel);
    expect(predict(loaded, [1, 2, 3, 4])).toEqual(predict(model, [1, 2, 3, 4]));
    const bad = JSON.parse(toJSON(model));
    bad.camadas[0].blocos[0].origem = [0, 7];
    expect(() => fromJSON(JSON.stringify(bad))).toThrow(/não existe/);
  });

  it('recusa bloco sem origem e aprende XOR com dois blocos', () => {
    expect(() => Network.create({ inputs: 2, layers: [withBlocks([{ neurons: 2, activation: 'tanh', from: [] }, { neurons: 1, activation: 'tanh' }]), { neurons: 1, activation: 'sigmoid' }] }, 1)).toThrow(/Marque ao menos uma/);
    const net = Network.create(
      { inputs: 2, layers: [withBlocks([{ neurons: 3, activation: 'tanh' }, { neurons: 3, activation: 'relu' }]), { neurons: 1, activation: 'sigmoid' }] },
      4,
    );
    const X = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const Y = [[0], [1], [1], [0]];
    new Trainer(net, { inputs: X, targets: Y }, { inputs: X, targets: Y }, { learningRate: 0.5, epochs: 3000, seed: 2 }).run();
    expect(mse(net, X, Y)).toBeLessThan(0.02);
  });
});

describe('parada antecipada', () => {
  it('para quando a validação não melhora e volta aos melhores pesos', () => {
    // validação impossível de acertar junto com o treino: piora enquanto o treino melhora
    const X = [[0], [0.25], [0.5], [0.75], [1]];
    const Y = X.map(([x]) => [x]);
    const val = { inputs: [[0.5]], targets: [[5]] };
    const net = Network.create({ inputs: 1, layers: [{ neurons: 4, activation: 'tanh' }, { neurons: 1, activation: 'linear' }] }, 3);
    const t = new Trainer(net, { inputs: X, targets: Y }, val, { learningRate: 0.1, epochs: 2000, seed: 1, patience: 10 });
    const hist = t.run();
    expect(t.stoppedEarly).toBe(true);
    expect(hist.length).toBeLessThan(2000);
    expect(hist.length - t.bestEpoch).toBe(10);
    t.restoreBest();
    expect(mse(net, val.inputs, val.targets)).toBeCloseTo(t.bestValMSE, 10);
  });

  it('desligada, roda todas as épocas', () => {
    const X = [[0], [1]];
    const t = new Trainer(Network.create({ inputs: 1, layers: [{ neurons: 1, activation: 'linear' }] }, 1), { inputs: X, targets: X }, { inputs: X, targets: X }, { learningRate: 0.1, epochs: 50, seed: 1 });
    expect(t.run()).toHaveLength(50);
    expect(t.stoppedEarly).toBe(false);
  });
});

describe('matriz de confusão', () => {
  it('conta real × previsto pelas classes e no caso 0/1', () => {
    const cod: ColumnCoding[] = [{ nome: 'c', tipo: 'classe', classes: ['a', 'b'] }];
    const c = confusionMatrix([[0.9, 0.1], [0.2, 0.8], [0.7, 0.3]], [[1, 0], [0, 1], [0, 1]], cod)!;
    expect(c.labels).toEqual(['a', 'b']);
    expect(c.m).toEqual([[1, 0], [1, 1]]);
    const bin = confusionMatrix([[0.8], [0.2], [0.6]], [[1], [0], [0]], undefined)!;
    expect(bin.labels).toEqual(['1', '0']);
    expect(bin.m).toEqual([[1, 0], [1, 1]]);
    expect(confusionMatrix([[0.3]], [[0.37]], undefined)).toBeUndefined();
  });
});
