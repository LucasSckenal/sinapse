import './ui/styles.css';
import { fromJSON, toJSON } from './core/persistence';
import { download, h, icon, logo, pickFile, toast } from './ui/dom';
import { arquiteturaScreen, disposeArchPreview } from './ui/screens/arquitetura';
import { dadosScreen } from './ui/screens/dados';
import { preverScreen } from './ui/screens/prever';
import { disposeTreino, leaveTreino, treinoScreen } from './ui/screens/treino';
import { disposePredictNet } from './ui/net3d-mount';
import { onChange, resetTraining, set, state, type ScreenName } from './ui/state';

const SCREENS: { id: ScreenName; label: string; icon: string; render: () => HTMLElement; done: () => boolean }[] = [
  { id: 'dados', label: 'Dados', icon: 'database', render: dadosScreen, done: () => !!state.table && state.selection.inputs.length > 0 && state.selection.outputs.length > 0 },
  { id: 'arquitetura', label: 'Arquitetura', icon: 'layers', render: arquiteturaScreen, done: () => !!state.model },
  { id: 'treino', label: 'Treino', icon: 'activity', render: treinoScreen, done: () => state.modelTrained },
  { id: 'prever', label: 'Prever', icon: 'target', render: preverScreen, done: () => false },
];

const busy = () => state.status === 'rodando' || state.status === 'pausado';

async function openModel(): Promise<void> {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const model = fromJSON(await file.text());
    set({
      model,
      modelName: file.name.replace(/\.json$/i, ''),
      modelTrained: true,
      arch: model.net.architecture,
      ...resetTraining(),
      screen: 'prever',
    });
    toast(`${file.name} aberta`);
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

function saveModel(): void {
  if (!state.model) return;
  download(`${state.modelName || 'rede'}.json`, toJSON(state.model));
  toast('Rede salva em JSON');
}

const sideEl = h('nav', { class: 'side', 'aria-label': 'Etapas' });
const mainEl = h('main');
document.getElementById('app')!.replaceChildren(h('div', { class: 'app' }, sideEl, mainEl));

let lastScreen: ScreenName | null = null;
let lastFocus: string | null = null;

function renderSide(): void {
  const m = state.model;
  const statusHint = state.status === 'rodando' ? 'treinando' : state.status === 'pausado' ? 'pausado' : '';
  sideEl.replaceChildren(
    h('div', { class: 'brand wide' }, logo(), h('span', null, 'Sinapse')),
    ...SCREENS.map((s) =>
      h(
        'button',
        {
          type: 'button',
          class: `step ${s.done() ? 'done' : ''}`,
          'aria-current': state.screen === s.id ? 'page' : undefined,
          'aria-label': s.label,
          onclick: () => set({ screen: s.id }),
        },
        h('span', { class: 'step-icon', 'aria-hidden': 'true' }, icon(s.icon)),
        s.label,
        s.id === 'treino' && statusHint ? h('span', { class: 'hint' }, statusHint) : null,
      ),
    ),
    h(
      'div',
      { class: 'side-foot' },
      h('div', { class: 'model-chip mono', title: m ? state.modelName : '' }, m ? `${state.modelName} · ${state.modelTrained ? 'treinada' : 'nova'}` : ''),
      h('button', { type: 'button', class: 'ghost', disabled: busy(), onclick: openModel, title: 'Abrir rede salva (JSON)', 'aria-label': 'Abrir rede' }, icon('upload'), h('span', null, 'Abrir rede')),
      h('button', { type: 'button', class: 'ghost', disabled: !m || busy(), onclick: saveModel, title: 'Salvar rede em JSON', 'aria-label': 'Salvar rede' }, icon('download'), h('span', null, 'Salvar')),
    ),
  );
}

function render(): void {
  // guarda o foco para não perdê-lo quando a tela é redesenhada
  const active = document.activeElement as HTMLElement | null;
  lastFocus = active?.getAttribute('aria-label') ?? null;
  renderSide();
  if (lastScreen === 'treino') (state.screen === 'treino' ? leaveTreino : disposeTreino)();
  if (lastScreen === 'prever' && state.screen !== 'prever') disposePredictNet();
  if (lastScreen === 'arquitetura' && state.screen !== 'arquitetura') disposeArchPreview();
  const screen = SCREENS.find((s) => s.id === state.screen)!;
  const el = screen.render();
  if (lastScreen === state.screen) el.style.animation = 'none';
  mainEl.replaceChildren(el);
  if (lastScreen !== state.screen) window.scrollTo({ top: 0 });
  lastScreen = state.screen;
  if (lastFocus) (document.querySelector(`[aria-label="${CSS.escape(lastFocus)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
}

onChange(render);
render();
