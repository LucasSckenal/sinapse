import type { Table } from '../core/dataset';
import { argmax, decode, type ColumnCoding } from '../core/encoding';
import type { Model } from '../core/persistence';
import { predict } from '../core/predict';

/**
 * Fronteira ao vivo: com 2 entradas numéricas, pinta o plano com a classe que a rede escolhe
 * em cada ponto (tom = classe, força = confiança) e marca os exemplos reais por cima.
 * Com 1 entrada numérica, desenha a curva da rede sobre os pontos.
 */
export type BoundaryKind = '2d' | '1d' | null;

export function boundaryKind(model: Model): BoundaryKind {
  const ins = model.codings?.entradas;
  if (ins) {
    if (ins.some((c) => c.tipo === 'classe')) return null;
    return ins.length === 2 ? '2d' : ins.length === 1 ? '1d' : null;
  }
  return model.net.inputCount === 2 ? '2d' : model.net.inputCount === 1 ? '1d' : null;
}

const TONES = [
  [236, 236, 238],
  [120, 120, 128],
  [176, 176, 182],
  [72, 72, 78],
  [208, 208, 212],
];
const BG = [18, 18, 20];

/** Classe e confiança que a rede dá para uma saída. */
function classOf(out: number[], cods: ColumnCoding[] | undefined): { k: number; conf: number } {
  if (cods && cods[0]?.tipo === 'classe') {
    const d = decode(cods, out)[0];
    if (d.tipo === 'classe') {
      const total = d.valores.reduce((s, v) => s + Math.max(0, v.valor), 0) || 1;
      return { k: d.indice, conf: Math.max(0, d.valores[d.indice].valor) / total };
    }
  }
  if (out.length === 1) {
    const p = Math.max(0, Math.min(1, out[0]));
    return { k: p >= 0.5 ? 0 : 1, conf: Math.abs(p - 0.5) * 2 };
  }
  const k = argmax(out);
  const total = out.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  return { k, conf: Math.max(0, out[k]) / total };
}

/** Classe verdadeira de uma linha do dataset (pelas colunas de saída). */
function trueClass(row: number[], outCols: number[], table: Table): number {
  const c0 = outCols[0];
  if (table.classes[c0]) return row[c0];
  if (outCols.length === 1) return row[c0] >= 0.5 ? 0 : 1;
  return argmax(outCols.map((c) => row[c]));
}

export class Boundary {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private G = 84;

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'boundary';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Fronteira de decisão da rede sobre os exemplos do dataset');
    this.ctx = this.el.getContext('2d')!;
  }

  draw(model: Model, table: Table, inCols: number[], outCols: number[]): void {
    const kind = boundaryKind(model);
    const size = Math.round(Math.min(560, Math.max(240, this.el.clientWidth || 360)) * Math.min(devicePixelRatio, 2));
    if (this.el.width !== size) {
      this.el.width = size;
      this.el.height = size;
    }
    if (kind === '2d') this.draw2d(model, table, inCols, outCols, size);
    else if (kind === '1d') this.draw1d(model, table, inCols, outCols, size);
  }

  private range(vals: number[]): [number, number] {
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }

  private draw2d(model: Model, table: Table, inCols: number[], outCols: number[], size: number): void {
    const [x0, x1] = this.range(table.rows.map((r) => r[inCols[0]]));
    const [y0, y1] = this.range(table.rows.map((r) => r[inCols[1]]));
    const G = this.G;
    if (!this.img || this.img.width !== G) this.img = new ImageData(G, G);
    const d = this.img.data;
    const cods = model.codings?.saidas;
    for (let gy = 0; gy < G; gy++)
      for (let gx = 0; gx < G; gx++) {
        const x = x0 + ((gx + 0.5) / G) * (x1 - x0);
        const y = y1 - ((gy + 0.5) / G) * (y1 - y0);
        const { k, conf } = classOf(predict(model, [x, y]), cods);
        const tone = TONES[k % TONES.length];
        const a = 0.18 + conf * 0.5;
        const i = (gy * G + gx) * 4;
        d[i] = BG[0] + (tone[0] - BG[0]) * a * 0.5;
        d[i + 1] = BG[1] + (tone[1] - BG[1]) * a * 0.5;
        d[i + 2] = BG[2] + (tone[2] - BG[2]) * a * 0.5;
        d[i + 3] = 255;
      }
    // amplia o mapa pequeno com suavização
    const tmp = document.createElement('canvas');
    tmp.width = G;
    tmp.height = G;
    tmp.getContext('2d')!.putImageData(this.img, 0, 0);
    const c = this.ctx;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(tmp, 0, 0, size, size);
    // exemplos reais
    const s = size / 360;
    const step = Math.max(1, Math.floor(table.rows.length / 500));
    for (let r = 0; r < table.rows.length; r += step) {
      const row = table.rows[r];
      const px = ((row[inCols[0]] - x0) / (x1 - x0)) * size;
      const py = (1 - (row[inCols[1]] - y0) / (y1 - y0)) * size;
      const k = trueClass(row, outCols, table);
      const pred = classOf(predict(model, [row[inCols[0]], row[inCols[1]]]), cods).k;
      this.marker(px, py, k, 3.2 * s, pred !== k);
    }
  }

  private marker(x: number, y: number, k: number, r: number, wrong: boolean): void {
    const c = this.ctx;
    c.lineWidth = Math.max(1, r * 0.4);
    const light = '#f2f2f3';
    const mid = '#9a9aa2';
    c.beginPath();
    switch (k % 4) {
      case 0:
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fillStyle = light;
        c.fill();
        break;
      case 1:
        c.arc(x, y, r, 0, Math.PI * 2);
        c.strokeStyle = mid;
        c.stroke();
        break;
      case 2:
        c.moveTo(x - r, y - r);
        c.lineTo(x + r, y + r);
        c.moveTo(x + r, y - r);
        c.lineTo(x - r, y + r);
        c.strokeStyle = light;
        c.stroke();
        break;
      default:
        c.moveTo(x, y - r);
        c.lineTo(x + r, y + r);
        c.lineTo(x - r, y + r);
        c.closePath();
        c.strokeStyle = mid;
        c.stroke();
    }
    if (wrong) {
      // exemplo que a rede ainda erra: um anel em volta
      c.beginPath();
      c.arc(x, y, r * 2.1, 0, Math.PI * 2);
      c.strokeStyle = '#ff8a80';
      c.lineWidth = Math.max(1, r * 0.35);
      c.stroke();
    }
  }

  private draw1d(model: Model, table: Table, inCols: number[], outCols: number[], size: number): void {
    const c = this.ctx;
    c.fillStyle = 'rgb(18,18,20)';
    c.fillRect(0, 0, size, size);
    const xs = table.rows.map((r) => r[inCols[0]]);
    const [x0, x1] = this.range(xs);
    const ts = table.rows.map((r) => (table.classes[outCols[0]] ? (r[outCols[0]] === 0 ? 1 : 0) : r[outCols[0]]));
    const N = 220;
    const curve = Array.from({ length: N }, (_, i) => {
      const x = x0 + (i / (N - 1)) * (x1 - x0);
      return [x, predict(model, [x])[0]] as const;
    });
    const [y0, y1] = this.range([...ts, ...curve.map((p) => p[1]).filter(Number.isFinite)]);
    const X = (x: number) => ((x - x0) / (x1 - x0)) * size;
    const Y = (y: number) => (1 - (y - y0) / (y1 - y0)) * size;
    // eixo zero
    if (y0 < 0 && y1 > 0) {
      c.strokeStyle = '#2e2e33';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, Y(0));
      c.lineTo(size, Y(0));
      c.stroke();
    }
    const s = size / 360;
    c.fillStyle = '#8a8a92';
    const step = Math.max(1, Math.floor(xs.length / 500));
    for (let i = 0; i < xs.length; i += step) {
      c.beginPath();
      c.arc(X(xs[i]), Y(ts[i]), 2.4 * s, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = '#f2f2f3';
    c.lineWidth = 2.2 * s;
    c.lineJoin = 'round';
    c.beginPath();
    curve.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
    c.stroke();
  }
}
