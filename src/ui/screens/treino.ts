import { selectColumns, splitSizes } from '../../core/dataset';
import { confusionMatrix } from '../../core/encoding';
import { NORMALIZATION_LABELS, describeOutputScaling, normalizeRows, scaleTargets } from '../../core/normalization';
import { deserialize, serialize, type SavedModel } from '../../core/persistence';
import { Boundary, boundaryKind } from '../boundary';
import { MseChart } from '../chart';
import { fmt, h, icon, notice, parseNum, segmented } from '../dom';
import { cycleOf, mountNet, mountSurface, type NetHandle, type SurfaceHandle } from '../net3d-mount';
import { NetView } from '../netview';
import { architectureText, resetTraining, saveRuns, set, state } from '../state';
import { currentSplit, onProgress, pauseTraining, requestSurface, resumeTraining, startTraining, stepOnce, stopTraining, trainBlockers, type StepResult } from '../training';
import { toast } from '../dom';
import { printReport } from '../report';

function emptyState(title: string, text: string, action: string, go: () => void): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    h('div', { class: 'head' }, h('h1', { class: 'wide' }, 'Treino')),
    h('div', { class: 'empty' }, h('div', { class: 'wide' }, title), h('p', null, text), h('button', { type: 'button', class: 'btn primary', onclick: go }, action, icon('arrow'))),
  );
}

type View = 'rede' | 'plano' | 'superficie';

/** Último passo feito à mão e neurônio escolhido no desenho (sobrevivem aos redesenhos). */
let lastStep: StepResult | null = null;
let picked: { layer: number; unit: number } | null = null;

const VIEW_KEY = 'sinapse.vista';
function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'rede' || v === 'plano' || v === 'superficie') return v;
  } catch {
    /* sem armazenamento: decide pela tela */
  }
  return defaultView();
}

/** Sem escolha salva, tela pequena começa no 2D: não baixa o three.js nem força a placa de vídeo do celular. */
function defaultView(): View {
  return matchMedia('(max-width: 700px)').matches ? 'plano' : 'rede';
}

/**
 * As cenas 3D e a fronteira sobrevivem aos redesenhos da tela (mudar a taxa, pausar...):
 * só são recriadas quando a arquitetura muda ou quando se sai do Treino.
 */
interface Visuals {
  key: string;
  netHost: HTMLElement;
  flatHost: HTMLElement;
  flat: NetView;
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
  const flatHost = h('div', { class: 'stage-host flat-host', hidden: true });
  const flat = new NetView(arch, saved);
  flatHost.appendChild(flat.el);
  vis = { key, netHost, flatHost, flat, net: mountNet(netHost, saved, arch), surfHost, surf: null, surfMsg, boundary: new Boundary(), view: savedView() };
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
  if (running) lastStep = null;
  const busy = running || st === 'pausado';
  const blockers = busy ? [] : trainBlockers();
  const arch = model.net.architecture;
  const v = visualsFor(serialize(model), arch);
  v.net.setWeights(serialize(model));
  v.flat.update(serialize(model));

  const chart = new MseChart();
  const trainEl = h('b', { class: 'mono' });
  const valEl = h('b', { class: 'mono' });
  const testEl = h('b', { class: 'mono' });
  // com as saídas normalizadas, o MSE acima está na escala da rede; este é o mesmo erro na unidade do CSV
  const testOrigEl = h('small', { class: 'mono stat-orig' });
  const accEl = h('span', { class: 'acc mono' });
  const stopInfo = h('p', { class: 'stop-info' });
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

  // um exemplo de treino fazendo o ciclo inteiro: ida, erro voltando, pesos atualizados
  let lastWave = 0;
  // exemplos para a animação parada: os do treino atual ou, sem treino ainda, os do dataset aberto
  let idleSamples: { inputs: number[][]; targets: number[][] } | null = null;
  const samples = () => {
    if (currentSplit?.treino.inputs.length) return currentSplit.treino;
    if (idleSamples) return idleSamples;
    try {
      if (!state.table || !compatible) return null;
      const s = selectColumns(state.table, state.selection);
      idleSamples = { inputs: normalizeRows(liveModel.normalization, s.inputs), targets: s.targets.map((x) => scaleTargets(liveModel.outputScaling, x)) };
      return idleSamples;
    } catch {
      return null;
    }
  };
  const waveFrom = (m: typeof model, flash = true) => {
    const tr = samples();
    if (!tr || tr.inputs.length === 0) return;
    const now = performance.now();
    if (now - lastWave < 1900) return;
    lastWave = now;
    try {
      const k = Math.floor(Math.random() * tr.inputs.length);
      const c = cycleOf(m, tr.inputs[k], tr.targets[k]);
      if (v.view === 'plano') v.flat.cycle(c.acts, c.deltas, flash);
      else if (v.view === 'rede') v.net.cycle(c, false, flash);
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
    testOrigEl.textContent = state.testMSEOriginal !== undefined ? `${fmt(state.testMSEOriginal)} na unidade do arquivo` : '';
    const va = last?.valAccuracy;
    const ta = state.testAccuracy;
    const pctTxt = (x: number) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    accEl.textContent = ta !== undefined ? `Acertos no teste: ${pctTxt(ta)}` : va !== undefined ? `Acertos na validação: ${pctTxt(va)}` : '';
    const p = state.status === 'fim' ? 100 : Math.min(100, (hist.length / state.epochs) * 100);
    bar.style.transform = `scaleX(${p / 100})`;
    bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(p)));
    pct.textContent = `${Math.round(p)}%`;
    const epochTxt = hist.length ? ` · época ${hist.length} de ${state.epochs}` : '';
    subEl.textContent = `${state.fileName} · ${architectureText(arch)}${epochTxt}`;
    const fim = state.status === 'fim';
    chart.update(hist, fim ? Math.max(1, hist.length) : state.epochs, fim ? state.bestEpoch : 0);
    stopInfo.textContent =
      state.status === 'fim' && state.bestEpoch > 0
        ? state.earlyStopped
          ? `Parada antecipada na época ${hist.length}; pesos da época ${state.bestEpoch} (melhor validação).`
          : `Pesos da época ${state.bestEpoch} (melhor validação).`
        : '';
  };
  paint();
  queueMicrotask(() => drawBoundary(true));
  if (v.view === 'superficie') queueMicrotask(() => refreshSurface(serialize(model), true));
  const off = onProgress((snap) => {
    if (snap) {
      v.net.setWeights(snap);
      v.flat.update(snap);
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
  // a animação não para: sem treino rodando, um exemplo continua passando pela rede (sem mexer nos pesos)
  const idle = setInterval(() => {
    if (state.status !== 'rodando') waveFrom(liveModel, false);
  }, 2100);
  queueMicrotask(() => state.status !== 'rodando' && waveFrom(liveModel, false));
  cleanup = () => {
    off();
    clearInterval(idle);
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

  const canStep = !busy && blockers.length === 0;
  const doStep = () => {
    const r = stepOnce();
    if (typeof r === 'string') {
      toast(r, 'err');
      return;
    }
    lastStep = r;
    set({ modelTrained: true });
    // o passo aparece na rede: ida, erro voltando e os pesos mudando
    queueMicrotask(() => {
      if (!vis) return;
      if (vis.view === 'plano') vis.flat.cycle(r.acts, r.deltas, true);
      else vis.net.cycle({ acts: r.acts, deltas: r.deltas }, true, true);
    });
  };
  const inspector = h('div', { class: 'inspector', hidden: !picked });
  const paintInspector = () => {
    inspector.hidden = !picked;
    if (picked) inspector.replaceChildren(...inspectorBody(picked, () => ((picked = null), paintInspector())));
  };
  paintInspector();
  const onPick = (layer: number, unit: number) => {
    picked = { layer, unit };
    // passa um exemplo de treino pela rede (sem mudar pesos) para z, saída e δ terem valores reais
    const tr = currentSplit?.treino;
    if (tr?.inputs.length && state.model) {
      const k = Math.floor(Math.random() * tr.inputs.length);
      try {
        cycleOf(state.model, tr.inputs[k], tr.targets[k]);
      } catch {
        /* rede e dados não batem: mostra o que tiver */
      }
    }
    paintInspector();
  };
  v.net.onPick(onPick);
  v.flat.onPick = onPick;

  const mainBtn = running
    ? h('button', { type: 'button', class: 'btn primary', onclick: pauseTraining }, icon('pause'), 'Pausar')
    : st === 'pausado'
      ? h('button', { type: 'button', class: 'btn primary', onclick: resumeTraining }, icon('play'), 'Continuar')
      : h('button', { type: 'button', class: 'btn primary', disabled: blockers.length > 0, onclick: startTraining }, icon('play'), st === 'fim' ? 'Treinar mais' : 'Treinar');

  const statusTxt = { parado: 'Pronto', rodando: 'Treinando', pausado: 'Pausado', fim: 'Concluído', erro: 'Erro' }[st];
  const counts = state.splitCounts;

  const titleOf = (view: View) => (view === 'superficie' ? 'Superfície do erro' : 'Rede');
  const showView = (view: View) => {
    v.netHost.hidden = view !== 'rede';
    v.flatHost.hidden = view !== 'plano';
    v.surfHost.hidden = view !== 'superficie';
  };
  const setView = (view: View) => {
    v.view = view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* sem armazenamento: só não lembra */
    }
    showView(view);
    stageLabel.textContent = titleOf(view);
    legend.replaceChildren(...legendFor(view).filter((x): x is HTMLSpanElement => !!x));
    seg.replaceWith((seg = makeSeg()));
    if (view === 'superficie') refreshSurface(serialize(liveModel), true);
  };
  const makeSeg = () =>
    segmented<View>(
      [
        { value: 'rede', label: '3D', icon: 'cube' },
        { value: 'plano', label: '2D', icon: 'nodes' },
        { value: 'superficie', label: 'Superfície do erro', icon: 'mountain' },
      ],
      v.view,
      setView,
      { label: 'Vista da rede' },
    );
  let seg = makeSeg();
  const stageLabel = h('span', { class: 'lbl wide' }, titleOf(v.view));
  const legendFor = (view: View) =>
    view !== 'superficie'
      ? [
          h('span', null, h('i', { class: 'lg-pos' }), 'ida: ativação'),
          h('span', null, h('i', { class: 'lg-neg' }), 'volta: erro (δ)'),
          h('span', null, 'piscar = pesos atualizados'),
          view === 'rede' ? h('span', { class: 'hint-drag' }, 'arraste: girar · botão direito: mover · roda: zoom') : null,
        ]
      : [h('span', null, 'MSE do treino variando w₁ e w₂; os outros pesos como estão agora'), h('span', null, h('i', { class: 'lg-pos' }), 'caminho do treino')];
  const legend = h('div', { class: 'legend3d' }, ...legendFor(v.view));
  showView(v.view);

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
        canStep ? h('button', { type: 'button', class: 'btn line', onclick: doStep, title: 'Faz um passo do SGD com um exemplo e mostra todas as contas' }, icon('step'), 'Um exemplo') : null,
        st === 'fim' ? h('button', { type: 'button', class: 'btn line', onclick: printReport, title: 'Abre a impressão com o relatório desta execução (salve como PDF)' }, icon('file'), 'Relatório') : null,
        st === 'fim' ? h('button', { type: 'button', class: 'btn line', onclick: () => set({ screen: 'prever' }) }, 'Prever', icon('arrow')) : null,
        mainBtn,
      ),
    ),
    blockers.length ? notice(blockers[0], 'err') : null,
    st === 'erro' ? notice(state.trainError, 'err') : null,
    h(
      'div',
      { class: 'train-grid' },
      h('section', { class: 'card stage-card' }, h('div', { class: 'card-head' }, stageLabel, seg), v.netHost, v.flatHost, v.surfHost, inspector, legend),
      h(
        'div',
        { class: 'train-side' },
        boundaryCard,
        confusionCard(),
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
            h('div', null, h('span', { class: 'lbl wide' }, 'Teste'), testEl, testOrigEl),
          ),
          h('div', { class: 'stat-foot' }, accEl, counts ? h('span', { class: 'counts mono' }, `${counts[0]} · ${counts[1]} · ${counts[2]} exemplos`) : null),
          stopInfo,
        ),
      ),
    ),
    lastStep ? stepCard(lastStep) : null,
    explainCard(),
    runsCard(),
    h(
      'div',
      { class: 'train-foot' },
      h(
        'div',
        { class: 'inline-fields' },
        field('Taxa', String(state.learningRate).replace('.', ','), (x) => set({ learningRate: Number.isFinite(x) ? x : state.learningRate }), 'Taxa de aprendizado (η). Comum entre 0,01 e 0,5'),
        field('Épocas', String(state.epochs), (x) => set({ epochs: Number.isFinite(x) ? Math.round(x) : state.epochs, ...(state.status === 'fim' ? {} : resetTraining()) }), 'Quantas vezes o treino passa por todos os exemplos'),
        field('Semente', String(state.trainSeed), (x) => set({ trainSeed: Number.isFinite(x) ? Math.round(x) : state.trainSeed }), 'Semente da ordem dos exemplos a cada época'),
        field(
          'Paciência',
          String(state.patience),
          (x) => set({ patience: Number.isFinite(x) ? Math.max(0, Math.round(x)) : state.patience }),
          'Parada antecipada: quantas épocas sem melhorar na validação antes de parar e voltar aos melhores pesos. 0 = desligada',
        ),
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Progresso do treino', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
      pct,
      h('span', { style: 'font-size:13px;color:var(--t2);display:flex;align-items:center' }, h('i', { class: `status-dot ${running ? 'live' : ''}` }), statusTxt),
    ),
  );
}

/** Como a divisão, o treino e o ajuste dos pesos foram feitos, com os números desta execução. */
function explainCard(): HTMLElement {
  const n = state.table?.rows.length ?? 0;
  const p = state.percent;
  const [a, b, c] = state.splitCounts ?? splitSizes(n, p);
  const pct = (x: number) => `${String(x).replace('.', ',')}%`;
  const norm = state.normalization;
  const outTxt = () => {
    const d = describeOutputScaling(state.model?.outputScaling, state.model?.columns?.saidas);
    if (d) return `Saídas numéricas: Min-Max também só pelo treino, para a faixa da ativação de saída (${d}); a previsão desfaz a conta e mostra na unidade do arquivo.`;
    return state.model?.codings?.saidas.some((c) => c.tipo === 'numero')
      ? 'Saídas numéricas: Min-Max só pelo treino, para a faixa da ativação de saída (sigmoid 0 a 1, tanh −1 a 1); a previsão desfaz a conta.'
      : 'Saídas de classe já ficam em 0 e 1 (one-hot), sem normalizar.';
  };
  const normTxt =
    norm === 'nenhuma'
      ? 'Sem normalização: entradas e saídas entram como estão no arquivo.'
      : `Entradas: ${NORMALIZATION_LABELS[norm]} calculado só com o conjunto de treino (${norm === 'minmax' ? 'mínimo e máximo' : 'média e desvio-padrão'} de cada entrada) e aplicado aos três conjuntos e à previsão. ${outTxt()}`;
  const lr = String(state.learningRate).replace('.', ',');
  const done = state.history.length;
  const ajustes = done * a;
  const block = (title: string, ...body: (HTMLElement | string)[]) => h('div', null, h('h3', null, title), ...body);
  return h(
    'section',
    { class: 'explain', 'aria-label': 'Como foi feito' },
    block(
      'Divisão',
      h('p', null, 'As ', h('b', null, `${n} linhas`), ` foram embaralhadas (Fisher-Yates) com a semente `, h('code', null, String(state.splitSeed)), ' e cortadas em:'),
      h('p', null, h('b', null, `${a} de treino`), ` (${pct(p.treino)}) · `, h('b', null, `${b} de validação`), ` (${pct(p.validacao)}) · `, h('b', null, `${c} de teste`), ` (${pct(p.teste)}).`),
      h('p', null, normTxt),
    ),
    block(
      'Treinamento',
      h('p', null, h('b', null, 'SGD'), `: a cada época, os ${a} exemplos de treino são embaralhados (semente `, h('code', null, String(state.trainSeed)), ') e passam ', h('b', null, 'um de cada vez'), ': propagação → erro → retropropagação → ajuste.'),
      h('p', null, 'No fim de cada época calcula o MSE do treino e da validação. A validação só mede, nunca ajusta. O teste só é usado no fim.'),
      h('p', null, h('code', null, `${state.epochs} épocas`), ' · taxa ', h('code', null, `η = ${lr}`), done ? ` · ${done} épocas feitas` : ''),
    ),
    block(
      'Ajuste dos pesos',
      h('p', null, 'Não é por conjunto (lote): o ajuste acontece ', h('b', null, 'depois de cada exemplo'), '. Primeiro calcula todos os deltas, com os pesos de antes:'),
      h('p', null, h('code', null, 'δ saída = (o − t) · f′(z)'), ' ', h('code', null, 'δ oculta = f′(z) · Σ w·δ')),
      h('p', null, 'Só depois atualiza: ', h('code', null, 'w ← w − η · δ · x'), ' ', h('code', null, 'b ← b − η · δ')),
      h('p', null, ajustes ? `Até agora foram ${ajustes.toLocaleString('pt-BR')} ajustes (${done} épocas × ${a} exemplos).` : `Cada época faz ${a} ajustes, um por exemplo de treino.`),
    ),
  );
}

/** Matriz de confusão no conjunto de teste (só para classificação, depois do treino). */
function confusionCard(): HTMLElement | null {
  const m = state.model;
  const te = currentSplit?.teste;
  if (state.status !== 'fim' || !m || !te || te.inputs.length === 0) return null;
  let cm;
  try {
    cm = confusionMatrix(
      te.inputs.map((x) => m.net.forward(x)),
      te.targets,
      m.codings?.saidas,
      m.columns?.saidas,
    );
  } catch {
    return null;
  }
  if (!cm) return null;
  const max = Math.max(1, ...cm.m.flat());
  const rowTotal = cm.m.map((r) => r.reduce((a, b) => a + b, 0));
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('span', { class: 'lbl wide' }, 'Matriz de confusão'), h('span', { class: 'lbl' }, `teste · ${te.inputs.length} exemplos`)),
    h(
      'div',
      { class: 'cm-scroll' },
      h(
        'table',
        { class: 'cm mono' },
        h('thead', null, h('tr', null, h('th', { class: 'corner' }, 'real ↓ · previsto →'), cm.labels.map((l) => h('th', { title: l }, l)), h('th', null, 'acerto'))),
        h(
          'tbody',
          null,
          cm.m.map((row, i) =>
            h(
              'tr',
              null,
              h('th', { title: cm.labels[i] }, cm.labels[i]),
              row.map((v, j) =>
                h(
                  'td',
                  { class: i === j ? 'diag' : v ? 'miss' : '', style: `--a:${(v / max).toFixed(3)}`, title: `${v} exemplos de "${cm.labels[i]}" previstos como "${cm.labels[j]}"` },
                  String(v),
                ),
              ),
              h('td', { class: 'rate' }, rowTotal[i] ? `${Math.round((row[i] / rowTotal[i]) * 100)}%` : '—'),
            ),
          ),
        ),
      ),
    ),
  );
}

/** Execuções anteriores, para comparar arquiteturas e parâmetros. */
function runsCard(): HTMLElement | null {
  const runs = state.runs;
  if (runs.length === 0) return null;
  const finite = runs.map((r) => r.validacao).filter(Number.isFinite);
  const bestVal = finite.length ? Math.min(...finite) : NaN;
  const spark = (c: number[]) => {
    const v = c.filter((x) => Number.isFinite(x) && x > 0);
    if (v.length < 2) return h('span');
    const lo = Math.log10(Math.min(...v));
    // curva toda igual: abre uma década para não dividir por zero (antes, max = 1 dava log 0 e caía aqui por engano)
    let hi = Math.log10(Math.max(...v));
    if (hi === lo) hi = lo + 1;
    const pts = v.map((x, i) => `${((i / (v.length - 1)) * 80).toFixed(1)},${(2 + (1 - (Math.log10(x) - lo) / Math.max(1e-9, hi - lo)) * 18).toFixed(1)}`).join(' ');
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 80 22');
    el.setAttribute('class', 'spark');
    el.innerHTML = `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
    return el;
  };
  const pctTxt = (x?: number) => (x === undefined ? '—' : `${Math.round(x * 1000) / 10}%`.replace('.', ','));
  return h(
    'section',
    { class: 'card runs-card' },
    h(
      'div',
      { class: 'card-head' },
      h('span', { class: 'lbl wide' }, 'Execuções'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn line small',
          onclick: () => {
            saveRuns([]);
            set({ runs: [] });
          },
        },
        icon('trash'),
        'Limpar',
      ),
    ),
    h(
      'div',
      { class: 'cm-scroll' },
      h(
        'table',
        { class: 'runs mono' },
        h(
          'thead',
          null,
          h('tr', null, ['quando', 'arquivo', 'arquitetura', 'η', 'épocas', 'MSE treino', 'MSE validação', 'MSE teste', 'acerto', 'validação'].map((t) => h('th', null, t))),
        ),
        h(
          'tbody',
          null,
          runs.map((r) =>
            h(
              'tr',
              { class: r.validacao === bestVal ? 'best' : '' },
              h('td', null, r.quando),
              h('td', null, r.arquivo),
              h('td', { class: 'arch', title: `${r.arquitetura} · ${r.normalizacao} · divisão ${r.divisao}` }, r.arquitetura),
              h('td', null, String(r.taxa).replace('.', ',')),
              h('td', null, r.melhorEpoca ? `${r.feitas} (melhor ${r.melhorEpoca})` : String(r.feitas)),
              h('td', null, fmt(r.treino)),
              h('td', null, fmt(r.validacao)),
              h('td', null, fmt(r.teste)),
              h('td', null, pctTxt(r.acerto)),
              h('td', null, spark(r.curva)),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'muted', style: 'font-size:12px' }, 'Destacada: a de menor erro na validação. Fica guardada neste navegador.'),
  );
}

const n4 = (v: number) => fmt(v, 4);

function layerName(l: number, total: number): string {
  return l === 0 ? 'Entrada' : l === total - 1 ? 'Saída' : `Oculta ${l}`;
}

/** Painel do neurônio clicado: viés, z, saída, δ e os pesos que chegam nele. */
function inspectorBody(p: { layer: number; unit: number }, close: () => void): HTMLElement[] {
  const m = state.model;
  if (!m) return [];
  const L = m.net.layers.length + 1;
  const head = h(
    'div',
    { class: 'insp-head' },
    h('span', { class: 'lbl wide' }, `${layerName(p.layer, L)} · neurônio ${p.unit + 1}`),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, icon('x')),
  );
  if (p.layer === 0) {
    const name = m.columns?.entradas[p.unit] ?? `entrada ${p.unit + 1}`;
    return [head, h('p', { class: 'insp-note' }, `Entrada "${name}". Não tem pesos: só passa o valor (já normalizado) para a camada seguinte.`)];
  }
  const n = m.net.layers[p.layer - 1].neurons[p.unit];
  const srcName = (j: number) => (p.layer === 1 ? (m.columns?.entradas[j] ?? `x${j + 1}`) : `${layerName(p.layer - 1, L)} n${j + 1}`);
  const ws = n.weights.map((w, q) => ({ j: n.sourceOf(q), w })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  return [
    head,
    h(
      'div',
      { class: 'insp-grid mono' },
      h('span', null, 'ativação'), h('b', null, n.activation.label),
      h('span', null, 'viés b'), h('b', null, n4(n.bias)),
      h('span', null, 'z = Σw·x + b'), h('b', null, n4(n.z)),
      h('span', null, 'saída f(z)'), h('b', null, n4(n.output)),
      h('span', null, 'δ = ∂E/∂z'), h('b', null, n4(n.delta)),
    ),
    h('p', { class: 'insp-note' }, `z, saída e δ do último exemplo que passou pela rede. ${ws.length} pesos chegam aqui${ws.length > 8 ? ' (os 8 maiores)' : ''}:`),
    h('div', { class: 'insp-weights mono' }, ws.slice(0, 8).map((x) => h('div', null, h('span', null, srcName(x.j)), h('b', { class: x.w < 0 ? 'neg' : '' }, n4(x.w))))),
  ];
}

/** As contas de um passo do SGD com um exemplo. */
function stepCard(r: StepResult): HTMLElement {
  const m = state.model;
  const inNames = m?.columns?.entradas;
  const outNames = m?.columns?.saidas;
  const L = r.layers.length + 1;
  const vec = (v: number[], names?: string[]) =>
    h('div', { class: 'vec mono' }, v.slice(0, 8).map((x, i) => h('span', { title: names?.[i] }, h('i', null, names?.[i] ?? `${i + 1}`), n4(x))), v.length > 8 ? h('span', null, `+${v.length - 8}`) : null);
  return h(
    'section',
    { class: 'card step-card' },
    h('div', { class: 'card-head' }, h('span', { class: 'lbl wide' }, 'Passo a passo'), h('span', { class: 'lbl mono' }, `exemplo ${r.index + 1} do treino · η = ${String(state.learningRate).replace('.', ',')}`)),
    h(
      'div',
      { class: 'step-flow' },
      h('div', null, h('h3', null, '1 · Entrada x'), vec(r.x, inNames)),
      h('div', null, h('h3', null, '2 · Saída o'), vec(r.o, outNames)),
      h('div', null, h('h3', null, '3 · Esperado t'), vec(r.t, outNames)),
      h('div', null, h('h3', null, '4 · Erro E = ½Σ(o − t)²'), h('p', { class: 'big-num mono' }, n4(r.erro))),
    ),
    h(
      'div',
      { class: 'cm-scroll' },
      h(
        'table',
        { class: 'step-table mono' },
        h('thead', null, h('tr', null, h('th', null, 'camada'), h('th', null, 'neurônio'), h('th', null, 'f'), h('th', null, 'z'), h('th', null, 'saída'), h('th', null, 'δ'))),
        h(
          'tbody',
          null,
          r.layers.flatMap((ly, li) =>
            ly.z.slice(0, 6).map((z, i) =>
              h(
                'tr',
                { class: i === 0 ? 'first' : '' },
                h('td', null, i === 0 ? layerName(li + 1, L) : ''),
                h('td', null, outNames && li === r.layers.length - 1 ? outNames[i] : `n${i + 1}`),
                h('td', null, ly.activation[i]),
                h('td', null, n4(z)),
                h('td', null, n4(ly.out[i])),
                h('td', null, n4(ly.delta[i])),
              ),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'insp-note' }, '5 · Todos os δ calculados com os pesos de antes. 6 · Só então os pesos mudam: w ← w − η·δ·x. Os que mais mudaram:'),
    h(
      'div',
      { class: 'changes mono' },
      r.changes.map((c) =>
        h(
          'div',
          null,
          h('span', null, `${layerName(c.layer + 1, L)} n${c.i + 1} ← ${c.layer === 0 ? (inNames?.[c.j] ?? `x${c.j + 1}`) : `n${c.j + 1}`}`),
          h('b', null, `${n4(c.before)} → ${n4(c.after)}`),
          h('i', null, `Δ ${n4(c.after - c.before)}`),
        ),
      ),
      r.biasChanges.map((c) =>
        h('div', null, h('span', null, `viés ${layerName(c.layer + 1, L)} n${c.i + 1}`), h('b', null, `${n4(c.before)} → ${n4(c.after)}`), h('i', null, `Δ ${n4(c.after - c.before)}`)),
      ),
    ),
  );
}
