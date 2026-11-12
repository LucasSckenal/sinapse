// Olhada rápida numa tela durante o treino (para conferir o 3D): node scripts/olhar.mjs <exemplo> <saida.png> [vista]
import puppeteer from 'puppeteer-core';

const [exemplo = 'Espiral', saida = 'olhar.png', vista = 'rede', largura = '1440', altura = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: +largura, height: +altura, deviceScaleFactor: 1 });
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));
page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
await page.goto(process.env.URL ?? 'http://localhost:5191', { waitUntil: 'networkidle0' });
if (vista === 'inicio') {
  await new Promise((r) => setTimeout(r, Number(process.env.ESPERA ?? 7000)));
  await page.screenshot({ path: saida });
  console.log(JSON.stringify({ erros, legenda: await page.evaluate(() => document.querySelector('.demo-caption')?.textContent) }));
  await browser.close();
  process.exit(0);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (t, s = 'main') => {
  await page.evaluate((t, s) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === t).click(), t, s);
  await wait(450);
};
await click(exemplo);
await click('Arquitetura');
for (let i = 0; i < 12; i++) await page.click('[aria-label="Aumentar neurônios da camada oculta 1"]');
await page.click('.add-layer');
await wait(200);
await click('Criar rede');
await page.evaluate(() => {
  const el = document.querySelectorAll('.inline-fields input')[1];
  el.value = '3000';
  el.dispatchEvent(new Event('change'));
});
await wait(300);
await click('Treinar');
if (vista === 'superficie') await click('Superfície do erro');
if (vista === 'plano') await click('2D');
if (vista === 'rede') await click('3D');
await wait(vista === 'superficie' ? 5000 : Number(process.env.ESPERA ?? 3000));
if (process.env.INTERAGIR) {
  // gira, move com o botão direito, aproxima com a roda e usa o botão "+"
  const box = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.stage3d')].find((e) => e.offsetParent).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 40, { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x - 60, box.y + 30, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel({ deltaY: -300 });
  await page.evaluate(() => [...document.querySelectorAll('.cam-btn')].find((b) => b.offsetParent && b.getAttribute('aria-label') === "Aproximar").click());
  await wait(800);
}
await page.screenshot({ path: saida });
console.log(JSON.stringify({ erros, webgl: await page.evaluate(() => document.querySelectorAll('.stage3d canvas').length) }));
await browser.close();
