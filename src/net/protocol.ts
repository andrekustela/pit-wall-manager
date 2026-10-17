// Mensagens entre cliente e sala (compartilhado pelos dois lados).
import type { ChampState } from "../sim/championship";
import type { Engineer } from "../sim/entrants";
import type { LapRec, RaceOptions, Snapshot } from "../sim/race";
import type { QualiLap } from "../sim/tuning";
import type { CarSetup, Command, Tuning } from "../sim/types";
import type { Forecast } from "../sim/weather";
import type { QualiResult } from "../sim/weekend";

export type Phase = "lobby" | "practice" | "quali" | "strategy" | "race" | "podium";

export interface LobbyPlayer {
  id: string;
  name: string; // nome do engenheiro
  teamName: string;
  teamId: string | null;
  connected: boolean;
  ready: boolean;
}

export interface WeekendPublic {
  seed: number;
  trackIndex: number;
  laps: number;
  equalCars: boolean;
  teamNames: Record<string, string>;
  engineers: Record<string, Engineer>;
  lineup?: import("../sim/drivers").Lineup;
  practiceWet: number;
  qualiWet: number;
  startWet: number;
  forecast: Forecast | null;
}

export interface LobbyState {
  code: string;
  solo: boolean;
  you: string;
  /** senha pra reconectar (só a sua) */
  token?: string;
  hostId: string;
  phase: Phase;
  laps: number;
  trackIndex: number;
  equalCars: boolean;
  /** modo campeonato ligado no lobby */
  champMode: boolean;
  /** porcentagem das pistas que entram no campeonato (sorteadas) */
  champPct: number;
  /** campeonato em andamento (ou o que acabou de terminar) */
  champ: ChampState | null;
  /** pilotos reais (lendas) em vez dos fictícios */
  realDrivers: boolean;
  /** pilotos sorteados de cada equipe */
  lineup: import("../sim/drivers").Lineup;
  /** equipes que já usaram a troca pelo reserva */
  swapUsed: string[];
  players: LobbyPlayer[];
  weekend: WeekendPublic | null;
}

export type ClientMsg =
  | { t: "create"; name: string; teamName: string }
  | { t: "join"; code: string; name: string; teamName: string }
  | { t: "rejoin"; code: string; token: string }
  | { t: "develop"; area: import("../sim/development").DevArea }
  | { t: "repairEngine"; carId: string }
  | { t: "newEngine"; carId: string }
  | { t: "chat"; text: string }
  | { t: "profile"; name: string; teamName: string }
  | { t: "team"; teamId: string }
  | { t: "options"; laps?: number; trackIndex?: number; equalCars?: boolean; champ?: boolean; champPct?: number; realDrivers?: boolean }
  | { t: "startWeekend" }
  | { t: "practiceLap"; carId: string; tuning: Tuning }
  | { t: "finalTuning"; carId: string; tuning: Tuning }
  | { t: "setup"; setups: Record<string, CarSetup> }
  | { t: "ready"; ready: boolean }
  | { t: "cmd"; cmd: Command }
  | { t: "speed"; speed: number }
  | { t: "skip" }
  | { t: "abort" }
  | { t: "back" }
  | { t: "reroll" }
  | { t: "swapDriver"; carId: string }
  | { t: "leave" };

/** mensagem do chat (só entre jogadores) */
export interface ChatLine {
  from: string;
  name: string;
  teamId: string | null;
  text: string;
}

export type ServerMsg =
  | { t: "error"; msg: string }
  | { t: "chat"; line: ChatLine }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "practice"; carId: string; lapIndex: number; lap: QualiLap }
  | { t: "quali"; results: QualiResult[]; wet: number }
  | { t: "start"; opts: RaceOptions; speed: number }
  | { t: "snap"; snap: Snapshot; speed: number }
  | { t: "end"; tele: Record<string, LapRec[]> };

export const MAX_PLAYERS = 10;
export const LAP_OPTIONS = [10, 20, 30];
export const SPEEDS = [0, 1, 2, 4, 8, 16];
