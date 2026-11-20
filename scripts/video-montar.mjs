// Junta a gravação do app com as cenas de código: cada trecho de código entra logo depois da cena do app que ele explica.
// node scripts/video-montar.mjs <app.mp4> <app.cenas.json> <pasta-codigo> <saida.mp4>   (precisa do ffmpeg no PATH)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [app, cenasArq, pasta, saida] = process.argv.slice(2);
if (!saida) throw new Error('Uso: node scripts/video-montar.mjs <app.mp4> <app.cenas.json> <pasta-codigo> <saida.mp4>');
const cenas = JSON.parse(readFileSync(cenasArq, 'utf8'));
// depois de qual cena do app entra cada código
const DEPOIS = { Dados: 'codigo-dados', Arquitetura: 'codigo-entidades', 'Um exemplo': 'codigo-retropropagacao', Treinando: 'codigo-treino', Salvar: 'codigo-prever' };
const NOMES = { 'codigo-dados': 'Código: divisão e normalização', 'codigo-entidades': 'Código: neurônio e ativações', 'codigo-retropropagacao': 'Código: retropropagação', 'codigo-treino': 'Código: treino', 'codigo-prever': 'Código: previsão e JSON' };

const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const inputs = [app];
const parts = [];
const novas = [];
let t = 0;
const fim = cenas.find((c) => c.nome === 'Fim')?.t ?? dur(app);
cenas.filter((c) => c.nome !== 'Fim').forEach((c, i, arr) => {
  const a = c.t;
  const b = arr[i + 1]?.t ?? fim;
  parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[p${parts.length}]`);
  novas.push({ nome: c.nome, t: Math.round(t * 10) / 10 });
  t += b - a;
  const cod = DEPOIS[c.nome];
  if (cod) {
    const f = path.join(pasta, `${cod}.mp4`);
    inputs.push(f);
    parts.push(`[${inputs.length - 1}:v]setpts=PTS-STARTPTS,fps=30[p${parts.length}]`);
    novas.push({ nome: NOMES[cod], t: Math.round(t * 10) / 10 });
    t += dur(f);
  }
});
novas.push({ nome: 'Fim', t: Math.round(t * 10) / 10 });
const filtro = `${parts.join(';')};${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', filtro, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida]);
writeFileSync(saida.replace(/\.\w+$/, '') + '.cenas.json', JSON.stringify(novas, null, 1));
console.log(JSON.stringify(novas));
