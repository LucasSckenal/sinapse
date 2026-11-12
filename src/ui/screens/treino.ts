import { deserialize, serialize, type SavedModel } from '../../core/persistence';
import { Boundary, boundaryKind } from '../boundary';
import { MseChart } from '../chart';
import { fmt, h, icon, notice, parseNum, segmented } from '../dom';
import { activationsOf, mountNet, mountSurface, type NetHandle, type SurfaceHandle } from '../net3d-mount';
import { architectureText, resetTraining, set, state } from '../state';
import { currentSplit, onProgress, pauseTraining, requestSurface, resumeTraining, startTraining, stopTraining, trainBlockers } from '../training';

function emptyState(title: string, text: string, action: string, go: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    h('div', { class: 'head' }, h('h1', { class: 'wide' }, 'Treino')),
    h('div', { class: 'empty' }, h('div', { class: 'wide' }, title), h('p', null, text), h('button', { type: 'button', class: 'btn primary', onclick: go }, action, icon('arrow'))),
  );
}

type View = 'rede' | 'superficie';

/**
 * As cenas 3D e a fronteira sobrevivem aos redesenhos da tela (mudar a taxa, pausar...):
 * só são recriadas quando a arquitetura muda ou quando se sai do Treino.
 */
interface Visuals {
  key: string;
  netHost: HTMLElement;
  net: NetHandle;
  surfHost: HTMLElement;
  surf: SurfaceHandle | null;
  surfMsg: HTMLElement;
  boundary: Boundary;
  view: View;
}
let vis: Visuals | null = null;

function visualsFor(saved: SavedModel, arch: ReturnType<typeof deserialize>['net']['architecture']): Visuals {
  const key = architectureText(arch);
  if (vis && vis.key === key) return vis;
  disposeTreino();
  const netHost = h('div', { class: 'stage-host' });
  const surfHost = h('div', { class: 'stage-host', hidden: true });
  const surfMsg = h('p', { class: 'stage-msg' });
  surfHost.appendChild(surfMsg);
  vis = { key, netHost, net: mountNet(netHost, saved, arch), surfHost, surf: null, surfMsg, boundary: new Boundary(), view: 'rede' };
  return vis;
}

/** Sai do Treino de vez: libera as cenas 3D. */
export function disposeTreino(): void {
  leaveTreino();
  vis?.net.dispose();
  vis?.surf?.dispose();
  vis = null;
}

/** Limpeza a cada redesenho (listeners do worker e do gráfico). */
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
  const arch = model.net.architecture;
  const v = visualsFor(serialize(model), arch);
  v.net.setWeights(serialize(model));

  const chart = new MseChart();
  const trainEl = h('b', { class: 'mono' });
  const valEl = h('b', { class: 'mono' });
  const testEl = h('b', { class: 'mono' });
  const accEl = h('span', { class: 'acc mono' });
  const bar = h('span');
  const pct = h('span', { class: 'mono', style: 'min-width:44px;text-align:right' });
  const subEl = h('div', { class: 'sub mono' });

  // a fronteira usa a rede atual e as colunas escolhidas (só quando batem com a rede)
  const compatible = blockers.length === 0 || busy;
  const kind = compatible ? boundaryKind(model) : null;
  let liveModel = model;
  let lastBoundary = 0;
  const drawBoundary = (force = false) => {
    if (!kind || !state.table) return;
    const now = performance.now();
    if (!force && now - lastBoundary < 220) return;
    lastBoundary = now;
    v.boundary.draw(liveModel, state.table, state.selection.inputs, state.selection.outputs);
  };

  // onda de um exemplo de treino passando pela rede 3D
  let lastWave = 0;
  const waveFrom = (m: typeof model) => {
    const tr = currentSplit?.treino;
    if (!tr || tr.inputs.length === 0) return;
    const now = performance.now();
    if (now - lastWave < 650) return;
    lastWave = now;
    try {
      m.net.forward(tr.inputs[Math.floor(Math.random() * tr.inputs.length)]);
      v.net.wave(activationsOf(m));
    } catch {
      /* arquitetura mudou no meio: ignora */
    }
  };

  // superfície do erro: pede ao worker quando a aba está aberta
  let surfBusy = false;
  let lastSurf = 0;
  const refreshSurface = (snap: SavedModel, force = false) => {
    if (v.view !== 'superficie' || surfBusy) return;
    const now = performance.now();
    if (!force && now - lastSurf < 1600) return;
    const req = requestSurface(snap);
    if (!req) {
      v.surfMsg.textContent = state.history.length ? 'Rede grande demais para guardar o caminho dos pesos.' : 'A superfície aparece quando o treino começar.';
      return;
    }
    surfBusy = true;
    lastSurf = now;
    if (!v.surf) v.surfMsg.textContent = 'Calculando a superfície…';
    req.then((r) => {
      surfBusy = false;
      if (!vis || vis !== v) return;
      v.surf ??= mountSurface(v.surfHost);
      v.surf.set(r);
      v.surfMsg.textContent = `w₁ = peso ${r.a.j + 1}→${r.a.i + 1} da camada ${r.a.layer + 1} · w₂ = peso ${r.b.j + 1}→${r.b.i + 1} da camada ${r.b.layer + 1}`;
    });
  };

  const paint = () => {
    const hist = state.history;
    const last = hist[hist.length - 1];
    trainEl.textContent = fmt(last?.trainMSE);
    valEl.textContent = fmt(last?.valMSE);
    testEl.textContent = fmt(state.testMSE);
    testEl.style.color = state.testMSE === undefined ? 'var(--t3)' : '';
    const va = last?.valAccuracy;
    const ta = state.testAccuracy;
    const pctTxt = (x: number) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    accEl.textContent = ta !== undefined ? `Acertos no teste: ${pctTxt(ta)}` : va !== undefined ? `Acertos na validação: ${pctTxt(va)}` : '';
    const p = Math.min(100, (hist.length / state.epochs) * 100);
    bar.style.transform = `scaleX(${p / 100})`;
    bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(p)));
    pct.textContent = `${Math.round(p)}%`;
    const epochTxt = hist.length ? ` · época ${hist.length} de ${state.epochs}` : '';
    subEl.textContent = `${state.fileName} · ${architectureText(arch)}${epochTxt}`;
    chart.update(hist, state.epochs);
  };
  paint();
  queueMicrotask(() => drawBoundary(true));
  if (v.view === 'superficie') queueMicrotask(() => refreshSurface(serialize(model), true));
  const off = onProgress((snap) => {
    if (snap) {
      v.net.setWeights(snap);
      try {
        liveModel = deserialize(snap);
        waveFrom(liveModel);
      } catch {
        /* foto incompleta: espera a próxima */
      }
      drawBoundary(state.status !== 'rodando');
      refreshSurface(snap, state.status !== 'rodando');
    }
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

  const setView = (view: View) => {
    v.view = view;
    v.netHost.hidden = view !== 'rede';
    v.surfHost.hidden = view !== 'superficie';
    stageLabel.textContent = view === 'rede' ? 'Rede' : 'Superfície do erro';
    legend.replaceChildren(...legendFor(view));
    seg.replaceWith((seg = makeSeg()));
    if (view === 'superficie') refreshSurface(serialize(liveModel), true);
  };
  const makeSeg = () =>
    segmented<View>(
      [
        { value: 'rede', label: 'Rede' },
        { value: 'superficie', label: 'Superfície do erro' },
      ],
      v.view,
      setView,
      { label: 'Vista 3D' },
    );
  let seg = makeSeg();
  const stageLabel = h('span', { class: 'lbl wide' }, v.view === 'rede' ? 'Rede' : 'Superfície do erro');
  const legendFor = (view: View) =>
    view === 'rede'
      ? [h('span', null, h('i', { class: 'lg-pos' }), 'peso positivo'), h('span', null, h('i', { class: 'lg-neg' }), 'negativo'), h('span', null, 'brilho = ativação'), h('span', { class: 'hint-drag' }, 'arraste: girar · botão direito: mover · roda: zoom')]
      : [h('span', null, 'MSE do treino variando w₁ e w₂; os outros pesos como estão agora'), h('span', null, h('i', { class: 'lg-pos' }), 'caminho do treino')];
  const legend = h('div', { class: 'legend3d' }, ...legendFor(v.view));
  v.netHost.hidden = v.view !== 'rede';
  v.surfHost.hidden = v.view !== 'superficie';

  const boundaryCard = kind
    ? h(
        'section',
        { class: 'card boundary-card' },
        h('div', { class: 'card-head' }, h('span', { class: 'lbl wide' }, kind === '2d' ? 'Fronteira' : 'Curva da rede'), h('span', { class: 'lbl' }, kind === '2d' ? 'anel = a rede ainda erra' : 'pontos = dataset')),
        v.boundary.el,
      )
    : null;

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
      { class: 'train-grid' },
      h('section', { class: 'card stage-card' }, h('div', { class: 'card-head' }, stageLabel, seg), v.netHost, v.surfHost, legend),
      h(
        'div',
        { class: 'train-side' },
        boundaryCard,
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
          h('div', { class: 'stat-foot' }, accEl, counts ? h('span', { class: 'counts mono' }, `${counts[0]} · ${counts[1]} · ${counts[2]} exemplos`) : null),
        ),
      ),
    ),
    h(
      'div',
      { class: 'train-foot' },
      h(
        'div',
        { class: 'inline-fields' },
        field('Taxa', String(state.learningRate).replace('.', ','), (x) => set({ learningRate: Number.isFinite(x) ? x : state.learningRate }), 'Taxa de aprendizado (η). Comum entre 0,01 e 0,5'),
        field('Épocas', String(state.epochs), (x) => set({ epochs: Number.isFinite(x) ? Math.round(x) : state.epochs, ...(state.status === 'fim' ? {} : resetTraining()) }), 'Quantas vezes o treino passa por todos os exemplos'),
        field('Semente', String(state.trainSeed), (x) => set({ trainSeed: Number.isFinite(x) ? Math.round(x) : state.trainSeed }), 'Semente da ordem dos exemplos a cada época'),
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Progresso do treino', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
      pct,
      h('span', { style: 'font-size:13px;color:var(--t2);display:flex;align-items:center' }, h('i', { class: `status-dot ${running ? 'live' : ''}` }), statusTxt),
    ),
  );
}
