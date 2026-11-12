import type { Model, SavedModel } from '../core/persistence';
import { serialize } from '../core/persistence';
import type { Cycle, Net3D, Surface3D } from './net3d';
import { NetView } from './netview';

/**
 * Carrega a cena 3D só quando ela aparece (o three.js fica fora do pacote inicial).
 * Sem WebGL, cai no desenho 2D, que mostra os mesmos pesos.
 */
type Mod = typeof import('./net3d');
let modPromise: Promise<Mod> | null = null;
const loadMod = () => (modPromise ??= import('./net3d'));

/** Ativações de cada camada do último exemplo que passou pela rede (camada 0 = entradas). */
export function activationsOf(model: Model): number[][] {
  const net = model.net;
  return [net.layers[0].inputs.slice(), ...net.layers.map((l) => l.outputs())];
}

export interface NetHandle {
  setWeights(m: SavedModel): void;
  wave(acts: number[][], strong?: boolean): void;
  cycle(c: Cycle, strong?: boolean): void;
  dispose(): void;
}

/** Ativações e deltas de um exemplo, calculados na cópia da rede (os pesos não mudam). */
export function cycleOf(model: Model, x: readonly number[], t?: readonly number[]): Cycle {
  model.net.forward(x);
  const acts = activationsOf(model);
  if (!t) return { acts };
  model.net.backward(t);
  return { acts, deltas: model.net.layers.map((l) => l.neurons.map((n) => n.delta)) };
}

export function mountNet(host: HTMLElement, saved: SavedModel, arch: { inputs: number; layers: { neurons: number; activation: string }[] }): NetHandle {
  let net3d: Net3D | null = null;
  let flat: NetView | null = null;
  let pending: SavedModel = saved;
  let disposed = false;
  host.classList.add('loading3d');
  loadMod()
    .then((m) => {
      if (disposed) return;
      host.classList.remove('loading3d');
      if (!m.webglAvailable()) throw new Error('sem webgl');
      net3d = new m.Net3D(pending);
      host.appendChild(net3d.el);
    })
    .catch(() => {
      if (disposed) return;
      host.classList.remove('loading3d');
      flat = new NetView(arch as never, pending);
      host.appendChild(flat.el);
    });
  return {
    setWeights(m) {
      pending = m;
      net3d?.setWeights(m);
      flat?.update(m);
    },
    wave(acts, strong) {
      net3d?.wavePass(acts, strong);
      flat?.cycle(acts);
    },
    cycle(c, strong) {
      net3d?.cycle(c, strong);
      flat?.cycle(c.acts, c.deltas);
    },
    dispose() {
      disposed = true;
      net3d?.dispose();
    },
  };
}

export interface SurfaceHandle {
  set(d: import('./net3d').SurfaceData): void;
  dispose(): void;
}

export function mountSurface(host: HTMLElement): SurfaceHandle {
  let s: Surface3D | null = null;
  let data: import('./net3d').SurfaceData | null = null;
  let disposed = false;
  loadMod().then((m) => {
    if (disposed || !m.webglAvailable()) return;
    s = new m.Surface3D();
    host.appendChild(s.el);
    if (data) s.setData(data);
  });
  return {
    set(d) {
      data = d;
      s?.setData(d);
    },
    dispose() {
      disposed = true;
      s?.dispose();
    },
  };
}

/** Rede da tela Prever: acende camada por camada com as ativações reais. Fica guardada entre redesenhos. */
let predictNet: { model: Model; el: HTMLElement; handle: NetHandle } | null = null;

export function predictNetFor(model: Model): { el: HTMLElement; light(): void } {
  if (!predictNet || predictNet.model !== model) {
    disposePredictNet();
    const el = document.createElement('div');
    el.className = 'pred-net';
    predictNet = { model, el, handle: mountNet(el, serialize(model), model.net.architecture) };
  }
  const p = predictNet;
  return {
    el: p.el,
    light() {
      p.handle.wave(activationsOf(model), true);
    },
  };
}

export function disposePredictNet(): void {
  predictNet?.handle.dispose();
  predictNet = null;
}
