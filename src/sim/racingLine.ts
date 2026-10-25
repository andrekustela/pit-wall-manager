// Traçado ideal (achado pelo carro de teste: scripts/racing-line.ts) por pista: distância até o meio
// da pista (m, + = direita) em qualquer ponto da volta. Ligado por índice na hora de carregar
// (os nomes ainda são os originais; o Editor pode renomear depois).
import { CIRCUITS } from "./track";
import { LINE_STEP, RACING_LINES } from "./racingLines";

const byIndex: (number[] | null)[] = CIRCUITS.map((t) => RACING_LINES[t.name]?.o ?? null);

/** tem traçado calculado pra essa pista? */
export function hasRacingLine(trackIndex: number): boolean {
  return !!byIndex[trackIndex];
}

/** distância do traçado ideal até o meio da pista em s (m); 0 se a pista não tem traçado */
export function racingLineAt(trackIndex: number, s: number): number {
  const o = byIndex[trackIndex];
  if (!o) return 0;
  const N = o.length;
  const u = s / LINE_STEP, f = u - Math.floor(u), j = ((Math.floor(u) % N) + N) % N;
  const p0 = o[(j - 1 + N) % N], p1 = o[j], p2 = o[(j + 1) % N], p3 = o[(j + 2) % N];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}
