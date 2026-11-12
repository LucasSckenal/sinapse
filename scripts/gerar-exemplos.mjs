// Gera os datasets de exemplo (sintéticos, gerados por fórmula) em public/exemplos.
// Rodar: npm run exemplos
import { writeFileSync, mkdirSync } from 'node:fs';

const dir = new URL('../public/exemplos/', import.meta.url);
mkdirSync(dir, { recursive: true });

let s = 20261112;
const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const f = (v) => +v.toFixed(4);
const save = (name, header, rows) =>
  writeFileSync(new URL(name, dir), [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n');

// XOR: 2 entradas, 1 saída
save('xor.csv', ['a', 'b', 'xor'], [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]);

// Seno: ângulo em graus (0–360) → seno. Escala grande na entrada: mostra o efeito da normalização.
save(
  'seno.csv',
  ['angulo', 'seno'],
  Array.from({ length: 240 }, () => {
    const a = rand() * 360;
    return [f(a), f(Math.sin((a * Math.PI) / 180))];
  }),
);

// Círculo: ponto (x, y) no quadrado [-1, 1]² → duas saídas (dentro, fora) do círculo de raio 0,6.
save(
  'circulo.csv',
  ['x', 'y', 'dentro', 'fora'],
  Array.from({ length: 400 }, () => {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const d = x * x + y * y < 0.36 ? 1 : 0;
    return [f(x), f(y), d, 1 - d];
  }),
);

// Espiral: ponto (x, y) → braço da espiral, com rótulo em texto (três classes).
const arms = ['norte', 'leste', 'oeste'];
save(
  'espiral.csv',
  ['x', 'y', 'braco'],
  arms.flatMap((name, k) =>
    Array.from({ length: 110 }, (_, i) => {
      const r = i / 110;
      const t = k * ((2 * Math.PI) / 3) + r * 4.2 + (rand() - 0.5) * 0.35;
      return [f(r * Math.sin(t)), f(r * Math.cos(t)), name];
    }),
  ),
);

console.log('exemplos gerados em public/exemplos');
