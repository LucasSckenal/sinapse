import type { EpochResult } from '../core/trainer';
import { svg } from './dom';

/** Curva do MSE por época (treino contínuo, validação tracejada), eixo y em escala log. */
export class MseChart {
  readonly el: SVGElement;
  private history: EpochResult[] = [];
  private total = 1;
  private ro: ResizeObserver;

  constructor() {
    this.el = svg('svg', { class: 'chart', role: 'img', 'aria-label': 'Erro quadrático médio por época' });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.el);
  }

  update(history: EpochResult[], totalEpochs: number): void {
    this.history = history;
    this.total = Math.max(totalEpochs, history.length, 1);
    this.draw();
  }

  disconnect(): void {
    this.ro.disconnect();
  }

  private draw(): void {
    const w = this.el.clientWidth || 400;
    const h = this.el.clientHeight || 240;
    const padL = 54;
    const padB = 22;
    this.el.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.el.replaceChildren();
    const vals = this.history.flatMap((r) => [r.trainMSE, r.valMSE]).filter((v) => Number.isFinite(v) && v > 0);
    const font = { fill: '#75757d', 'font-size': 10, 'font-family': 'JetBrains Mono, monospace' };
    if (!vals.length) {
      this.el.appendChild(svg('line', { x1: padL, x2: w, y1: h - padB, y2: h - padB, stroke: '#2e2e33' }));
      const t = svg('text', { x: (w + padL) / 2, y: h / 2, 'text-anchor': 'middle', ...font, 'font-size': 12 });
      t.textContent = 'A curva aparece quando o treino começar';
      this.el.appendChild(t);
      return;
    }
    let lo = Math.floor(Math.log10(Math.min(...vals)));
    let hi = Math.ceil(Math.log10(Math.max(...vals)));
    if (hi === lo) hi = lo + 1;
    if (hi - lo > 8) lo = hi - 8;
    const y = (v: number) => {
      const l = Math.min(hi, Math.max(lo, Math.log10(Math.max(v, 10 ** lo))));
      return 8 + ((hi - l) / (hi - lo)) * (h - padB - 8);
    };
    const x = (e: number) => padL + (e / this.total) * (w - padL - 4);
    for (let p = lo; p <= hi; p++) {
      const yy = y(10 ** p);
      this.el.appendChild(svg('line', { x1: padL, x2: w, y1: yy, y2: yy, stroke: '#232327' }));
      const t = svg('text', { x: padL - 10, y: yy + 3, 'text-anchor': 'end', ...font });
      t.textContent = p >= 0 ? String(10 ** p) : p >= -4 ? `0,${'0'.repeat(-p - 1)}1` : `1e${p}`;
      this.el.appendChild(t);
    }
    const ex = svg('text', { x: w - 2, y: h - 4, 'text-anchor': 'end', ...font });
    ex.textContent = `${this.total} épocas`;
    this.el.appendChild(ex);
    // reduz pontos para no máximo ~1 por pixel
    const stepN = Math.max(1, Math.floor(this.history.length / (w - padL)));
    const path = (key: 'trainMSE' | 'valMSE') => {
      let d = '';
      this.history.forEach((r, i) => {
        if (i % stepN && i !== this.history.length - 1) return;
        const v = r[key];
        if (!Number.isFinite(v)) return;
        d += `${d ? 'L' : 'M'}${x(r.epoch).toFixed(1)},${y(v).toFixed(1)}`;
      });
      return d;
    };
    const val = path('valMSE');
    if (val) this.el.appendChild(svg('path', { d: val, fill: 'none', stroke: '#8b8b93', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
    this.el.appendChild(svg('path', { d: path('trainMSE'), fill: 'none', stroke: '#f2f2f3', 'stroke-width': 1.75, 'stroke-linejoin': 'round' }));
    const last = this.history[this.history.length - 1];
    this.el.appendChild(svg('circle', { cx: x(last.epoch), cy: y(last.trainMSE), r: 3.5, fill: '#f2f2f3' }));
  }
}
