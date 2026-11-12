import { ACTIVATION_NAMES, ACTIVATIONS, type ActivationName } from '../../core/activations';
import { checkCompatibility, codingsFor, modelMeta, selectionWidths } from '../../core/dataset';
import { expandedNames } from '../../core/encoding';
import { initFor } from '../../core/initialization';
import { Network, blocksOf, validateArchitecture, withBlocks, type Architecture, type BlockSpec } from '../../core/network';
import { h, icon, notice, parseNum, segmented, stepper, toast } from '../dom';
import { NetView } from '../netview';
import { DEFAULT_HIDDEN, resetTraining, set, state } from '../state';

const MAX_NEURONS = 256;
const MAX_HIDDEN = 8;
const MAX_BLOCKS = 6;
/** Índice da camada recém-adicionada (só ela anima ao entrar). */
let justAdded = -1;

/** Ajusta entradas e neurônios de saída ao dataset escolhido. */
export function syncArchWithData(): void {
  const { inputs, outputs } = state.selection;
  if (!state.table || !inputs.length || !outputs.length) return;
  const layers = state.arch.layers.slice();
  const t = state.table;
  // sugere a ativação de saída pela faixa dos valores esperados (rótulos viram 0/1: sigmoid)
  const vals = t.rows.flatMap((r) => outputs.filter((c) => !t.classes[c]).map((c) => r[c]));
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const activation: ActivationName = lo >= 0 && hi <= 1 ? 'sigmoid' : lo >= -1 && hi <= 1 ? 'tanh' : 'linear';
  const w = selectionWidths(t, state.selection);
  layers[layers.length - 1] = { neurons: w.outputs, activation };
  set({ arch: { inputs: w.inputs, layers } });
}

function setArch(arch: Architecture): void {
  set({ arch });
}

const LETTERS = 'ABCDEFGHIJKLMNOP';

function blocksAt(arch: Architecture, i: number): BlockSpec[] {
  return blocksOf(arch.layers[i]).map((b) => ({ ...b, ...(b.from ? { from: b.from.slice() } : {}) }));
}

/** Troca os blocos da camada i e conserta as origens da camada seguinte (índices de blocos). */
function setBlocks(arch: Architecture, i: number, blocks: BlockSpec[], removed?: number): Architecture {
  const layers = arch.layers.slice();
  layers[i] = withBlocks(blocks);
  if (removed !== undefined && i + 1 < layers.length) {
    const next = blocksAt({ ...arch, layers }, i + 1).map((b) => {
      if (!b.from) return b;
      const from = b.from.filter((f) => f !== removed).map((f) => (f > removed ? f - 1 : f));
      return from.length ? { ...b, from } : { neurons: b.neurons, activation: b.activation };
    });
    layers[i + 1] = withBlocks(next);
  }
  return { ...arch, layers };
}

/** Nomes do que a camada i pode receber: entradas (1ª camada) ou blocos da anterior. */
function sourceNames(arch: Architecture, i: number): string[] {
  if (i > 0) {
    const prev = blocksOf(arch.layers[i - 1]);
    return prev.map((b, k) => (prev.length > 1 ? `${LETTERS[k]} · ${b.neurons}` : `Oculta ${i}`));
  }
  const t = state.table;
  if (t && selectionWidths(t, state.selection).inputs === arch.inputs) return expandedNames(codingsFor(t, state.selection.inputs));
  return Array.from({ length: arch.inputs }, (_, k) => `entrada ${k + 1}`);
}

function blockRow(i: number, k: number): HTMLElement {
  const arch = state.arch;
  const blocks = blocksAt(arch, i);
  const b = blocks[k];
  const isOut = i === arch.layers.length - 1;
  const multi = blocks.length > 1;
  const update = (patch: Partial<BlockSpec>) => {
    const next = blocks.slice();
    next[k] = { ...b, ...patch };
    if ('from' in patch && patch.from === undefined) delete next[k].from;
    setArch(setBlocks(arch, i, next));
  };
  const names = sourceNames(arch, i);
  const active = new Set(b.from ?? names.map((_, n) => n));
  const toggle = (n: number) => {
    const set2 = new Set(active);
    if (set2.has(n)) set2.delete(n);
    else set2.add(n);
    const from = [...set2].sort((x, y) => x - y);
    update(from.length === names.length ? { from: undefined } : { from });
  };
  const label = `${isOut ? 'saída' : `oculta ${i + 1}`}${multi ? `, bloco ${LETTERS[k]}` : ''}`;
  // a 1ª camada sempre mostra as entradas; as outras só quando há escolha (vários blocos atrás ou origem marcada)
  const showSources = i === 0 ? multi || !!b.from : names.length > 1 || !!b.from;
  return h(
    'div',
    { class: `block-row ${multi ? 'multi' : ''}` },
    h(
      'div',
      { class: 'block-main' },
      multi ? h('span', { class: 'block-tag mono', title: `Bloco ${LETTERS[k]}` }, LETTERS[k]) : null,
      stepper(b.neurons, 1, MAX_NEURONS, (v) => update({ neurons: v }), `neurônios da camada ${label}`),
      h(
        'div',
        { class: 'acts' },
        segmented<ActivationName>(
          ACTIVATION_NAMES.map((a) => ({ value: a, label: ACTIVATIONS[a].label })),
          b.activation,
          (a) => update({ activation: a }),
          { label: `Função de ativação da camada ${label}` },
        ),
        h('span', { class: 'init', title: 'Inicialização dos pesos' }, initFor(b.activation) === 'he' ? 'He' : 'Xavier'),
      ),
      multi
        ? h(
            'button',
            { type: 'button', class: 'icon-btn', 'aria-label': `Remover bloco ${LETTERS[k]} da camada ${isOut ? 'de saída' : `oculta ${i + 1}`}`, onclick: () => setArch(setBlocks(arch, i, blocks.filter((_, x) => x !== k), k)) },
            icon('x'),
          )
        : null,
    ),
    showSources
      ? h(
          'div',
          { class: 'sources' },
          h('span', { class: 'src-label' }, 'recebe de'),
          names.map((nm, n) =>
            h(
              'button',
              {
                type: 'button',
                class: 'chip',
                'aria-pressed': String(active.has(n)),
                title: active.has(n) ? `Desligar ${nm}` : `Ligar ${nm}`,
                onclick: () => toggle(n),
              },
              nm,
            ),
          ),
          active.size === 0 ? h('span', { class: 'src-warn' }, 'marque ao menos uma') : null,
        )
      : null,
  );
}

function layerGroup(i: number): HTMLElement {
  const arch = state.arch;
  const isOut = i === arch.layers.length - 1;
  const blocks = blocksAt(arch, i);
  const addBlock = () => {
    const last = blocks[blocks.length - 1];
    setArch(setBlocks(arch, i, [...blocks, { neurons: Math.max(1, Math.min(4, last.neurons)), activation: last.activation }]));
  };
  const removeLayer = () => {
    const layers = arch.layers.filter((_, k) => k !== i);
    // a camada que vinha depois perde as origens (elas apontavam para os blocos removidos)
    if (layers[i]) layers[i] = withBlocks(blocksOf(layers[i]).map((b) => ({ neurons: b.neurons, activation: b.activation })));
    setArch({ ...arch, layers });
  };
  return h(
    'div',
    { class: `layer-group ${i === justAdded ? 'new' : ''} ${blocks.length > 1 ? 'parallel' : ''}` },
    h(
      'div',
      { class: 'layer-head' },
      h('div', { class: 'name wide' }, isOut ? 'Saída' : `Oculta ${i + 1}`),
      blocks.length > 1 ? h('span', { class: 'muted', style: 'font-size:12px' }, `${blocks.length} blocos em paralelo`) : null,
      h(
        'div',
        { class: 'layer-actions' },
        h('button', { type: 'button', class: 'btn line small', disabled: blocks.length >= MAX_BLOCKS, onclick: addBlock, title: 'Adicionar um bloco em paralelo nesta camada' }, icon('plus'), 'Bloco'),
        isOut ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remover camada oculta ${i + 1}`, onclick: removeLayer }, icon('x')),
      ),
    ),
    blocks.map((_, k) => blockRow(i, k)),
  );
}

function createNetwork(): void {
  try {
    const net = Network.create(state.arch, state.initSeed);
    const t = state.table;
    const compatible = t && checkCompatibility(net.architecture, t, state.selection).length === 0;
    const meta = compatible ? modelMeta(t, state.selection) : {};
    set({
      model: { net, normalization: null, ...meta },
      modelName: state.fileName ? state.fileName.replace(/\.\w+$/, '') : 'rede',
      modelTrained: false,
      ...resetTraining(),
      screen: 'treino',
    });
    toast('Rede criada');
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

export function arquiteturaScreen(): HTMLElement {
  const arch = state.arch;
  const hidden = arch.layers.length - 1;
  const busy = state.status === 'rodando' || state.status === 'pausado';
  const problems = state.table ? checkCompatibility(arch, state.table, state.selection) : [];
  let archError = '';
  try {
    validateArchitecture(arch);
  } catch (e) {
    archError = (e as Error).message;
  }
  let total = 0;
  try {
    total = Network.create(arch, 1).layers.reduce((acc, l) => acc + l.neurons.reduce((x, n) => x + n.weights.length + 1, 0), 0);
  } catch {
    total = 0;
  }

  const addHidden = () => {
    const layers = arch.layers.slice();
    const prev = layers[layers.length - 2];
    layers.splice(layers.length - 1, 0, { neurons: prev?.neurons ?? 4, activation: prev?.activation ?? DEFAULT_HIDDEN });
    justAdded = layers.length - 2;
    // a saída passa a receber da camada nova: as origens antigas deixam de valer
    const out = layers.length - 1;
    layers[out] = withBlocks(blocksOf(layers[out]).map((b) => ({ neurons: b.neurons, activation: b.activation })));
    setArch({ ...arch, layers });
  };

  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'head' },
      h('div', null, h('h1', { class: 'wide' }, 'Arquitetura'), h('div', { class: 'sub mono' }, `${total.toLocaleString('pt-BR')} parâmetros`)),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', disabled: busy, title: busy ? 'Pare o treino antes de criar outra rede' : undefined, onclick: createNetwork }, 'Criar rede', icon('arrow')),
      ),
    ),
    busy ? notice('Há um treino em andamento. Pare o treino para criar outra rede.') : null,
    h(
      'div',
      { class: 'grid2 stretch' },
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'lbl wide' }, 'Camadas'),
        h(
          'div',
          { class: 'layers' },
          h(
            'div',
            { class: 'layer-group' },
            h(
              'div',
              { class: 'layer-head' },
              h('div', { class: 'name wide' }, 'Entradas'),
              stepper(
                arch.inputs,
                1,
                MAX_NEURONS,
                (v) => {
                  // origens da 1ª camada que deixam de existir são descartadas
                  const first = blocksAt(arch, 0).map((b) => {
                    if (!b.from) return b;
                    const from = b.from.filter((f) => f < v);
                    return from.length ? { ...b, from } : { neurons: b.neurons, activation: b.activation };
                  });
                  setArch(setBlocks({ ...arch, inputs: v }, 0, first));
                },
                'entradas',
              ),
              h('span', { class: 'muted', style: 'font-size:12px' }, state.table ? `o dataset pede ${selectionWidths(state.table, state.selection).inputs}` : ''),
            ),
          ),
          arch.layers.map((_, i) => layerGroup(i)),
          ((justAdded = -1), null),
        ),
        h(
          'button',
          { type: 'button', class: 'btn line small add-layer', disabled: hidden >= MAX_HIDDEN, onclick: addHidden },
          icon('plus'),
          'Camada oculta',
        ),
        archError ? notice(archError, 'err') : null,
        problems.length ? problems.map((p) => notice(p, 'err')) : state.table && !archError ? notice('Combina com o dataset.', 'ok') : null,
        h(
          'label',
          { class: 'field', style: 'max-width:200px' },
          h('span', null, 'Semente dos pesos'),
          h('input', {
            class: 'input',
            inputmode: 'numeric',
            'aria-label': 'Semente dos pesos',
            value: String(state.initSeed),
            onchange: (e: Event) => {
              const v = Math.round(parseNum((e.target as HTMLInputElement).value));
              set({ initSeed: Number.isFinite(v) ? v : state.initSeed, ...resetTraining() });
            },
          }),
        ),
      ),
      h('section', { class: 'card', style: 'min-height:420px' }, h('div', { class: 'lbl wide' }, 'Prévia'), new NetView(arch).el),
    ),
  );
}
