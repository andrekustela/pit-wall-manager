// SUSTO (a traseira rebola e o piloto segura — ou não): a forma no tempo, usada pela corrida (quanto dura, quanto
// perde de velocidade, de que ângulo a rodada começa) e pelo desenho (Renderer.startMoment). Pelo desenho do
// usuário no editor de lance: vai e volta a cada 0,4 s, mais pra fora que pra dentro, começo sutil.

/** uma ida e volta da traseira (s) */
export const MOMENT_P = 0.4;
/** o susto de um carro: amp (rad, + = bico pro lado de +lateral), n zigue-zagues, slow = quanto o tempo estica */
export interface Moment {
  amp: number;
  n: number;
  slow: number;
}

/**
 * forma no tempo t (s, sem o `slow`): começa pequena (cresce em ~0,5 s), n idas e vindas — mais pra fora (+1,3) que
 * pra dentro (−0,7) — e assenta em 0,4 s. Pra fora nos instantes 0,2 + k·0,4 s
 */
export function momentShape(t: number, n = 3): number {
  const end = momentEnd(n);
  if (t <= 0 || t >= end) return 0;
  const up = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t / 0.5));
  const settle = n * MOMENT_P;
  const down = t < settle ? 1 : 0.5 + 0.5 * Math.cos(((t - settle) / (end - settle)) * Math.PI);
  return up * down * (0.3 + Math.sin(((t - 0.1) / MOMENT_P) * Math.PI * 2));
}
/** quando o susto acaba (s, sem o `slow`) */
export const momentEnd = (n: number) => n * MOMENT_P + 0.4;
/** o k-ésimo pico pra fora (s, sem o `slow`): onde a rodada começa quando o piloto não segura */
export const momentPeak = (k: number) => 0.2 + k * MOMENT_P;
