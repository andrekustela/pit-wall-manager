// Desenvolvimento do carro no campeonato: depois de cada etapa a equipe ganha
// pontos de desenvolvimento (quem está atrás na tabela ganha mais) e investe em
// aerodinâmica, motor ou chassi. Cada investimento pode dar certo, dar muito
// certo ou não render nada.
import type { Rng } from "./rng";
import type { Track } from "./track";

export type DevArea = "aero" | "engine" | "chassis";
export type DevLevels = Record<DevArea, number>;

export const DEV_MAX = 6;

export const DEV_AREAS: { id: DevArea; label: string; desc: string }[] = [
  { id: "aero", label: "Aerodinâmica", desc: "Mais rápido nas curvas. Rende mais em pista travada." },
  { id: "engine", label: "Motor", desc: "Mais velocidade de reta e motor que gasta menos. Rende mais em pista rápida." },
  { id: "chassis", label: "Chassi", desc: "Carro mais estável: um pouco mais rápido em todo lugar e gasta menos pneu." },
];

export const NO_DEV: DevLevels = { aero: 0, engine: 0, chassis: 0 };

/** custo de tentar subir de nível (fica mais caro quanto mais evoluído) */
export function devCost(level: number): number {
  return 1 + Math.floor(level / 2);
}

/** pontos ganhos na etapa: o líder ganha 3, o último 6 */
export function roundDevPoints(rank: number, teams: number): number {
  return 3 + Math.round((rank / Math.max(1, teams - 1)) * 3);
}

/** resultado de um investimento: 0 = não rendeu, 1 = subiu, 2 = achou algo grande */
export function rollUpgrade(rng: Rng | (() => number), quality: number | null): 0 | 1 | 2 {
  const r = typeof rng === "function" ? rng() : rng.next();
  const q = quality ?? 0.75;
  const fail = 0.3 - q * 0.2; // engenheiro bom erra menos
  if (r < fail) return 0;
  if (r > 0.9 - q * 0.05) return 2;
  return 1;
}

/** fração da volta em reta (pista rápida = perto de 1) */
const fastCache = new WeakMap<Track, number>();
function fastShare(track: Track): number {
  let f = fastCache.get(track);
  if (f === undefined) {
    let n = 0;
    for (let i = 0; i < track.L; i++) if (track.vProfile[i] > 72) n++;
    f = n / track.L;
    fastCache.set(track, f);
  }
  return f;
}

/** segundos por volta que o desenvolvimento tira nessa pista */
export function devLapGain(track: Track, lv: DevLevels): number {
  const fast = fastShare(track);
  return lv.aero * (0.05 + 0.08 * (1 - fast)) + lv.engine * (0.04 + 0.09 * fast) + lv.chassis * 0.05;
}

/** multiplicadores de desgaste (pneu e motor) */
export function devWear(lv: DevLevels): { tyre: number; engine: number } {
  return { tyre: 1 - 0.03 * lv.chassis, engine: 1 - 0.06 * lv.engine };
}
