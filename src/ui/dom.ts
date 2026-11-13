type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Cria um elemento: h('button', { class: 'btn', onclick: fn }, 'Texto'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props)
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k in el && k !== 'style' && !k.startsWith('aria') && !k.startsWith('data')) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

/** Ícones de traço único (desenhados aqui, estilo Lucide). */
const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6z',
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  download: 'M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  alert: 'M12 8v5m0 3.5v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14m0 0-5-5m5 5-5 5',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  // telas
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  layers: 'M12 3l9 4.5-9 4.5-9-4.5L12 3zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  // ações
  step: 'M5 5v14l10-7zM19 5v14',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zM14 3v6h6M8 13h8M8 17h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  enter: 'M9 10 4 15l5 5M20 4v7a4 4 0 0 1-4 4H4',
  pencil: 'M15 4l5 5L9 20H4v-5L15 4zM13 6l5 5',
  // vistas
  cube: 'M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5zM3.5 7 12 11.5 20.5 7M12 11.5v10',
  nodes: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 7.5l6.8 3M8.6 16.5l6.8-3',
  mountain: 'M3 20l6-11 4 6 3-4 5 9H3z',
  // exemplos
  xor: 'M5 5l14 14M19 5 5 19',
  wave: 'M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0 3.5-4 5-3',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 12h.01',
  spiral: 'M12 12a1.5 1.5 0 1 1 1.5 1.5 3.5 3.5 0 0 1-3.5-3.5 5 5 0 0 1 5-5 7 7 0 0 1 7 7 8.5 8.5 0 0 1-8.5 8.5A9.5 9.5 0 0 1 2.5 10'
};

export function icon(name: keyof typeof PATHS | string): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: PATHS[name] ?? '' }),
  );
}

/** Logotipo: dois nós ligados. */
export function logo(): SVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'aria-hidden': 'true' },
    svg('circle', { cx: 5, cy: 7, r: 2.5 }),
    svg('circle', { cx: 5, cy: 17, r: 2.5 }),
    svg('circle', { cx: 19, cy: 12, r: 3, fill: 'currentColor' }),
    svg('path', { d: 'M7.4 7.8 16.2 11M7.4 16.2 16.2 13' }),
  );
}

/** Número em pt-BR com casas fixas e vírgula. */
export function fmt(v: number | undefined, digits = 4): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return v.toExponential(2).replace('.', ',');
  return v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Lê número escrito com vírgula ou ponto. */
export function parseNum(s: string): number {
  const t = s.trim().replace(/\s/g, '');
  if (t === '') return NaN;
  if (t.includes(',') && t.includes('.')) {
    // só aceita os dois juntos no formato brasileiro com milhar: 1.234,5
    return /^-?\d{1,3}(\.\d{3})+,\d+$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : NaN;
  }
  if ((t.match(/,/g) ?? []).length > 1) return NaN;
  return Number(t.replace(',', '.'));
}

export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(box);
  }
  const t = h('div', { class: `toast ${kind === 'err' ? 'err' : ''}` }, icon(kind === 'err' ? 'alert' : 'check'), message);
  box.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, kind === 'err' ? 5200 : 2600);
}

export function notice(message: string, kind: 'err' | 'ok' | 'info' = 'info'): HTMLElement {
  return h('div', { class: `notice ${kind}`, role: kind === 'err' ? 'alert' : undefined }, icon(kind === 'ok' ? 'check' : 'alert'), h('span', null, message));
}

export function segmented<T extends string>(
  options: { value: T; label: string; icon?: string }[],
  current: T,
  onChange: (v: T) => void,
  opts: { label: string; disabled?: boolean },
): HTMLElement {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': opts.label },
    options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(o.value === current),
          disabled: opts.disabled,
          onclick: () => o.value !== current && onChange(o.value),
        },
        o.icon ? icon(o.icon) : null,
        o.label,
      ),
    ),
  );
}

export function stepper(value: number, min: number, max: number, onChange: (v: number) => void, label: string): HTMLElement {
  const input = h('input', {
    class: 'mono',
    type: 'number',
    inputmode: 'numeric',
    min,
    max,
    value: String(value),
    'aria-label': label,
    onchange: () => {
      const v = Math.round(Number(input.value));
      onChange(Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : value);
    },
  });
  return h(
    'div',
    { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': `Diminuir ${label}`, disabled: value <= min, onclick: () => onChange(value - 1) }, '−'),
    input,
    h('button', { type: 'button', 'aria-label': `Aumentar ${label}`, disabled: value >= max, onclick: () => onChange(value + 1) }, '+'),
  );
}

export function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
