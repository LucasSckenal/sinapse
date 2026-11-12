import { mse } from '../core/loss';
import { Network } from '../core/network';
import { serialize } from '../core/persistence';
import { fmt, h } from './dom';
import { cycleOf, mountNet, type NetHandle } from './net3d-mount';

/**
 * Tela de entrada: uma rede de verdade (2 → 5 tanh → 1 sigmoid) aprendendo XOR ao vivo, com o
 * mesmo núcleo do app. A cada ciclo, um exemplo vai, o erro volta, os pesos mudam e a cena mostra.
 */
const X = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];
const Y = [[0], [1], [1], [0]];

export function xorDemo(): HTMLElement {
  const host = h('div', { class: 'demo-net', 'aria-hidden': 'true' });
  const caption = h('p', { class: 'demo-caption mono' });
  const wrap = h('div', { class: 'demo' }, host, caption);

  let net = Network.create({ inputs: 2, layers: [{ neurons: 5, activation: 'tanh' }, { neurons: 1, activation: 'sigmoid' }] }, 7);
  const model = () => ({ net, normalization: null });
  let handle: NetHandle | null = null;
  let k = 0;
  let epoch = 0;

  const tick = () => {
    if (!wrap.isConnected) {
      clearInterval(timer);
      handle?.dispose();
      return;
    }
    if (!handle) {
      handle = mountNet(host, serialize(model()), net.architecture);
      return;
    }
    // um exemplo fazendo o ciclo inteiro (é este que a cena mostra) ...
    const i = k++ % 4;
    const c = cycleOf(model(), X[i], Y[i]);
    handle.cycle(c);
    net.update(0.5);
    // ... e mais algumas épocas por trás, para dar para ver o erro caindo
    for (let e = 0; e < 6; e++) for (let j = 0; j < 4; j++) net.trainExample(X[j], Y[j], 0.5);
    epoch += 6;
    const err = mse(net, X, Y);
    setTimeout(() => handle?.setWeights(serialize(model())), 1700);
    caption.textContent = `Uma rede de verdade aprendendo XOR · época ${epoch} · erro ${fmt(err, 3)}`;
    if (err < 0.003 || epoch > 1800) {
      // aprendeu: recomeça do zero, com outra semente
      net = Network.create(net.architecture, 7 + epoch);
      epoch = 0;
    }
  };
  const timer = setInterval(tick, 2100);
  queueMicrotask(tick);
  return wrap;
}
