// Treino livre e classificação (Q1, Q2, Q3).
import { buildEntrants, type Engineer } from "./entrants";
import { Rng } from "./rng";
import { getTrack } from "./track";
import type { Lineup } from "./drivers";
import type { DevLevels } from "./development";
import { aiTuning, clampTuning, makeConditions, qualiLap, type QualiLap } from "./tuning";
import type { Tuning } from "./types";
import { makeWeather } from "./weather";

export const PRACTICE_LAPS = 5;

export interface WeekendInfo {
  seed: number;
  trackIndex: number;
  laps: number;
  equalCars: boolean;
  teamNames: Record<string, string>;
  engineers: Record<string, Engineer>;
  lineup?: Lineup;
  dev?: Record<string, DevLevels>;
}

/** condições da pista no fim de semana (vento, ondulação, temperatura) */
export function weekendConditions(w: { seed: number; trackIndex: number }) {
  return makeConditions(w.seed, getTrack(w.trackIndex));
}

export function weekendWeather(w: WeekendInfo) {
  return makeWeather(w.seed, w.laps, getTrack(w.trackIndex).def.rainChance);
}

/** volta de teste do treino livre (mais combustível, pista do treino) */
export function practiceLap(w: WeekendInfo, carId: string, tuning: Tuning, lapIndex: number): QualiLap {
  const track = getTrack(w.trackIndex);
  const { teams, drivers } = buildEntrants(w);
  const d = drivers.find((x) => x.id === carId)!;
  const team = teams.find((t) => t.id === d.teamId)!;
  const rng = new Rng(w.seed ^ hash(carId) ^ (lapIndex * 7919));
  return qualiLap(track, team, d, tuning, weekendWeather(w).practiceWet, rng, 40, weekendConditions(w));
}

export interface QualiResult {
  carId: string;
  /** tempo que vale pro grid (da última sessão que o carro disputou) */
  time: number;
  tyre: string;
  topSpeed: number;
  tuning: Tuning;
  /** tempos no Q1, Q2 e Q3 (só das sessões que disputou) */
  q: number[];
  /** em que sessão caiu (1 ou 2); 3 = foi até o Q3 */
  out: 1 | 2 | 3;
}

/** quantos passam de cada sessão (com 20 carros: 15 pro Q2, 10 pro Q3) */
export function qualiCuts(n: number): [number, number] {
  return [Math.max(1, n - 5), Math.max(1, Math.min(10, n - 10))];
}

/**
 * Classificação em 3 sessões (Q1, Q2, Q3): cada carro faz uma volta lançada por
 * sessão, os mais lentos vão caindo. A pista emborracha e melhora a cada sessão.
 * Retorna o grid e os acertos de todos.
 */
export function runQualifying(w: WeekendInfo, humanTunings: Record<string, Tuning>) {
  const track = getTrack(w.trackIndex);
  const { teams, drivers } = buildEntrants(w);
  const wet = weekendWeather(w).qualiWet;
  const rng = new Rng(w.seed ^ 0x2545f491);
  const cond = weekendConditions(w);
  const results: QualiResult[] = drivers.map((d) => {
    const eng = w.engineers[d.teamId];
    const tuning = clampTuning(humanTunings[d.id] ?? aiTuning(track, eng?.quality ?? 0.6, rng, cond, d));
    return { carId: d.id, time: 0, tyre: "S", topSpeed: 0, tuning, q: [], out: 3 };
  });
  const cuts = qualiCuts(results.length);
  let alive = results;
  for (let session = 0; session < 3; session++) {
    for (const r of alive) {
      const d = drivers.find((x) => x.id === r.carId)!;
      const team = teams.find((t) => t.id === d.teamId)!;
      const lap = qualiLap(track, team, d, r.tuning, wet, rng, 8, cond);
      const t = lap.time - session * 0.12; // pista emborrachando
      r.q.push(t);
      r.time = t;
      r.tyre = lap.tyre;
      r.topSpeed = lap.topSpeed;
    }
    alive.sort((a, b) => a.time - b.time);
    if (session < 2) {
      const keep = cuts[session];
      for (const r of alive.slice(keep)) r.out = (session + 1) as 1 | 2;
      alive = alive.slice(0, keep);
    }
  }
  // grid: quem foi mais longe na frente; dentro da sessão, pelo tempo dela
  results.sort((a, b) => b.out - a.out || a.time - b.time);
  const tunings: Record<string, Tuning> = {};
  for (const r of results) tunings[r.carId] = r.tuning;
  return { results, tunings, grid: results.map((r) => r.carId), wet };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
