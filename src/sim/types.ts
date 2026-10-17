export type Compound = "S" | "M" | "H" | "I" | "W";
export const DRY: Compound[] = ["S", "M", "H"];
export const ALL_COMPOUNDS: Compound[] = ["S", "M", "H", "I", "W"];
export type PaceMode = "push" | "normal" | "conserve";
export type EngineMode = "rich" | "normal" | "lean";

export interface Team {
  id: string;
  name: string;
  short: string;
  color: string;
  accent: string;
  /** segundos por volta mais lento que o melhor carro */
  carPace: number;
}

export interface Driver {
  id: string;
  name: string;
  short: string;
  teamId: string;
  /** segundos por volta (0 = melhor) */
  skill: number;
  /** multiplicador de desgaste (menor = cuida melhor do pneu) */
  tyreCare: number;
}

export interface CompoundSpec {
  label: string;
  /** delta de tempo de volta com pneu novo */
  offset: number;
  /** desgaste por volta em ritmo normal (1 = gasto) */
  wearPerLap: number;
  color: string;
}

export const COMPOUNDS: Record<Compound, CompoundSpec> = {
  S: { label: "Macio", offset: -0.9, wearPerLap: 1 / 13, color: "#ff3b3b" },
  M: { label: "Médio", offset: 0, wearPerLap: 1 / 22, color: "#ffd23b" },
  H: { label: "Duro", offset: 0.75, wearPerLap: 1 / 32, color: "#f2f2f2" },
  I: { label: "Intermediário", offset: 0, wearPerLap: 1 / 24, color: "#3bd16f" },
  W: { label: "Chuva", offset: 0, wearPerLap: 1 / 28, color: "#2e8bff" },
};

export const isWetTyre = (c: Compound) => c === "I" || c === "W";

/**
 * Segundos perdidos por volta conforme a pista molhada (0 seco .. 1 encharcada).
 * Slick é ótimo no seco e péssimo no molhado; intermediário vai bem no meio-termo;
 * pneu de chuva só compensa com muita água.
 */
export function wetPenalty(c: Compound, wet: number): number {
  if (c === "I") return 1.2 + 10 * (wet - 0.4) ** 2;
  if (c === "W") return 2.6 + 4 * (wet - 0.9) ** 2;
  return 16 * Math.pow(wet, 1.3);
}

/** multiplicador de desgaste: pneu de chuva derrete no seco */
export function wetWear(c: Compound, wet: number): number {
  if (c === "I") return 1 + 3 * Math.max(0, 0.3 - wet) / 0.3;
  if (c === "W") return 1 + 4 * Math.max(0, 0.55 - wet) / 0.55;
  return 1 - 0.3 * wet;
}

/** melhor pneu para o nível de água (ignorando desgaste) */
export function bestForWet(wet: number): "dry" | "I" | "W" {
  const slick = wetPenalty("M", wet);
  const inter = wetPenalty("I", wet);
  const full = wetPenalty("W", wet);
  if (slick <= inter && slick <= full) return "dry";
  return inter <= full ? "I" : "W";
}

// ---------- acerto do carro ----------

/** cada ajuste vai de 1 a 11 cliques */
export interface Tuning {
  fw: number; // asa dianteira
  rw: number; // asa traseira
  h: number; // altura (1 = baixo, 11 = alto)
}

export const DEFAULT_TUNING: Tuning = { fw: 6, rw: 6, h: 6 };

export interface PlannedStop {
  lap: number; // entra no box no fim dessa volta
  compound: Compound;
  fuel: number;
}

export const PACE: Record<PaceMode, { label: string; offset: number; wear: number; fuel: number }> = {
  push: { label: "Atacar", offset: -0.4, wear: 1.5, fuel: 1.08 },
  normal: { label: "Normal", offset: 0, wear: 1, fuel: 1 },
  conserve: { label: "Poupar", offset: 0.65, wear: 0.62, fuel: 0.94 },
};

export const ENGINE: Record<EngineMode, { label: string; offset: number; fuel: number }> = {
  rich: { label: "Rica", offset: -0.3, fuel: 1.18 },
  normal: { label: "Normal", offset: 0, fuel: 1 },
  lean: { label: "Pobre", offset: 0.4, fuel: 0.84 },
};

export const FUEL_MAX = 110; // kg
/** consumo da corrida inteira em modo normal (kg), independente do nº de voltas */
export const RACE_FUEL = 87;
/** segundos por volta a cada kg de combustível */
export const FUEL_WEIGHT = 0.035;
/** kg por segundo no reabastecimento */
export const REFUEL_RATE = 11;

export interface CarSetup {
  tyre: Compound;
  fuel: number;
  plan: PlannedStop[];
}

export type Command =
  | { type: "box"; carId: string; compound: Compound; fuel: number }
  | { type: "cancelBox"; carId: string }
  | { type: "pace"; carId: string; mode: PaceMode }
  | { type: "engine"; carId: string; mode: EngineMode }
  | { type: "plan"; carId: string; plan: PlannedStop[] };

export type PitPhase = "none" | "entering" | "stopped" | "leaving" | "parked";

export interface CarState {
  id: string; // = driver id
  driver: Driver;
  team: Team;
  /** controlado por um humano (senão, IA) */
  isHuman: boolean;

  /** distância percorrida na volta atual (m) */
  s: number;
  lap: number; // voltas completas
  v: number; // m/s
  lateral: number; // deslocamento lateral em relação ao centro (m)
  lateralTarget: number;

  compound: Compound;
  wear: number;
  tyreLaps: number;
  usedCompounds: Compound[];

  fuel: number; // kg
  engine: EngineMode;
  pace: PaceMode;
  boxRequest: Compound | null;
  boxFuel: number; // kg a colocar na próxima parada
  pit: PitPhase;
  pitTimer: number;
  pitStops: number;

  lapNoise: number;
  lapStartTime: number;
  lastLap: number | null;
  bestLap: number | null;

  overtaking: string | null; // id do carro que está passando
  nextAttemptS: number; // não tenta de novo antes desse ponto (distância total)
  finished: boolean;
  finishTime: number | null;
  retired: boolean;
  retireReason: string | null;
  /** segundos restantes de uma rodada */
  spin: number;
  position: number;
  penalty: number;

  /** tempo de volta estimado no momento (s) */
  targetLap: number;
  /** variação de largada */
  launch: number;
  /** avisos de rádio já enviados neste stint */
  tyreWarn: number;
  fuelWarn: number;

  /** acerto definido na classificação (parque fechado) */
  tuning: Tuning;
  /** perfil de velocidade próprio do carro (depende do acerto) */
  profile: Float32Array;
  profileLap: number;
  /** plano de paradas do jogador */
  plan: PlannedStop[];
  planIdx: number;
  /** a volta da próxima parada planejada chegou (aviso pro jogador) */
  planDue: boolean;
  wetWarn: number;

  // IA
  aiPlan: number[]; // voltas planejadas de parada
  aiCompounds: Compound[];
}

export interface RaceEvent {
  time: number;
  text: string;
  important: boolean;
  /** equipe a que o evento diz respeito (pra destacar só pro dono) */
  teamId?: string;
  /** tipo do evento (usado pros sons) */
  kind?: string;
}
