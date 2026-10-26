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
  /** desenvolvimento do campeonato: multiplicadores de desgaste */
  tyreWear?: number;
  engineWear?: number;
  /** pintura personalizada (equipe de jogador) */
  livery?: import("./livery").Livery;
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
  /** ficha completa (pilotos sorteados da base) */
  profile?: import("./drivers").DriverProfile;
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

/** cada ajuste vai de 0 a 100 */
export interface Tuning {
  fw: number; // asa dianteira
  rw: number; // asa traseira
  h: number; // altura (0 = baixo, 100 = alto)
  sf: number; // suspensão dianteira (0 = macia, 100 = dura)
  sr: number; // suspensão traseira
}

export const DEFAULT_TUNING: Tuning = { fw: 50, rw: 50, h: 50, sf: 50, sr: 50 };

export interface PlannedStop {
  lap: number; // entra no box no fim dessa volta
  compound: Compound;
  fuel: number;
}

/** risk = chance de erro de pilotagem (passar reto) */
export const PACE: Record<PaceMode, { label: string; offset: number; wear: number; fuel: number; risk: number }> = {
  push: { label: "Atacar", offset: -0.4, wear: 1.5, fuel: 1.08, risk: 8 },
  normal: { label: "Normal", offset: 0, wear: 1, fuel: 1, risk: 1 },
  conserve: { label: "Poupar", offset: 0.65, wear: 0.62, fuel: 0.94, risk: 0.35 },
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
  | { type: "plan"; carId: string; plan: PlannedStop[] }
  | { type: "repair"; carId: string; parts: Partial<Record<"fw" | "suspF" | "rw" | "suspR", boolean>> }
  | { type: "engineSave"; carId: string; on: boolean }
  | { type: "order"; carId: string; mode: TeamOrder };

export type FaultKind = "puncture" | "gearbox" | "brakes" | "power" | "hydraulics";

/** problemas mecânicos que podem aparecer do nada */
export const FAULTS: Record<FaultKind, { label: string; pen: number; weight: number; radio: string; fix: string }> = {
  puncture: { label: "Pneu furado", pen: 14, weight: 0.35, radio: "Furou o pneu! Tô me arrastando, preciso do box!", fix: "troca no box (qualquer pneu)" },
  gearbox: { label: "Câmbio com problema", pen: 0.9, weight: 0.2, radio: "O câmbio tá pulando marcha!", fix: "não tem conserto na corrida; pode quebrar" },
  brakes: { label: "Freio fraco", pen: 0.5, weight: 0.15, radio: "Pedal de freio tá longo, vou ter que frear antes.", fix: "não tem conserto; erra mais nas freadas" },
  power: { label: "Perda de potência", pen: 1.2, weight: 0.15, radio: "Tô perdendo potência na reta!", fix: "não tem conserto na corrida" },
  hydraulics: { label: "Pressão hidráulica caindo", pen: 0.7, weight: 0.15, radio: "Luz da hidráulica acesa no painel!", fix: "não tem conserto; pode parar o carro" },
};

/** ordem de equipe: deixar o companheiro passar, manter posições ou livre */
export type TeamOrder = "none" | "letPass" | "hold";

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
  /** ordem de equipe pra esse carro */
  order: TeamOrder;

  lapNoise: number;

  /** velocidade de lado (m/s): o carro acelera e freia de lado aos poucos, como um carro de verdade */

  latV?: number;

  /** quanto o dano pesa nesta volta (sorteado a cada volta: o tempo perdido é estimado, varia) */

  dmgVar?: number;
  lapStartTime: number;
  lastLap: number | null;
  bestLap: number | null;

  overtaking: string | null; // id do carro que está passando
  nextAttemptS: number; // não tenta de novo antes desse ponto (distância total)
  finished: boolean;
  finishTime: number | null;
  retired: boolean;
  retireReason: string | null;
  /** passou reto e está fora da pista (segundos que faltam); lado e o que vai acontecer */
  offTrack: number;
  offSide: number;
  offFate: "rejoin" | "stuck";
  /** temperatura do pneu (0 = gelado, faixa boa ~0,55-0,82, 1 = fervendo) */
  tyreTemp: number;
  /** colado atrás de outro carro numa curva: perde aderência (ar sujo) */
  dirtyAir: boolean;
  /** asa aberta (DRS): estava a menos de 1 s do da frente ao entrar na zona */
  drs?: boolean;
  /** zona de DRS em que o carro está agora (-1 = fora) */
  drsZ?: number;
  /** problema mecânico no momento (furo, câmbio...) e quanto custa por volta */
  fault: FaultKind | null;
  faultPen: number;
  /** dano por peça (segundos por volta perdidos); conserta no box */
  dmg: { fw: number; suspF: number; rw: number; suspR: number };
  /** de que lado cada peça danificada levou a pancada (l = esquerda, r = direita, b = os dois) — só pro desenho */
  dmgSide: Partial<Record<"fw" | "suspF" | "rw" | "suspR", "l" | "r" | "b">>;
  /** pneu furado (0 dianteiro esq., 1 dianteiro dir., 2 traseiro esq., 3 traseiro dir.; -1 nenhum) */
  flatWheel: number;
  /** quais peças danificadas trocar na próxima parada */
  repair: { fw: boolean; suspF: boolean; rw: boolean; suspR: boolean };
  /** saúde do motor: 1 novo .. 0 quebra */
  engineHealth: number;
  /** poupando o motor (mais lento, desgasta bem menos) */
  engineSave: boolean;
  /** soma do dano (s por volta) */
  damage: number;
  /** disputa na freada: quem perdeu alivia até esse instante */
  yieldTill: number;
  /** não decide outra freada antes dessa distância */
  duelAt: number;
  /** defendendo a posição: fica nessa lateral até esse instante */
  defendTill: number;
  defendLat: number;
  /** ultrapassando: de que lado do traçado ideal (m, relativo a ele) */
  otOff?: number;
  /** rodando (> 0 enquanto o carro está solto numa rodada) */
  spin: number;
  /**
   * carro solto (rodou, passou reto, bateu): segue reto pela inércia em vez de acompanhar a pista.
   * psi = direção do movimento e yaw = do carro, as duas em relação à pista (rad); stop = tempo parado (s)
   */
  slide?: { mode: "spin" | "off" | "crash"; psi: number; yaw: number; yawRate: number; stop: number } | null;
  /** fora da corrida e parado: como ficou virado (rad, em relação à pista) */
  restYaw?: number | null;
  /** guindaste retirando o carro: tempo (s), duração e se ele está em cima da pista (segura o safety car) */
  recover?: { t: number; dur: number; onTrack: boolean } | null;
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
  /** volta do líder quando aconteceu (histórico da corrida) */
  lap?: number;
  /** carro envolvido (a câmera do replay segue ele) */
  carId?: string;
}
