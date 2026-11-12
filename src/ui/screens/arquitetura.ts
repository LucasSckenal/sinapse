import { ACTIVATION_NAMES, ACTIVATIONS, type ActivationName } from '../../core/activations';
import { checkCompatibility } from '../../core/dataset';
import { initFor } from '../../core/initialization';
import { Network, type Architecture } from '../../core/network';
import { h, icon, notice, parseNum, segmented, stepper, toast } from '../dom';
import { NetView } from '../netview';
import { DEFAULT_HIDDEN, resetTraining, set, state } from '../state';

const MAX_NEURONS = 256;
const MAX_HIDDEN = 8;
/** Índice da camada recém-adicionada (só ela anima ao entrar). */
let justAdded = -1;

/** Ajusta entradas e neurônios de saída ao dataset escolhido. */
export function syncArchWithData(): void {
  const { inputs, outputs } = state.selection;
  if (!state.table || !inputs.length || !outputs.length) return;
  const layers = state.arch.layers.slice();
  // sugere a ativação de saída pela faixa dos valores esperados
  const vals = state.table.rows.flatMap((r) => outputs.map((c) => r[c]));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const activation: ActivationName = lo >= 0 && hi <= 1 ? 'sigmoid' : lo >= -1 && hi <= 1 ? 'tanh' : 'linear';
  layers[layers.length - 1] = { neurons: outputs.length, activation };
  set({ arch: { inputs: inputs.length, layers } });
}

function setArch(arch: Architecture): void {
  set({ arch });
}

function layerRow(i: number): HTMLElement {
  const arch = state.arch;
  const l = arch.layers[i];
  const isOut = i === arch.layers.length - 1;
  const update = (patch: Partial<typeof l>) => {
    const layers = arch.layers.slice();
    layers[i] = { ...l, ...patch };
    setArch({ ...arch, layers });
  };
  return h(
    'div',
    { class: `layer-row ${i === justAdded ? 'new' : ''}` },
    h('div', { class: 'name wide' }, isOut ? 'Saída' : `Oculta ${i + 1}`),
    stepper(l.neurons, 1, MAX_NEURONS, (v) => update({ neurons: v }), `neurônios da camada ${isOut ? 'de saída' : `oculta ${i + 1}`}`),
    h(
      'div',
      { class: 'acts' },
      segmented<ActivationName>(
        ACTIVATION_NAMES.map((a) => ({ value: a, label: ACTIVATIONS[a].label })),
        l.activation,
        (a) => update({ activation: a }),
        { label: 'Função de ativação' },
      ),
      h('span', { class: 'init', title: 'Inicialização dos pesos' }, initFor(l.activation) === 'he' ? 'He' : 'Xavier'),
    ),
    isOut
      ? h('span')
      : h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': `Remover camada oculta ${i + 1}`,
            onclick: () => setArch({ ...arch, layers: arch.layers.filter((_, k) => k !== i) }),
          },
          icon('x'),
        ),
  );
}

function createNetwork(): void {
  try {
    const net = Network.create(state.arch, state.initSeed);
    const t = state.table;
    const columns = t
      ? {
          entradas: state.selection.inputs.map((c) => t.headers[c]),
          saidas: state.selection.outputs.map((c) => t.headers[c]),
        }
      : undefined;
    const compatible = columns && columns.entradas.length === net.inputCount && columns.saidas.length === net.outputCount;
    set({
      model: { net, normalization: null, columns: compatible ? columns : undefined },
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
  const problems = state.table ? checkCompatibility(arch, state.selection) : [];
  const total = arch.layers.reduce((acc, l, i) => acc + l.neurons * ((i === 0 ? arch.inputs : arch.layers[i - 1].neurons) + 1), 0);

  const addHidden = () => {
    const layers = arch.layers.slice();
    const prev = layers[layers.length - 2];
    justAdded = layers.length - 1;
    layers.splice(layers.length - 1, 0, { neurons: prev?.neurons ?? 4, activation: prev?.activation ?? DEFAULT_HIDDEN });
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
            { class: 'layer-row' },
            h('div', { class: 'name wide' }, 'Entradas'),
            stepper(arch.inputs, 1, MAX_NEURONS, (v) => setArch({ ...arch, inputs: v }), 'entradas'),
            h('div', { class: 'acts' }, h('span', { class: 'muted', style: 'font-size:12px' }, state.table ? `${state.selection.inputs.length} ${state.selection.inputs.length === 1 ? 'coluna' : 'colunas'} no dataset` : '')),
            h('span'),
          ),
          arch.layers.map((_, i) => layerRow(i)),
          ((justAdded = -1), null),
        ),
        h(
          'button',
          { type: 'button', class: 'btn line small add-layer', disabled: hidden >= MAX_HIDDEN, onclick: addHidden },
          icon('plus'),
          'Camada oculta',
        ),
        problems.length ? problems.map((p) => notice(p, 'err')) : state.table ? notice('Combina com o dataset.', 'ok') : null,
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
