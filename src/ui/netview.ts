import type { Architecture } from '../core/network';
import { shownUnits, topology } from './topology';
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
  private lines: { el: SVGElement; layer: number; i: number; j: number; p: number; x1: number; y1: number; x2: number; y2: number }[] = [];
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
    const topo = topology(arch);
    const sizes = topo.sizes;
    const cols = sizes.length;
    const x = (c: number) => (cols === 1 ? W / 2 : 46 + (c * (W - 92)) / (cols - 1));
    // cada bloco mostra até MAX_SHOWN nós; blocos da mesma camada ficam separados por um vão
    const shown = shownUnits(topo, MAX_SHOWN);
    // vão extra entre blocos da mesma camada (além do espaço normal entre nós)
    const BLOCK_GAP = 34;
    const pos: Map<number, readonly [number, number]>[] = topo.blocks.map((blocks, c) => {
      const counts = blocks.map((b) => Math.min(b.count, MAX_SHOWN));
      const total = counts.reduce((a, b) => a + b, 0);
      const gaps = (blocks.length - 1) * BLOCK_GAP;
      const g = Math.min(38, (H - 100 - gaps) / Math.max(1, total - 1));
      const height = (total - 1) * g + gaps;
      let y = (H - 34) / 2 - height / 2;
      const m = new Map<number, readonly [number, number]>();
      blocks.forEach((b, k) => {
        for (let u = 0; u < counts[k]; u++) {
          m.set(b.start + u, [x(c), y] as const);
          if (u < counts[k] - 1) y += g;
        }
        y += g + BLOCK_GAP;
      });
      return m;
    });

    const gLines = svg('g');
    this.gLines = gLines;
    const gNodes = svg('g');
    this.gPulses = svg('g');
    for (let c = 0; c < cols - 1; c++)
      for (const i of shown[c + 1]) {
        const to = pos[c + 1].get(i)!;
        const src = topo.sources[c][i];
        const n = src ? src.length : sizes[c];
        for (let p = 0; p < n; p++) {
          const j = src ? src[p] : p;
          const from = pos[c].get(j);
          if (!from) continue;
          const el = svg('line', { x1: from[0], y1: from[1], x2: to[0], y2: to[1], stroke: '#f2f2f3', 'stroke-opacity': 0.12, 'stroke-width': 0.8 });
          gLines.appendChild(el);
          this.lines.push({ el, layer: c, i, j, p, x1: from[0], y1: from[1], x2: to[0], y2: to[1] });
        }
      }
    topo.blocks.forEach((blocks, c) => {
      this.nodeDots[c] = [];
      // moldura discreta em volta de cada bloco quando a camada tem mais de um
      if (blocks.length > 1)
        blocks.forEach((b, k) => {
          const ys = Array.from({ length: Math.min(b.count, MAX_SHOWN) }, (_, u) => pos[c].get(b.start + u)![1]);
          gNodes.appendChild(svg('rect', { x: x(c) - 15, y: Math.min(...ys) - 13, width: 30, height: Math.max(...ys) - Math.min(...ys) + 26, rx: 13, fill: 'none', stroke: '#3a3a40', 'stroke-dasharray': '3 4' }));
          const tag = svg('text', { x: x(c) - 22, y: Math.min(...ys) + 3, 'text-anchor': 'end', fill: '#8a8a92', 'font-size': 10, 'font-family': 'JetBrains Mono, monospace' });
          tag.textContent = 'ABCDEFGHIJKLMNOP'[k];
          gNodes.appendChild(tag);
        });
      for (const [i, [cx, cy]] of pos[c]) {
        const r = sizes[c] > MAX_SHOWN ? 7 : 9;
        gNodes.appendChild(svg('circle', { cx, cy, r, fill: '#18181b', stroke: c === 0 ? '#75757d' : '#3a3a40', 'stroke-width': 1.2 }));
        const dot = svg('circle', { cx, cy, r: 3, fill: '#f2f2f3', 'fill-opacity': c === 0 ? 0.35 : 0.5 });
        gNodes.appendChild(dot);
        this.nodeDots[c][i] = dot;
        if (c > 0) this.biasDots.push({ el: dot, layer: c - 1, i });
      }
      blocks.forEach((b) => {
        if (b.count <= MAX_SHOWN) return;
        const last = pos[c].get(b.start + MAX_SHOWN - 1)!;
        const t = svg('text', { x: last[0] + 15, y: last[1] + 4, 'text-anchor': 'start', fill: '#75757d', 'font-size': 11, 'font-family': 'JetBrains Mono, monospace' });
        t.textContent = `+${b.count - MAX_SHOWN}`;
        gNodes.appendChild(t);
      });
      const label = svg('text', { x: x(c), y: H - 6, 'text-anchor': 'middle', fill: '#75757d', 'font-size': 10, 'letter-spacing': 1.6, 'font-family': 'Archivo Variable, sans-serif' });
      label.textContent = (c === 0 ? 'Entrada' : blocks.map((b) => ACT_LABEL[b.activation]).filter((v, k, a) => a.indexOf(v) === k).join(' · ')).toUpperCase();
      gNodes.appendChild(label);
    });
    this.el.append(gLines, gNodes, this.gPulses);
  }

  /**
   * O mesmo ciclo da cena 3D, no plano: a ida acende os nós com a ativação, o erro volta
   * (pulsos cinza, da saída para a entrada) e as ligações piscam quando os pesos mudam.
   */
  cycle(acts: number[][], deltas?: number[][], flash = true): void {
    if (!this.weights) return;
    const hop = 0.32;
    const L = this.nodeDots.length - 1;
    const pick = (layer: number, score: (i: number, j: number, w: number) => number, n: number) =>
      this.lines
        .filter((l) => l.layer === layer)
        .map((l) => ({ l, s: score(l.i, l.j, this.weights!.camadas[layer]?.pesos[l.i]?.[l.p] ?? 0) }))
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
      if (flash) this.flashAt = this.clock + fwd + L * hop + 0.2;
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
    for (const { el, layer, i, p } of this.lines) {
      const w = model.camadas[layer]?.pesos[i]?.[p] ?? 0;
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
