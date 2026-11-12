import type { Architecture } from '../core/network';
import type { SavedModel } from '../core/persistence';
import { svg } from './dom';

const W = 560;
const H = 380;
const MAX_SHOWN = 10;
const ACT_LABEL: Record<string, string> = { linear: 'Linear', sigmoid: 'Sigmoid', tanh: 'Tanh', relu: 'ReLU' };

/**
 * Desenho da rede: nós por camada e ligações cuja espessura e opacidade seguem |peso|.
 * Peso positivo em branco, negativo em cinza. Camadas grandes mostram os primeiros nós e "+N".
 */
interface Pulse2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  delay: number;
  t: number;
  s: number;
  back: boolean;
}

export class NetView {
  readonly el: SVGElement;
  private lines: { el: SVGElement; layer: number; i: number; j: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  private biasDots: { el: SVGElement; layer: number; i: number }[] = [];
  private nodeDots: SVGElement[][] = [];
  private gLines!: SVGElement;
  private gPulses!: SVGElement;
  private pool: SVGElement[] = [];
  private pulses: Pulse2D[] = [];
  private raf = 0;
  private last = 0;
  private flashAt = -1;
  private flash = 0;
  private clock = 0;
  private weights: SavedModel | null = null;

  constructor(arch: Architecture, model?: SavedModel | null) {
    this.el = svg('svg', { class: 'netview', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Rede com ${arch.inputs} entradas e ${arch.layers.length} camadas` });
    this.build(arch);
    if (model) this.update(model);
  }

  private build(arch: Architecture): void {
    const sizes = [arch.inputs, ...arch.layers.map((l) => l.neurons)];
    const cols = sizes.length;
    const x = (c: number) => (cols === 1 ? W / 2 : 46 + (c * (W - 92)) / (cols - 1));
    const gap = (n: number) => Math.min(38, (H - 90) / Math.max(1, n - 1));
    const pos = sizes.map((n, c) => {
      const shown = Math.min(n, MAX_SHOWN);
      return Array.from({ length: shown }, (_, j) => [x(c), (H - 34) / 2 + (j - (shown - 1) / 2) * gap(shown)] as const);
    });

    const gLines = svg('g');
    this.gLines = gLines;
    const gNodes = svg('g');
    this.gPulses = svg('g');
    for (let c = 0; c < cols - 1; c++)
      pos[c + 1].forEach(([x2, y2], i) =>
        pos[c].forEach(([x1, y1], j) => {
          const el = svg('line', { x1, y1, x2, y2, stroke: '#f2f2f3', 'stroke-opacity': 0.12, 'stroke-width': 0.8 });
          gLines.appendChild(el);
          this.lines.push({ el, layer: c, i, j, x1, y1, x2, y2 });
        }),
      );
    pos.forEach((col, c) => {
      this.nodeDots[c] = [];
      col.forEach(([cx, cy], i) => {
        const r = sizes[c] > MAX_SHOWN ? 7 : 9;
        gNodes.appendChild(svg('circle', { cx, cy, r, fill: '#18181b', stroke: c === 0 ? '#75757d' : '#3a3a40', 'stroke-width': 1.2 }));
        const dot = svg('circle', { cx, cy, r: 3, fill: '#f2f2f3', 'fill-opacity': c === 0 ? 0.35 : 0.5 });
        gNodes.appendChild(dot);
        this.nodeDots[c].push(dot);
        if (c > 0) this.biasDots.push({ el: dot, layer: c - 1, i });
      });
      if (sizes[c] > MAX_SHOWN) {
        const last = col[col.length - 1];
        const t = svg('text', { x: last[0] + 15, y: last[1] + 4, 'text-anchor': 'start', fill: '#75757d', 'font-size': 11, 'font-family': 'JetBrains Mono, monospace' });
        t.textContent = `+${sizes[c] - MAX_SHOWN}`;
        gNodes.appendChild(t);
      }
      const label = svg('text', { x: x(c), y: H - 6, 'text-anchor': 'middle', fill: '#75757d', 'font-size': 10, 'letter-spacing': 1.6, 'font-family': 'Archivo Variable, sans-serif' });
      label.textContent = (c === 0 ? 'Entrada' : ACT_LABEL[arch.layers[c - 1].activation]).toUpperCase();
      gNodes.appendChild(label);
    });
    this.el.append(gLines, gNodes, this.gPulses);
  }

  /**
   * O mesmo ciclo da cena 3D, no plano: a ida acende os nós com a ativação, o erro volta
   * (pulsos cinza, da saída para a entrada) e as ligações piscam quando os pesos mudam.
   */
  cycle(acts: number[][], deltas?: number[][]): void {
    if (!this.weights) return;
    const hop = 0.32;
    const L = this.nodeDots.length - 1;
    const pick = (layer: number, score: (i: number, j: number, w: number) => number, n: number) =>
      this.lines
        .filter((l) => l.layer === layer)
        .map((l) => ({ l, s: score(l.i, l.j, this.weights!.camadas[layer]?.pesos[l.i]?.[l.j] ?? 0) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, n);
    const norm = acts.map((a) => {
      const m = Math.max(1, ...a.map(Math.abs));
      return a.map((v) => Math.min(1, Math.abs(v) / m));
    });
    for (let l = 0; l < L; l++)
      for (const { l: ln, s } of pick(l, (_i, j, w) => Math.abs(w) * (0.25 + (norm[l]?.[j] ?? 0)), 14))
        this.pulses.push({ x1: ln.x1, y1: ln.y1, x2: ln.x2, y2: ln.y2, delay: l * hop + Math.random() * 0.05, t: 0, s: Math.min(1, 0.4 + s), back: false });
    // acende os nós quando a onda chega
    norm.forEach((layer, l) =>
      setTimeout(() => {
        layer.forEach((v, k) => {
          const d = this.nodeDots[l]?.[k];
          if (!d) return;
          d.setAttribute('r', (2.5 + v * 5).toFixed(2));
          d.setAttribute('fill-opacity', (0.3 + v * 0.7).toFixed(2));
        });
      }, l * hop * 1000),
    );
    if (deltas) {
      const fwd = L * hop + 0.3;
      for (let l = L - 1; l >= 0; l--) {
        const m = Math.max(1e-12, ...(deltas[l] ?? []).map(Math.abs));
        for (const { l: ln } of pick(l, (i, _j, w) => (Math.abs(deltas[l]?.[i] ?? 0) / m) * Math.abs(w), 10))
          this.pulses.push({ x1: ln.x2, y1: ln.y2, x2: ln.x1, y2: ln.y1, delay: fwd + (L - 1 - l) * hop + Math.random() * 0.05, t: 0, s: 0.7, back: true });
      }
      this.flashAt = this.clock + fwd + L * hop + 0.2;
    }
    this.start();
  }

  private start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.clock += dt;
      if (!this.el.isConnected) {
        this.raf = 0;
        this.pulses = [];
        return;
      }
      if (this.flashAt >= 0 && this.clock >= this.flashAt) {
        this.flash = 1;
        this.flashAt = -1;
      }
      this.flash = Math.max(0, this.flash - dt * 2.2);
      this.gLines.style.filter = this.flash > 0.01 ? `brightness(${1 + this.flash * 1.8})` : '';
      let n = 0;
      this.pulses = this.pulses.filter((p) => {
        if (p.delay > 0) {
          p.delay -= dt;
          return true;
        }
        p.t += dt * 3.2;
        if (p.t >= 1) return false;
        const el = this.pool[n] ?? this.gPulses.appendChild(svg('circle', { r: 3 }));
        this.pool[n++] = el;
        el.setAttribute('cx', (p.x1 + (p.x2 - p.x1) * p.t).toFixed(1));
        el.setAttribute('cy', (p.y1 + (p.y2 - p.y1) * p.t).toFixed(1));
        el.setAttribute('r', ((p.back ? 2.2 : 2.8) * (0.4 + p.s) * Math.sin(Math.PI * p.t) + 0.6).toFixed(2));
        el.setAttribute('fill', p.back ? '#8c8c96' : '#ffffff');
        el.setAttribute('visibility', 'visible');
        return true;
      });
      for (let k = n; k < this.pool.length; k++) this.pool[k].setAttribute('visibility', 'hidden');
      if (this.pulses.length || this.flash > 0 || this.flashAt >= 0) this.raf = requestAnimationFrame(step);
      else this.raf = 0;
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Atualiza as ligações com os pesos atuais. */
  update(model: SavedModel): void {
    this.weights = model;
    const maxPerLayer = model.camadas.map((l) => Math.max(1e-9, ...l.pesos.flat().map(Math.abs)));
    for (const { el, layer, i, j } of this.lines) {
      const w = model.camadas[layer]?.pesos[i]?.[j] ?? 0;
      const a = Math.abs(w) / maxPerLayer[layer];
      el.setAttribute('stroke', w >= 0 ? '#f2f2f3' : '#7d7d86');
      el.setAttribute('stroke-opacity', (0.06 + a * 0.6).toFixed(3));
      el.setAttribute('stroke-width', (0.4 + a * 2).toFixed(2));
    }
    const maxBias = model.camadas.map((l) => Math.max(1e-9, ...l.vieses.map(Math.abs)));
    for (const { el, layer, i } of this.biasDots) {
      const b = model.camadas[layer]?.vieses[i] ?? 0;
      const a = Math.abs(b) / maxBias[layer];
      el.setAttribute('r', (2 + a * 4).toFixed(2));
      el.setAttribute('fill-opacity', (0.25 + a * 0.75).toFixed(2));
    }
  }
}
