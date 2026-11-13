import { blocksOf } from '../core/network';
import { confusionMatrix } from '../core/encoding';
import { NORMALIZATION_LABELS } from '../core/normalization';
import { serialize } from '../core/persistence';
import { fmt } from './dom';
import { NetView } from './netview';
import { architectureText, state } from './state';
import { currentSplit } from './training';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Curva do MSE (treino e validação) em SVG claro, para imprimir. */
function chartSvg(): string {
  const hist = state.history;
  if (hist.length < 2) return '';
  const W = 640;
  const H = 220;
  const vals = hist.flatMap((r) => [r.trainMSE, r.valMSE]).filter((v) => Number.isFinite(v) && v > 0);
  const lo = Math.floor(Math.log10(Math.min(...vals)));
  const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...vals))));
  const x = (e: number) => 50 + (e / hist.length) * (W - 60);
  const y = (v: number) => 10 + ((hi - Math.log10(Math.max(v, 10 ** lo))) / (hi - lo)) * (H - 40);
  const path = (k: 'trainMSE' | 'valMSE') =>
    hist
      .filter((r) => Number.isFinite(r[k]))
      .map((r, i) => `${i ? 'L' : 'M'}${x(r.epoch).toFixed(1)},${y(r[k]).toFixed(1)}`)
      .join('');
  let grid = '';
  for (let p = lo; p <= hi; p++)
    grid += `<line x1="50" x2="${W - 10}" y1="${y(10 ** p)}" y2="${y(10 ** p)}" stroke="#ddd"/><text x="44" y="${y(10 ** p) + 3}" text-anchor="end" font-size="10" fill="#777">1e${p}</text>`;
  const best = state.bestEpoch
    ? `<line x1="${x(state.bestEpoch)}" x2="${x(state.bestEpoch)}" y1="10" y2="${H - 30}" stroke="#111" stroke-dasharray="3 4"/><text x="${x(state.bestEpoch) + 5}" y="20" font-size="10">melhor: ${state.bestEpoch}</text>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" font-family="JetBrains Mono, monospace">${grid}<path d="${path('valMSE')}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="4 4"/><path d="${path('trainMSE')}" fill="none" stroke="#111" stroke-width="1.8"/>${best}<text x="${W - 10}" y="${H - 8}" text-anchor="end" font-size="10" fill="#777">${hist.length} épocas · contínua = treino · tracejada = validação</text></svg>`;
}

export function buildReport(): string {
  const m = state.model!;
  const t = state.table;
  const arch = m.net.architecture;
  const [a, b, c] = state.splitCounts ?? [0, 0, 0];
  const last = state.history[state.history.length - 1];
  const at = state.bestEpoch > 0 ? state.history[state.bestEpoch - 1] : last;
  const role = (j: number) => (state.selection.inputs.includes(j) ? 'entrada' : state.selection.outputs.includes(j) ? 'saída' : 'ignorada');
  const cols = t
    ? t.headers.map((hd, j) => `<tr><td>${esc(hd)}</td><td>${role(j)}</td><td>${t.classes[j] ? `rótulo: ${esc(t.classes[j]!.join(', '))}` : 'número'}</td></tr>`).join('')
    : '';
  const norm = m.normalization;
  const normTxt = !norm
    ? 'Nenhuma.'
    : norm.tipo === 'minmax'
      ? `Min-Max com parâmetros do treino. Mín: ${norm.min.map((v) => fmt(v, 3)).join(' · ')}. Máx: ${norm.max.map((v) => fmt(v, 3)).join(' · ')}.`
      : `Z-score com parâmetros do treino. Média: ${norm.media.map((v) => fmt(v, 3)).join(' · ')}. Desvio: ${norm.desvio.map((v) => fmt(v, 3)).join(' · ')}.`;
  const layers = arch.layers
    .map((l, i) => {
      const name = i === arch.layers.length - 1 ? 'Saída' : `Oculta ${i + 1}`;
      const bl = blocksOf(l)
        .map((bk, k) => `${blocksOf(l).length > 1 ? `bloco ${'ABCDEFGH'[k]}: ` : ''}${bk.neurons} × ${bk.activation}${bk.from ? ` (recebe de ${bk.from.map((f) => (i === 0 ? (m.columns?.entradas[f] ?? `x${f + 1}`) : 'ABCDEFGH'[f])).join(', ')})` : ''}`)
        .join('; ');
      return `<tr><td>${name}</td><td>${esc(bl)}</td></tr>`;
    })
    .join('');
  let cmHtml = '';
  const te = currentSplit?.teste;
  if (te && te.inputs.length) {
    const cm = confusionMatrix(te.inputs.map((x) => m.net.forward(x)), te.targets, m.codings?.saidas, m.columns?.saidas);
    if (cm)
      cmHtml = `<h2>Matriz de confusão (teste)</h2><table class="cm"><tr><th>real \\ previsto</th>${cm.labels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr>${cm.m
        .map((r, i) => `<tr><th>${esc(cm.labels[i])}</th>${r.map((v, j) => `<td class="${i === j ? 'd' : ''}">${v}</td>`).join('')}</tr>`)
        .join('')}</table>`;
  }
  const net = new NetView(arch, serialize(m));
  const pct = (x?: number) => (x === undefined ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório · ${esc(state.fileName)}</title>
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.5 'Archivo', Arial, sans-serif; color: #111; margin: 0; }
h1 { font-weight: 300; font-stretch: 125%; text-transform: uppercase; letter-spacing: .04em; font-size: 26pt; margin: 0 0 4px; }
h2 { font-weight: 400; text-transform: uppercase; letter-spacing: .1em; font-size: 9pt; color: #555; margin: 22px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
.sub { color: #666; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
td, th { text-align: left; padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
th { color: #666; font-weight: 400; }
.nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.nums div { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; }
.nums b { display: block; font: 15pt 'JetBrains Mono', monospace; }
.nums span { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: .08em; }
.net { background: #121214; border-radius: 10px; padding: 8px; }
.net svg { width: 100%; height: auto; display: block; }
.cm { width: auto; } .cm td { text-align: center; min-width: 48px; } .cm td.d { background: #111; color: #fff; }
p { margin: 4px 0; }
code { font-family: 'JetBrains Mono', monospace; font-size: 9pt; background: #f2f2f3; padding: 0 4px; border-radius: 4px; }
.page { break-inside: avoid; }
</style></head><body>
<h1>Sinapse · relatório</h1>
<p class="sub">${esc(state.fileName)} · ${new Date().toLocaleString('pt-BR')} · ${esc(architectureText(arch))}</p>

<h2>Resultado</h2>
<div class="nums">
<div><span>MSE treino</span><b>${fmt(at?.trainMSE)}</b></div>
<div><span>MSE validação</span><b>${fmt(at?.valMSE)}</b></div>
<div><span>MSE teste</span><b>${fmt(state.testMSE)}</b></div>
<div><span>Acerto no teste</span><b>${pct(state.testAccuracy)}</b></div>
</div>
<p class="sub">${state.history.length} épocas feitas${state.bestEpoch ? ` · pesos da época ${state.bestEpoch} (melhor validação${state.earlyStopped ? ', parada antecipada' : ''})` : ''}.</p>

<div class="page"><h2>Curva do erro</h2>${chartSvg()}</div>
${cmHtml}

<div class="page"><h2>Rede</h2><div class="net">${net.el.outerHTML}</div>
<table>${layers}<tr><td>Entradas</td><td>${arch.inputs}${m.columns ? ` (${esc(m.columns.entradas.join(', '))})` : ''}</td></tr></table></div>

<h2>Dados e divisão</h2>
<table><tr><th>coluna</th><th>papel</th><th>tipo</th></tr>${cols}</table>
<p>${t?.rows.length ?? 0} linhas embaralhadas (Fisher-Yates) com a semente <code>${state.splitSeed}</code>: <b>${a}</b> de treino (${state.percent.treino}%), <b>${b}</b> de validação (${state.percent.validacao}%), <b>${c}</b> de teste (${state.percent.teste}%).</p>
<p>Normalização das entradas (${NORMALIZATION_LABELS[state.normalization]}): ${normTxt} As saídas não são normalizadas.</p>

<h2>Treinamento</h2>
<p>SGD: a cada época os exemplos de treino são embaralhados (semente <code>${state.trainSeed}</code>) e passam um de cada vez — propagação, erro, retropropagação e ajuste. Taxa <code>η = ${String(state.learningRate).replace('.', ',')}</code>, ${state.epochs} épocas${state.patience ? `, parada antecipada com paciência ${state.patience}` : ''}.</p>
<p>O ajuste é feito depois de <b>cada exemplo</b> (não por lote). Primeiro calcula todos os deltas com os pesos de antes — <code>δ saída = (o − t)·f′(z)</code>, <code>δ oculta = f′(z)·Σ w·δ</code> — e só então atualiza <code>w ← w − η·δ·x</code> e <code>b ← b − η·δ</code>. A validação só mede o erro a cada época; o teste é usado só no fim.</p>
<p class="sub">Pesos iniciais: Xavier (Linear, Sigmoid, Tanh) ou He (ReLU), semente <code>${state.initSeed}</code>; vieses começam em 0.</p>
</body></html>`;
}

/** Abre a impressão do navegador com o relatório (lá dá para salvar em PDF). */
export function printReport(): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.srcdoc = buildReport();
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  };
  document.body.appendChild(frame);
}
