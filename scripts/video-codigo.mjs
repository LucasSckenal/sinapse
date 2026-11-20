// Grava as cenas de código do vídeo (video/codigo.html com o código real de src/core), uma .mp4 por cena:
// node scripts/video-codigo.mjs <pasta-saida>   (precisa do ffmpeg no PATH)
// Os trechos são lidos dos arquivos na hora: se o código mudar, confira as linhas abaixo.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.resolve(process.argv[2] ?? 'video/codigo');
mkdirSync(saida, { recursive: true });
const trecho = (arquivo, de, ate) => ({ arquivo, de, ate, linhas: readFileSync(path.join(raiz, arquivo), 'utf8').split(/\r?\n/).slice(de - 1, ate) });

// roda os testes de verdade e mostra a lista: "✓ grupo › nome", e o resumo no fim
const saidaTestes = execFileSync('npx vitest run --reporter=verbose', { cwd: raiz, shell: true, env: { ...process.env, NO_COLOR: '1' } }).toString();
const testes = saidaTestes
  .split(/\r?\n/)
  .filter((l) => l.includes('✓') && l.includes(' > '))
  .map((l) => '✓ ' + l.replace(/^.*?tests\/core\.test\.ts > /, '').replace(/\s+\d+ms$/, '').replace(' > ', ' › ').replace(/\r/g, '\\r'));
const resumo = saidaTestes.match(/Tests\s+\d+ passed \(\d+\)/)?.[0];
if (!resumo || !testes.length) throw new Error('Os testes não passaram:\n' + saidaTestes);
const linhasTestes = [...testes, '', resumo.replace(/\s+/, ' ')];
const linhaDe = (txt) => linhasTestes.findIndex((l) => l.includes(txt)) + 1;

export const CENAS = [
  {
    id: 'codigo-dados',
    eyebrow: 'Código · requisito 1.9',
    titulo: 'Divisão e normalização',
    paginas: [
      {
        ...trecho('src/core/dataset.ts', 215, 239),
        focos: [
          { de: 222, ate: 226, legenda: 'Embaralha os índices com semente e corta nos percentuais.', ms: 5200 },
          { de: 231, ate: 233, legenda: 'Treino, validação e teste nunca se misturam.', ms: 4200 },
          { de: 234, ate: 235, legenda: 'A normalização é calculada só com o treino, para o teste não vazar no treino.', ms: 5600 },
          { de: 236, ate: 238, legenda: 'As saídas numéricas também: Min-Max para a faixa da ativação.', ms: 5600 },
        ],
      },
    ],
  },
  {
    id: 'codigo-entidades',
    eyebrow: 'Código · requisitos 1.1 a 1.5',
    titulo: 'Neurônio e ativações',
    paginas: [
      {
        ...trecho('src/core/neuron.ts', 35, 61),
        focos: [
          { de: 35, ate: 42, legenda: 'Soma ponderada: z = Σ w·x + b.', ms: 4600 },
          { de: 44, ate: 48, legenda: 'A saída é a ativação aplicada a z.', ms: 4000 },
          { de: 55, ate: 61, legenda: 'Ajuste do peso: w ← w − η·δ·x, e o viés: b ← b − η·δ.', ms: 5600 },
        ],
      },
      {
        ...trecho('src/core/activations.ts', 15, 41),
        focos: [
          { de: 22, ate: 27, legenda: 'Cada ativação traz a função e a derivada. Sigmoid: f′ = f·(1 − f).', ms: 5200 },
          { de: 28, ate: 33, legenda: 'Tanh: f′ = 1 − f².', ms: 3800 },
          { de: 34, ate: 40, legenda: 'ReLU: derivada 1 quando z > 0, e 0 no resto.', ms: 4200 },
        ],
      },
    ],
  },
  {
    id: 'codigo-retropropagacao',
    eyebrow: 'Código · requisitos 1.6 a 1.8',
    titulo: 'Propagação e retropropagação',
    paginas: [
      {
        ...trecho('src/core/network.ts', 138, 182),
        focos: [
          { de: 139, ate: 145, legenda: 'Para frente: a saída de cada camada vira a entrada da próxima.', ms: 5000 },
          { de: 156, ate: 159, legenda: 'Delta da saída: δ = (o − t)·f′(z).', ms: 4800 },
          { de: 160, ate: 168, legenda: 'Ocultas, de trás para frente: δ = f′(z)·Σ w·δ, com os pesos ainda antigos.', ms: 6200 },
          { de: 171, ate: 174, legenda: 'Só depois de todos os deltas os pesos mudam: a regra usa os pesos da ida.', ms: 5400 },
          { de: 177, ate: 182, legenda: 'Um passo de SGD: ida, volta e ajuste, para um exemplo.', ms: 4600 },
        ],
      },
    ],
  },
  {
    id: 'codigo-treino',
    eyebrow: 'Código · requisitos 1.7 e 1.10',
    titulo: 'Treino por época',
    paginas: [
      {
        ...trecho('src/core/trainer.ts', 87, 105),
        focos: [
          { de: 88, ate: 90, legenda: 'A cada época, embaralha e treina um exemplo de cada vez.', ms: 5200 },
          { de: 92, ate: 95, legenda: 'No fim da época, mede o MSE do treino e da validação.', ms: 4800 },
          { de: 96, ate: 102, legenda: 'Guarda os melhores pesos; sem melhorar por "paciência" épocas, para.', ms: 5600 },
          { de: 96, ate: 102, legenda: 'Por quê: quando a validação piora, a rede começou a decorar o treino.', ms: 5200 },
        ],
      },
      {
        ...trecho('src/core/loss.ts', 9, 23),
        focos: [{ de: 13, ate: 22, legenda: 'MSE: média de (o − t)² sobre todos os exemplos e saídas. Só mede, não muda a rede.', ms: 6200 }],
      },
    ],
  },
  {
    id: 'codigo-prever',
    eyebrow: 'Código · requisitos 1.11 e 1.12',
    titulo: 'Previsão e JSON',
    paginas: [
      {
        ...trecho('src/core/predict.ts', 10, 17),
        antes: 1200,
        focos: [
          { de: 11, ate: 15, legenda: 'Confere se veio o número certo de valores.', ms: 4200 },
          { de: 16, ate: 16, legenda: 'Normaliza como no treino, propaga e desfaz a escala da saída.', ms: 5200 },
        ],
      },
      {
        ...trecho('src/core/persistence.ts', 53, 73),
        focos: [
          { de: 55, ate: 63, legenda: 'O JSON guarda a arquitetura, os pesos e os vieses de cada camada.', ms: 5200 },
          { de: 68, ate: 69, legenda: 'E os parâmetros de normalização, para prever igual depois.', ms: 4800 },
        ],
      },
    ],
  },
  {
    id: 'codigo-testes',
    eyebrow: 'Código · como sabemos que está certo',
    titulo: 'Testes',
    paginas: [
      {
        ...trecho('tests/core.test.ts', 81, 122),
        focos: [
          { de: 83, ate: 96, legenda: 'Uma rede com as quatro ativações e um exemplo qualquer.', ms: 4400 },
          { de: 98, ate: 100, legenda: 'A retropropagação dá o gradiente de cada peso: δ·x.', ms: 4600 },
          { de: 104, ate: 110, legenda: 'Mexe o peso um pouquinho para cada lado e mede o erro: a derivada numérica.', ms: 5800 },
          { de: 111, ate: 111, legenda: 'As duas batem até a 5ª casa, em todos os pesos e vieses.', ms: 5200 },
        ],
      },
      {
        arquivo: 'npm test',
        rotulo: `npm test · ${testes.length} testes`,
        de: 1,
        ate: linhasTestes.length,
        linhas: linhasTestes,
        focos: [
          { de: linhaDe('gradientes analíticos'), ate: linhaDe('calcula todos os deltas'), legenda: 'Os gradientes e a ordem dos deltas.', ms: 4200 },
          { de: linhaDe('só com o treino'), ate: linhaDe('z-score'), legenda: 'A divisão e a normalização só com o treino.', ms: 4000 },
          { de: linhasTestes.length, ate: linhasTestes.length, legenda: 'Todos passam.', ms: 3600 },
        ],
      },
    ],
  },
];

// DURACOES=arquivo.json ({"codigo-dados": 30, ...} em segundos): estica os destaques de cada cena na mesma proporção
// para a cena durar o tempo da narração. O resto (entrada, troca de página, final) fica igual.
if (process.env.DURACOES) {
  const alvo = JSON.parse(readFileSync(process.env.DURACOES, 'utf8'));
  for (const c of CENAS) {
    if (!alvo[c.id]) continue;
    const focos = c.paginas.flatMap((p) => p.focos);
    const soma = focos.reduce((s, f) => s + f.ms, 0);
    const fixo = 300 + 1200 + c.paginas.reduce((s, p, i) => s + (i ? 480 : 30) + (p.antes ?? 1600) + p.focos.length * 250, 0);
    const k = (alvo[c.id] * 1000 - fixo) / soma;
    for (const f of focos) f.ms = Math.round(f.ms * k);
  }
}

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files', '--hide-scrollbars'] });
const so = process.argv.slice(3);
for (const cena of CENAS.filter((c) => !so.length || so.includes(c.id))) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.2 });
  await page.goto(pathToFileURL(path.join(raiz, 'video/codigo.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const dir = path.join(saida, `${cena.id}-quadros`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    writeFileSync(path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    frames.push(Date.now());
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate((c) => window.play(c), cena);
  await page.waitForFunction(() => window.done === true, { timeout: 120000 });
  await cdp.send('Page.stopScreencast');
  const tEnd = Date.now();
  const list = frames.map((t, i) => `file '${String(i).padStart(6, '0')}.jpg'\nduration ${(((frames[i + 1] ?? tEnd) - t) / 1000).toFixed(3)}`);
  list.push(`file '${String(frames.length - 1).padStart(6, '0')}.jpg'`);
  writeFileSync(path.join(dir, 'lista.txt'), list.join('\n'));
  const mp4 = path.join(saida, `${cena.id}.mp4`);
  // -t: o concat de imagens deixa o último quadro parado a mais; corta no tempo que a cena durou de verdade
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'lista.txt'), '-t', ((tEnd - frames[0]) / 1000).toFixed(2), '-vf', 'scale=1920:1080:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', mp4]);
  rmSync(dir, { recursive: true, force: true });
  console.log(cena.id, ((tEnd - frames[0]) / 1000).toFixed(1) + 's');
  await page.close();
}
await browser.close();
