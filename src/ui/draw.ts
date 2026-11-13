import type { Model } from '../core/persistence';
import { h, icon } from './dom';

/**
 * Quadro para desenhar um dígito. O conjunto "digits" foi feito assim: cada dígito desenhado
 * numa grade 32×32 (preto e branco), centralizado, e contado em blocos 4×4, o que dá 8×8 valores
 * de 0 a 16. Aqui o desenho passa pelo mesmo caminho, para a rede ver o mesmo tipo de imagem.
 */
const G = 32;
const NAMES = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];

/** A rede é de dígitos 8×8? (64 entradas p00…p77 e saída com as classes zero…nove) */
export function isDigitModel(m: Model): boolean {
  const ins = m.columns?.entradas ?? m.codings?.entradas.map((c) => c.nome);
  if (!ins || ins.length !== 64 || !ins.every((n, i) => n === `p${Math.floor(i / 8)}${i % 8}`)) return false;
  const out = m.codings?.saidas[0];
  return !!out && out.tipo === 'classe' && out.classes.every((c) => NAMES.includes(c));
}

export function digitOf(name: string): string {
  const i = NAMES.indexOf(name);
  return i >= 0 ? String(i) : name;
}

export class DigitPad {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private mini: HTMLCanvasElement;
  private grid = new Uint8Array(G * G);
  private drawing = false;
  private last: [number, number] | null = null;
  private timer = 0;
  private shown: number[] | null = null;

  constructor(private onChange: (values: number[] | null) => void) {
    this.canvas = h('canvas', { class: 'pad', width: 320, height: 320, 'aria-label': 'Quadro para desenhar um número com o mouse ou o dedo' });
    this.mini = h('canvas', { class: 'pad-mini', width: 8, height: 8, 'aria-label': 'O que a rede vê: 8 por 8' });
    const clear = h('button', { type: 'button', class: 'btn line small', onclick: () => this.clear() }, icon('trash'), 'Limpar');
    this.el = h(
      'div',
      { class: 'pad-wrap' },
      this.canvas,
      h('div', { class: 'pad-side' }, h('div', { class: 'pad-mini-box' }, this.mini, h('span', { class: 'lbl' }, 'o que a rede vê · 8×8')), clear),
    );
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      if (this.shown) this.clear(false);
      this.drawing = true;
      this.last = null;
      this.paint(e);
    });
    c.addEventListener('pointermove', (e) => this.drawing && this.paint(e));
    const end = () => {
      if (!this.drawing) return;
      this.drawing = false;
      this.last = null;
      this.emit();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    this.render();
  }

  clear(emit = true): void {
    this.grid.fill(0);
    this.shown = null;
    this.render();
    if (emit) this.onChange(null);
  }

  /** Mostra 8×8 valores (0–16) de uma linha do dataset no quadro. */
  show(values: number[]): void {
    this.grid.fill(0);
    this.shown = values;
    this.render();
    this.drawMini(values);
  }

  private cell(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * G, ((e.clientY - r.top) / r.height) * G];
  }

  private stamp(x: number, y: number): void {
    const rad = 1.7;
    for (let j = Math.floor(y - rad); j <= Math.ceil(y + rad); j++)
      for (let i = Math.floor(x - rad); i <= Math.ceil(x + rad); i++)
        if (i >= 0 && j >= 0 && i < G && j < G && (i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2 <= rad * rad) this.grid[j * G + i] = 1;
  }

  private paint(e: PointerEvent): void {
    const [x, y] = this.cell(e);
    if (this.last) {
      const [lx, ly] = this.last;
      const steps = Math.ceil(Math.hypot(x - lx, y - ly) * 2) + 1;
      for (let s = 0; s <= steps; s++) this.stamp(lx + ((x - lx) * s) / steps, ly + ((y - ly) * s) / steps);
    } else this.stamp(x, y);
    this.last = [x, y];
    this.render();
    // prevê enquanto desenha, sem exagerar
    if (!this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.emit();
      }, 90);
  }

  /** Centraliza o desenho e reduz para 8×8 como no conjunto original. */
  values(): number[] | null {
    let x0 = G;
    let y0 = G;
    let x1 = -1;
    let y1 = -1;
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++)
        if (this.grid[j * G + i]) {
          x0 = Math.min(x0, i);
          x1 = Math.max(x1, i);
          y0 = Math.min(y0, j);
          y1 = Math.max(y1, j);
        }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1;
    const hh = y1 - y0 + 1;
    const scale = 28 / Math.max(w, hh);
    const ox = (G - w * scale) / 2;
    const oy = (G - hh * scale) / 2;
    const norm = new Uint8Array(G * G);
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) {
        const sx = Math.floor((i - ox) / scale) + x0;
        const sy = Math.floor((j - oy) / scale) + y0;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && this.grid[sy * G + sx]) norm[j * G + i] = 1;
      }
    const out: number[] = [];
    for (let by = 0; by < 8; by++)
      for (let bx = 0; bx < 8; bx++) {
        let s = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s += norm[(by * 4 + j) * G + bx * 4 + i];
        out.push(s);
      }
    return out;
  }

  private emit(): void {
    const v = this.values();
    if (v) this.drawMini(v);
    this.onChange(v);
  }

  private render(): void {
    const ctx = this.canvas.getContext('2d')!;
    const s = this.canvas.width / G;
    ctx.fillStyle = '#121214';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // grade de 8×8 bem discreta (os blocos que viram cada entrada)
    ctx.strokeStyle = '#1f1f23';
    ctx.lineWidth = 1;
    for (let k = 1; k < 8; k++) {
      const p = Math.round(k * 4 * s) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, this.canvas.height);
      ctx.moveTo(0, p);
      ctx.lineTo(this.canvas.width, p);
      ctx.stroke();
    }
    if (this.shown) {
      this.shown.forEach((v, k) => {
        const g = Math.round((v / 16) * 230);
        ctx.fillStyle = `rgb(${g},${g},${g + 2})`;
        ctx.fillRect((k % 8) * 4 * s + 1, Math.floor(k / 8) * 4 * s + 1, 4 * s - 2, 4 * s - 2);
      });
      return;
    }
    ctx.fillStyle = '#f2f2f3';
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (this.grid[j * G + i]) ctx.fillRect(i * s, j * s, s + 0.5, s + 0.5);
    if (!this.grid.some(Boolean)) {
      ctx.fillStyle = '#4a4a52';
      ctx.font = '500 15px "Archivo Variable", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Desenhe um número de 0 a 9', this.canvas.width / 2, this.canvas.height / 2);
      this.drawMini(new Array(64).fill(0));
    }
  }

  private drawMini(v: number[]): void {
    const ctx = this.mini.getContext('2d')!;
    const img = ctx.createImageData(8, 8);
    v.forEach((x, k) => {
      const g = Math.round(18 + (x / 16) * 224);
      img.data.set([g, g, g + 2, 255], k * 4);
    });
    ctx.putImageData(img, 0, 0);
  }
}
