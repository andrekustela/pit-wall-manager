// Peças do carro que podem quebrar (e o motor, que só desgasta).

export type PartId = "fw" | "suspF" | "rw" | "suspR";

export const PARTS: { id: PartId; label: string; repair: [number, number] }[] = [
  { id: "fw", label: "Asa dianteira", repair: [4, 6.5] },
  { id: "suspF", label: "Suspensão dianteira", repair: [7, 10] },
  { id: "rw", label: "Asa traseira", repair: [3, 5] },
  { id: "suspR", label: "Suspensão traseira", repair: [7, 10] },
];

export type PartDamage = Record<PartId, number>;
export const NO_DAMAGE: PartDamage = { fw: 0, suspF: 0, rw: 0, suspR: 0 };

/** 4 estados por peça, pelo tempo perdido por volta (s) */
export const LEVELS = ["OK", "Leve", "Danificado", "Destruído"] as const;
export function partLevel(secPerLap: number): 0 | 1 | 2 | 3 {
  if (secPerLap <= 0) return 0;
  if (secPerLap < 0.6) return 1;
  if (secPerLap < 1.4) return 2;
  return 3;
}

/** motor: saúde de 1 (novo) a 0 (quebra) */
export const ENGINE_LEVELS = ["OK", "Desgastado", "Muito gasto", "Crítico"] as const;
export function engineLevel(health: number): 0 | 1 | 2 | 3 {
  if (health > 0.75) return 0;
  if (health > 0.5) return 1;
  if (health > 0.3) return 2;
  return 3;
}

/** desgaste do motor por volta (corrida de 30 voltas de referência) */
export const ENGINE_WEAR_PER_LAP = 0.014;
/** poupar o motor: gasta bem menos, mas custa tempo */
export const ENGINE_SAVE = { wear: 0.4, offset: 0.25 };
