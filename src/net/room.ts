// Sala de jogo: fluxo do fim de semana (lobby -> treino -> classificação ->
// estratégia -> corrida -> pódio). Não sabe nada de rede: no solo roda no
// navegador, no online roda no servidor Node. A corrida é autoritativa aqui.
import { TEAMS } from "../sim/data";
import { drawLineup, drawReserves, type Lineup } from "../sim/drivers";
import { awardPoints, newChampionship, type ChampState } from "../sim/championship";
import { makeEngineers } from "../sim/entrants";
import { Race, type RaceOptions } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import { clampTuning, type QualiLap } from "../sim/tuning";
import { ALL_COMPOUNDS, DEFAULT_TUNING, FUEL_MAX, type CarSetup, type Tuning } from "../sim/types";
import { PRACTICE_LAPS, practiceLap, runQualifying, weekendWeather, type WeekendInfo } from "../sim/weekend";
import {
  LAP_OPTIONS,
  MAX_PLAYERS,
  SPEEDS,
  type ClientMsg,
  type LobbyState,
  type Phase,
  type ServerMsg,
  type WeekendPublic,
} from "./protocol";

const TICK_MS = 50;
const SIM_DT = 1 / 20;

interface Player {
  id: string;
  name: string;
  teamName: string;
  teamId: string | null;
  connected: boolean;
  ready: boolean;
  setups: Record<string, CarSetup>;
  tunings: Record<string, Tuning>;
  practiceCount: Record<string, number>;
  practiceLaps: Record<string, QualiLap[]>;
}

export type Send = (playerId: string, msg: ServerMsg) => void;

export class Room {
  readonly players = new Map<string, Player>();
  hostId = "";
  phase: Phase = "lobby";
  laps = 20;
  trackIndex = 0;
  equalCars = false;
  champMode = false;
  private champ: ChampState | null = null;
  private weekend: WeekendInfo | null = null;
  private race: Race | null = null;
  private speed = 1;
  private sentEvents = 0;
  private ticks = 0;
  private lastTick = 0;
  private simDebt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;

  /** pilotos sorteados pras equipes (novo a cada jogo; o campeonato mantém) */
  lineup: Lineup = drawLineup((Math.random() * 2 ** 32) >>> 0);
  /** reserva escondido de cada equipe e quem já usou a troca (1 por jogo/campeonato) */
  private reserves: Record<string, string> = {};
  private swapUsed = new Set<string>();

  private newLineup() {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.lineup = drawLineup(seed);
    this.reserves = drawReserves(this.lineup, seed);
    this.swapUsed.clear();
  }

  constructor(readonly code: string, private send: Send, readonly solo = false) {}

  private teamDrivers(teamId: string | null): string[] {
    return teamId ? (this.lineup[teamId] ?? []) : [];
  }

  // ---------- jogadores ----------

  join(name: string, teamName: string): string | null {
    if (this.phase !== "lobby") return null;
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((o) => o.teamId));
    const p: Player = {
      id: `p${this.nextId++}`,
      name: clean(name, 18) || "Engenheiro",
      teamName: clean(teamName, 24),
      // já entra com uma equipe livre (começando pelas do meio do grid)
      teamId: [...TEAMS].sort((a, b) => Math.abs(a.carPace - 0.7) - Math.abs(b.carPace - 0.7)).find((t) => !used.has(t.id))?.id ?? null,
      connected: true,
      ready: false,
      setups: {},
      tunings: {},
      practiceCount: {},
      practiceLaps: {},
    };
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    this.broadcastLobby();
    return p.id;
  }

  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.race && p.teamId) this.race.setHuman(p.teamId, false); // a IA assume
    this.players.delete(id);
    if (this.players.size === 0) {
      this.dispose();
      return;
    }
    if (this.hostId === id) this.hostId = this.players.keys().next().value!;
    this.checkAdvance();
    this.broadcastLobby();
  }

  isEmpty() {
    return this.players.size === 0;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- mensagens ----------

  handle(id: string, msg: ClientMsg) {
    const p = this.players.get(id);
    if (!p) return;
    const isHost = this.hostId === id;
    switch (msg.t) {
      case "profile":
        if (this.phase !== "lobby") return;
        p.name = clean(msg.name, 18) || p.name;
        p.teamName = clean(msg.teamName, 24);
        this.broadcastLobby();
        break;
      case "team": {
        if (this.phase !== "lobby" || !TEAMS.some((t) => t.id === msg.teamId)) return;
        if ([...this.players.values()].some((o) => o !== p && o.teamId === msg.teamId))
          return this.send(id, { t: "error", msg: "Essa equipe já foi escolhida." });
        p.teamId = msg.teamId;
        this.broadcastLobby();
        break;
      }
      case "options":
        if (!isHost || this.phase !== "lobby") return;
        if (msg.laps !== undefined && LAP_OPTIONS.includes(msg.laps)) this.laps = msg.laps;
        if (msg.trackIndex !== undefined && CIRCUITS[msg.trackIndex]) this.trackIndex = msg.trackIndex;
        if (msg.equalCars !== undefined) this.equalCars = !!msg.equalCars;
        if (msg.champ !== undefined) this.champMode = !!msg.champ;
        this.broadcastLobby();
        break;
      case "startWeekend":
        if (!isHost || this.phase !== "lobby") return;
        if ([...this.players.values()].some((o) => !o.teamId))
          return this.send(id, { t: "error", msg: "Todo mundo precisa escolher uma equipe." });
        this.champ = this.champMode ? newChampionship() : null;
        this.startWeekend();
        break;
      case "practiceLap": {
        if (this.phase !== "practice" || !this.owns(p, msg.carId)) return;
        const n = p.practiceCount[msg.carId] ?? 0;
        if (n >= PRACTICE_LAPS) return;
        const tuning = clampTuning(msg.tuning);
        p.practiceCount[msg.carId] = n + 1;
        p.tunings[msg.carId] = tuning;
        const lap = practiceLap(this.weekend!, msg.carId, tuning, n);
        (p.practiceLaps[msg.carId] ??= []).push(lap);
        this.send(id, { t: "practice", carId: msg.carId, lapIndex: n, lap });
        break;
      }
      case "finalTuning":
        if (this.phase !== "practice" || !this.owns(p, msg.carId)) return;
        p.tunings[msg.carId] = clampTuning(msg.tuning);
        break;
      case "setup":
        if (this.phase !== "strategy") return;
        p.setups = sanitizeSetups(msg.setups, this.teamDrivers(p.teamId));
        break;
      case "ready":
        if (this.phase === "lobby") return;
        p.ready = !!msg.ready;
        this.checkAdvance();
        this.broadcastLobby();
        break;
      case "cmd": {
        if (!this.race || !p.teamId) return;
        const car = this.race.cars.find((c) => c.id === msg.cmd?.carId);
        if (!car || car.team.id !== p.teamId) return; // só manda nos próprios carros
        this.race.command(msg.cmd);
        break;
      }
      case "speed":
        if (isHost && this.race && SPEEDS.includes(msg.speed)) this.speed = msg.speed;
        break;
      case "back": {
        // volta uma etapa (host): treino -> lobby, classificação -> treino, estratégia -> classificação
        if (!isHost) return;
        if (this.phase === "practice") {
          this.champ = null;
          this.setPhase("lobby");
        } else if (this.phase === "quali") {
          this.setPhase("practice");
          // reenvia as voltas de treino já feitas pra tela não perder o histórico
          for (const pl of this.players.values())
            for (const [carId, laps] of Object.entries(pl.practiceLaps))
              laps.forEach((lap, lapIndex) => this.send(pl.id, { t: "practice", carId, lapIndex, lap }));
        } else if (this.phase === "strategy" && this.lastQuali) {
          this.setPhase("quali");
          this.broadcast({ t: "quali", results: this.lastQuali.results, wet: this.lastQuali.wet });
        }
        break;
      }
      case "swapDriver": {
        // troca 1 piloto pelo reserva (surpresa), uma vez só, durante o treino
        const team = p.teamId;
        if (this.phase !== "practice" || !team || !this.owns(p, msg.carId) || this.swapUsed.has(team)) return;
        const res = this.reserves[team];
        if (!res) return;
        const pair = [...this.lineup[team]] as [string, string];
        pair[pair.indexOf(msg.carId)] = res;
        this.lineup = { ...this.lineup, [team]: pair };
        if (this.weekend) this.weekend.lineup = this.lineup;
        this.swapUsed.add(team);
        p.tunings[res] = p.tunings[msg.carId] ?? { ...DEFAULT_TUNING };
        delete p.tunings[msg.carId];
        delete p.practiceCount[msg.carId];
        delete p.practiceLaps[msg.carId];
        this.broadcastLobby();
        // reenvia as voltas do outro piloto (a tela é redesenhada)
        for (const [carId, laps] of Object.entries(p.practiceLaps))
          laps.forEach((lap, lapIndex) => this.send(id, { t: "practice", carId, lapIndex, lap }));
        break;
      }
      case "reroll":
        // host sorteia os pilotos de novo (só no lobby)
        if (!isHost || this.phase !== "lobby") return;
        this.newLineup();
        this.broadcastLobby();
        break;
      case "abort":
        // host encerra o fim de semana/corrida e todo mundo volta pro lobby
        if (!isHost || this.phase === "lobby") return;
        this.dispose();
        this.race = null;
        this.champ = null;
        this.setPhase("lobby");
        break;
      case "skip":
        if (isHost && this.race?.checkered) this.race.skipToEnd();
        break;
      case "leave":
        this.leave(id);
        break;
    }
  }

  private owns(p: Player, carId: string) {
    return this.teamDrivers(p.teamId).includes(carId);
  }

  // ---------- fases ----------

  private setPhase(phase: Phase) {
    this.phase = phase;
    for (const p of this.players.values()) p.ready = false;
    this.broadcastLobby();
  }

  private startWeekend() {
    const players = [...this.players.values()];
    const seed = (Math.random() * 2 ** 32) >>> 0;
    // pilotos sorteados agora (depois da escolha das equipes); no campeonato, só na 1ª etapa
    if (!this.champ || this.champ.round === 0) this.newLineup();
    const human: Record<string, string> = {};
    const teamNames: Record<string, string> = {};
    for (const p of players) {
      human[p.teamId!] = p.name;
      if (p.teamName) teamNames[p.teamId!] = p.teamName;
      p.tunings = {};
      p.setups = {};
      p.practiceCount = {};
      p.practiceLaps = {};
      for (const id of this.teamDrivers(p.teamId)) p.tunings[id] = { ...DEFAULT_TUNING };
    }
    const ch = this.champ;
    // no campeonato os engenheiros da IA são sorteados uma vez só
    if (ch && !ch.engineers) ch.engineers = makeEngineers(seed, human);
    const engineers = ch?.engineers ? { ...ch.engineers } : makeEngineers(seed, human);
    for (const p of players) engineers[p.teamId!] = { name: p.name, quality: null };
    this.weekend = {
      seed,
      trackIndex: ch ? ch.rounds[ch.round] : this.trackIndex,
      laps: this.laps,
      equalCars: this.equalCars,
      teamNames,
      engineers,
      lineup: this.lineup,
    };
    this.setPhase("practice");
  }

  /** avança de fase quando todo mundo (conectado) está pronto */
  private checkAdvance() {
    const ps = [...this.players.values()];
    if (ps.length === 0 || !ps.every((p) => p.ready)) return;
    if (this.phase === "practice") this.startQuali();
    else if (this.phase === "quali") this.setPhase("strategy");
    else if (this.phase === "strategy") this.startRace();
    else if (this.phase === "podium") {
      const ch = this.champ;
      if (ch && !ch.finished) {
        ch.round++;
        this.startWeekend(); // próxima etapa
      } else {
        // jogo novo: pilotos sorteados de novo
        this.champ = null;
        this.newLineup();
        this.setPhase("lobby");
      }
    }
  }

  private lastQuali: { results: ReturnType<typeof runQualifying>["results"]; wet: number } | null = null;

  private startQuali() {
    const tunings: Record<string, Tuning> = {};
    for (const p of this.players.values()) Object.assign(tunings, p.tunings);
    const q = runQualifying(this.weekend!, tunings);
    this.qualiGrid = q.grid;
    this.qualiTunings = q.tunings;
    this.setPhase("quali");
    this.lastQuali = { results: q.results, wet: q.wet };
    this.broadcast({ t: "quali", results: q.results, wet: q.wet });
  }
  private qualiGrid: string[] = [];
  private qualiTunings: Record<string, Tuning> = {};

  private startRace() {
    const w = this.weekend!;
    const players = [...this.players.values()];
    const setups: Record<string, CarSetup> = {};
    for (const p of players) Object.assign(setups, p.setups);
    const opts: RaceOptions = {
      seed: w.seed,
      laps: w.laps,
      trackIndex: w.trackIndex,
      humanTeams: players.map((p) => p.teamId!).filter(Boolean),
      setups,
      tunings: this.qualiTunings,
      grid: this.qualiGrid,
      equalCars: w.equalCars,
      teamNames: w.teamNames,
      engineers: w.engineers,
      lineup: w.lineup,
    };
    this.race = new Race(opts);
    this.speed = 1;
    this.sentEvents = 0;
    this.ticks = 0;
    this.setPhase("race");
    this.broadcast({ t: "start", opts, speed: this.speed });

    this.lastTick = Date.now();
    this.simDebt = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const race = this.race!;
    // anda pelo tempo real que passou: se o navegador atrasar o timer (aba
    // minimizada no solo), a corrida compensa em vez de ficar lenta
    const now = Date.now();
    const elapsed = Math.min(30, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.simDebt += elapsed * this.speed;
    let steps = 0;
    while (this.simDebt >= SIM_DT && steps < 12000 && race.phase !== "finished") {
      race.step(SIM_DT);
      this.simDebt -= SIM_DT;
      steps++;
    }
    this.ticks++;
    const done = race.phase === "finished";
    // no solo manda todo tick (sem custo de rede); online, 10x por segundo
    if (this.solo || this.ticks % 2 === 0 || done) {
      this.broadcast({ t: "snap", snap: race.snapshot(this.sentEvents), speed: this.speed });
      this.sentEvents = race.events.length;
    }
    if (done) {
      if (this.champ) awardPoints(this.champ, race);
      this.dispose();
      this.race = null;
      this.broadcast({ t: "end" });
      this.setPhase("podium");
    }
  }

  // ---------- envio ----------

  private lobbyFor(id: string): LobbyState {
    const w = this.weekend;
    let weekend: WeekendPublic | null = null;
    if (w && this.phase !== "lobby") {
      const wx = weekendWeather(w);
      weekend = { ...w, practiceWet: wx.practiceWet, qualiWet: wx.qualiWet, startWet: wx.startWet, forecast: wx.forecast };
    }
    return {
      code: this.code,
      solo: this.solo,
      you: id,
      hostId: this.hostId,
      phase: this.phase,
      laps: this.laps,
      trackIndex: this.trackIndex,
      equalCars: this.equalCars,
      champMode: this.champMode,
      lineup: this.lineup,
      swapUsed: [...this.swapUsed],
      champ: this.champ,
      weekend,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        teamName: p.teamName,
        teamId: p.teamId,
        connected: p.connected,
        ready: p.ready,
      })),
    };
  }

  private broadcastLobby() {
    for (const p of this.players.values()) this.send(p.id, { t: "lobby", lobby: this.lobbyFor(p.id) });
  }

  private broadcast(msg: ServerMsg) {
    for (const p of this.players.values()) this.send(p.id, msg);
  }
}

function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/[<>]/g, "").trim().slice(0, max);
}

function sanitizeSetups(setups: Record<string, CarSetup>, ids: string[]): Record<string, CarSetup> {
  const out: Record<string, CarSetup> = {};
  const fuel = (x: unknown) => Math.max(0, Math.min(FUEL_MAX, Number(x) || 0));
  const tyre = (x: unknown) => (ALL_COMPOUNDS.includes(x as never) ? (x as CarSetup["tyre"]) : "M");
  for (const id of ids) {
    const s = setups?.[id];
    if (!s) continue;
    out[id] = {
      tyre: tyre(s.tyre),
      fuel: Math.max(1, fuel(s.fuel)),
      plan: (Array.isArray(s.plan) ? s.plan : []).slice(0, 5).map((st) => ({
        lap: Math.max(1, Math.round(Number(st?.lap) || 1)),
        compound: tyre(st?.compound),
        fuel: fuel(st?.fuel),
      })),
    };
  }
  return out;
}
