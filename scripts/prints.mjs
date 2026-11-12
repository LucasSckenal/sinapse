// Tira os prints da interface rodando de verdade (precisa do `npm run dev` ligado e do Chrome instalado).
// Rodar: node scripts/prints.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = process.env.URL ?? 'http://localhost:5191';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = new URL('../docs/prints/', import.meta.url);
mkdirSync(out, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });

async function run(name, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(APP, { waitUntil: 'networkidle0' });
  const click = async (text, scope = 'main') => {
    await page.evaluate(
      (t, s) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.trim() === t).click(),
      text,
      scope,
    );
    await wait(400);
  };
  const shot = async (n) => {
    await wait(450);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}-${n}.png`, out)), fullPage: n !== '3-treino' });
  };
  const setField = (sel, i, v) =>
    page.evaluate(
      (s, k, val) => {
        const el = document.querySelectorAll(s)[k];
        el.value = val;
        el.dispatchEvent(new Event('change'));
      },
      sel,
      i,
      v,
    );

  await shot('0-vazio');
  await click('Círculo');
  await click('Z-score');
  await shot('1-dados');
  await click('Arquitetura');
  await wait(200);
  await page.evaluate(() => document.querySelectorAll('.layer-row')[1].querySelectorAll('.seg button')[3].click());
  for (let i = 0; i < 8; i++) await page.click('[aria-label="Aumentar neurônios da camada oculta 1"]');
  await page.click('.add-layer');
  await shot('2-arquitetura');
  await click('Criar rede');
  await wait(200);
  await setField('.inline-fields input', 1, '400');
  await click('Treinar');
  await wait(4000);
  await shot('3-treino');
  await click('Prever', '.side');
  await wait(300);
  await page.type('[aria-label="Linha de valores"]', '0,1; 0,2');
  await page.keyboard.press('Enter');
  await shot('4-prever');
  await page.close();
}

await run('desktop', { width: 1440, height: 900, deviceScaleFactor: 1 });
await run('celular', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await browser.close();
console.log('prints em docs/prints');
