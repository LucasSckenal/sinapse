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
export class NetView {
  readonly el: SVGElement;
  private lines: { el: SVGElement; layer: number; i: number; j: number }[] = [];
  private biasDots: { el: SVGElement; layer: number; i: number }[] = [];

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
    const gNodes = svg('g');
    for (let c = 0; c < cols - 1; c++)
      pos[c + 1].forEach(([x2, y2], i) =>
        pos[c].forEach(([x1, y1], j) => {
          const el = svg('line', { x1, y1, x2, y2, stroke: '#f2f2f3', 'stroke-opacity': 0.12, 'stroke-width': 0.8 });
          gLines.appendChild(el);
          this.lines.push({ el, layer: c, i, j });
        }),
      );
    pos.forEach((col, c) => {
      col.forEach(([cx, cy], i) => {
        const r = sizes[c] > MAX_SHOWN ? 7 : 9;
        gNodes.appendChild(svg('circle', { cx, cy, r, fill: '#18181b', stroke: c === 0 ? '#75757d' : '#3a3a40', 'stroke-width': 1.2 }));
        if (c > 0) {
          const dot = svg('circle', { cx, cy, r: 3, fill: '#f2f2f3', 'fill-opacity': 0.5 });
          gNodes.appendChild(dot);
          this.biasDots.push({ el: dot, layer: c - 1, i });
        }
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
    this.el.append(gLines, gNodes);
  }

  /** Atualiza as ligações com os pesos atuais. */
  update(model: SavedModel): void {
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
