import { serialize } from '../../core/persistence';
import { MseChart } from '../chart';
import { fmt, h, icon, notice, parseNum } from '../dom';
import { NetView } from '../netview';
import { architectureText, resetTraining, set, state } from '../state';
import { onProgress, pauseTraining, resumeTraining, startTraining, stopTraining, trainBlockers } from '../training';

function emptyState(title: string, text: string, action: string, go: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    h('div', { class: 'head' }, h('h1', { class: 'wide' }, 'Treino')),
    h('div', { class: 'empty' }, h('div', { class: 'wide' }, title), h('p', null, text), h('button', { type: 'button', class: 'btn primary', onclick: go }, action, icon('arrow'))),
  );
}

/** Limpeza da tela anterior (listeners do worker e do gráfico). */
let cleanup: (() => void) | null = null;
export function leaveTreino(): void {
  cleanup?.();
  cleanup = null;
}

export function treinoScreen(): HTMLElement {
  leaveTreino();
  const model = state.model;
  if (!model) return emptyState('Sem rede', 'Monte uma arquitetura ou abra uma rede salva.', 'Arquitetura', () => set({ screen: 'arquitetura' }));
  if (!state.table) return emptyState('Sem dados', 'O treino precisa de um dataset.', 'Dados', () => set({ screen: 'dados' }));

  const st = state.status;
  const running = st === 'rodando';
  const busy = running || st === 'pausado';
  const blockers = busy ? [] : trainBlockers();

  const net = new NetView(model.net.architecture, serialize({ net: model.net, normalization: null }));
  const chart = new MseChart();
  const trainEl = h('b', { class: 'mono' });
  const valEl = h('b', { class: 'mono' });
  const testEl = h('b', { class: 'mono' });
  const bar = h('span');
  const pct = h('span', { class: 'mono', style: 'min-width:44px;text-align:right' });
  const subEl = h('div', { class: 'sub mono' });

  const paint = () => {
    const hist = state.history;
    const last = hist[hist.length - 1];
    trainEl.textContent = fmt(last?.trainMSE);
    valEl.textContent = fmt(last?.valMSE);
    testEl.textContent = fmt(state.testMSE);
    testEl.style.color = state.testMSE === undefined ? 'var(--t3)' : '';
    const p = Math.min(100, (hist.length / state.epochs) * 100);
    bar.style.transform = `scaleX(${p / 100})`;
    bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(p)));
    pct.textContent = `${Math.round(p)}%`;
    const epochTxt = hist.length ? ` · época ${hist.length} de ${state.epochs}` : '';
    subEl.textContent = `${state.fileName} · ${architectureText(model.net.architecture)}${epochTxt}`;
    chart.update(hist, state.epochs);
  };
  paint();
  const off = onProgress((snap) => {
    if (snap) net.update(snap);
    paint();
  });
  cleanup = () => {
    off();
    chart.disconnect();
  };

  const field = (label: string, value: string, apply: (v: number) => void, hint: string) =>
    h(
      'label',
      null,
      label,
      h('input', {
        class: 'input',
        inputmode: 'decimal',
        'aria-label': label,
        title: hint,
        value,
        disabled: busy,
        onchange: (e: Event) => apply(parseNum((e.target as HTMLInputElement).value)),
      }),
    );

  const mainBtn = running
    ? h('button', { type: 'button', class: 'btn primary', onclick: pauseTraining }, icon('pause'), 'Pausar')
    : st === 'pausado'
      ? h('button', { type: 'button', class: 'btn primary', onclick: resumeTraining }, icon('play'), 'Continuar')
      : h('button', { type: 'button', class: 'btn primary', disabled: blockers.length > 0, onclick: startTraining }, icon('play'), st === 'fim' ? 'Treinar mais' : 'Treinar');

  const statusTxt = { parado: 'Pronto', rodando: 'Treinando', pausado: 'Pausado', fim: 'Concluído', erro: 'Erro' }[st];
  const counts = state.splitCounts;

  return h(
    'div',
    { class: 'screen' },
    h(
      'div',
      { class: 'head' },
      h('div', null, h('h1', { class: 'wide' }, 'Treino'), subEl),
      h(
        'div',
        { class: 'actions' },
        busy ? h('button', { type: 'button', class: 'btn line', onclick: stopTraining }, icon('stop'), 'Parar') : null,
        st === 'fim' ? h('button', { type: 'button', class: 'btn line', onclick: () => set({ screen: 'prever' }) }, 'Prever', icon('arrow')) : null,
        mainBtn,
      ),
    ),
    blockers.length ? notice(blockers[0], 'err') : null,
    st === 'erro' ? notice(state.trainError, 'err') : null,
    h(
      'div',
      { class: 'grid2 stretch' },
      h('section', { class: 'card' }, h('div', { class: 'lbl wide' }, 'Rede'), net.el),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'lbl wide' }, 'Erro (MSE)'),
        chart.el,
        h('div', { class: 'legend' }, h('span', null, h('i'), 'Treino'), h('span', null, h('i', { class: 'dash' }), 'Validação')),
        h(
          'div',
          { class: 'stats' },
          h('div', null, h('span', { class: 'lbl wide' }, 'Treino'), trainEl),
          h('div', null, h('span', { class: 'lbl wide' }, 'Validação'), valEl),
          h('div', null, h('span', { class: 'lbl wide' }, 'Teste'), testEl),
        ),
        counts ? h('div', { class: 'counts mono' }, `${counts[0]} · ${counts[1]} · ${counts[2]} exemplos`) : null,
      ),
    ),
    h(
      'div',
      { class: 'train-foot' },
      h(
        'div',
        { class: 'inline-fields' },
        field('Taxa', String(state.learningRate).replace('.', ','), (v) => set({ learningRate: Number.isFinite(v) ? v : state.learningRate }), 'Taxa de aprendizado (η). Comum entre 0,01 e 0,5'),
        field('Épocas', String(state.epochs), (v) => set({ epochs: Number.isFinite(v) ? Math.round(v) : state.epochs, ...(state.status === 'fim' ? {} : resetTraining()) }), 'Quantas vezes o treino passa por todos os exemplos'),
        field('Semente', String(state.trainSeed), (v) => set({ trainSeed: Number.isFinite(v) ? Math.round(v) : state.trainSeed }), 'Semente da ordem dos exemplos a cada época'),
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Progresso do treino', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
      pct,
      h('span', { style: 'font-size:13px;color:var(--t2);display:flex;align-items:center' }, h('i', { class: `status-dot ${running ? 'live' : ''}` }), statusTxt),
    ),
  );
}
