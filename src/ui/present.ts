import { h, icon } from './dom';
import { createNetwork } from './screens/arquitetura';
import { loadExample } from './screens/dados';
import { set, state } from './state';
import { startTraining, stopTraining } from './training';

/**
 * Modo apresentação: roda a demonstração sozinha, como um filme, com uma legenda curta em cada
 * passo. Tudo acontece de verdade no app (carrega, monta, treina, prevê). Esc ou "Sair" para.
 */
let running = false;

class Stop extends Error {}

export function isPresenting(): boolean {
  return running;
}

export async function startPresentation(): Promise<void> {
  if (running) return;
  running = true;
  const caption = h('p', { class: 'pres-caption' });
  const step = h('span', { class: 'pres-step mono' });
  const bar = h('i');
  const exit = h('button', { type: 'button', class: 'btn line small', onclick: () => (running = false) }, icon('x'), 'Sair');
  const box = h('div', { class: 'pres', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'pres-top' }, step, exit), caption, h('div', { class: 'pres-bar' }, bar));
  document.body.appendChild(box);
  document.body.classList.add('presenting');
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (running = false);
  addEventListener('keydown', onKey);

  const STEPS = 8;
  let n = 0;
  const say = (text: string) => {
    n++;
    step.textContent = `${n} / ${STEPS}`;
    caption.textContent = text;
    caption.classList.remove('in');
    void caption.offsetWidth;
    caption.classList.add('in');
    bar.style.transform = `scaleX(${n / STEPS})`;
  };
  const wait = async (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (!running) throw new Stop();
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const clickText = (text: string) =>
    ([...document.querySelectorAll('main button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim().endsWith(text))?.click();

  try {
    // 1 · abertura: a rede da tela inicial aprendendo XOR
    set({ screen: 'dados', table: null, model: null, modelTrained: false });
    say('Sinapse: redes neurais MLP escritas do zero, sem biblioteca de IA.');
    await wait(4200);

    // 2 · dados
    await loadExample('espiral.csv');
    say('Os dados: 330 pontos de uma espiral, com a classe escrita em texto.');
    await wait(3800);

    // 3 · a rede sendo montada, camada por camada
    set({ screen: 'arquitetura', arch: { inputs: 2, layers: [{ neurons: 4, activation: 'tanh' }, { neurons: 3, activation: 'sigmoid' }] }, initSeed: 42 });
    say('A arquitetura: escolhida na tela, sem mexer no código.');
    await wait(1600);
    for (const n2 of [8, 12]) {
      set({ arch: { inputs: 2, layers: [{ neurons: n2, activation: 'tanh' }, { neurons: 3, activation: 'sigmoid' }] } });
      await wait(1100);
    }
    set({ arch: { inputs: 2, layers: [{ neurons: 12, activation: 'tanh' }, { neurons: 12, activation: 'tanh' }, { neurons: 3, activation: 'sigmoid' }] } });
    await wait(1800);

    // 4 · treino ao vivo
    try {
      localStorage.setItem('sinapse.vista', 'rede');
    } catch {
      /* sem armazenamento: usa a vista que estiver */
    }
    createNetwork();
    set({ learningRate: 0.1, epochs: 800, patience: 0 });
    await wait(500);
    say('O treino: cada exemplo vai pela rede, o erro volta e os pesos mudam.');
    startTraining();
    const t0 = performance.now();
    while (state.status === 'rodando' && performance.now() - t0 < 30000) await wait(200);
    if (state.status === 'rodando') stopTraining();
    await wait(1500);

    // 5 · fronteira e matriz
    say('O que ela aprendeu: a fronteira de cada classe e a matriz de confusão do teste.');
    await wait(4500);

    // 6 · superfície do erro
    clickText('Superfície do erro');
    say('A superfície do erro e o caminho que os pesos fizeram até o fundo.');
    await wait(5000);
    clickText('3D');

    // 7 · previsão
    set({ screen: 'prever' });
    say('A previsão: um exemplo novo passa pela rede e ela responde.');
    await wait(1200);
    clickText('Linha do dataset');
    await wait(2600);
    clickText('Linha do dataset');
    await wait(2600);

    // 8 · laboratório
    set({ screen: 'lab' });
    await wait(300);
    clickText('Espiral');
    say('E ao vivo: ponha pontos e veja a rede aprender na hora.');
    await wait(6000);
  } catch (e) {
    if (!(e instanceof Stop)) console.error(e);
  } finally {
    running = false;
    removeEventListener('keydown', onKey);
    document.body.classList.remove('presenting');
    box.classList.add('out');
    setTimeout(() => box.remove(), 300);
  }
}
