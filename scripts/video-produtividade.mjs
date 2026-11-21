// Grava a demonstração com o dataset de produtividade (sem som, para narrar por cima):
// node scripts/video-produtividade.mjs <dataset.csv> <saida.mp4>   (precisa do ffmpeg no PATH; roteiro em video/roteiro-produtividade.md)
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arquivo = process.argv[2];
const out = process.argv[3] ?? 'sinapse-produtividade.mp4';
if (!arquivo) throw new Error('Passe o caminho do dataset.csv');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.2 });

// um cursor desenhado (a gravação não mostra o do sistema) e um anel a cada clique
await page.evaluateOnNewDocument(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4 3.9 7.3-2.6 1.4-3.9-7.3L4 19z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647, pointerEvents: 'none', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.6))' });
    document.body.append(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX - 4 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: e.clientX - 18 + 'px', top: e.clientY - 18 + 'px', width: '36px', height: '36px', borderRadius: '50%', border: '2px solid rgba(255,255,255,.85)', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out' });
      document.body.append(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  });
});

// motion design (títulos, abertura, zoom da câmera): scripts/video-movimento.js
await page.evaluateOnNewDocument((await import('node:fs')).readFileSync(new URL('./video-movimento.js', import.meta.url), 'utf8'));

await page.goto(process.env.URL ?? 'https://sinapse-mlp.vercel.app', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
// pausas de cena (1,5 s ou mais) esticam pelo fator da cena atual; cliques e movimentos não mudam
let fator = 1;
const wait = (ms) => new Promise((r) => setTimeout(r, ms >= 1500 ? ms * fator : ms));
// zoom da câmera: aproxima de um elemento; antes de medir, clicar ou rolar, volta ao normal
let zoomado = false;
async function zoom(fn, max) {
  zoomado = (await page.evaluate((src, max) => window.__mo.zoom(new Function(src)(), max), fn, max)) || zoomado;
}
async function solta() {
  if (!zoomado) return;
  zoomado = false;
  await page.evaluate(() => window.__mo.zoomOut());
  await new Promise((r) => setTimeout(r, 1150));
}
let mx = 800, my = 450;
await page.mouse.move(mx, my);

// anda com o mouse até o elemento e clica
async function to(x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
  mx = x; my = y;
}
async function clickAt(x, y) {
  await solta();
  await to(x, y);
  await wait(180);
  await page.mouse.click(x, y);
  await wait(450);
}
async function box(fn, ...args) {
  await solta();
  return page.evaluate((src, args) => {
    const el = new Function('args', src)(args);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y };
  }, fn, args);
}
const byText = (t, s = 'main') => box(`return [...document.querySelectorAll(${JSON.stringify(s + ' button')})].find((b) => b.textContent.trim() === ${JSON.stringify(t)})`);
async function click(t, s = 'main') {
  const b = await byText(t, s);
  if (!b) throw new Error('não achei o botão ' + t);
  await clickAt(b.x, b.y);
}
async function clickSel(sel) {
  const b = await box(`return document.querySelector(${JSON.stringify(sel)})`);
  if (!b) throw new Error('não achei ' + sel);
  await clickAt(b.x, b.y);
}
async function setField(label, v) {
  const b = await box(`return document.querySelector('.inline-fields input[aria-label="${label}"]')`);
  if (b) await to(b.x, b.y, 18);
  await page.evaluate((l, v) => {
    const el = document.querySelector(`.inline-fields input[aria-label="${l}"]`);
    el.value = v;
    el.dispatchEvent(new Event('change'));
  }, label, v);
  await wait(500);
}
async function scrollMain(y) {
  await solta();
  await page.evaluate((y) => {
    const m = document.querySelector('main');
    (m.scrollHeight > m.clientHeight ? m : document.scrollingElement).scrollTo({ top: y, behavior: 'smooth' });
  }, y);
  await wait(1200);
}
async function trained() {
  await page.waitForFunction(() => /Treinar mais/.test(document.querySelector('main .head')?.textContent ?? ''), { timeout: 180000 });
}

// a gravação: cada quadro do Chrome com o horário em que apareceu; o ffmpeg monta com as durações de verdade
// (um trecho parado não encolhe, o que importa para as pausas da narração)
const dir = out.replace(/\.\w+$/, '') + '-quadros';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const cdp = await page.createCDPSession();
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  const n = frames.length;
  writeFileSync(`${dir}/${String(n).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64'));
  frames.push(Date.now());
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = Date.now();
const cenas = [];
// ALVOS (opcional): arquivo JSON { "Abertura": 35, … } com quantos segundos cada cena precisa ter (o tamanho da narração).
// As pausas da cena esticam na proporção do tamanho natural, e se ainda faltar tempo a cena segura no fim antes da próxima.
const NATURAL = { Abertura: 7.4, Dados: 23, Arquitetura: 12.8, 'Um exemplo': 27.5, Treinando: 26, Resultados: 22.6, Prever: 28.5, Salvar: 5.9, Fechamento: 6 };
const ALVOS = process.env.ALVOS ? JSON.parse((await import('node:fs')).readFileSync(process.env.ALVOS, 'utf8')) : {};
async function cena(nome) {
  const ant = cenas.at(-1);
  if (ant && ALVOS[ant.nome]) {
    const falta = ALVOS[ant.nome] * 1000 - (Date.now() - t0 - ant.t * 1000);
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  }
  fator = ALVOS[nome] && NATURAL[nome] ? Math.max(1, ALVOS[nome] / NATURAL[nome]) : 1;
  await solta();
  cenas.push({ nome, t: Math.round((Date.now() - t0) / 100) / 10 });
  const n = CAPITULOS.indexOf(nome);
  if (n >= 0) await page.evaluate((n, total, nome) => window.__mo.capitulo(n, total, nome), n + 1, CAPITULOS.length, nome);
}
// títulos de capítulo das cenas do app; a abertura e o fechamento têm animação própria
const CAPITULOS = ['Dados', 'Arquitetura', 'Um exemplo', 'Treinando', 'Resultados', 'Prever', 'Salvar'];
// o menor cartão da página que tem esse texto
const cartao = (re) => `return [...document.querySelectorAll('main .card, main section, main .panel')].filter((c) => ${re}.test(c.textContent) && c.getBoundingClientRect().height > 40).sort((a, b) => a.textContent.length - b.textContent.length)[0]`;
// tempos da fala (s, contados do começo do áudio, que entra 0,5 s depois da cena)
const NOME1 = process.env.NOME1 ?? 'Henrique Luan Fritz';
const NOME2 = process.env.NOME2 ?? 'Lucas Pannebecker Sckenal';


async function scrollToEl(fn) {
  await page.evaluate((src) => new Function(src)()?.scrollIntoView({ behavior: 'smooth', block: 'center' }), fn);
  await wait(1200);
}
// o JSON do Salvar vai para a pasta temporária, sem perguntar
await cdpDownloads();
async function cdpDownloads() {
  const s = await page.createCDPSession();
  await s.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: (await import('node:os')).tmpdir() }).catch(() => {});
}

// 1. abertura: a tela inicial com a rede aprendendo ao vivo
await cena('Abertura');
await page.evaluate((a, b) => window.__mo.intro({
  nome1: a, nome2: b, n1: 2.8, n2: 6.2, projeto: 9.2,
  chips: [[13.8, 'MLP escrita do zero', true], [18.5, 'TypeScript'], [19.8, 'sem biblioteca de IA'], [21.9, 'dataset de produtividade']],
  sai: 26.6,
}), NOME1, NOME2);
await to(900, 520, 40);
await wait(7000);

// 2. dados: o CSV do professor entra pelo quadro de arquivo
await cena('Dados');
const drop = await box(`return document.querySelector('[aria-label="Escolher arquivo CSV"]')`);
await to(drop.x, drop.y);
await wait(400);
const [chooser] = await Promise.all([page.waitForFileChooser(), page.mouse.click(drop.x, drop.y)]);
await wait(700);
await chooser.accept([arquivo]);
await wait(2500);
await zoom(cartao('/Colunas/i'));
await wait(4500);
await zoom(cartao('/Divis/'));
await wait(5000);
await scrollToEl(`return [...document.querySelectorAll('main .card, main section')].find((c) => /Como o arquivo foi lido/i.test(c.textContent))`);
await wait(3000);
await scrollToEl(`return [...document.querySelectorAll('main .lbl')].find((l) => /Normaliza/.test(l.textContent))`);
await wait(3000);
await scrollMain(0);

// 3. arquitetura: 2 → 4 tanh → 1 linear, com a prévia
await cena('Arquitetura');
await click('Arquitetura', '.side');
await wait(1500);
await zoom(cartao('/Camadas/i'));
await wait(4000);
await zoom(cartao('/Prévia/i'));
await wait(3500);
await click('Criar rede');
await wait(2000);

// 4. um exemplo passando pela rede, com as contas
await cena('Um exemplo');
await click('2D');
await wait(2000);
await click('Um exemplo');
await wait(2500);
await scrollToEl(`return document.querySelector('main .step-flow') ?? [...document.querySelectorAll('main section')].find((s) => /Um exemplo/.test(s.textContent) && s.querySelector('table'))`);
await zoom(`return document.querySelector('main .step-flow') ?? [...document.querySelectorAll('main section')].find((s) => /Um exemplo/.test(s.textContent) && s.querySelector('table'))`, 1.35);
await wait(9000);
await scrollMain(0);
await click('Um exemplo');
await wait(5000);
await click('3D');
await wait(1500);

// 5. treinar: 1000 épocas, paciência 50 (parada antecipada)
await cena('Treinando');
await setField('Épocas', '1000');
await setField('Paciência', '50');
await click('Treinar');
await trained();
await wait(4000);
// a curva do erro e o mapa da rede, com tempo para a narração
await scrollToEl(`return document.querySelector('main .chart')`);
await zoom(`return document.querySelector('main .chart')`, 1.6);
await wait(9000);
await scrollToEl(`return document.querySelector('main canvas.boundary')`);
await zoom(`return document.querySelector('main canvas.boundary')`, 1.5);
await wait(7000);
await scrollMain(0);

// 6. resultados: erro do teste nas duas escalas e a explicação
await cena('Resultados');
await scrollToEl(`return document.querySelector('main .stats')`);
await zoom(`return document.querySelector('main .stats')`, 1.7);
await wait(7000);
await scrollToEl(`return document.querySelector('main .explain')`);
await zoom(`return document.querySelector('main .explain')`, 1.35);
await wait(12000);
await scrollMain(0);

// 7. prever: um valor digitado e linhas reais do dataset
await cena('Prever');
await click('Prever', '.side');
await wait(2500);
const campos = await page.$$('main .field input');
for (const [i, v] of ['250', '60'].entries()) {
  const r = await campos[i].boundingBox();
  await clickAt(r.x + r.width / 2, r.y + r.height / 2);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type(v, { delay: 120 });
  await wait(300);
}
await click('Prever', 'main .head');
await wait(500);
await zoom(cartao('/Saídas/i'), 1.6);
await wait(5500);
await click('Linha do dataset', 'main .head');
await wait(500);
await zoom(cartao('/Saídas/i'), 1.5);
await wait(4500);
await click('Linha do dataset', 'main .head');
await wait(500);
await zoom(cartao('/Saídas/i'), 1.5);
await wait(4500);

// 8. salvar: a rede vai para um JSON
await cena('Salvar');
await click('Salvar', '.side');
await wait(5000);

// 9. fechamento
await cena('Fechamento');
await page.evaluate((a, b) => window.__mo.fim({
  chips: [[6.6, 'configurável', true], [7.7, 'treinada'], [8.8, 'testada'], [10.0, 'com o dataset do trabalho']],
  obrigado: 12.2, nomes: a + '  ·  ' + b,
}), NOME1, NOME2);
await wait(6000);
await cena('Fim');
await cdp.send('Page.stopScreencast');
const tEnd = Date.now();
const list = frames.map((t, i) => `file '${String(i).padStart(6, '0')}.jpg'
duration ${(((frames[i + 1] ?? tEnd) - t) / 1000).toFixed(3)}`);
// o concat do ffmpeg pede o último quadro repetido no fim
list.push(`file '${String(frames.length - 1).padStart(6, '0')}.jpg'`);
writeFileSync(`${dir}/lista.txt`, list.join('\n'));
const lead = Math.max(0, (frames[0] - t0) / 1000);
cenas.forEach((c) => (c.t = Math.max(0, Math.round((c.t - lead) * 10) / 10)));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/lista.txt`, '-vf', 'scale=1920:1080:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out.replace(/\.\w+$/, '') + '.mp4']);
writeFileSync(out.replace(/\.\w+$/, '') + '.cenas.json', JSON.stringify(cenas, null, 1));
console.log(JSON.stringify(cenas));
await browser.close();
