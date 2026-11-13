// Teste de ponta a ponta do "desenhe um número": node scripts/digitos.mjs <pasta-saida>
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? '.';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));
page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
await page.goto(process.env.URL ?? 'http://localhost:5191', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (t, s = 'main') => {
  await page.evaluate((t, s) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === t).click(), t, s);
  await wait(500);
};
await click('Dígitos');
await wait(500);
await click('Arquitetura');
await click('Criar rede');
await click('Treinar');
await page.waitForFunction(() => /Treinar mais/.test(document.querySelector('main .head')?.textContent ?? ''), { timeout: 120000 });
const acc = await page.evaluate(() => document.querySelector('.acc')?.textContent);
await click('Prever', '.side');
await wait(800);

// desenha números com o mouse no quadro
const box = await page.evaluate(() => {
  const r = document.querySelector('canvas.pad').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width };
});
const P = (fx, fy) => [box.x + fx * box.w, box.y + fy * box.w];
async function stroke(points) {
  const [x0, y0] = P(...points[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const pt of points.slice(1)) {
    const [x, y] = P(...pt);
    await page.mouse.move(x, y, { steps: 8 });
  }
  await page.mouse.up();
  await wait(300);
}
async function guess() {
  return page.evaluate(() => document.querySelector('.guess')?.textContent);
}
const results = {};
// 1: traço vertical
await stroke([[0.5, 0.15], [0.5, 0.85]]);
results['1'] = await guess();
await page.screenshot({ path: `${out}/d-um.png` });
await click('Limpar');
// 7: traço de cima e diagonal
await stroke([[0.25, 0.18], [0.75, 0.18], [0.42, 0.85]]);
results['7'] = await guess();
await page.screenshot({ path: `${out}/d-sete.png` });
await click('Limpar');
// 0: oval
const oval = Array.from({ length: 25 }, (_, k) => [0.5 + 0.22 * Math.sin((k / 24) * 2 * Math.PI), 0.5 - 0.33 * Math.cos((k / 24) * 2 * Math.PI)]);
await stroke(oval);
results['0'] = await guess();
await page.screenshot({ path: `${out}/d-zero.png` });
console.log(JSON.stringify({ acc, results, erros }, null, 1));
await browser.close();
