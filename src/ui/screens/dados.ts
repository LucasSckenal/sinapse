import { parseCSV, splitSizes, validatePercent, type SplitPercent, type Table } from '../../core/dataset';
import { NORMALIZATION_LABELS, type NormalizationName } from '../../core/normalization';
import { fmt, h, icon, notice, parseNum, segmented, toast } from '../dom';
import { resetTraining, set, state } from '../state';
import { syncArchWithData } from './arquitetura';

const EXAMPLES = [
  { file: 'xor.csv', label: 'XOR' },
  { file: 'seno.csv', label: 'Seno' },
  { file: 'circulo.csv', label: 'Círculo' },
];

type Role = 'entrada' | 'saida' | 'nada';

export function loadTable(table: Table, fileName: string): void {
  const n = table.headers.length;
  // sugestão: colunas 0/1 no fim (ex.: one-hot de classes) viram saída; senão, só a última
  const binary = (c: number) => table.rows.every((r) => r[c] === 0 || r[c] === 1);
  let first = n - 1;
  while (first > 0 && binary(first - 1) && binary(n - 1)) first--;
  if (first === 0 || (first < n - 1 && binary(first - 1))) first = n - 1;
  const inputs = Array.from({ length: first }, (_, i) => i);
  const outputs = Array.from({ length: n - first }, (_, i) => first + i);
  set({ table, fileName, selection: { inputs, outputs }, ...resetTraining() });
  syncArchWithData();
}

async function readFile(file: File): Promise<void> {
  if (!/\.(csv|txt)$/i.test(file.name)) {
    toast('Escolha um arquivo .csv.', 'err');
    return;
  }
  try {
    loadTable(parseCSV(await file.text()), file.name);
    toast(`${file.name} carregado`);
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function loadExample(file: string): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}exemplos/${file}`);
    if (!res.ok) throw new Error('Não deu para abrir o exemplo.');
    loadTable(parseCSV(await res.text()), file);
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

function dropZone(): HTMLElement {
  const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: () => input.files?.[0] && readFile(input.files[0]) });
  const hint = h('div', { class: 'drop-hint' }, 'Arraste um CSV ou clique para escolher');
  const zone = h(
    'div',
    {
      class: 'drop',
      role: 'button',
      tabindex: 0,
      'aria-label': 'Escolher arquivo CSV',
      onclick: (e: Event) => !(e.target as HTMLElement).closest('.examples') && input.click(),
      onkeydown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()),
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.add('over');
        hint.textContent = 'Solte aqui';
      },
      ondragleave: (e: DragEvent) => {
        if (zone.contains(e.relatedTarget as Node)) return;
        zone.classList.remove('over');
        hint.textContent = 'Arraste um CSV ou clique para escolher';
      },
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.remove('over');
        const f = e.dataTransfer?.files?.[0];
        if (f) readFile(f);
      },
    },
    h('div', null, h('div', { class: 'big wide' }, 'Solte um CSV'), h('div', { style: 'margin-top:12px' }, hint)),
    h(
      'div',
      { style: 'display:grid;gap:12px;justify-items:center' },
      h('span', { class: 'lbl wide' }, 'Ou use um exemplo'),
      h('div', { class: 'examples' }, EXAMPLES.map((ex) => h('button', { type: 'button', class: 'btn line small', onclick: () => loadExample(ex.file) }, ex.label))),
    ),
    input,
  );
  return zone;
}

function roleOf(i: number): Role {
  if (state.selection.inputs.includes(i)) return 'entrada';
  if (state.selection.outputs.includes(i)) return 'saida';
  return 'nada';
}

function setRole(i: number, role: Role): void {
  const inputs = state.selection.inputs.filter((c) => c !== i);
  const outputs = state.selection.outputs.filter((c) => c !== i);
  if (role === 'entrada') inputs.push(i);
  if (role === 'saida') outputs.push(i);
  set({ selection: { inputs: inputs.sort((a, b) => a - b), outputs: outputs.sort((a, b) => a - b) }, ...resetTraining() });
  syncArchWithData();
}

function columnsCard(table: Table): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'lbl wide' }, 'Colunas'),
    h(
      'div',
      { class: 'cols' },
      table.headers.map((name, i) => {
        const col = table.rows.map((r) => r[i]);
        const min = Math.min(...col);
        const max = Math.max(...col);
        return h(
          'div',
          { class: 'col-row' },
          h('div', { style: 'min-width:0' }, h('div', { class: 'col-name', title: name }, name), h('div', { class: 'col-range mono' }, `${fmt(min, 2)} a ${fmt(max, 2)}`)),
          segmented<Role>(
            [
              { value: 'entrada', label: 'Entrada' },
              { value: 'saida', label: 'Saída' },
              { value: 'nada', label: 'Ignorar' },
            ],
            roleOf(i),
            (r) => setRole(i, r),
            { label: `Papel da coluna ${name}` },
          ),
        );
      }),
    ),
    state.selection.inputs.length === 0 ? notice('Marque ao menos uma coluna como entrada.', 'err') : null,
    state.selection.outputs.length === 0 ? notice('Marque ao menos uma coluna como saída.', 'err') : null,
  );
}

function splitCard(table: Table): HTMLElement {
  const p = state.percent;
  let err = '';
  try {
    validatePercent(p);
  } catch (e) {
    err = (e as Error).message;
  }
  const [a, b, c] = splitSizes(table.rows.length, p);
  const field = (key: keyof SplitPercent, label: string, sw: string) =>
    h(
      'label',
      { class: 'field' },
      h('span', null, h('i', { class: 'sw', style: `background:${sw}` }), label),
      h('input', {
        class: 'input',
        inputmode: 'decimal',
        value: String(p[key]).replace('.', ','),
        'aria-invalid': String(!!err),
        onchange: (e: Event) => {
          const v = parseNum((e.target as HTMLInputElement).value);
          set({ percent: { ...p, [key]: Number.isFinite(v) ? v : p[key] }, ...resetTraining() });
        },
      }),
    );
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'lbl wide' }, 'Divisão'),
    h(
      'div',
      { class: 'split-bar', 'aria-hidden': 'true' },
      h('span', { class: 'tr', style: `flex-grow:${Math.max(0, p.treino)}` }),
      h('span', { class: 'va', style: `flex-grow:${Math.max(0, p.validacao)}` }),
      h('span', { class: 'te', style: `flex-grow:${Math.max(0, p.teste)}` }),
    ),
    h('div', { class: 'split-fields' }, field('treino', 'Treino %', 'var(--t1)'), field('validacao', 'Validação %', 'var(--t3)'), field('teste', 'Teste %', 'var(--line2)')),
    err ? notice(err, 'err') : h('div', { class: 'counts mono' }, `${a} · ${b} · ${c} linhas`),
    h(
      'label',
      { class: 'field' },
      h('span', null, 'Semente da divisão'),
      h('input', {
        class: 'input',
        inputmode: 'numeric',
        value: String(state.splitSeed),
        onchange: (e: Event) => {
          const v = Math.round(parseNum((e.target as HTMLInputElement).value));
          set({ splitSeed: Number.isFinite(v) ? v : state.splitSeed, ...resetTraining() });
        },
      }),
    ),
    h('div', { class: 'lbl wide', style: 'margin-top:6px' }, 'Normalização das entradas'),
    segmented<NormalizationName>(
      (Object.keys(NORMALIZATION_LABELS) as NormalizationName[]).map((v) => ({ value: v, label: NORMALIZATION_LABELS[v] })),
      state.normalization,
      (v) => set({ normalization: v, ...resetTraining() }),
      { label: 'Normalização das entradas' },
    ),
    h('div', { class: 'counts' }, 'Calculada só com o treino.'),
  );
}

export function dadosScreen(): HTMLElement {
  const t = state.table;
  if (!t)
    return h('div', { class: 'screen' }, h('div', { class: 'head' }, h('div', null, h('h1', { class: 'wide' }, 'Dados'), h('div', { class: 'sub' }, 'Um CSV numérico, já limpo.'))), dropZone());

  const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: () => input.files?.[0] && readFile(input.files[0]) });
  const ready = state.selection.inputs.length > 0 && state.selection.outputs.length > 0;
  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'head' },
      h('div', null, h('h1', { class: 'wide' }, 'Dados'), h('div', { class: 'sub mono' }, `${state.fileName} · ${t.rows.length} linhas · ${t.headers.length} colunas`)),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn line', onclick: () => input.click() }, 'Trocar arquivo'),
        h('button', { type: 'button', class: 'btn primary', disabled: !ready, onclick: () => set({ screen: 'arquitetura' }) }, 'Arquitetura', icon('arrow')),
        input,
      ),
    ),
    h('div', { class: 'grid2' }, columnsCard(t), splitCard(t)),
  );
}
