import type { ColumnCoding, Decoded } from '../../core/encoding';
import { NORMALIZATION_LABELS } from '../../core/normalization';
import { predictColumns } from '../../core/predict';
import { fmt, h, icon, notice, parseNum, segmented } from '../dom';
import { set, state } from '../state';
import { predictNetFor } from '../net3d-mount';

/** Valores digitados ficam guardados enquanto a mesma rede estiver aberta. */
let draft: string[] = [];
let draftFor: unknown = null;
/** Esperado da "Linha do dataset", entregue ao próximo desenho da tela. */
let pendingExpected: Decoded[] | null = null;

function inputCodings(): ColumnCoding[] {
  const m = state.model!;
  return m.codings?.entradas ?? Array.from({ length: m.net.inputCount }, (_, i) => ({ nome: m.columns?.entradas[i] ?? `Entrada ${i + 1}`, tipo: 'numero' as const }));
}

/** Converte o texto digitado no valor da coluna: número, ou o índice da classe pelo nome. */
function readValue(c: ColumnCoding, text: string): number {
  if (c.tipo === 'numero') return parseNum(text);
  const t = text.trim();
  const i = c.classes.findIndex((k) => k === t || k.toLowerCase() === t.toLowerCase());
  return i;
}

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

  const cods = inputCodings();
  if (draftFor !== model) {
    draft = cods.map((c) => (c.tipo === 'classe' ? c.classes[0] : ''));
    draftFor = model;
  }

  const outBox = h('div', { class: 'outs', 'aria-live': 'polite' });
  const errBox = h('div');
  const net3d = predictNetFor(model);
  const netHost = net3d.el;
  let expected: Decoded[] | null = pendingExpected;
  let lastManual = 0;
  pendingExpected = null;

  const showOutputs = (decoded: Decoded[] | null) => {
    if (!decoded) {
      outBox.replaceChildren(h('p', { class: 'muted', style: 'padding:14px 4px' }, 'As saídas aparecem aqui.'));
      return;
    }
    outBox.replaceChildren(
      ...decoded.map((d, k) => {
        const exp = expected?.[k];
        if (d.tipo === 'numero')
          return h(
            'div',
            { class: 'out-row' },
            h('div', null, h('div', null, d.nome), exp && exp.tipo === 'numero' ? h('div', { class: 'exp mono' }, `esperado ${fmt(exp.valor)}`) : null),
            h('b', { class: 'flash' }, fmt(d.valor)),
          );
        const max = Math.max(1e-9, ...d.valores.map((v) => Math.abs(v.valor)));
        const hit = exp && exp.tipo === 'classe' ? exp.classe === d.classe : null;
        return h(
          'div',
          { class: 'out-class' },
          h(
            'div',
            { class: 'out-row', style: 'border:0;padding-bottom:6px' },
            h(
              'div',
              null,
              h('div', null, d.nome),
              exp && exp.tipo === 'classe' ? h('div', { class: 'exp mono' }, `esperado ${exp.classe} · ${hit ? 'acertou' : 'errou'}`) : null,
            ),
            h('b', { class: 'flash class-name' }, d.classe),
          ),
          h(
            'div',
            { class: 'class-bars' },
            d.valores.map((v, i) =>
              h(
                'div',
                { class: `class-bar ${i === d.indice ? 'win' : ''}` },
                h('span', { class: 'cn' }, v.classe),
                h('span', { class: 'track' }, h('i', { style: `transform:scaleX(${Math.max(0, v.valor) / max})` })),
                h('span', { class: 'cv mono' }, fmt(v.valor, 3)),
              ),
            ),
          ),
        );
      }),
    );
  };

  const fields: HTMLElement[] = [];
  const textInputs: (HTMLInputElement | null)[] = [];
  cods.forEach((c, i) => {
    if (c.tipo === 'classe') {
      textInputs.push(null);
      const ctrl =
        c.classes.length <= 4
          ? segmented(
              c.classes.map((k) => ({ value: k, label: k })),
              draft[i],
              (v) => {
                draft[i] = v;
                expected = null;
                set({});
              },
              { label: c.nome },
            )
          : h(
              'select',
              {
                class: 'input',
                'aria-label': c.nome,
                onchange: (e: Event) => {
                  draft[i] = (e.target as HTMLSelectElement).value;
                  expected = null;
                },
              },
              c.classes.map((k) => h('option', { value: k, selected: k === draft[i] }, k)),
            );
      fields.push(h('div', { class: 'field' }, h('span', { title: c.nome }, c.nome), ctrl));
      return;
    }
    const input = h('input', {
      class: 'input',
      inputmode: 'decimal',
      value: draft[i],
      'aria-label': c.nome,
      placeholder: '0',
      oninput: (e: Event) => {
        draft[i] = (e.target as HTMLInputElement).value;
        expected = null;
        (e.target as HTMLInputElement).removeAttribute('aria-invalid');
      },
    });
    textInputs.push(input);
    fields.push(h('label', { class: 'field' }, h('span', { title: c.nome }, c.nome), input));
  });

  const run = () => {
    errBox.replaceChildren();
    const values = cods.map((c, i) => readValue(c, draft[i]));
    const bad = values.findIndex((v, i) => (cods[i].tipo === 'numero' ? !Number.isFinite(v) : v < 0));
    if (bad >= 0) {
      textInputs[bad]?.setAttribute('aria-invalid', 'true');
      textInputs[bad]?.focus();
      errBox.replaceChildren(notice(`Preencha "${cods[bad].nome}" com ${cods[bad].tipo === 'numero' ? 'um número' : 'uma das classes'}.`, 'err'));
      return;
    }
    try {
      const r = predictColumns(model, values);
      showOutputs(r.decoded);
      lastManual = performance.now();
      net3d.light();
    } catch (e) {
      errBox.replaceChildren(notice((e as Error).message, 'err'));
    }
  };

  /** Colar a linha inteira: valores separados por ; (a vírgula é a casa decimal). Classes pelo nome. */
  const lineInput = h('input', {
    class: 'input',
    'aria-label': 'Linha de valores',
    placeholder: cods
      .slice(0, 4)
      .map((c, i) => (c.tipo === 'classe' ? c.classes[0] : ['0,5', '12', '3,1', '7'][i]))
      .join('; ') + (cods.length > 4 ? '; …' : ''),
  });
  const runLine = () => {
    errBox.replaceChildren();
    const raw = lineInput.value.trim();
    if (!raw) return;
    const parts = raw.split(/\s*;\s*|\t+/).filter(Boolean);
    if (parts.length !== cods.length) {
      lineInput.setAttribute('aria-invalid', 'true');
      errBox.replaceChildren(notice(`A rede espera ${cods.length} valores de entrada, foram informados ${parts.length}.`, 'err'));
      return;
    }
    const bad = parts.findIndex((p, i) => {
      const v = readValue(cods[i], p);
      return cods[i].tipo === 'numero' ? !Number.isFinite(v) : v < 0;
    });
    if (bad >= 0) {
      lineInput.setAttribute('aria-invalid', 'true');
      const c = cods[bad];
      errBox.replaceChildren(
        notice(c.tipo === 'classe' ? `"${parts[bad]}" não é uma classe de "${c.nome}" (${c.classes.join(', ')}).` : `"${parts[bad]}" não é um número.`, 'err'),
      );
      return;
    }
    lineInput.removeAttribute('aria-invalid');
    draft = parts.map((p, i) => {
      const c = cods[i];
      return c.tipo === 'classe' ? c.classes[readValue(c, p)] : p;
    });
    expected = null;
    textInputs.forEach((el, i) => el && (el.value = draft[i]));
    run();
  };
  lineInput.addEventListener('input', () => lineInput.removeAttribute('aria-invalid'));
  lineInput.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), runLine()));

  /** Preenche com uma linha real do dataset aberto, para comparar com o esperado. */
  const t = state.table;
  const outCods = model.codings?.saidas;
  const colIndex = (name: string) => t?.headers.indexOf(name) ?? -1;
  const canSample = !!t && !!model.codings && [...cods, ...(outCods ?? [])].every((c) => colIndex(c.nome) >= 0);
  const cellText = (c: ColumnCoding, row: number[]): string => {
    const j = colIndex(c.nome);
    const k = t!.classes[j];
    return k ? k[row[j]] : String(row[j]).replace('.', ',');
  };
  const sample = () => {
    if (!t || !outCods) return;
    const row = t.rows[Math.floor(Math.random() * t.rows.length)];
    draft = cods.map((c) => cellText(c, row));
    const expected = outCods.map((c): Decoded => {
      const txt = cellText(c, row);
      return c.tipo === 'classe'
        ? { nome: c.nome, tipo: 'classe', classe: txt, indice: c.classes.indexOf(txt), valores: [] }
        : { nome: c.nome, tipo: 'numero', valor: parseNum(txt) };
    });
    pendingExpected = expected;
    set({});
  };

  showOutputs(null);
  const normTxt = model.normalization ? `normalizadas com ${NORMALIZATION_LABELS[model.normalization.tipo]}` : 'sem normalização';
  const n = cods.length;

  const el = h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'head' },
      h('div', null, h('h1', { class: 'wide' }, 'Prever'), h('div', { class: 'sub' }, `${n} ${n === 1 ? 'entrada' : 'entradas'} · ${normTxt}`)),
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
          fields,
          h('button', { type: 'submit', hidden: true }),
        ),
        h(
          'div',
          { class: 'line-field' },
          h('label', { class: 'field', style: 'flex:1' }, h('span', null, 'Ou cole a linha inteira'), lineInput),
          h('button', { type: 'button', class: 'btn line small', onclick: runLine }, icon('enter'), 'Usar'),
        ),
        errBox,
      ),
      h('section', { class: 'card' }, netHost, h('div', { class: 'lbl wide' }, 'Saídas'), outBox),
    ),
  );

  // depois de "Linha do dataset", roda a previsão já com o esperado
  if (expected) queueMicrotask(run);

  // animação contínua: linhas do dataset passando pela rede (para alguns segundos depois de uma previsão sua)
  const idle = setInterval(() => {
    if (!el.isConnected) {
      clearInterval(idle);
      return;
    }
    if (!canSample || !t || performance.now() - lastManual < 7000) return;
    try {
      const row = t.rows[Math.floor(Math.random() * t.rows.length)];
      predictColumns(model, cods.map((c) => readValue(c, cellText(c, row))));
      net3d.light();
    } catch {
      /* linha que não serve para esta rede: espera a próxima */
    }
  }, 2600);
  return el;
}
