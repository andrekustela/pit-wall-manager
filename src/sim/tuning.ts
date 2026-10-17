// Acerto do carro -> física. Mais asa = mais aderência em curva e menos
// velocidade de reta. Carro baixo = mais aderência, mas bate no chão em
// pista ondulada. Asa dianteira x traseira = equilíbrio (sub/sobresterço).
import { Rng } from "./rng";
import type { Profile, Track } from "./track";
import { FUEL_WEIGHT, bestForWet, wetPenalty, type Compound, type Driver, type Team, type Tuning } from "./types";

export const CLICKS = 11;
export const BASE_SLACK = 1.5; // s: margem do melhor carro pro limite teórico

export function clampTuning(t: Tuning): Tuning {
  const c = (x: number) => Math.max(1, Math.min(CLICKS, Math.round(Number(x) || 6)));
  return { fw: c(t?.fw), rw: c(t?.rw), h: c(t?.h) };
}

export function downforce(t: Tuning): number {
  return (t.fw * 0.4 + t.rw * 0.6) / CLICKS;
}

export function physics(track: Track, t: Tuning): { latAcc: number; vmax: number } {
  const D = downforce(t);
  const bal = t.fw - t.rw - track.def.balance;
  const balFactor = Math.max(0.82, 1 - 0.009 * bal * bal);
  let hg = 1 + (0.05 * (CLICKS - t.h)) / 10;
  if (t.h < track.def.minHeight) hg -= 0.035 * (track.def.minHeight - t.h);
  const latAcc = 33 * (0.86 + 0.28 * D) * balFactor * hg;
  const vmax = 100 - 21 * D;
  return { latAcc, vmax };
}

export function carProfile(track: Track, t: Tuning): Profile {
  const p = physics(track, t);
  return track.profile(p.latAcc, p.vmax);
}

/** melhor acerto possível pra pista (busca completa, roda uma vez por pista) */
const optimalCache = new Map<string, { tuning: Tuning; lap: number }>();
export function optimalTuning(track: Track): { tuning: Tuning; lap: number } {
  const hit = optimalCache.get(track.name);
  if (hit) return hit;
  let best = { tuning: { fw: 6, rw: 6, h: 6 }, lap: Infinity };
  const h = Math.max(1, track.def.minHeight);
  for (let rw = 1; rw <= CLICKS; rw++) {
    for (let fw = 1; fw <= CLICKS; fw++) {
      if (Math.abs(fw - rw - track.def.balance) > 2) continue;
      const lap = carProfile(track, { fw, rw, h }).lap;
      if (lap < best.lap) best = { tuning: { fw, rw, h }, lap };
    }
  }
  optimalCache.set(track.name, best);
  return best;
}

/** acerto da IA: perto do ótimo; engenheiro ruim erra mais (e às vezes deixa o carro baixo demais) */
export function aiTuning(track: Track, quality: number, rng: Rng): Tuning {
  const opt = optimalTuning(track).tuning;
  const err = 0.3 + (1 - quality) * 1.3;
  const hErr = Math.round(rng.gauss(err * 0.6));
  return clampTuning({
    fw: opt.fw + Math.round(rng.gauss(err)),
    rw: opt.rw + Math.round(rng.gauss(err)),
    h: opt.h + (quality > 0.3 ? Math.abs(hErr) : hErr),
  });
}

/** o que o piloto fala depois da volta */
export function feedback(track: Track, t: Tuning): string[] {
  const out: string[] = [];
  const bal = t.fw - t.rw - track.def.balance;
  if (bal <= -2) out.push("O carro está saindo de frente nas curvas (subesterço). Mais asa dianteira ou menos traseira.");
  else if (bal === -1) out.push("Um pouco de subesterço na entrada das curvas.");
  else if (bal >= 2) out.push("A traseira está escapando (sobresterço). Mais asa traseira ou menos dianteira.");
  else if (bal === 1) out.push("A traseira está um pouco solta na saída das curvas.");

  if (t.h < track.def.minHeight) out.push("O carro está batendo no chão nas ondulações! Precisa subir.");
  else if (t.h > track.def.minHeight + 2) out.push("O carro está alto demais, dá pra baixar e ganhar aderência.");
  else if (t.h === track.def.minHeight + 2) out.push("Dá pra baixar um pouquinho o carro.");

  const opt = optimalTuning(track).tuning;
  const dOpt = downforce(opt), d = downforce(t);
  if (d > dOpt + 0.12) out.push("Estamos lentos nas retas, tem asa demais.");
  else if (d > dOpt + 0.05) out.push("Talvez dê pra tirar um pouco de asa.");
  else if (d < dOpt - 0.12) out.push("Falta aderência nas curvas, precisa de mais asa.");
  else if (d < dOpt - 0.05) out.push("Talvez um pouco mais de asa ajude nas curvas.");

  if (out.length === 0) out.push("O carro está perfeito! Não mexe em nada.");
  return out;
}

export interface QualiLap {
  time: number;
  topSpeed: number; // km/h
  tyre: Compound;
  feedback: string[];
  tuning: Tuning;
}

/** pneu que o carro usa na classificação */
export function qualiTyre(wet: number): Compound {
  const b = bestForWet(wet);
  return b === "dry" ? "S" : b;
}

/** tempo de uma volta lançada de classificação (pneu novo, pouco combustível) */
export function qualiLap(track: Track, team: Team, driver: Driver, t: Tuning, wet: number, rng: Rng, fuelKg = 8): QualiLap {
  const tuning = clampTuning(t);
  const p = carProfile(track, tuning);
  const tyre = qualiTyre(wet);
  const offset = tyre === "S" ? -0.9 : 0;
  const time =
    p.lap + BASE_SLACK + team.carPace + driver.skill + offset + wetPenalty(tyre, wet) +
    fuelKg * FUEL_WEIGHT + rng.gauss(0.12) + (wet > 0.1 ? Math.abs(rng.gauss(0.35 * wet)) : 0);
  return { time, topSpeed: Math.round(p.top * 3.6), tyre, feedback: feedback(track, tuning), tuning };
}
