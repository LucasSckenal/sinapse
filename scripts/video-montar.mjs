// Junta a gravação do app com as cenas de código: cada trecho de código entra logo depois da cena do app que ele explica.
// node scripts/video-montar.mjs <app.mp4> <app.cenas.json> <pasta-codigo> <saida.mp4> [pasta-narracoes]   (precisa do ffmpeg no PATH)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [app, cenasArq, pasta, saida] = process.argv.slice(2);
if (!saida) throw new Error('Uso: node scripts/video-montar.mjs <app.mp4> <app.cenas.json> <pasta-codigo> <saida.mp4>');
const cenas = JSON.parse(readFileSync(cenasArq, 'utf8'));
// depois de qual cena do app entra cada código
const DEPOIS = { Dados: 'codigo-dados', Arquitetura: 'codigo-entidades', 'Um exemplo': 'codigo-retropropagacao', Treinando: 'codigo-treino', Resultados: 'codigo-testes', Salvar: 'codigo-prever' };
const NOMES = { 'codigo-testes': 'Código: testes', 'codigo-dados': 'Código: divisão e normalização', 'codigo-entidades': 'Código: neurônio e ativações', 'codigo-retropropagacao': 'Código: retropropagação', 'codigo-treino': 'Código: treino', 'codigo-prever': 'Código: previsão e JSON' };

// transição: cada trecho escurece 0,22 s no fim e clareia 0,22 s no começo (não muda a duração, a narração segue sincronizada)
const passagem = (d) => `fade=t=in:st=0:d=0.22,fade=t=out:st=${(d - 0.22).toFixed(3)}:d=0.22`;
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const inputs = [app];
const parts = [];
const novas = [];
let t = 0;
const fim = cenas.find((c) => c.nome === 'Fim')?.t ?? dur(app);
cenas.filter((c) => c.nome !== 'Fim').forEach((c, i, arr) => {
  const a = c.t;
  const b = arr[i + 1]?.t ?? fim;
  parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS,${passagem(b - a)}[p${parts.length}]`);
  novas.push({ nome: c.nome, t: Math.round(t * 10) / 10 });
  t += b - a;
  const cod = DEPOIS[c.nome];
  if (cod) {
    const f = path.join(pasta, `${cod}.mp4`);
    inputs.push(f);
    parts.push(`[${inputs.length - 1}:v]setpts=PTS-STARTPTS,fps=30,${passagem(dur(f))}[p${parts.length}]`);
    novas.push({ nome: NOMES[cod], t: Math.round(t * 10) / 10 });
    t += dur(f);
  }
});
novas.push({ nome: 'Fim', t: Math.round(t * 10) / 10 });
let filtro = `${parts.join(';')};${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
// 5º argumento opcional: pasta com as narrações das cenas de código (b1.wav … b6.wav), cada uma começa 0,6 s depois da cena
const audios = process.argv[6];
const NARRACAO = { 'codigo-dados': 'b1', 'codigo-entidades': 'b2', 'codigo-retropropagacao': 'b3', 'codigo-treino': 'b4', 'codigo-testes': 'b5', 'codigo-prever': 'b6' };
const mapas = ['-map', '[v]'];
if (audios) {
  const faixas = [];
  for (const [cod, b] of Object.entries(NARRACAO)) {
    const cena = novas.find((n) => n.nome === NOMES[cod]);
    if (!cena) continue;
    inputs.push(path.join(audios, `${b}.wav`));
    const ms = Math.round((cena.t + 0.6) * 1000);
    filtro += `;[${inputs.length - 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[a${faixas.length}]`;
    faixas.push(`[a${faixas.length}]`);
  }
  // narração das cenas do app (parte A): áudio 0,5 s depois do começo da cena e legenda queimada embaixo
  const SA = process.env.SINCRONIA_A ? JSON.parse(readFileSync(process.env.SINCRONIA_A, 'utf8')) : {};
  const ass = [];
  const hora = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  for (const [nome, a] of Object.entries(SA)) {
    const cena = novas.find((n) => n.nome === nome);
    if (!cena) continue;
    inputs.push(path.join(audios, `${a.audio}.wav`));
    const ms = Math.round((cena.t + 0.5) * 1000);
    filtro += `;[${inputs.length - 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[a${faixas.length}]`;
    faixas.push(`[a${faixas.length}]`);
    a.falas.forEach(([t0, txt], i) => {
      const ini = cena.t + 0.5 + t0;
      const fim = cena.t + 0.5 + (a.falas[i + 1]?.[0] ?? a.dur + 0.4) - 0.05;
      ass.push(`Dialogue: 0,${hora(ini)},${hora(fim)},Fala,,0,0,0,,{\\fad(180,120)}${txt}`);
    });
  }
  if (ass.length) {
    writeFileSync('legendas-A.ass', `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Fala,Segoe UI,40,&H00F3F2F2,&H00F3F2F2,&H38100C0B,&H00000000,0,0,0,0,100,100,0,0,3,16,0,2,220,220,56,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ass.join(String.fromCharCode(10))}
`);
    filtro = filtro.replace('concat=n=' + parts.length + ':v=1:a=0[v]', 'concat=n=' + parts.length + ':v=1:a=0,subtitles=legendas-A.ass[v]');
  }
  filtro += `;${faixas.join('')}amix=inputs=${faixas.length}:normalize=0:duration=longest,apad,atrim=end=${t}[a]`;
  mapas.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
}
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', filtro, ...mapas, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida]);
writeFileSync(saida.replace(/\.\w+$/, '') + '.cenas.json', JSON.stringify(novas, null, 1));
console.log(JSON.stringify(novas));
