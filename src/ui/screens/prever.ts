import { NORMALIZATION_LABELS } from '../../core/normalization';
import { predict } from '../../core/predict';
import { fmt, h, icon, notice, parseNum } from '../dom';
import { set, state } from '../state';

/** Valores digitados ficam guardados enquanto a mesma rede estiver aberta. */
let draft: string[] = [];
let draftFor: unknown = null;

export function preverScreen(): HTMLElement {
  const model = state.model;
  if (!model)
    return h(
      'div',
      { class: 'screen' },
      h('div', { class: 'head' }, h('h1', { class: 'wide' }, 'Prever')),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'wide' }, 'Sem rede'),
        h('p', null, 'Treine uma rede ou abra uma salva.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => set({ screen: 'arquitetura' }) }, 'Arquitetura', icon('arrow')),
      ),
    );

  const net = model.net;
  if (draftFor !== model) {
    draft = Array(net.inputCount).fill('');
    draftFor = model;
  }
  const inNames = model.columns?.entradas ?? Array.from({ length: net.inputCount }, (_, i) => `Entrada ${i + 1}`);
  const outNames = model.columns?.saidas ?? Array.from({ length: net.outputCount }, (_, i) => `Saída ${i + 1}`);

  const outBox = h('div', { class: 'outs', 'aria-live': 'polite' });
  const errBox = h('div');
  let expected: number[] | null = null;

  const showOutputs = (values: number[] | null) => {
    const max = values ? Math.max(1e-9, ...values.map(Math.abs)) : 1;
    outBox.replaceChildren(
      ...outNames.map((name, k) =>
        h(
          'div',
          { class: 'out-row' },
          h('div', null, h('div', null, name), expected ? h('div', { class: 'exp mono' }, `esperado ${fmt(expected[k])}`) : null),
          h('b', { class: values ? 'flash' : '', style: values ? '' : 'color:var(--t3)' }, values ? fmt(values[k]) : '—'),
          outNames.length > 1 ? h('div', { class: 'out-bar' }, h('span', { style: `width:${values ? (Math.abs(values[k]) / max) * 100 : 0}%` })) : null,
        ),
      ),
    );
  };

  const inputs = inNames.map((name, i) =>
    h('input', {
      class: 'input',
      inputmode: 'decimal',
      value: draft[i],
      'aria-label': name,
      placeholder: '0',
      oninput: (e: Event) => {
        draft[i] = (e.target as HTMLInputElement).value;
        expected = null;
        (e.target as HTMLInputElement).removeAttribute('aria-invalid');
      },
    }),
  );

  const run = () => {
    errBox.replaceChildren();
    const values = draft.map(parseNum);
    const bad = values.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) {
      inputs[bad].setAttribute('aria-invalid', 'true');
      inputs[bad].focus();
      errBox.replaceChildren(notice(`Preencha "${inNames[bad]}" com um número.`, 'err'));
      return;
    }
    try {
      showOutputs(predict(model, values));
    } catch (e) {
      errBox.replaceChildren(notice((e as Error).message, 'err'));
    }
  };

  /** Preenche com uma linha real do dataset aberto, para comparar com o esperado. */
  const t = state.table;
  const canSample =
    !!t &&
    !!model.columns &&
    model.columns.entradas.every((n) => t.headers.includes(n)) &&
    model.columns.saidas.every((n) => t.headers.includes(n));
  const sample = () => {
    if (!t || !model.columns) return;
    const row = t.rows[Math.floor(Math.random() * t.rows.length)];
    draft = model.columns.entradas.map((n) => String(row[t.headers.indexOf(n)]).replace('.', ','));
    expected = model.columns.saidas.map((n) => row[t.headers.indexOf(n)]);
    inputs.forEach((el, i) => (el.value = draft[i]));
    run();
  };

  /** Colar a linha inteira: valores separados por ; espaço ou tab (a vírgula é a casa decimal). */
  const lineInput = h('input', {
    class: 'input',
    'aria-label': 'Linha de valores',
    placeholder: Array.from({ length: Math.min(net.inputCount, 4) }, (_, i) => ['0,5', '12', '3,1', '7'][i]).join('; ') + (net.inputCount > 4 ? '; …' : ''),
  });
  const runLine = () => {
    errBox.replaceChildren();
    const raw = lineInput.value.trim();
    if (!raw) return;
    const parts = raw.split(/[;\s]+/).filter(Boolean);
    const values = parts.map(parseNum);
    try {
      const out = predict(model, values);
      lineInput.removeAttribute('aria-invalid');
      draft = parts.slice();
      inputs.forEach((el, i) => (el.value = draft[i]));
      expected = null;
      showOutputs(out);
    } catch (e) {
      lineInput.setAttribute('aria-invalid', 'true');
      errBox.replaceChildren(notice((e as Error).message, 'err'));
    }
  };
  lineInput.addEventListener('input', () => lineInput.removeAttribute('aria-invalid'));
  lineInput.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), runLine()));

  showOutputs(null);
  const normTxt = model.normalization ? `entradas normalizadas com ${NORMALIZATION_LABELS[model.normalization.tipo]}` : 'sem normalização';

  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'head' },
      h('div', null, h('h1', { class: 'wide' }, 'Prever'), h('div', { class: 'sub' }, `${net.inputCount} ${net.inputCount === 1 ? 'entrada' : 'entradas'} · ${normTxt}`)),
      h(
        'div',
        { class: 'actions' },
        canSample ? h('button', { type: 'button', class: 'btn line', onclick: sample }, icon('dice'), 'Linha do dataset') : null,
        h('button', { type: 'button', class: 'btn primary', onclick: run }, 'Prever', icon('arrow')),
      ),
    ),
    !state.modelTrained ? notice('Esta rede ainda não foi treinada; as saídas vêm dos pesos iniciais.') : null,
    h(
      'div',
      { class: 'grid2' },
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'lbl wide' }, 'Entradas'),
        h(
          'form',
          {
            class: 'pred-inputs',
            onsubmit: (e: Event) => {
              e.preventDefault();
              expected = null;
              run();
            },
          },
          inNames.map((name, i) => h('label', { class: 'field' }, h('span', { title: name }, name), inputs[i])),
          h('button', { type: 'submit', hidden: true }),
        ),
        h(
          'div',
          { class: 'line-field' },
          h('label', { class: 'field', style: 'flex:1' }, h('span', null, 'Ou cole a linha inteira'), lineInput),
          h('button', { type: 'button', class: 'btn line small', onclick: runLine }, 'Usar'),
        ),
        errBox,
      ),
      h('section', { class: 'card' }, h('div', { class: 'lbl wide' }, 'Saídas'), outBox),
    ),
  );
}
