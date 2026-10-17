// Treino livre e classificação (volta única).
import { buildEntrants, type Engineer } from "./entrants";
import { Rng } from "./rng";
import { getTrack } from "./track";
import type { Lineup } from "./drivers";
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
  time: number;
  tyre: string;
  topSpeed: number;
  tuning: Tuning;
}

/** classificação: uma volta lançada por carro. Retorna o grid e os acertos de todos. */
export function runQualifying(w: WeekendInfo, humanTunings: Record<string, Tuning>) {
  const track = getTrack(w.trackIndex);
  const { teams, drivers } = buildEntrants(w);
  const wet = weekendWeather(w).qualiWet;
  const rng = new Rng(w.seed ^ 0x2545f491);
  const cond = weekendConditions(w);
  const results: QualiResult[] = drivers.map((d) => {
    const team = teams.find((t) => t.id === d.teamId)!;
    const eng = w.engineers[team.id];
    const tuning = clampTuning(humanTunings[d.id] ?? aiTuning(track, eng?.quality ?? 0.6, rng, cond, d));
    const lap = qualiLap(track, team, d, tuning, wet, rng, 8, cond);
    return { carId: d.id, time: lap.time, tyre: lap.tyre, topSpeed: lap.topSpeed, tuning };
  });
  results.sort((a, b) => a.time - b.time);
  const tunings: Record<string, Tuning> = {};
  for (const r of results) tunings[r.carId] = r.tuning;
  return { results, tunings, grid: results.map((r) => r.carId), wet };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
