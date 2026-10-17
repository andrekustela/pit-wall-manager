// Acerto do carro -> física. Cada ajuste vai de 0 a 100.
//  - Mais asa = mais aderência em curva e menos velocidade de reta.
//  - Asa dianteira x traseira (e a rigidez da suspensão de cada eixo) = equilíbrio.
//  - Carro baixo = mais aderência, mas bate no chão em pista ondulada.
//  - Suspensão: dura demais pula nas ondulações, macia demais balança.
// O ideal muda a cada fim de semana (condições sorteadas) e com o gosto do piloto.
import { Rng } from "./rng";
import type { Profile, Track } from "./track";
import { FUEL_WEIGHT, bestForWet, wetPenalty, type Compound, type Driver, type Team, type Tuning } from "./types";

export const BASE_SLACK = 1.5; // s: margem do melhor carro pro limite teórico

/** 0..100 -> "cliques" internos 1..11 */
const click = (x: number) => 1 + x / 10;
const clamp100 = (x: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(x) ? x : 50)));

export function clampTuning(t: Partial<Tuning> | undefined): Tuning {
  return { fw: clamp100(t?.fw ?? 50), rw: clamp100(t?.rw ?? 50), h: clamp100(t?.h ?? 50), sf: clamp100(t?.sf ?? 50), sr: clamp100(t?.sr ?? 50) };
}

/** condições da pista no fim de semana (sorteadas pela seed) */
export interface Conditions {
  /** desvio do equilíbrio ideal (cliques) — vento, temperatura do asfalto */
  balance: number;
  /** pista mais (+) ou menos (−) ondulada que o normal (cliques de altura) */
  bump: number;
  /** rigidez ideal da suspensão (0..100) */
  stiff: number;
  /** arrasto (vento contra na reta > 1) */
  drag: number;
  notes: string[];
}

export function makeConditions(seed: number, track: Track): Conditions {
  const rng = new Rng(seed ^ 0x3c0dd17);
  const balance = Math.round(rng.gauss(0.7) * 10) / 10;
  const bump = Math.max(-2, Math.min(2, Math.round(rng.gauss(0.7))));
  const base = 80 - track.def.minHeight * 6.5; // pista ondulada pede suspensão mais macia
  const stiff = Math.max(10, Math.min(90, Math.round(base - bump * 6 + rng.gauss(8))));
  const drag = Math.round((1 + rng.gauss(0.05)) * 100) / 100;
  const notes: string[] = [];
  if (bump > 0) notes.push("asfalto mais ondulado que o normal");
  if (bump < 0) notes.push("asfalto recapeado, mais liso");
  if (drag > 1.04) notes.push("vento contra na reta principal");
  if (drag < 0.96) notes.push("vento a favor na reta principal");
  if (balance > 0.6) notes.push("asfalto quente, a traseira tende a escorregar");
  if (balance < -0.6) notes.push("asfalto frio, a frente tende a escorregar");
  return { balance, bump, stiff, drag, notes };
}

const NEUTRAL: Conditions = { balance: 0, bump: 0, stiff: 50, drag: 1, notes: [] };

/** preferências do piloto (em cliques e pontos de rigidez) */
function prefs(d?: Driver) {
  return { bal: (d?.profile?.balancePref ?? 0) / 10, stiff: d?.profile?.stiffPref ?? 0 };
}

export function downforce(t: Tuning): number {
  return (click(t.fw) * 0.4 + click(t.rw) * 0.6) / 11;
}

/** quanto o equilíbrio está longe do ideal (cliques; − = sai de frente, + = traseira solta) */
export function balanceError(track: Track, t: Tuning, cond: Conditions, d?: Driver): number {
  const ideal = track.def.balance + cond.balance + prefs(d).bal;
  // suspensão traseira mais dura que a dianteira solta a traseira (e vice-versa)
  return click(t.fw) - click(t.rw) + (t.sr - t.sf) / 25 - ideal;
}

export function minHeight(track: Track, cond: Conditions): number {
  return track.def.minHeight + cond.bump;
}

export function idealStiff(cond: Conditions, d?: Driver): number {
  return Math.max(0, Math.min(100, cond.stiff + prefs(d).stiff));
}

export function physics(track: Track, t: Tuning, cond: Conditions = NEUTRAL, d?: Driver): { latAcc: number; vmax: number } {
  const D = downforce(t);
  const bal = balanceError(track, t, cond, d);
  const balFactor = Math.max(0.82, 1 - 0.009 * bal * bal);
  const h = click(t.h);
  const minH = minHeight(track, cond);
  let hg = 1 + (0.05 * (11 - h)) / 10;
  if (h < minH) hg -= 0.035 * (minH - h);
  const sDev = (t.sf + t.sr) / 2 - idealStiff(cond, d);
  const sg = Math.max(0.9, 1 - 0.00006 * sDev * sDev);
  const latAcc = 33 * (0.86 + 0.28 * D) * balFactor * hg * sg;
  const vmax = 100 - 21 * D * cond.drag;
  return { latAcc, vmax };
}

export function carProfile(track: Track, t: Tuning, cond?: Conditions, d?: Driver): Profile {
  const p = physics(track, t, cond, d);
  return track.profile(p.latAcc, p.vmax);
}

/** melhor acerto possível (pra pista, condições e piloto) */
const optimalCache = new Map<string, { tuning: Tuning; lap: number }>();
export function optimalTuning(track: Track, cond: Conditions = NEUTRAL, d?: Driver): { tuning: Tuning; lap: number } {
  const key = `${track.name}|${cond.balance}|${cond.bump}|${cond.stiff}|${cond.drag}|${d?.profile?.id ?? "-"}`;
  const hit = optimalCache.get(key);
  if (hit) return hit;
  const ideal = track.def.balance + cond.balance + prefs(d).bal;
  const st = idealStiff(cond, d);
  const h = clamp100((minHeight(track, cond) - 1) * 10);
  let best = { tuning: clampTuning({}), lap: Infinity };
  for (let rw = 0; rw <= 100; rw += 5) {
    const fw = clamp100(rw + ideal * 10);
    const tuning = { fw, rw, h, sf: st, sr: st };
    const lap = carProfile(track, tuning, cond, d).lap;
    if (lap < best.lap) best = { tuning, lap };
  }
  optimalCache.set(key, best);
  return best;
}

/** acerto da IA: perto do ótimo; engenheiro ruim e piloto com feedback ruim erram mais */
export function aiTuning(track: Track, quality: number, rng: Rng, cond?: Conditions, d?: Driver): Tuning {
  const opt = optimalTuning(track, cond, d).tuning;
  const fb = (d?.profile?.feedback ?? 70) / 100;
  const err = (0.3 + (1 - quality) * 1.3 + (1 - fb) * 0.6) * 10;
  const hErr = rng.gauss(err * 0.6);
  return clampTuning({
    fw: opt.fw + rng.gauss(err),
    rw: opt.rw + rng.gauss(err),
    h: opt.h + (quality > 0.3 ? Math.abs(hErr) : hErr),
    sf: opt.sf + rng.gauss(err * 1.2),
    sr: opt.sr + rng.gauss(err * 1.2),
  });
}

const VAGUE = [
  "Tem alguma coisa estranha no carro, mas não sei dizer bem o quê.",
  "Não está ruim... acho. Difícil explicar.",
  "O carro está esquisito em algumas curvas.",
];

/**
 * O que o piloto fala depois da volta. Piloto com bom feedback percebe até
 * erros pequenos e diz exatamente o que mudar; piloto ruim só nota erros
 * grandes, às vezes fala coisa vaga e, raramente, aponta a direção errada.
 */
export function feedback(track: Track, t: Tuning, cond: Conditions = NEUTRAL, d?: Driver, rng = new Rng(1)): string[] {
  const fb = (d?.profile?.feedback ?? 70) / 100;
  const tol = 0.6 + (1 - fb) * 1.4; // menor = percebe erro menor
  const out: string[] = [];
  const say = (msg: string, opposite?: string) => {
    if (rng.next() > fb + 0.3) out.push(VAGUE[Math.floor(rng.next() * VAGUE.length)]);
    else if (opposite && fb < 0.45 && rng.chance(0.15)) out.push(opposite);
    else out.push(msg);
  };
  const under = "O carro está saindo de frente (subesterço). Mais asa dianteira, menos traseira, ou suspensão dianteira mais macia.";
  const over = "A traseira está escapando (sobresterço). Mais asa traseira, menos dianteira, ou suspensão traseira mais macia.";
  const bal = balanceError(track, t, cond, d);
  if (bal <= -tol) say(bal < -2 * tol ? under : "Um pouco de subesterço na entrada das curvas.", over);
  else if (bal >= tol) say(bal > 2 * tol ? over : "A traseira está um pouco solta na saída das curvas.", under);

  const hDev = click(t.h) - minHeight(track, cond);
  if (hDev < 0) out.push("O carro está batendo no chão nas ondulações! Precisa subir.");
  else if (hDev > 2 * tol) say("O carro está alto demais, dá pra baixar e ganhar aderência.");
  else if (hDev > tol && fb > 0.7) out.push("Dá pra baixar um pouquinho o carro.");

  const dOpt = downforce(optimalTuning(track, cond, d).tuning), dd = downforce(t) - dOpt;
  const dt = 0.05 * tol;
  if (dd > 2.4 * dt) say("Estamos lentos nas retas, tem asa demais.", "Falta aderência nas curvas, precisa de mais asa.");
  else if (dd > dt && fb > 0.6) out.push("Talvez dê pra tirar um pouco de asa.");
  else if (dd < -2.4 * dt) say("Falta aderência nas curvas, precisa de mais asa.", "Estamos lentos nas retas, tem asa demais.");
  else if (dd < -dt && fb > 0.6) out.push("Talvez um pouco mais de asa ajude nas curvas.");

  const sDev = (t.sf + t.sr) / 2 - idealStiff(cond, d);
  const sTol = 8 + (1 - fb) * 14;
  if (sDev > sTol) say("A suspensão está dura demais: o carro pula nas zebras e nas ondulações.", "A suspensão está mole demais: o carro balança e demora a reagir.");
  else if (sDev < -sTol) say("A suspensão está mole demais: o carro balança e demora a reagir.", "A suspensão está dura demais: o carro pula nas zebras e nas ondulações.");

  if (out.length === 0) out.push(fb > 0.6 ? "O carro está perfeito! Não mexe em nada." : "Acho que está bom assim.");
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

/** chuva: piloto bom na chuva perde menos (multiplicador do tempo perdido) */
export function wetSkillFactor(d?: Driver): number {
  return 1.25 - ((d?.profile?.wet ?? 60) / 100) * 0.5;
}

/** variação volta a volta (piloto consistente varia menos) */
export function lapNoiseSd(d?: Driver): number {
  return 0.12 + (1 - (d?.profile?.consistency ?? 65) / 100) * 0.3;
}

/** tempo de uma volta lançada (pneu novo, pouco combustível) */
export function qualiLap(track: Track, team: Team, driver: Driver, t: Tuning, wet: number, rng: Rng, fuelKg = 8, cond: Conditions = NEUTRAL): QualiLap {
  const tuning = clampTuning(t);
  const p = carProfile(track, tuning, cond, driver);
  const tyre = qualiTyre(wet);
  const offset = tyre === "S" ? -0.9 : 0;
  const time =
    p.lap + BASE_SLACK + team.carPace + driver.skill + offset + wetPenalty(tyre, wet) * wetSkillFactor(driver) +
    fuelKg * FUEL_WEIGHT + rng.gauss(lapNoiseSd(driver) * 0.6) + (wet > 0.1 ? Math.abs(rng.gauss(0.35 * wet)) : 0);
  return { time, topSpeed: Math.round(p.top * 3.6), tyre, feedback: feedback(track, tuning, cond, driver, rng), tuning };
}
