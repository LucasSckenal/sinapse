/**
 * Funções de ativação e suas derivadas (requisito 1.4).
 * A derivada recebe z (soma ponderada) e a saída já calculada, para evitar recomputar f(z).
 */
export type ActivationName = 'linear' | 'sigmoid' | 'tanh' | 'relu';

export interface Activation {
  name: ActivationName;
  label: string;
  f(z: number): number;
  /** df/dz avaliada em z; `out` = f(z). */
  df(z: number, out: number): number;
}

export const ACTIVATIONS: Record<ActivationName, Activation> = {
  linear: {
    name: 'linear',
    label: 'Linear',
    f: (z) => z,
    df: () => 1,
  },
  sigmoid: {
    name: 'sigmoid',
    label: 'Sigmoid',
    f: (z) => 1 / (1 + Math.exp(-z)),
    df: (_z, out) => out * (1 - out),
  },
  tanh: {
    name: 'tanh',
    label: 'Tanh',
    f: (z) => Math.tanh(z),
    df: (_z, out) => 1 - out * out,
  },
  relu: {
    name: 'relu',
    label: 'ReLU',
    f: (z) => (z > 0 ? z : 0),
    // Em z = 0 a derivada não existe; usamos 0 (convenção comum).
    df: (z) => (z > 0 ? 1 : 0),
  },
};

export const ACTIVATION_NAMES = Object.keys(ACTIVATIONS) as ActivationName[];

export function getActivation(name: string): Activation {
  const a = ACTIVATIONS[name as ActivationName];
  if (!a) throw new Error(`Função de ativação desconhecida: "${name}".`);
  return a;
}
