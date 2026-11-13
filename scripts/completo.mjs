// Teste de ponta a ponta das ferramentas de análise: node scripts/completo.mjs <pasta-saida>
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
await page.evaluate(() => localStorage.clear());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (t, s = 'main') => {
  await page.evaluate((t, s) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === t).click(), t, s);
  await wait(400);
};
const setField = (label, v) =>
  page.evaluate(
    (l, v) => {
      const el = document.querySelector(`.inline-fields input[aria-label="${l}"]`);
      el.value = v;
      el.dispatchEvent(new Event('change'));
    },
    label,
    v,
  );

await click('Espiral');
await click('Arquitetura');
for (let i = 0; i < 8; i++) await page.click('[aria-label="Aumentar neurônios da camada oculta 1"]');
await click('Criar rede');
await click('2D');
// dois passos manuais
await click('Um exemplo');
await wait(300);
await click('Um exemplo');
await wait(1200);
const passo = await page.evaluate(() => ({
  titulo: document.querySelector('.step-card .card-head')?.textContent,
  linhas: document.querySelectorAll('.step-table tbody tr').length,
  mudancas: document.querySelectorAll('.changes > div').length,
}));
// clica num neurônio da camada oculta no 2D
await page.evaluate(() => document.querySelectorAll('.flat-host .pick')[4].dispatchEvent(new MouseEvent('click', { bubbles: true })));
await wait(300);
const insp = await page.evaluate(() => document.querySelector('.inspector')?.innerText.replace(/\n/g, ' | '));
await page.screenshot({ path: `${out}/c-passo.png`, fullPage: true });

// treino com parada antecipada
await setField('Épocas', '4000');
await wait(200);
await setField('Paciência', '40');
await wait(200);
await setField('Taxa', '0,2');
await wait(200);
await click('Treinar');
await page.waitForFunction(() => /Treinar mais/.test(document.querySelector('main .head')?.textContent ?? ''), { timeout: 120000 });
await wait(1500);
const fim = await page.evaluate(() => ({
  sub: document.querySelector('main .sub')?.textContent,
  stop: document.querySelector('.stop-info')?.textContent,
  acc: document.querySelector('.acc')?.textContent,
  cm: document.querySelector('table.cm')?.innerText.replace(/\s+/g, ' '),
  runs: document.querySelectorAll('table.runs tbody tr').length,
}));
await page.screenshot({ path: `${out}/c-fim.png`, fullPage: true });

// relatório: pega o HTML que iria para a impressão e gera o PDF
await page.evaluate(() => {
  window.print = () => {};
});
await click('Relatório');
await wait(800);
const html = await page.evaluate(() => document.querySelector('iframe')?.srcdoc ?? '');
const rp = await browser.newPage();
await rp.setContent(html, { waitUntil: 'load' });
await rp.pdf({ path: `${out}/relatorio.pdf`, format: 'A4', printBackground: true });
await rp.screenshot({ path: `${out}/c-relatorio.png`, fullPage: true });
console.log(JSON.stringify({ passo, insp, fim, relatorio: html.length, erros }, null, 1));
await browser.close();
