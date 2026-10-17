import { TEAMS } from "./data";
import { buildEntrants, type Engineer } from "./entrants";
import { Rng } from "./rng";
import { BOX_SHIFT, PIT_MERGE, TRACK_WIDTH, Track, getTrack } from "./track";
import { BASE_SLACK, aiTuning, carProfile, clampTuning, lapNoiseSd, makeConditions, wetSkillFactor, type Conditions } from "./tuning";
import {
  COMPOUNDS,
  DRY,
  ENGINE,
  FUEL_MAX,
  FUEL_WEIGHT,
  PACE,
  RACE_FUEL,
  REFUEL_RATE,
  bestForWet,
  isWetTyre,
  wetPenalty,
  wetWear,
  type CarSetup,
  type CarState,
  type Command,
  type Compound,
  type Driver,
  type RaceEvent,
  type Team,
  type TeamOrder,
  type Tuning,
} from "./types";
import { makeWeather, rainAt, type WeatherPlan } from "./weather";
import { ENGINE_SAVE, ENGINE_WEAR_PER_LAP, NO_DAMAGE, PARTS, type PartId } from "./parts";

/** uma volta na telemetria: tempo, posição ao cruzar a linha, pneu, parou no box, safety car */
export interface LapRec {
  t: number;
  p: number;
  c: Compound;
  pit: boolean;
  sc: boolean;
}

export interface RaceOptions {
  seed: number;
  laps: number;
  trackIndex: number;
  /** equipes controladas por humanos */
  humanTeams: string[];
  /** pneu, combustível e plano de paradas dos carros humanos, por id do piloto */
  setups: Record<string, CarSetup>;
  /** acerto de cada carro (da classificação); quem não tiver, a IA escolhe */
  tunings?: Record<string, Tuning>;
  /** ordem de largada (ids); sem isso, sorteia uma classificação */
  grid?: string[];
  equalCars?: boolean;
  teamNames?: Record<string, string>;
  engineers?: Record<string, Engineer>;
  lineup?: import("./drivers").Lineup;
}

export type RacePhase = "lights" | "racing" | "finished";

const REF_LAPS = 30; // desgaste é escalado pra corrida "parecer" ter 30 voltas
const PIT_SPEED = 22; // m/s (~80 km/h)
const MANDATORY_PENALTY = 30;
const CRASH_RATE = 1.4e-5; // por carro por segundo, no seco
const COOLDOWN_TIMEOUT = 260; // s depois da bandeirada
/** tamanho do carro pra colisão (m) */
const CAR_L = 4.4;
const CAR_W = 2.3;
/** distância lateral entre "faixas" numa disputa */
const LANE_STEP = 3.4;
const LANE_EDGE = TRACK_WIDTH / 2 - 1.6;
/** quanto o lado de dentro da curva encurta o caminho (0 = nada, 1 = geometria pura) */
const INSIDE_LINE = 0.45;

/** consumo por volta em modo normal */
export function fuelPerLap(laps: number): number {
  return RACE_FUEL / laps;
}

/** campos do carro que mudam durante a corrida (vão no snapshot da rede) */
const SNAP_KEYS = [
  "s", "lap", "v", "lateral", "compound", "wear", "tyreLaps", "usedCompounds", "fuel", "engine", "pace",
  "boxRequest", "boxFuel", "pit", "pitTimer", "pitStops", "lastLap", "bestLap", "finished", "finishTime",
  "retired", "retireReason", "spin", "damage", "dmg", "repair", "engineHealth", "engineSave", "order", "position", "penalty", "targetLap", "isHuman", "plan", "planIdx", "planDue",
] as const satisfies readonly (keyof CarState)[];

export interface SafetyCar {
  active: boolean;
  /** o carro de segurança está na pista (senão já entrou no box e espera a relargada) */
  onTrack: boolean;
  s: number;
  v: number;
  lapsLeft: number;
}

export interface Snapshot {
  time: number;
  phase: RacePhase;
  checkered: boolean;
  checkeredTime: number | null;
  wet: number;
  rain: number;
  sc: SafetyCar;
  fastestLap: { carId: string; time: number } | null;
  cars: unknown[][];
  gaps: [number, number][];
  events: RaceEvent[];
}

export class Race {
  readonly track: Track;
  readonly laps: number;
  readonly opts: RaceOptions;
  readonly weather: WeatherPlan;
  readonly teams: Team[];
  readonly drivers: Driver[];
  readonly engineers: Record<string, Engineer>;
  /** condições do fim de semana (vento, ondulação, temperatura) */
  readonly cond: Conditions;
  readonly cars: CarState[] = [];
  readonly events: RaceEvent[] = [];
  time = 0;
  phase: RacePhase = "lights";
  lightsTime: number;
  checkered = false;
  checkeredTime: number | null = null;
  /** água na pista (0 seco .. 1 encharcada) */
  wet = 0;
  /** intensidade da chuva agora (0..1) */
  rain = 0;
  sc: SafetyCar = { active: false, onTrack: false, s: 0, v: 0, lapsLeft: 0 };
  fastestLap: { carId: string; time: number } | null = null;
  /** telemetria volta a volta (só na sala; vai pro cliente no fim da corrida) */
  telemetry: Record<string, LapRec[]> = {};
  private teleState: Record<string, { c: Compound; stops: number }> = {};
  /** contadores (pra balancear e pro resumo) */
  stats = { attempts: 0, aborts: 0, noSide: 0, overtakes: 0, touches: 0, damages: 0, spins: 0, crashes: 0, safetyCars: 0 };

  private rng: Rng;
  private wearScale: number;
  private trace = new Map<number, number>(); // bucket de distância -> tempo do líder
  private teamIndex = new Map<string, number>();
  private remoteGaps: Map<string, { seconds: number; laps: number }> | null = null;
  private lastLapAnnounced = false;

  constructor(opts: RaceOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.track = getTrack(opts.trackIndex);
    this.laps = opts.laps;
    this.wearScale = REF_LAPS / opts.laps;
    this.weather = makeWeather(opts.seed, opts.laps, this.track.def.rainChance);
    this.wet = this.weather.startWet;
    this.rain = rainAt(this.weather, 0);
    this.lightsTime = 5 + this.rng.range(0.4, 2);
    const { teams, drivers } = buildEntrants(opts);
    this.cond = makeConditions(opts.seed, this.track);
    this.teams = teams;
    this.drivers = drivers;
    this.engineers = opts.engineers ?? {};
    TEAMS.forEach((t, i) => this.teamIndex.set(t.id, i));

    let order: string[];
    if (opts.grid && opts.grid.length === drivers.length) order = opts.grid;
    else {
      // sem classificação: sorteia pela pace
      order = drivers
        .map((d) => {
          const team = teams.find((t) => t.id === d.teamId)!;
          return { id: d.id, q: team.carPace + d.skill + this.rng.gauss(0.22) };
        })
        .sort((a, b) => a.q - b.q)
        .map((x) => x.id);
    }

    order.forEach((id, i) => {
      const d = drivers.find((x) => x.id === id)!;
      const team = teams.find((t) => t.id === d.teamId)!;
      const isHuman = opts.humanTeams.includes(team.id);
      const tuning = clampTuning(opts.tunings?.[id] ?? aiTuning(this.track, this.quality(team.id), this.rng, this.cond, d));
      const prof = carProfile(this.track, tuning, this.cond, d);
      const setup = opts.setups[id];
      const car: CarState = {
        id: d.id,
        driver: d,
        team,
        isHuman,
        s: this.track.L - 14 - i * 8,
        lap: -1,
        v: 0,
        lateral: i % 2 === 0 ? -LANE_STEP : LANE_STEP,
        lateralTarget: 0,
        compound: "M",
        wear: 0,
        tyreLaps: 0,
        usedCompounds: [],
        fuel: 0,
        engine: "normal",
        pace: "normal",
        boxRequest: null,
        boxFuel: 0,
        pit: "none",
        pitTimer: 0,
        pitStops: 0,
        lapNoise: 0,
        lapStartTime: 0,
        lastLap: null,
        bestLap: null,
        overtaking: null,
        nextAttemptS: -Infinity,
        finished: false,
        finishTime: null,
        retired: false,
        retireReason: null,
        spin: 0,
        damage: 0,
        dmg: { ...NO_DAMAGE },
        repair: { fw: true, suspF: true, rw: true, suspR: true },
        engineHealth: 1,
        engineSave: false,
        order: "none",
        defendTill: 0,
        yieldTill: 0,
        duelAt: 0,
        defendLat: 0,
        position: i + 1,
        penalty: 0,
        targetLap: 0,
        // arrancada: uns largam muito bem, outros patinam
        launch: this.rng.range(0.8, 1.16),
        tyreWarn: 0,
        fuelWarn: 0,
        wetWarn: 0,
        tuning,
        profile: prof.v,
        profileLap: prof.lap,
        plan: isHuman ? [...(setup?.plan ?? [])].sort((a, b) => a.lap - b.lap) : [],
        planIdx: 0,
        planDue: false,
        aiPlan: [],
        aiCompounds: [],
      };
      // a IA sempre planeja (assume o carro se um jogador cair)
      this.planAi(car);
      if (isHuman) {
        car.compound = setup?.tyre ?? "M";
        car.fuel = clampFuel(setup?.fuel ?? RACE_FUEL * 0.55);
      } else {
        car.compound = this.aiStartCompound(car);
        car.fuel = this.aiStintFuel(car, -1, car.aiPlan[0] ?? this.laps);
      }
      car.usedCompounds = [car.compound];
      this.cars.push(car);
    });
  }

  // ---------- comandos (no multiplayer chegam pela rede) ----------

  command(cmd: Command) {
    const car = this.cars.find((c) => c.id === cmd.carId);
    if (!car || car.finished || car.retired) return;
    switch (cmd.type) {
      case "box":
        if ((car.pit === "none" || car.pit === "entering") && COMPOUNDS[cmd.compound]) {
          car.boxRequest = cmd.compound;
          car.boxFuel = Math.max(0, Math.min(FUEL_MAX, Number(cmd.fuel) || 0));
        }
        break;
      case "cancelBox":
        if (car.pit === "none") car.boxRequest = null;
        break;
      case "pace":
        if (PACE[cmd.mode] && !(car.engineSave && cmd.mode === "push")) car.pace = cmd.mode;
        break;
      case "engine":
        if (ENGINE[cmd.mode] && !(car.engineSave && cmd.mode === "rich")) car.engine = cmd.mode;
        break;
      case "repair":
        for (const p of PARTS) if (typeof cmd.parts?.[p.id] === "boolean") car.repair = { ...car.repair, [p.id]: cmd.parts[p.id] };
        break;
      case "order":
        this.teamOrder(car, cmd.mode);
        break;
      case "engineSave":
        car.engineSave = !!cmd.on;
        // poupando: nada de atacar nem mistura rica
        if (car.engineSave) {
          if (car.pace === "push") car.pace = "normal";
          if (car.engine === "rich") car.engine = "normal";
        }
        break;
      case "plan": {
        // substitui as paradas que ainda não aconteceram
        const list = Array.isArray(cmd.plan) ? cmd.plan.slice(0, 5) : [];
        car.plan = list
          .map((st) => ({
            lap: Math.round(Number(st?.lap) || 0),
            compound: COMPOUNDS[st?.compound] ? st.compound : car.compound,
            fuel: Math.max(0, Math.min(FUEL_MAX, Number(st?.fuel) || 0)),
          }))
          .filter((st) => st.lap > car.lap && st.lap < this.laps)
          .sort((a, b) => a.lap - b.lap);
        car.planIdx = 0;
        car.planDue = false;
        break;
      }
    }
  }

  setHuman(teamId: string, human: boolean) {
    for (const c of this.cars) if (c.team.id === teamId) c.isHuman = human;
  }

  /** pula a volta de desaceleração e vai direto pro pódio */
  skipToEnd() {
    if (!this.checkered) return;
    for (const c of this.cars) {
      if (!c.finished && !c.retired) {
        c.finished = true;
        c.finishTime = this.time;
      }
    }
    this.updatePositions();
    this.phase = "finished";
  }

  // ---------- consultas ----------

  quality(teamId: string): number {
    return this.engineers[teamId]?.quality ?? 0.6;
  }

  dist(c: CarState): number {
    return c.lap * this.track.L + c.s;
  }

  ordered(): CarState[] {
    return [...this.cars].sort((a, b) => a.position - b.position);
  }

  leader(): CarState {
    return this.ordered()[0];
  }

  /** consumo estimado por volta no modo atual do carro */
  consumption(c: CarState): number {
    return fuelPerLap(this.laps) * PACE[c.pace].fuel * ENGINE[c.engine].fuel * (this.sc.active ? 0.6 : 1);
  }

  /** voltas que faltam pro carro completar (contando a atual) */
  lapsLeft(c: CarState): number {
    return Math.max(0, this.laps - c.lap - this.track.wrap(c.s) / this.track.L);
  }

  /** gap pro líder em segundos (laps > 0 = volta(s) atrás) */
  gapToLeader(c: CarState): { seconds: number; laps: number } {
    if (this.remoteGaps) return this.remoteGaps.get(c.id) ?? { seconds: 0, laps: 0 };
    const leader = this.leader();
    if (c === leader) return { seconds: 0, laps: 0 };
    if (c.finished && leader.finished) {
      const lapsDown = leader.lap - c.lap;
      return { seconds: c.finishTime! + c.penalty - (leader.finishTime! + leader.penalty), laps: lapsDown };
    }
    const lapsDown = Math.floor((this.dist(leader) - this.dist(c)) / this.track.L);
    const t = this.trace.get(Math.floor(this.dist(c) / 25));
    return { seconds: t === undefined ? 0 : this.time - t, laps: lapsDown };
  }

  currentLap(): number {
    return Math.min(this.laps, Math.max(1, this.leader().lap + 1));
  }

  /** progresso da corrida em voltas (líder) */
  raceLap(): number {
    if (this.phase === "lights") return 0;
    const l = this.leader();
    return Math.max(0, l.lap + (l.lap < 0 ? 0 : l.s / this.track.L));
  }

  // ---------- rede ----------

  snapshot(sinceEvent: number): Snapshot {
    return {
      time: this.time,
      phase: this.phase,
      checkered: this.checkered,
      checkeredTime: this.checkeredTime,
      wet: this.wet,
      rain: this.rain,
      sc: { ...this.sc },
      fastestLap: this.fastestLap,
      cars: this.cars.map((c) => SNAP_KEYS.map((k) => c[k])),
      gaps: this.cars.map((c) => {
        const g = this.gapToLeader(c);
        return [Math.round(g.seconds * 1000) / 1000, g.laps];
      }),
      events: this.events.slice(sinceEvent),
    };
  }

  /** usado no cliente online: o servidor manda o estado, aqui só aplica */
  applySnapshot(snap: Snapshot) {
    this.time = snap.time;
    this.phase = snap.phase;
    this.checkered = snap.checkered;
    this.checkeredTime = snap.checkeredTime;
    this.wet = snap.wet;
    this.rain = snap.rain;
    this.sc = snap.sc;
    this.fastestLap = snap.fastestLap;
    this.remoteGaps ??= new Map();
    snap.cars.forEach((vals, i) => {
      const c = this.cars[i] as unknown as Record<string, unknown>;
      SNAP_KEYS.forEach((k, j) => (c[k] = vals[j]));
      const g = snap.gaps[i];
      this.remoteGaps!.set(this.cars[i].id, { seconds: g[0], laps: g[1] });
    });
    this.events.push(...snap.events);
  }

  // ---------- simulação ----------

  step(dt: number) {
    if (this.phase === "finished") return;
    this.time += dt;
    if (this.phase === "lights") {
      if (this.time >= this.lightsTime) {
        this.phase = "racing";
        this.time = 0;
        this.cars.forEach((c) => (c.lapStartTime = 0));
        this.log(this.wet > 0.3 ? "Apagaram as luzes! Largada na chuva!" : "Apagaram as luzes! Começou a corrida!", true, undefined, "start");
      } else return;
    }

    this.updateWeather(dt);
    this.updateSafetyCar(dt);

    const L = this.track.L;
    for (const c of this.cars) this.updateTarget(c);
    const targets = new Map<string, number>();
    for (const c of this.cars) targets.set(c.id, this.targetSpeed(c));
    this.resolveTraffic(targets);

    for (const c of this.cars) {
      if (c.pit === "parked") continue;
      if (c.retired) {
        // encosta fora da pista e para
        c.v = Math.max(0, c.v - 12 * dt);
        c.lateral += Math.max(-4 * dt, Math.min(4 * dt, -13 - c.lateral));
        c.s += c.v * dt;
        if (c.s >= L) c.s -= L;
        continue;
      }
      const target = targets.get(c.id)!;
      if (c.pit === "stopped") {
        c.v = 0;
        c.pitTimer -= dt;
        if (c.pitTimer <= 0) this.finishStop(c);
        continue;
      }
      const launching = this.dist(c) < 400;
      const accMax = Math.max(2, 13 * (1 - c.v / 100)) * (launching ? c.launch : 1) * (1 - this.wet * 0.3);
      if (target > c.v) c.v = Math.min(target, c.v + accMax * dt);
      else c.v = Math.max(target, c.v - (c.spin > 0 ? 70 : 45) * dt);

      const prevS = c.s;
      // por dentro da curva o caminho é mais curto: quem mergulha por dentro ganha terreno
      const k = c.pit === "none" ? this.track.curvature[Math.floor(this.track.wrap(c.s)) % this.track.L] : 0;
      const ds = c.v * dt * (1 + Math.max(-0.04, Math.min(0.04, INSIDE_LINE * k * c.lateral)));
      c.s += ds;

      if (!c.finished) {
        // combustível
        c.fuel -= (ds / L) * this.consumption(c);
        if (c.fuel <= 0) {
          c.fuel = 0;
          this.retire(c, "Sem combustível");
          continue;
        }
        // motor: desgasta mais na mistura rica/atacando; quase no fim pode quebrar
        const engMult = (c.engine === "rich" ? 2.2 : c.engine === "lean" ? 0.6 : 1) * (c.pace === "push" ? 1.3 : 1) * (c.engineSave ? ENGINE_SAVE.wear : 1);
        c.engineHealth = Math.max(0, c.engineHealth - (ds / L) * ENGINE_WEAR_PER_LAP * this.wearScale * engMult);
        if (c.engineHealth < 0.3 && !this.checkered && this.rng.chance((0.3 - c.engineHealth) * 0.03 * dt)) {
          this.retire(c, "Motor");
          if (!this.sc.active && this.lapsLeft(this.leader()) > 2 && this.rng.chance(0.4)) this.deploySafetyCar();
          continue;
        }
        // desgaste
        if (c.pit === "none") {
          const spec = COMPOUNDS[c.compound];
          c.wear +=
            (ds / L) * spec.wearPerLap * PACE[c.pace].wear * c.driver.tyreCare * this.wearScale *
            wetWear(c.compound, this.wet) * (this.sc.active ? 0.5 : 1);
        }
        if (c.pit === "none" && c.spin <= 0) this.maybeIncident(c, dt);
        if (c.retired) continue;
        if (c.isHuman) {
          this.followPlan(c);
          this.radio(c);
        }
      }
      if (c.spin > 0) c.spin = Math.max(0, c.spin - dt);

      this.updatePit(c, prevS, ds);

      if (c.pit === "none") this.moveLateral(c, dt);

      if (c.s >= L) {
        c.s -= L;
        this.crossLine(c);
      }

      // trace pra cálculo de gap
      const bucket = Math.floor(this.dist(c) / 25);
      if (!this.trace.has(bucket) && !c.finished) this.trace.set(bucket, this.time);
    }

    this.resolveContacts(dt);
    this.updatePositions();
    const allIn = this.cars.every((c) => c.retired || c.pit === "parked");
    const timeout = this.checkeredTime !== null && this.time - this.checkeredTime > COOLDOWN_TIMEOUT;
    if (allIn || (timeout && this.cars.every((c) => c.finished || c.retired))) {
      this.phase = "finished";
    }
  }

  private updateWeather(dt: number) {
    const prevRain = this.rain;
    this.rain = rainAt(this.weather, this.raceLap());
    if (prevRain === 0 && this.rain > 0) this.log(this.rain > 0.6 ? "Começou a chover forte!" : "Começou a chover!", true, undefined, "rain");
    if (prevRain > 0 && this.rain === 0) this.log("A chuva parou. A pista vai começar a secar.", true, undefined, "dry");
    if (this.rain > this.wet) this.wet += (this.rain - this.wet) * Math.min(1, 0.012 * this.wearScale * dt);
    else this.wet = Math.max(this.rain, this.wet - 0.0018 * this.wearScale * dt);
  }

  // ---------- incidentes e safety car ----------

  private maybeIncident(c: CarState, dt: number) {
    if (this.checkered) return;
    const w = this.wet;
    let rate = CRASH_RATE * (1 + 7 * w);
    if (!isWetTyre(c.compound) && w > 0.2) rate *= 1 + 30 * (w - 0.2);
    if (c.pace === "push") rate *= 1.8;
    if (c.wear > 0.9) rate *= 3;
    if (c.tuning.h < this.track.def.minHeight) rate *= 1.5;
    if (Math.abs(c.tuning.fw - c.tuning.rw - this.track.def.balance) >= 2) rate *= 1.5;
    if (c.lap <= 0) rate *= 4;
    if (this.sc.active) rate *= 0.1;
    rate *= 1 + c.driver.skill;
    if (!this.rng.chance(rate * dt)) return;

    if (this.rng.chance(0.55)) {
      c.spin = this.rng.range(3.5, 8);
      this.stats.spins++;
      c.wear = Math.min(1.2, c.wear + 0.08);
      c.overtaking = null;
      this.log(`${c.driver.name} rodou!`, c.isHuman, c.isHuman ? c.team.id : undefined, "spin");
    } else {
      this.retire(c, "Acidente");
      if (!this.sc.active && this.lapsLeft(this.leader()) > 2 && this.rng.chance(0.75)) this.deploySafetyCar();
      else this.log("Bandeira amarela no local do acidente.", false, undefined, "yellow");
    }
  }

  private deploySafetyCar() {
    const leader = this.leader();
    this.sc = {
      active: true,
      onTrack: true,
      s: this.track.wrap(leader.s + 180),
      v: 30,
      lapsLeft: Math.max(2, Math.round(this.laps * 0.1)) + (this.rng.chance(0.4) ? 1 : 0),
    };
    for (const c of this.cars) c.overtaking = null;
    this.stats.safetyCars++;
    this.log("SAFETY CAR na pista! Proibido ultrapassar.", true, undefined, "sc");
  }

  private updateSafetyCar(dt: number) {
    const sc = this.sc;
    if (!sc.active || !sc.onTrack) return;
    const target = Math.min(48, this.track.speedAt(sc.s) * 0.55);
    sc.v += Math.max(-20 * dt, Math.min(8 * dt, target - sc.v));
    const prev = sc.s;
    sc.s = this.track.wrap(sc.s + sc.v * dt);
    // última volta do SC: entra no box
    if (sc.lapsLeft <= 1 && this.track.wrap(this.track.pitEntryS - prev) <= sc.v * dt) {
      sc.onTrack = false;
      this.log("O safety car entrou nos boxes. Relargada na linha!", true, undefined, "scin");
    }
  }

  /** chamado quando o líder cruza a linha */
  private safetyCarLap() {
    const sc = this.sc;
    if (!sc.active) return;
    if (!sc.onTrack) {
      sc.active = false;
      this.log("Bandeira verde! Valendo de novo!", true, undefined, "green");
      return;
    }
    sc.lapsLeft--;
    if (sc.lapsLeft === 1) this.log("Safety car entra nos boxes no fim desta volta.", true, undefined, "info");
  }

  // ---------- desempenho ----------

  private lapOffset(c: CarState): number {
    const spec = COMPOUNDS[c.compound];
    const w = c.wear;
    const wearPen = 1.6 * w * w + Math.max(0, w - 0.7) * 14 + Math.max(0, w - 1) * 30;
    const fuel = c.fuel * FUEL_WEIGHT;
    const cold = c.tyreLaps === 0 && c.pitStops > 0 ? 1.0 : 0;
    return (
      c.team.carPace + c.driver.skill + spec.offset + wetPenalty(c.compound, this.wet) * wetSkillFactor(c.driver) + wearPen + fuel +
      PACE[c.pace].offset + ENGINE[c.engine].offset + c.lapNoise + cold + c.damage +
      (c.engineSave ? ENGINE_SAVE.offset : 0) + Math.max(0, 0.6 - c.engineHealth) * 1.2
    );
  }

  private updateTarget(c: CarState) {
    c.targetLap = c.profileLap + BASE_SLACK + this.lapOffset(c);
    if (!c.isHuman && !c.finished && !c.retired) this.aiThink(c);
  }

  private targetSpeed(c: CarState): number {
    const base = c.profile[Math.floor(this.track.wrap(c.s)) % this.track.L];
    if (c.spin > 0) return c.spin > 2 ? 0 : 12;
    let v = c.finished ? base * 0.62 : base * (c.profileLap / c.targetLap);
    if (this.sc.active && !c.finished) v = Math.min(v, base * 0.7);
    if (c.pit === "entering" || c.pit === "leaving") {
      const box = this.boxS(c);
      const toExit = this.track.wrap(this.track.pitExitS - c.s);
      if (c.pit === "leaving" && toExit < 70) return v;
      v = Math.min(v, PIT_SPEED);
      if (c.pit === "entering") {
        const remaining = this.track.wrap(box - c.s);
        v = Math.min(v, Math.sqrt(2 * 22 * remaining) + 0.5);
      }
    }
    return v;
  }

  // ---------- tráfego e colisão ----------
  // Cada carro é um retângulo (CAR_L x CAR_W) numa posição s (ao longo da
  // pista) e lateral. Ninguém atravessa ninguém: quem está atrás na mesma
  // faixa segue o da frente; pra passar, precisa ir pra uma faixa livre.

  /** em que "área" o carro está: pista, pit lane ou fora (não interage) */
  private zone(c: CarState): "track" | "pit" | "off" {
    if (c.pit !== "none") return Math.abs(c.lateral) > TRACK_WIDTH / 2 + 0.5 ? "pit" : "track";
    return Math.abs(c.lateral) > TRACK_WIDTH / 2 + 0.8 ? "off" : "track";
  }

  /** distância ao longo da pista de a até b (negativa = b está atrás) */
  private rel(a: CarState, b: CarState): number {
    let d = this.track.wrap(b.s - a.s);
    if (d > this.track.L / 2) d -= this.track.L;
    return d;
  }

  /** faixa livre ao lado do carro da frente (ou null) */
  private freeSide(c: CarState, blocker: CarState): number | null {
    const cands = [blocker.lateral - LANE_STEP, blocker.lateral + LANE_STEP]
      .filter((x) => Math.abs(x) <= LANE_EDGE)
      .sort((x, y) => Math.abs(x) - Math.abs(y));
    for (const lat of cands) {
      const busy = this.cars.some((o) => {
        if (o === c || o === blocker || o.pit === "parked" || this.zone(o) !== "track") return false;
        const d = this.rel(c, o);
        return d > -10 && d < 18 && Math.abs(o.lateral - lat) < CAR_W + 0.6;
      });
      if (!busy) return lat;
    }
    return null;
  }

  private resolveTraffic(targets: Map<string, number>) {
    const sc = this.sc;
    for (const c of this.cars) {
      if (c.retired || c.spin > 0 || c.pit === "stopped" || c.pit === "parked") continue;
      const zone = this.zone(c);
      let myT = targets.get(c.id)!;

      // ---- faixa desejada (só na pista) ----
      if (c.pit === "none") {
        // largada: cada um segura a sua fila até a primeira curva (chegam lado a lado)
        const opening = c.lap < 0 || (c.lap === 0 && this.dist(c) < 550);
        let want = c.finished ? 4 : opening ? Math.round(c.lateral / LANE_STEP) * LANE_STEP : 0;
        // vai pro lado do pit antes da entrada
        if (!c.finished && c.boxRequest && this.track.wrap(this.track.pitEntryS - c.s) < 320) want = PIT_MERGE;
        if (c.defendTill > this.time) want = c.defendLat;
        // ordem de equipe: abre espaço pro companheiro que está chegando
        if (c.order === "letPass") {
          const m = this.mate(c);
          if (!m || m.retired || m.finished || c.finished) c.order = "none";
          else if (this.dist(m) > this.dist(c) + CAR_L) {
            c.order = "none";
            this.log(`${c.driver.short} cumpre a ordem e deixa ${m.driver.short} passar.`, true, c.team.id, "overtake");
          } else if (m.pit === "none" && !sc.active) {
            const d = this.dist(c) - this.dist(m);
            // até ~3 s atrás: tira o pé pra ele chegar; colado: abre a faixa e deixa passar
            if (d > 0 && d < 220) {
              myT *= d < 40 ? 0.9 : 0.95;
              if (d < 70) want = Math.abs(c.lateral) > 1 ? Math.sign(c.lateral) * LANE_STEP : LANE_STEP;
            }
          }
        }
        // retardatário: abre espaço pra quem vai colocar volta
        for (const o of this.cars) {
          if (o === c || o.finished || o.retired || o.pit !== "none") continue;
          const d = this.rel(c, o);
          if (d < 0 && d > -35 && this.dist(o) > this.dist(c) + this.track.L / 2) {
            want = o.lateral >= 0 ? -LANE_STEP : LANE_STEP;
            myT *= 0.97;
          }
        }

        // carro na frente, na mesma faixa
        let blocker: CarState | null = null;
        let gap = Infinity;
        for (const o of this.cars) {
          if (o === c || o.pit === "parked" || this.zone(o) !== zone) continue;
          const d = this.rel(c, o);
          if (d > 0 && d < 45 && d < gap && Math.abs(o.lateral - c.lateral) < CAR_W + 0.4) {
            gap = d;
            blocker = o;
          }
        }

        if (sc.active && !c.finished) {
          c.overtaking = null; // safety car: fila indiana
        } else if (c.overtaking) {
          const o = this.cars.find((x) => x.id === c.overtaking)!;
          const d = this.rel(c, o);
          if (d < -(CAR_L + 2)) {
            if (!o.finished) this.onOvertake(c, o);
            c.overtaking = null;
          } else if (d > 45 || o.retired || this.zone(o) !== "track") {
            c.overtaking = null; // desistiu
            this.stats.aborts++;
          } else if (Math.abs(d) < CAR_L + 6 && this.track.isStraight(c.s) && !this.track.isStraight(c.s + 70) && this.dist(c) > c.duelAt) {
            // chegaram juntos na freada: alguém cede
            c.duelAt = this.dist(c) + 250;
            const turn = Math.sign(this.track.curvature[Math.floor(this.track.wrap(c.s + 100)) % this.track.L]);
            const inside = turn * (c.lateral - o.lateral) > 0 ? 0.15 : -0.1;
            const delta = o.targetLap - c.targetLap;
            // ultrapassador x muralha
            const craft = ((c.driver.profile?.overtaking ?? 60) - (o.driver.profile?.defending ?? 60)) * 0.002;
            const ov = this.track.def.overtake ?? 1;
            const p = o.order === "letPass" && o.team.id === c.team.id ? 1 : Math.max(0.12 * ov, Math.min(0.9, (0.5 + delta * 0.5 + inside + craft - this.wet * 0.05) * Math.min(1, ov * 1.6)));
            if (this.rng.chance(p)) {
              o.yieldTill = this.time + 1.6; // segurou a freada e passou
            } else {
              c.yieldTill = this.time + 1.6; // não deu: recua e tenta na próxima
              c.overtaking = null;
              this.stats.aborts++;
              if (this.rng.chance(0.05 * (1 + this.wet))) this.maybeContact(c, o, c, 1); // mergulhou demais
            }
            want = c.overtaking ? c.lateralTarget : want;
          } else {
            want = c.lateralTarget;
            if (d > 0 && d < 25) myT *= this.track.isStraight(c.s) ? 1.028 : 1.01; // vácuo + "DRS" na reta
          }
        }
        // "DRS": colado no da frente na reta (a partir da 2ª volta) o carro chega mais rápido
        if (!sc.active && blocker && gap < 30 && c.lap >= 1 && this.track.isStraight(c.s)) myT *= 1.015;
        // na arrancada ninguém troca de fila (senão todo mundo ia pro meio e virava fila indiana);
        // as brigas começam a partir da primeira curva
        if (!sc.active && !c.overtaking && blocker && !c.finished && gap < 20 && !opening) {
          // na rua só passa quem está bem mais lento (curvas lentas enganam a comparação)
          const slow = blocker.v < myT * (this.track.def.street ? 0.45 : 0.7) || blocker.spin > 0 || blocker.retired || blocker.finished;
          const lapping = this.dist(blocker) < this.dist(c) - this.track.L / 2;
          const sameTeam = blocker.team.id === c.team.id;
          // companheiro mandado abrir: passa sem briga; "manter posições": não ataca o companheiro
          let go = slow || lapping || (sameTeam && blocker.order === "letPass");
          const held = sameTeam && c.order === "hold" && !go;
          // 1ª volta: briga em qualquer lugar, não só nas retas
          const firstLap = c.lap <= 0;
          if (!go && !held && myT > blocker.v * 1.003 && (firstLap || this.track.isStraight(c.s)) && this.dist(c) >= c.nextAttemptS) {
            const delta = blocker.targetLap - c.targetLap;
            // na chuva o spray atrapalha: tenta menos
            // piloto agressivo tenta muito mais
            const aggr = ((c.driver.profile?.aggression ?? 55) - 50) * 0.003;
            const p = Math.max(0.08, Math.min(0.95, 0.32 + delta * 0.7 + aggr + (gap < 12 ? 0.1 : 0) + (firstLap ? 0.08 : 0) - this.wet * 0.06));
            c.nextAttemptS = this.dist(c) + (firstLap ? 220 : 300);
            go = this.rng.chance(p * (this.track.def.overtake ?? 1));
          }
          if (go) {
            const side = this.freeSide(c, blocker);
            if (side === null) this.stats.noSide++;
            if (side !== null) {
              this.stats.attempts++;
              c.overtaking = blocker.id;
              want = side;
              // quem está na frente às vezes fecha a porta (se ainda não emparelharam)
              const q = this.quality(blocker.team.id);
              if (!slow && !lapping && !blocker.isHuman && gap > CAR_L + 1 && this.rng.chance((0.06 + 0.12 * q) * (0.5 + (blocker.driver.profile?.defending ?? 60) / 100))) {
                blocker.defendTill = this.time + 2.5;
                blocker.defendLat = Math.max(-LANE_EDGE, Math.min(LANE_EDGE, side));
              }
            }
          }
        }
        c.lateralTarget = want;
      }

      if (c.yieldTill > this.time) myT *= c.lap <= 0 ? 0.95 : 0.92;
      // ---- não encosta no da frente (mesma faixa) ----
      for (const o of this.cars) {
        if (o === c || o.pit === "parked" || this.zone(o) !== zone) continue;
        const d = this.rel(c, o);
        if (d <= 0 || d > 40 || Math.abs(o.lateral - c.lateral) >= CAR_W + 0.3) continue;
        const net = d - CAR_L;
        const desired = net < 0.5 ? o.v * 0.85 : o.v + 0.9 * (net - 2.5);
        myT = Math.min(myT, Math.max(0, desired));
      }
      // safety car na frente
      if (sc.active && sc.onTrack && zone === "track" && !c.finished) {
        const g = this.track.wrap(sc.s - c.s);
        if (g < 60) myT = Math.min(myT, g < 35 ? sc.v * 0.95 : sc.v + 4);
      }
      targets.set(c.id, myT);
    }
  }

  /** move pro lado sem fechar quem está emparelhado */
  private moveLateral(c: CarState, dt: number) {
    if (c.spin > 0) {
      c.lateral += Math.max(-3 * dt, Math.min(3 * dt, -9 - c.lateral)); // rodando, escorrega pra fora
      return;
    }
    const step = Math.max(-2.6 * dt, Math.min(2.6 * dt, c.lateralTarget - c.lateral));
    if (step === 0) return;
    const next = c.lateral + step;
    for (const o of this.cars) {
      if (o === c || o.pit === "parked" || this.zone(o) !== "track") continue;
      if (Math.abs(this.rel(c, o)) > CAR_L + 0.8) continue;
      const now = Math.abs(c.lateral - o.lateral);
      const after = Math.abs(next - o.lateral);
      if (after < CAR_W + 0.25 && after < now) return; // tem carro do lado: espera
    }
    c.lateral = Math.max(-LANE_EDGE - 0.5, Math.min(LANE_EDGE + 0.5, next));
  }

  /** carros que se encostaram: separa e às vezes vira batida */
  private resolveContacts(dt: number) {
    if (this.phase !== "racing") return;
    const cars = this.cars.filter((c) => c.pit !== "parked" && c.pit !== "stopped" && this.zone(c) === "track");
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const d = this.rel(a, b);
        if (Math.abs(d) > CAR_L + 1) continue;
        const dl = b.lateral - a.lateral;
        const overlap = Math.abs(d) < CAR_L * 0.92 && Math.abs(dl) < CAR_W * 0.88;
        const sideBySide = !overlap && Math.abs(d) < CAR_L && Math.abs(dl) < CAR_W + 1.2;
        const front = d > 0 ? b : a;
        const rear = front === a ? b : a;
        if (overlap) {
          // separa
          const push = (CAR_W * 0.88 - Math.abs(dl)) / 2 + 0.05;
          const dir = dl >= 0 ? 1 : -1;
          if (!a.retired) a.lateral = Math.max(-LANE_EDGE - 0.5, a.lateral - push * dir);
          if (!b.retired) b.lateral = Math.min(LANE_EDGE + 0.5, b.lateral + push * dir);
          rear.v = Math.min(rear.v, front.v * 0.95);
          const rel = Math.abs(a.v - b.v);
          this.maybeContact(a, b, rear, Math.min(0.9, 0.2 + rel * 0.04) * (1 + this.wet));
        } else if (sideBySide && this.track.speedAt(a.s) < 62 && !this.sc.active && !a.finished && !b.finished) {
          // lado a lado na curva: risco de toque
          // lado a lado na curva tem risco (bem mais na largada, com todo mundo junto)
          const opening = (a.lap <= 0 && b.lap <= 0 ? 1.6 : 1) * this.aggrRisk(a, b);
          if (this.rng.chance(0.008 * opening * (1 + 2 * this.wet) * dt)) this.maybeContact(a, b, rear, 1);
        }
      }
    }
  }

  /** dois agressivos lado a lado = mais chance de toque */
  private aggrRisk(a: CarState, b: CarState): number {
    const f = (c: CarState) => 0.8 + ((c.driver.profile?.aggression ?? 55) / 100) * 0.4;
    return (f(a) + f(b)) / 2;
  }

  private contactCooldown = new Map<string, number>();
  private damageWarned = new Set<string>();
  private engineWarned = new Set<string>();

  private maybeContact(a: CarState, b: CarState, rear: CarState, p: number) {
    if (this.checkered || a.retired || b.retired) return;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if ((this.contactCooldown.get(key) ?? -1) > this.time) return;
    this.contactCooldown.set(key, this.time + 4);
    if (!this.rng.chance(p)) return;
    // quem vem atrás costuma levar a pior
    const victim = this.rng.chance(0.65) ? rear : rear === a ? b : a;
    const other = victim === a ? b : a;
    const team = victim.isHuman ? victim.team.id : other.isHuman ? other.team.id : undefined;
    // rua: muro do lado, o toque vira dano ou batida com mais facilidade
    const r = this.track.def.street ? 0.25 + this.rng.next() * 0.75 : this.rng.next();
    a.v *= 0.92;
    b.v *= 0.92;
    a.overtaking = null;
    b.overtaking = null;
    if (r < 0.6) {
      this.stats.touches++;
      this.log(`Toque entre ${a.driver.short} e ${b.driver.short}! Seguem na pista.`, !!team, team, "touch");
    } else if (r < 0.8) {
      // qual peça quebrou
      const pr = this.rng.next();
      const part: PartId = pr < 0.45 ? "fw" : pr < 0.6 ? "rw" : pr < 0.8 ? "suspF" : "suspR";
      const dmg = part.startsWith("susp") ? this.rng.range(0.7, 2) : this.rng.range(0.4, 1.6);
      victim.dmg = { ...victim.dmg, [part]: victim.dmg[part] + dmg };
      victim.damage += dmg;
      this.stats.damages++;
      const name = PARTS.find((x) => x.id === part)!.label.toLowerCase();
      this.log(`${victim.driver.name} danificou a ${name} no toque com ${other.driver.short}! (+${dmg.toFixed(1)}s por volta)`, !!team, team, "damage");
    } else if (r < 0.94) {
      victim.spin = this.rng.range(3, 6);
      this.stats.spins++;
      this.log(`${victim.driver.name} rodou depois de um toque com ${other.driver.short}!`, !!team, team, "spin");
    } else {
      this.retire(victim, "Acidente");
      if (!this.sc.active && this.lapsLeft(this.leader()) > 2 && this.rng.chance(0.75)) this.deploySafetyCar();
    }
  }

  // ---------- box ----------

  boxS(c: CarState): number {
    const t = this.track;
    const span = t.wrap(t.pitBoxEnd - t.pitBoxStart);
    const idx = this.teamIndex.get(c.team.id) ?? 0;
    return t.wrap(t.pitBoxStart + (span * (idx + 0.5)) / TEAMS.length);
  }

  private updatePit(c: CarState, prevS: number, ds: number) {
    const t = this.track;
    if (c.pit === "none") {
      const wantsIn = (c.boxRequest && !c.finished) || c.finished;
      if (wantsIn && t.wrap(t.pitEntryS - prevS) <= ds) {
        c.pit = "entering";
        c.overtaking = null;
        if (!c.finished) this.log(`${c.driver.name} entra nos boxes`, c.isHuman, c.team.id, "pitin");
      }
      return;
    }
    const toBox = t.wrap(this.boxS(c) - c.s);
    const fromBox = t.wrap(c.s - this.boxS(c));
    const near = c.pit === "entering" ? toBox : fromBox;
    c.lateral = t.pitLateralAt(c.s) + BOX_SHIFT * Math.max(0, Math.min(1, 1 - near / 25));
    if (c.pit === "entering") {
      const remaining = toBox;
      if (remaining < 0.6 || remaining > t.L - 5) {
        c.s = this.boxS(c);
        c.v = 0;
        c.lateral = t.pitLateralAt(c.s) + BOX_SHIFT;
        if (c.finished) {
          c.pit = "parked";
          return;
        }
        c.pit = "stopped";
        // troca de pneu e reabastecimento acontecem ao mesmo tempo
        let tyres = this.rng.range(2.0, 2.9);
        if (this.rng.chance(0.06)) tyres += this.rng.range(2.5, 6);
        const add = Math.min(c.boxFuel, FUEL_MAX - c.fuel);
        const refuel = add > 0.5 ? add / REFUEL_RATE + this.rng.range(0.4, 0.8) : 0;
        const mate = this.cars.find((o) => o !== c && o.team.id === c.team.id && o.pit === "stopped");
        // consertos: asa dianteira (bico), asa traseira e suspensão demoram diferente
        // consertos (só das peças marcadas pra trocar); cada peça demora diferente
        let nose = 0;
        for (const part of PARTS) if (c.dmg[part.id] > 0 && c.repair[part.id]) nose += this.rng.range(part.repair[0], part.repair[1]);
        c.pitTimer = Math.max(tyres, refuel) + nose + (mate ? mate.pitTimer + 0.8 : 0);
      }
    } else if (c.pit === "leaving") {
      if (t.wrap(t.pitExitS - prevS) <= ds) {
        c.pit = "none";
        c.lateral = PIT_MERGE; // sai pela beira e volta pro traçado quando tiver espaço
        c.lateralTarget = 0;
      }
    }
  }

  private finishStop(c: CarState) {
    const next = c.boxRequest ?? c.compound;
    const add = Math.max(0, Math.min(c.boxFuel, FUEL_MAX - c.fuel));
    c.fuel += add;
    if (c.damage > 0) {
      const fixedParts = PARTS.filter((p) => c.dmg[p.id] > 0 && c.repair[p.id]);
      if (fixedParts.length) {
        const dmg = { ...c.dmg };
        for (const p of fixedParts) dmg[p.id] = 0;
        c.dmg = dmg;
        c.damage = PARTS.reduce((a, p) => a + dmg[p.id], 0);
        this.damageWarned.delete(c.id);
        this.log(`${c.driver.short}: trocado (${fixedParts.map((p) => p.label.toLowerCase()).join(", ")}).`, c.isHuman, c.team.id, "info");
      }
    }
    c.compound = next;
    c.wear = 0;
    c.tyreLaps = 0;
    c.tyreWarn = 0;
    c.fuelWarn = 0;
    c.wetWarn = 0;
    if (!c.usedCompounds.includes(next)) c.usedCompounds.push(next);
    c.pitStops++;
    // parou na hora (ou perto) da parada planejada: ela foi feita
    const planned = c.plan[c.planIdx];
    if (planned && (c.planDue || planned.lap - c.lap <= 2)) {
      c.planIdx++;
      c.planDue = false;
    }
    c.boxRequest = null;
    c.boxFuel = 0;
    c.pit = "leaving";
    const fuelTxt = add >= 1 ? ` e +${Math.round(add)} kg` : "";
    this.log(`${c.driver.name} sai dos boxes: ${COMPOUNDS[next].label}${fuelTxt}`, c.isHuman, c.team.id, "pitout");
  }

  private retire(c: CarState, reason: string) {
    c.retired = true;
    c.retireReason = reason;
    if (reason === "Acidente") this.stats.crashes++;
    c.boxRequest = null;
    c.overtaking = null;
    c.spin = 0;
    if (c.pit !== "none") {
      c.pit = "none";
      c.lateral = 0;
    }
    const msg =
      reason === "Acidente"
        ? `${c.driver.name} bateu! Está fora da corrida.`
        : reason === "Motor"
          ? `${c.driver.name}: o motor quebrou! Fumaça e abandono.`
          : `${c.driver.name} ficou sem combustível! Abandono.`;
    this.log(msg, true, c.isHuman ? c.team.id : undefined, reason === "Acidente" ? "crash" : "out");
  }

  private crossLine(c: CarState) {
    if (c.finished) return;
    c.lap++;
    // instante exato em que cruzou a linha (s já passou um pouco do zero)
    const crossT = this.time - c.s / Math.max(c.v, 1);
    const ts = (this.teleState[c.id] ??= { c: c.compound, stops: c.pitStops });
    if (c.lap >= 1) {
      c.tyreLaps++;
      const lt = crossT - c.lapStartTime;
      (this.telemetry[c.id] ??= []).push({
        t: Math.round(lt * 1000) / 1000,
        p: c.position,
        c: ts.c,
        pit: c.pitStops > ts.stops,
        sc: this.sc.active,
      });
      c.lastLap = lt;
      if (c.bestLap === null || lt < c.bestLap) c.bestLap = lt;
      if (!this.sc.active && (!this.fastestLap || lt < this.fastestLap.time)) {
        this.fastestLap = { carId: c.id, time: lt };
        if (c.lap > 1) this.log(`Volta mais rápida: ${c.driver.name} ${fmtLap(lt)}`, c.isHuman, c.team.id, "fastest");
      }
    }
    ts.c = c.compound;
    ts.stops = c.pitStops;
    c.lapStartTime = crossT;
    c.lapNoise = this.rng.gauss(lapNoiseSd(c.driver));

    const isLeader = c.position === 1 || this.leader() === c;
    if (isLeader && !this.checkered) {
      this.safetyCarLap();
      if (c.lap === this.laps - 1 && !this.lastLapAnnounced) {
        this.lastLapAnnounced = true;
        this.log("ÚLTIMA VOLTA!", true, undefined, "lastlap");
      }
    }

    if (c.lap >= this.laps || this.checkered) {
      if (!this.checkered) {
        this.checkered = true;
        this.checkeredTime = crossT;
        this.sc.active = false;
        this.log(`Bandeira quadriculada! ${c.driver.name} vence!`, true, undefined, "checkered");
      }
      c.finished = true;
      c.finishTime = crossT;
      c.boxRequest = null;
      const usedWet = c.usedCompounds.some(isWetTyre);
      const dryKinds = c.usedCompounds.filter((x) => DRY.includes(x)).length;
      if (!usedWet && dryKinds < 2) {
        c.penalty = MANDATORY_PENALTY;
        this.log(`${c.driver.name}: +${MANDATORY_PENALTY}s (não usou 2 compostos)`, true, c.team.id, "penalty");
      }
    }
  }

  private updatePositions() {
    const L = this.track.L;
    const score = (c: CarState) => (c.finished ? c.lap * L : this.dist(c));
    const sorted = [...this.cars].sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      if (a.finished && b.finished) {
        if (a.lap !== b.lap) return b.lap - a.lap;
        return a.finishTime! + a.penalty - (b.finishTime! + b.penalty);
      }
      return score(b) - score(a);
    });
    sorted.forEach((c, i) => (c.position = i + 1));
  }

  private mate(c: CarState): CarState | null {
    return this.cars.find((o) => o !== c && o.team.id === c.team.id) ?? null;
  }

  /** ordens de equipe: "letPass" no carro da frente; "hold" vale pros dois */
  private teamOrder(car: CarState, mode: TeamOrder) {
    const mate = this.mate(car);
    if (!mate || car.retired || car.finished) return;
    const name = (x: CarState) => x.driver.name.split(" ").slice(-1)[0];
    if (mode === "letPass") {
      if (mate.retired || mate.finished || this.dist(mate) >= this.dist(car)) return;
      car.order = "letPass";
      if (mate.order !== "none") mate.order = "none";
      this.log(`Rádio: "${name(car)}, deixa o ${name(mate)} passar."`, true, car.team.id, "radio");
    } else if (mode === "hold") {
      car.order = mate.order = "hold";
      this.log(`Rádio: "Mantenham as posições, sem briga entre vocês."`, true, car.team.id, "radio");
    } else {
      const was = car.order !== "none" || mate.order !== "none";
      car.order = mate.order = "none";
      if (was) this.log(`Rádio: "Estão liberados pra correr."`, true, car.team.id, "radio");
    }
  }

  private onOvertake(c: CarState, o: CarState) {
    if (this.dist(c) - this.dist(o) > this.track.L / 2) return; // retardatário
    this.stats.overtakes++;
    if (c.isHuman || o.isHuman || c.position <= 4) {
      const team = c.isHuman ? c.team.id : o.isHuman ? o.team.id : undefined;
      this.log(`${c.driver.short} passa ${o.driver.short}!`, c.isHuman || o.isHuman, team, "overtake");
    }
  }

  /**
   * O plano só AVISA: na volta marcada o engenheiro lembra no rádio e o box
   * fica sugerido. Quem decide se para é o jogador.
   */
  private followPlan(c: CarState) {
    const stop = c.plan[c.planIdx];
    if (!stop) return;
    // passou da volta planejada sem parar: o aviso expira
    if (c.lap >= stop.lap) {
      c.planIdx++;
      c.planDue = false;
      return;
    }
    if (!c.planDue && c.lap + 1 >= stop.lap && c.pit === "none") {
      c.planDue = true;
      if (this.laps - c.lap <= 1) return;
      this.log(
        `Plano ${c.driver.short}: era pra parar nesta volta (${COMPOUNDS[stop.compound].label}, combustível p/ ${Math.round(stop.fuel / fuelPerLap(this.laps))} voltas). Chamar pro box?`,
        true,
        c.team.id,
        "plan",
      );
    }
  }

  private radio(c: CarState) {
    const say = (txt: string) => this.log(`Rádio ${c.driver.short}: "${txt}"`, true, c.team.id, "radio");
    if (c.engineHealth < 0.45 && !c.engineSave && !this.engineWarned.has(c.id)) {
      this.engineWarned.add(c.id);
      say(`O motor está sofrendo (${Math.round(c.engineHealth * 100)}%). Melhor poupar ou ele pode quebrar.`);
    }
    if (c.damage > 0 && !this.damageWarned.has(c.id)) {
      this.damageWarned.add(c.id);
      const worst = PARTS.reduce((a, p) => (c.dmg[p.id] > c.dmg[a.id] ? p : a), PARTS[0]);
      say(`Problema na ${worst.label.toLowerCase()}! Estamos perdendo uns ${c.damage.toFixed(1)}s por volta. Box pra trocar?`);
    }
    if (c.pit === "none" && !c.boxRequest) {
      if (c.wear > 0.85 && c.tyreWarn < 2) {
        c.tyreWarn = 2;
        say("Os pneus acabaram! Box, box!");
      } else if (c.wear > 0.65 && c.tyreWarn < 1) {
        c.tyreWarn = 1;
        say("Pneus começando a cair.");
      }
      const best = bestForWet(this.wet);
      const onWet = isWetTyre(c.compound);
      if (!onWet && best !== "dry" && c.wetWarn < 1) {
        c.wetWarn = 1;
        say(best === "W" ? "Tem muita água! Precisamos de pneu de chuva!" : "Pista molhada demais pro slick. Intermediários!");
      } else if (onWet && best === "dry" && c.wetWarn < 2) {
        c.wetWarn = 2;
        say("A pista está secando, já dá pra ir de pneu liso.");
      } else if (c.compound === "I" && best === "W" && c.wetWarn < 3) {
        c.wetWarn = 3;
        say("Muita água pro intermediário, quero o de chuva!");
      }
    }
    const fuelLaps = c.fuel / this.consumption(c);
    const left = this.lapsLeft(c);
    if (!c.boxRequest && fuelLaps < left) {
      if (fuelLaps < 1.3 && c.fuelWarn < 2) {
        c.fuelWarn = 2;
        say("Combustível no fim! Box agora ou a gente para!");
      } else if (c.fuelWarn < 1 && fuelLaps < 3) {
        c.fuelWarn = 1;
        say(`Combustível só pra mais ${fuelLaps.toFixed(1)} voltas.`);
      }
    }
  }

  // ---------- IA ----------

  private planAi(c: CarState) {
    const N = this.laps;
    const q = this.quality(c.team.id);
    const r = this.rng.next();
    const j = () => Math.round(this.rng.gauss(N * 0.04 * (1 + (1 - q) * 1.5)));
    if (r < 0.4) {
      c.aiCompounds = ["M", "H"];
      c.aiPlan = [Math.round(N * 0.42) + j()];
    } else if (r < 0.6) {
      c.aiCompounds = ["H", "M"];
      c.aiPlan = [Math.round(N * 0.58) + j()];
    } else if (r < 0.85) {
      c.aiCompounds = ["S", "M", "M"];
      c.aiPlan = [Math.round(N * 0.3) + j(), Math.round(N * 0.65) + j()];
    } else {
      c.aiCompounds = ["S", "H"];
      c.aiPlan = [Math.round(N * 0.35) + j()];
    }
  }

  private aiStartCompound(c: CarState): Compound {
    const best = bestForWet(this.wet);
    return best === "dry" ? c.aiCompounds[0] : best;
  }

  /** slick pra colocar sabendo quantas voltas faltam */
  private aiDryFor(lapsLeft: number): Compound {
    const share = lapsLeft / this.laps;
    return share > 0.5 ? "H" : share > 0.28 ? "M" : "S";
  }

  /** combustível pra ir da volta `fromLap` até `toLap`; engenheiro bom põe margem certa */
  private aiStintFuel(c: CarState, fromLap: number, toLap: number): number {
    const laps = Math.max(0, toLap - Math.max(0, fromLap));
    const margin = 1.01 + 0.05 * this.quality(c.team.id);
    return clampFuel(fuelPerLap(this.laps) * laps * margin + 1.5);
  }

  private aiThink(c: CarState) {
    const q = this.quality(c.team.id);
    const lapsLeft = this.laps - c.lap;
    const cons = this.consumption(c);
    const fuelLaps = c.fuel / cons;
    const nextPlanned = c.aiPlan[c.pitStops];
    const stintEnd = nextPlanned !== undefined && nextPlanned < this.laps ? nextPlanned : this.laps;

    // mistura do motor: economiza se não for chegar
    const lapsToEnd = stintEnd - c.lap - this.track.wrap(c.s) / this.track.L;
    c.engine = fuelLaps < lapsToEnd - 0.05 ? "lean" : "normal";
    c.engineSave = c.engineHealth < 0.38 + 0.15 * q;

    if (c.pit !== "none" || c.boxRequest) return;

    // clima: troca se o pneu certo ganhar bastante tempo (engenheiro ruim demora a reagir)
    const best = bestForWet(this.wet);
    // temporal forte chegando: engenheiro bom já vai direto pro pneu de chuva
    const want: Compound = best === "dry" ? this.aiDryFor(lapsLeft) : best === "I" && this.rain > 0.75 && q > 0.5 ? "W" : best;
    const current = isWetTyre(c.compound) ? c.compound : "dry";
    const threshold = 1.0 + (1 - q) * 2.5;
    const gain = wetPenalty(c.compound, this.wet) - wetPenalty(want, this.wet);
    // histerese: não fica trocando de pneu toda volta quando a pista está no meio-termo
    const trend = best === "dry" ? this.rain === 0 : this.rain > 0 || this.wet > 0.35;
    const weatherSwap = current !== best && gain > threshold && lapsLeft > 1 && trend && (c.tyreLaps >= 2 || gain > 4);

    const nextIdx = c.pitStops + 1;
    const plannedDry =
      c.aiCompounds[nextIdx] ?? (c.usedCompounds.includes("M") ? (c.usedCompounds.includes("H") ? "S" : "H") : "M");
    const nextCompound: Compound = weatherSwap || best !== "dry" ? want : plannedDry;

    const needsRule = !c.usedCompounds.some(isWetTyre) && c.usedCompounds.filter((x) => DRY.includes(x)).length < 2;
    const wornOut = c.wear > 0.8 && lapsLeft > 2;
    const planDue = best === "dry" && nextPlanned !== undefined && c.lap + 1 >= nextPlanned && (lapsLeft > 3 || needsRule);
    const lastChance = needsRule && lapsLeft <= 2;
    const lowFuel = fuelLaps < 1.6 && fuelLaps < this.lapsLeft(c);
    const damaged = c.damage > 0.5 && lapsLeft > 3;
    // safety car = parada mais barata; engenheiro esperto aproveita
    const scChance =
      this.sc.active && q > 0.35 && lapsLeft > 3 && best === "dry" &&
      ((nextPlanned !== undefined && nextPlanned - c.lap <= this.laps * 0.25) || c.wear > 0.5);
    if (lapsLeft >= 1 && (weatherSwap || wornOut || planDue || lastChance || lowFuel || scChance || damaged)) {
      const after = c.aiPlan[c.pitStops + 1];
      const until = after !== undefined && after > c.lap + 2 ? after : this.laps;
      const atStop = Math.max(0, c.fuel - cons * 0.5);
      c.boxRequest = nextCompound;
      c.boxFuel = Math.max(0, Math.ceil(this.aiStintFuel(c, c.lap + 1, until) - atStop));
    }

    if (lapsLeft <= 3 && c.wear < 0.6 && fuelLaps > this.lapsLeft(c) * 1.1) c.pace = "push";
    else if (c.wear > 0.75 && nextPlanned === undefined && lapsLeft > 3) c.pace = "conserve";
    else c.pace = "normal";
  }

  private log(text: string, important: boolean, teamId?: string, kind?: string) {
    this.events.push({ time: this.time, text, important, teamId, kind });
  }
}

function clampFuel(f: number): number {
  return Math.max(1, Math.min(FUEL_MAX, f));
}

export function fmtLap(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
