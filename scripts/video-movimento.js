// Camada de motion design injetada na página durante a gravação (scripts/video-produtividade.mjs).
// window.__mo.intro(), .capitulo(n, total, nome), .zoom(el), .zoomOut(), .fim()
// Tudo é desenhado num div fixo fora do #app, então o zoom do app não mexe nos títulos.
(() => {
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const css = `
  .mo { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: var(--font, 'Archivo', system-ui, sans-serif); color: #f2f2f3; }
  .mo-fundo { position: absolute; inset: 0; background: radial-gradient(120% 90% at 30% 40%, #0b0b0ca6, #0b0b0cee); backdrop-filter: blur(0px); opacity: 0; transition: opacity .8s ${EASE}, backdrop-filter .8s ${EASE}; }
  .mo.on .mo-fundo { opacity: 1; backdrop-filter: blur(10px); }
  .mo-box { position: absolute; left: 140px; top: 50%; transform: translateY(-50%); }
  .mo-eye { font: 500 14px var(--mono, monospace); letter-spacing: .24em; text-transform: uppercase; color: #a6a6ad; opacity: 0; transform: translateY(8px); transition: opacity .6s ${EASE}, transform .6s ${EASE}; }
  .mo-eye.on { opacity: 1; transform: none; }
  .mo-t { font-weight: 300; text-transform: uppercase; font-variation-settings: 'wdth' 125; letter-spacing: .04em; line-height: 1; clip-path: inset(0 100% 0 0); transition: clip-path 1s ${EASE}, opacity .5s ${EASE}, transform .9s ${EASE}; }
  .mo-t.on { clip-path: inset(0 0 0 0); }
  .mo-linha { height: 1px; background: #f2f2f3; transform: scaleX(0); transform-origin: left; transition: transform 1s ${EASE} .25s; margin: 26px 0; width: 420px; }
  .mo-linha.on { transform: scaleX(1); }
  .mo-nomes { display: grid; gap: 10px; }
  .mo-nome, .mo-chip { opacity: 0; transform: translateY(14px); filter: blur(6px); transition: opacity .6s ${EASE}, transform .7s cubic-bezier(.25,1.15,.35,1), filter .6s ${EASE}; }
  .mo-nome.on, .mo-chip.on { opacity: 1; transform: none; filter: none; }
  .mo-nome { font-size: 34px; font-weight: 300; }
  .mo-nome span { color: #8a8a92; font: 400 15px var(--mono, monospace); margin-right: 16px; vertical-align: 5px; }
  .mo-chips { display: flex; flex-wrap: wrap; gap: 12px; max-width: 1000px; }
  .mo-chip { font-size: 24px; font-weight: 400; border: 1px solid #ffffff38; background: #ffffff0d; border-radius: 999px; padding: 10px 22px; }
  .mo-chip.forte { background: #f2f2f3; color: #0b0b0c; border-color: #f2f2f3; }
  .mo.sai .mo-box > * { opacity: 0 !important; transform: translateY(-16px) !important; transition: opacity .5s ${EASE}, transform .6s ${EASE} !important; }
  .mo-num { font: 500 16px var(--mono, monospace); color: #a6a6ad; letter-spacing: .2em; display: flex; align-items: center; gap: 16px; }
  .mo-num b { color: #0b0b0c; background: #f2f2f3; border-radius: 999px; padding: 4px 12px; font-weight: 500; }
  #app { transition: transform 1.15s cubic-bezier(0.3, 0.9, 0.25, 1); transform-origin: 0 0; will-change: transform; }
  `;
  const el = (tag, cls, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
  const depois = (ms, fn) => setTimeout(fn, ms);
  let camada = null;
  function nova() {
    camada?.remove();
    camada = el('div', 'mo');
    camada.append(el('div', 'mo-fundo'));
    const box = el('div', 'mo-box');
    camada.append(box);
    document.body.append(camada);
    return box;
  }
  function some(ms) {
    const c = camada;
    depois(ms, () => { c.classList.add('sai'); c.classList.remove('on'); });
    depois(ms + 1000, () => c.remove());
  }
  const liga = (e, ms) => depois(ms, () => e.classList.add('on'));

  window.__mo = {
    // abertura: marcada pelos tempos da fala (s), a partir do começo do áudio
    intro(f) {
      const box = nova();
      const eye = el('div', 'mo-eye', 'Trabalho prático 02 · Redes neurais');
      const t = el('div', 'mo-t', 'Sinapse'); t.style.fontSize = '150px';
      const linha = el('div', 'mo-linha');
      const nomes = el('div', 'mo-nomes');
      const n1 = el('div', 'mo-nome', '<span>01</span>' + f.nome1);
      const n2 = el('div', 'mo-nome', '<span>02</span>' + f.nome2);
      nomes.append(n1, n2);
      const chips = el('div', 'mo-chips');
      const cs = f.chips.map(([, txt, forte]) => el('div', 'mo-chip' + (forte ? ' forte' : ''), txt));
      chips.append(...cs);
      box.append(eye, t, linha, nomes);
      requestAnimationFrame(() => camada.classList.add('on'));
      liga(t, 300); liga(linha, 500);
      liga(n1, f.n1 * 1000); liga(n2, f.n2 * 1000);
      // troca os nomes pelo assunto do trabalho
      depois(f.projeto * 1000, () => {
        eye.classList.add('on');
        for (const n of [n1, n2]) { n.style.transition = `opacity .45s ${EASE}, transform .5s ${EASE}`; n.style.opacity = '0'; n.style.transform = 'translateY(-10px)'; }
        depois(500, () => { nomes.remove(); box.append(chips); });
      });
      f.chips.forEach(([s], i) => liga(cs[i], s * 1000));
      some(f.sai * 1000);
    },
    // título de capítulo: número, linha e nome, ~2,3 s
    capitulo(n, total, nome) {
      const box = nova();
      const num = el('div', 'mo-num', `<b>${String(n).padStart(2, '0')}</b>de ${String(total).padStart(2, '0')}`);
      num.classList.add('mo-eye');
      const t = el('div', 'mo-t', nome); t.style.fontSize = '96px'; t.style.marginTop = '22px';
      const linha = el('div', 'mo-linha');
      box.append(num, t, linha);
      requestAnimationFrame(() => camada.classList.add('on'));
      liga(num, 80); liga(t, 200); liga(linha, 250);
      some(2100);
    },
    // fechamento: resumo e agradecimento
    fim(f) {
      const box = nova();
      const t = el('div', 'mo-t', 'Sinapse'); t.style.fontSize = '120px';
      const linha = el('div', 'mo-linha');
      const chips = el('div', 'mo-chips');
      const cs = f.chips.map(([, txt, forte]) => el('div', 'mo-chip' + (forte ? ' forte' : ''), txt));
      chips.append(...cs);
      const obrigado = el('div', 'mo-nome', 'Obrigado pelo seu tempo.'); obrigado.style.marginTop = '34px';
      const nomes = el('div', 'mo-eye', f.nomes); nomes.style.marginTop = '16px';
      box.append(t, linha, chips, obrigado, nomes);
      requestAnimationFrame(() => camada.classList.add('on'));
      liga(t, 200); liga(linha, 400);
      f.chips.forEach(([s], i) => liga(cs[i], s * 1000));
      liga(obrigado, f.obrigado * 1000); liga(nomes, f.obrigado * 1000 + 400);
    },
    // aproxima a câmera de um elemento (centraliza, sem mostrar fora da página)
    zoom(alvo, max = 1.45) {
      const app = document.getElementById('app');
      if (!alvo || !app) return false;
      const prev = app.style.transform;
      app.style.transition = 'none'; app.style.transform = 'none';
      const r = alvo.getBoundingClientRect();
      app.style.transform = prev; void app.offsetWidth; app.style.transition = '';
      const vw = innerWidth, vh = innerHeight;
      const s = Math.max(1.12, Math.min(max, 0.86 * Math.min(vw / r.width, vh / r.height)));
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = Math.min(0, Math.max(vw - s * vw, vw / 2 - s * cx));
      const dy = Math.min(0, Math.max(vh - s * vh, vh / 2 - s * cy));
      app.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      return true;
    },
    zoomOut() {
      const app = document.getElementById('app');
      if (app && app.style.transform && app.style.transform !== 'none') { app.style.transform = 'none'; return true; }
      return false;
    },
  };
  addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); });
})();
