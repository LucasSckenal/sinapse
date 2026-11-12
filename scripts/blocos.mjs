// Teste de ponta a ponta dos blocos em paralelo: node scripts/blocos.mjs <pasta-saida>
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
  await wait(350);
};
await click('Espiral');
await click('Arquitetura');
// Oculta 1: dois blocos, A recebe x, B recebe y
await page.evaluate(() => [...document.querySelectorAll('.layer-group')][1].querySelector('.layer-actions .btn').click());
await wait(300);
const chips = async (group, block) =>
  page.evaluate((g, b) => [...[...document.querySelectorAll('.layer-group')][g].querySelectorAll('.block-row')][b].querySelectorAll('.chip').length, group, block);
console.log('chips bloco A:', await chips(1, 0));
// desliga y no bloco A e x no bloco B
await page.evaluate(() => [...[...document.querySelectorAll('.layer-group')][1].querySelectorAll('.block-row')][0].querySelectorAll('.chip')[1].click());
await wait(300);
await page.evaluate(() => [...[...document.querySelectorAll('.layer-group')][1].querySelectorAll('.block-row')][1].querySelectorAll('.chip')[0].click());
await wait(300);
// bloco B vira ReLU com 6 neurônios
await page.evaluate(() => {
  const row = [...[...document.querySelectorAll('.layer-group')][1].querySelectorAll('.block-row')][1];
  [...row.querySelectorAll('.seg button')].find((b) => b.textContent === 'ReLU').click();
});
await wait(300);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const row = [...[...document.querySelectorAll('.layer-group')][1].querySelectorAll('.block-row')][1];
    row.querySelector('.stepper button:last-child').click();
  });
  await wait(120);
}
await click('Camada oculta');
const info = await page.evaluate(() => ({
  sub: document.querySelector('main .sub')?.textContent,
  avisos: [...document.querySelectorAll('main .notice')].map((n) => n.textContent),
}));
console.log(JSON.stringify(info));
await page.screenshot({ path: `${out}/b-arquitetura.png` });
await click('Criar rede');
await page.evaluate(() => {
  const el = document.querySelectorAll('.inline-fields input')[1];
  el.value = '1500';
  el.dispatchEvent(new Event('change'));
});
await wait(300);
await click('Treinar');
await click('3D');
await wait(3300);
await page.screenshot({ path: `${out}/b-treino-3d.png` });
await click('2D');
await wait(2600);
await page.screenshot({ path: `${out}/b-treino-2d.png` });
// espera acabar e salva/abre para conferir que os blocos voltam iguais
await page.waitForFunction(() => /Treinar mais/.test(document.querySelector('main .head')?.textContent ?? ''), { timeout: 60000 });
const fim = await page.evaluate(() => ({ sub: document.querySelector('main .sub')?.textContent, acc: document.querySelector('.acc')?.textContent }));
console.log(JSON.stringify(fim));
console.log(JSON.stringify({ erros }));
await browser.close();
