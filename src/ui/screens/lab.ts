import type { ActivationName } from '../../core/activations';
import type { Table } from '../../core/dataset';
import { mse } from '../../core/loss';
import { argmax } from '../../core/encoding';
import { Network } from '../../core/network';
import { Random } from '../../core/random';
import { fmt, h, icon, segmented, stepper } from '../dom';
import { set } from '../state';
import { loadTable } from './dados';

/**
 * Laboratório: você põe pontos de até três classes e uma rede de verdade (o mesmo núcleo do app)
 * treina sem parar com eles. A cada quadro faz alguns passos de SGD e repinta a fronteira.
 */
interface Pt {
  x: number;
  y: number;
  c: number;
}

const LABELS = ['A', 'B', 'C'];
const TONES = [
  [236, 236, 238],
  [120, 120, 128],
  [176, 176, 182],
];
const BG = [18, 18, 20];

const lab = {
  points: [] as Pt[],
  cls: 0,
  neurons: 8,
  layers: 2,
  activation: 'tanh' as ActivationName,
  rate: 0.1,
  running: true,
  net: null as Network | null,
  key: '',
  steps: 0,
  rng: new Random(7),
};

function classesUsed(): number[] {
  return [...new Set(lab.points.map((p) => p.c))].sort();
}

/** Recria a rede quando a forma muda (neurônios, camadas, ativação ou classes em uso). */
function ensureNet(): Network | null {
  const used = classesUsed();
  if (used.length < 2) return null;
  const key = `${lab.neurons}/${lab.layers}/${lab.activation}/${used.join('')}`;
  if (lab.net && lab.key === key) return lab.net;
  lab.net = Network.create(
    {
      inputs: 2,
      layers: [...Array.from({ length: lab.layers }, () => ({ neurons: lab.neurons, activation: lab.activation })), { neurons: used.length, activation: 'sigmoid' as ActivationName }],
    },
    lab.steps + 11,
  );
  lab.key = key;
  return lab.net;
}

function samples() {
  const used = classesUsed();
  return {
    inputs: lab.points.map((p) => [p.x, p.y]),
    targets: lab.points.map((p) => used.map((c) => (c === p.c ? 1 : 0))),
    used,
  };
}

function preset(kind: 'circulo' | 'xor' | 'espiral'): void {
  const r = new Random(Date.now() % 100000);
  const pts: Pt[] = [];
  if (kind === 'circulo')
    for (let i = 0; i < 120; i++) {
      const x = r.next() * 2 - 1;
      const y = r.next() * 2 - 1;
      pts.push({ x: x * 0.92, y: y * 0.92, c: x * x + y * y < 0.36 ? 0 : 1 });
    }
  if (kind === 'xor')
    for (let i = 0; i < 120; i++) {
      const x = r.next() * 2 - 1;
      const y = r.next() * 2 - 1;
      pts.push({ x: x * 0.92, y: y * 0.92, c: x * y > 0 ? 0 : 1 });
    }
  if (kind === 'espiral')
    for (let k = 0; k < 3; k++)
      for (let i = 0; i < 50; i++) {
        const t = i / 50;
        const a = k * ((2 * Math.PI) / 3) + t * 4 + (r.next() - 0.5) * 0.3;
        pts.push({ x: t * 0.9 * Math.sin(a), y: t * 0.9 * Math.cos(a), c: k });
      }
  lab.points = pts;
  lab.net = null;
}

function useAsDataset(): void {
  const used = classesUsed();
  const table: Table = {
    headers: ['x', 'y', 'classe'],
    classes: [null, null, used.map((c) => LABELS[c])],
    rows: lab.points.map((p) => [+p.x.toFixed(4), +(-p.y).toFixed(4), used.indexOf(p.c)]),
  };
  loadTable(table, 'laboratorio.csv');
  set({ screen: 'dados' });
}

export function labScreen(): HTMLElement {
  const canvas = h('canvas', { class: 'lab-canvas', width: 640, height: 640, 'aria-label': 'Quadro do laboratório: clique para pôr pontos; botão direito apaga' });
  const ctx = canvas.getContext('2d')!;
  const G = 64;
  const img = new ImageData(G, G);
  const tmp = document.createElement('canvas');
  tmp.width = G;
  tmp.height = G;
  const epEl = h('b', { class: 'mono' });
  const errEl = h('b', { class: 'mono' });
  const accEl = h('b', { class: 'mono' });
  const hint = h('p', { class: 'lab-hint' });

  const toCanvas = (x: number, y: number) => [((x + 1) / 2) * canvas.width, ((y + 1) / 2) * canvas.height] as const;
  const fromEvent = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1] as const;
  };

  // pôr pontos: clique (ou arraste) põe; botão direito / Alt apaga o mais perto
  let painting = false;
  let lastAdd = 0;
  const addAt = (e: PointerEvent) => {
    const [x, y] = fromEvent(e);
    if (e.button === 2 || e.altKey) {
      let best = -1;
      let bd = 0.08 ** 2;
      lab.points.forEach((p, i) => {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) lab.points.splice(best, 1);
      return;
    }
    const now = performance.now();
    if (now - lastAdd < 40) return;
    lastAdd = now;
    lab.points.push({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), c: lab.cls });
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    painting = true;
    addAt(e);
  });
  canvas.addEventListener('pointermove', (e) => painting && e.buttons && addAt(e));
  canvas.addEventListener('pointerup', () => (painting = false));

  const marker = (x: number, y: number, c: number, wrong: boolean) => {
    const r = 6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (c === 0) {
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f2f2f3';
      ctx.fill();
    } else if (c === 1) {
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#a6a6ad';
      ctx.stroke();
    } else {
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.strokeStyle = '#f2f2f3';
      ctx.stroke();
    }
    if (wrong) {
      ctx.beginPath();
      ctx.arc(x, y, r * 2, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff8a80';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  let frame = 0;
  let raf = 0;
  const loop = () => {
    if (!canvas.isConnected) {
      cancelAnimationFrame(raf);
      return;
    }
    frame++;
    const net = ensureNet();
    const s = samples();
    if (net && lab.running) {
      // treina por ~7 ms a cada quadro: um exemplo por vez (SGD)
      const t0 = performance.now();
      const order = s.inputs.map((_, i) => i);
      while (performance.now() - t0 < 7) {
        lab.rng.shuffle(order);
        for (const i of order) net.trainExample(s.inputs[i], s.targets[i], lab.rate);
        lab.steps++;
      }
    }
    if (frame % 2 === 0 || !lab.running) {
      // fronteira: a classe que a rede escolhe em cada ponto do plano
      const d = img.data;
      for (let gy = 0; gy < G; gy++)
        for (let gx = 0; gx < G; gx++) {
          let tone = BG;
          let a = 0;
          if (net) {
            const out = net.forward([((gx + 0.5) / G) * 2 - 1, ((gy + 0.5) / G) * 2 - 1]);
            const k = argmax(out);
            const tot = out.reduce((x, v) => x + Math.max(0, v), 0) || 1;
            a = 0.15 + (Math.max(0, out[k]) / tot) * 0.55;
            tone = TONES[s.used[k] % 3];
          }
          const i = (gy * G + gx) * 4;
          d[i] = BG[0] + (tone[0] - BG[0]) * a * 0.5;
          d[i + 1] = BG[1] + (tone[1] - BG[1]) * a * 0.5;
          d[i + 2] = BG[2] + (tone[2] - BG[2]) * a * 0.5;
          d[i + 3] = 255;
        }
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      let hits = 0;
      for (const p of lab.points) {
        const [cx, cy] = toCanvas(p.x, p.y);
        const pred = net ? s.used[argmax(net.forward([p.x, p.y]))] : p.c;
        if (pred === p.c) hits++;
        marker(cx, cy, p.c, pred !== p.c);
      }
      if (frame % 10 === 0 || !lab.running) {
        epEl.textContent = net ? lab.steps.toLocaleString('pt-BR') : '—';
        errEl.textContent = net && s.inputs.length ? fmt(mse(net, s.inputs, s.targets)) : '—';
        accEl.textContent = net && lab.points.length ? `${Math.round((hits / lab.points.length) * 100)}%` : '—';
        hint.textContent =
          lab.points.length === 0
            ? 'Clique no quadro para pôr pontos. Troque a classe e ponha outros.'
            : classesUsed().length < 2
              ? 'Ponha pontos de pelo menos duas classes.'
              : lab.running
                ? 'Aprendendo ao vivo. Mova, ponha ou apague pontos (botão direito).'
                : 'Pausado.';
      }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const onKey = (e: KeyboardEvent) => {
    if (!canvas.isConnected) {
      removeEventListener('keydown', onKey);
      return;
    }
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (['1', '2', '3'].includes(e.key)) {
      lab.cls = Number(e.key) - 1;
      set({});
    }
  };
  addEventListener('keydown', onKey);

  const rates = [0.01, 0.03, 0.1, 0.3];
  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'head' },
      h('div', null, h('h1', { class: 'wide' }, 'Laboratório'), h('div', { class: 'sub' }, 'Ponha pontos e veja a rede aprender ao vivo.')),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn line', onclick: () => ((lab.points = []), (lab.net = null), set({})) }, icon('trash'), 'Limpar'),
        h(
          'button',
          { type: 'button', class: 'btn primary', disabled: classesUsed().length < 2, onclick: useAsDataset, title: 'Leva estes pontos para a tela Dados, como um CSV' },
          'Usar como dataset',
          icon('arrow'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'lab-grid' },
      h('section', { class: 'card lab-board' }, canvas, hint),
      h(
        'section',
        { class: 'card lab-side' },
        h('div', { class: 'lbl wide' }, 'Classe do próximo ponto'),
        segmented(
          LABELS.map((l, i) => ({ value: String(i), label: `${['●', '○', '×'][i]}  ${l}` })),
          String(lab.cls),
          (v) => ((lab.cls = Number(v)), set({})),
          { label: 'Classe do ponto' },
        ),
        h('div', { class: 'lbl wide' }, 'Exemplos'),
        h(
          'div',
          { class: 'examples', style: 'justify-content:flex-start' },
          h('button', { type: 'button', class: 'btn line small', onclick: () => (preset('circulo'), set({})) }, icon('circle'), 'Círculo'),
          h('button', { type: 'button', class: 'btn line small', onclick: () => (preset('xor'), set({})) }, icon('xor'), 'XOR'),
          h('button', { type: 'button', class: 'btn line small', onclick: () => (preset('espiral'), set({})) }, icon('spiral'), 'Espiral'),
        ),
        h('div', { class: 'lbl wide' }, 'Rede'),
        h(
          'div',
          { class: 'lab-row' },
          h('span', null, 'Camadas ocultas'),
          stepper(lab.layers, 1, 4, (v) => ((lab.layers = v), set({})), 'camadas ocultas'),
        ),
        h(
          'div',
          { class: 'lab-row' },
          h('span', null, 'Neurônios por camada'),
          stepper(lab.neurons, 1, 32, (v) => ((lab.neurons = v), set({})), 'neurônios por camada'),
        ),
        segmented<ActivationName>(
          (['tanh', 'relu', 'sigmoid'] as ActivationName[]).map((a) => ({ value: a, label: a === 'relu' ? 'ReLU' : a[0].toUpperCase() + a.slice(1) })),
          lab.activation,
          (a) => ((lab.activation = a), set({})),
          { label: 'Ativação das camadas ocultas' },
        ),
        h('div', { class: 'lbl wide' }, 'Taxa de aprendizado'),
        segmented(
          rates.map((r) => ({ value: String(r), label: String(r).replace('.', ',') })),
          String(lab.rate),
          (v) => ((lab.rate = Number(v)), set({})),
          { label: 'Taxa de aprendizado' },
        ),
        h(
          'div',
          { class: 'stats' },
          h('div', null, h('span', { class: 'lbl wide' }, 'Épocas'), epEl),
          h('div', null, h('span', { class: 'lbl wide' }, 'Erro'), errEl),
          h('div', null, h('span', { class: 'lbl wide' }, 'Acerto'), accEl),
        ),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { type: 'button', class: 'btn line small', onclick: () => ((lab.running = !lab.running), set({})) },
            icon(lab.running ? 'pause' : 'play'),
            lab.running ? 'Pausar' : 'Continuar',
          ),
          h('button', { type: 'button', class: 'btn line small', onclick: () => ((lab.net = null), (lab.steps = 0), set({})) }, icon('restart'), 'Recomeçar pesos'),
        ),
      ),
    ),
  );
}
