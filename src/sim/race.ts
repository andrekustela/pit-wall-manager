import { TEAMS } from "./data";
import { buildEntrants, type Engineer } from "./entrants";
import { Rng } from "./rng";
import { Track, getTrack } from "./track";
import { BASE_SLACK, aiTuning, carProfile, clampTuning } from "./tuning";
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
  type Tuning,
} from "./types";
import { makeWeather, rainAt, type WeatherPlan } from "./weather";

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
}

export type RacePhase = "lights" | "racing" | "finished";

const REF_LAPS = 30; // desgaste é escalado pra corrida "parecer" ter 30 voltas
const PIT_SPEED = 22; // m/s (~80 km/h)
const MANDATORY_PENALTY = 30;
const CRASH_RATE = 1.4e-5; // por carro por segundo, no seco
const COOLDOWN_TIMEOUT = 260; // s depois da bandeirada

/** consumo por volta em modo normal */
export function fuelPerLap(laps: number): number {
  return RACE_FUEL / laps;
}

/** campos do carro que mudam durante a corrida (vão no snapshot da rede) */
const SNAP_KEYS = [
  "s", "lap", "v", "lateral", "compound", "wear", "tyreLaps", "usedCompounds", "fuel", "engine", "pace",
  "boxRequest", "boxFuel", "pit", "pitTimer", "pitStops", "lastLap", "bestLap", "finished", "finishTime",
  "retired", "retireReason", "spin", "position", "penalty", "targetLap", "isHuman", "plan", "planIdx", "planDue",
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
      const tuning = clampTuning(opts.tunings?.[id] ?? aiTuning(this.track, this.quality(team.id), this.rng));
      const prof = carProfile(this.track, tuning);
      const setup = opts.setups[id];
      const car: CarState = {
        id: d.id,
        driver: d,
        team,
        isHuman,
        s: this.track.L - 14 - i * 8,
        lap: -1,
        v: 0,
        lateral: i % 2 === 0 ? -3 : 3,
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
        position: i + 1,
        penalty: 0,
        targetLap: 0,
        launch: this.rng.range(0.82, 1.12),
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
        if (PACE[cmd.mode]) car.pace = cmd.mode;
        break;
      case "engine":
        if (ENGINE[cmd.mode]) car.engine = cmd.mode;
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
      const launching = this.dist(c) < 250;
      const accMax = Math.max(2, 13 * (1 - c.v / 100)) * (launching ? c.launch : 1) * (1 - this.wet * 0.3);
      if (target > c.v) c.v = Math.min(target, c.v + accMax * dt);
      else c.v = Math.max(target, c.v - (c.spin > 0 ? 70 : 45) * dt);

      const prevS = c.s;
      const ds = c.v * dt;
      c.s += ds;

      if (!c.finished) {
        // combustível
        c.fuel -= (ds / L) * this.consumption(c);
        if (c.fuel <= 0) {
          c.fuel = 0;
          this.retire(c, "Sem combustível");
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

      if (c.pit === "none") {
        if (c.spin > 0) c.lateralTarget = -9;
        else if (c.finished) c.lateralTarget = 4; // abre caminho pra quem ainda corre
        else if (!c.overtaking) c.lateralTarget = 0;
        const dl = c.lateralTarget - c.lateral;
        c.lateral += Math.max(-3 * dt, Math.min(3 * dt, dl));
      }

      if (c.s >= L) {
        c.s -= L;
        this.crossLine(c);
      }

      // trace pra cálculo de gap
      const bucket = Math.floor(this.dist(c) / 25);
      if (!this.trace.has(bucket) && !c.finished) this.trace.set(bucket, this.time);
    }

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
      c.team.carPace + c.driver.skill + spec.offset + wetPenalty(c.compound, this.wet) + wearPen + fuel +
      PACE[c.pace].offset + ENGINE[c.engine].offset + c.lapNoise + cold
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

  private resolveTraffic(targets: Map<string, number>) {
    const L = this.track.L;
    const sc = this.sc;
    const obstacle = (o: CarState) => o.pit === "none" && !o.retired && o.spin <= 0 && !o.finished;
    for (const c of this.cars) {
      if (c.pit !== "none" || c.finished || c.retired || c.spin > 0) continue;
      let ahead: CarState | null = null;
      let gap = Infinity;
      for (const o of this.cars) {
        if (o === c || !obstacle(o)) continue;
        const g = this.track.wrap(o.s - c.s);
        if (g > 0 && g < 45 && g < gap) {
          gap = g;
          ahead = o;
        }
      }

      // safety car: fila indiana, ninguém passa
      if (sc.active) {
        c.overtaking = null;
        const myT = targets.get(c.id)!;
        if (sc.onTrack) {
          const g = this.track.wrap(sc.s - c.s);
          if (g < 60 && g < gap) {
            targets.set(c.id, Math.min(myT, g < 35 ? sc.v * 0.95 : sc.v + 4));
            continue;
          }
        }
        if (ahead && gap < 30) targets.set(c.id, Math.min(myT, gap < 14 ? ahead.v * 0.95 : ahead.v + 3));
        continue;
      }

      if (c.overtaking) {
        const o = this.cars.find((x) => x.id === c.overtaking)!;
        const behindBy = this.track.wrap(o.s - c.s);
        // passou (o outro ficou 10 m atrás) ou desistiu
        const passed = behindBy > L / 2 && behindBy < L - 10;
        const fellBack = behindBy > 30 && behindBy <= L / 2;
        if (passed || fellBack || !obstacle(o)) {
          if (passed && !o.finished) this.onOvertake(c, o);
          c.overtaking = null;
        } else {
          targets.set(c.id, targets.get(c.id)! * 1.012); // vácuo
          continue;
        }
      }

      if (!ahead || gap > 16) continue;
      const myT = targets.get(c.id)!;
      const theirV = ahead.v;
      if (myT <= theirV) continue;

      const lapped = this.dist(ahead) < this.dist(c) - L / 2;
      const side = ahead.lateral > 0 ? -3.6 : 3.6;
      if (lapped) {
        c.overtaking = ahead.id;
        c.lateralTarget = side;
        continue;
      }

      if (this.track.isStraight(c.s) && this.dist(c) >= c.nextAttemptS) {
        const delta = ahead.targetLap - c.targetLap;
        // na chuva o spray atrapalha: ultrapassar fica mais difícil
        const p = Math.max(0.03, Math.min(0.85, 0.12 + delta * 0.5 + (gap < 10 ? 0.08 : 0) - this.wet * 0.06));
        c.nextAttemptS = this.dist(c) + 450;
        if (this.rng.chance(p)) {
          c.overtaking = ahead.id;
          c.lateralTarget = side;
          continue;
        }
        // disputa que deu errado: toque
        if (this.rng.chance(0.003 + this.wet * 0.012)) {
          const victim = this.rng.chance(0.5) ? c : ahead;
          this.log(`Toque entre ${c.driver.short} e ${ahead.driver.short}!`, c.isHuman || ahead.isHuman, undefined, "crash");
          if (this.rng.chance(0.35)) {
            this.retire(victim, "Acidente");
            if (!this.sc.active && this.lapsLeft(this.leader()) > 2 && this.rng.chance(0.75)) this.deploySafetyCar();
          } else victim.spin = this.rng.range(3, 6);
          continue;
        }
      }

      if (Math.abs(c.lateral - ahead.lateral) < 2.8 || gap < 7) {
        targets.set(c.id, Math.min(myT, gap < 9 ? theirV * 0.97 : theirV));
      }
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
    c.lateral = t.pitLateralAt(c.s);
    if (c.pit === "entering") {
      const remaining = t.wrap(this.boxS(c) - c.s);
      if (remaining < 0.6 || remaining > t.L - 5) {
        c.s = this.boxS(c);
        c.v = 0;
        c.lateral = t.pitLateralAt(c.s);
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
        c.pitTimer = Math.max(tyres, refuel) + (mate ? mate.pitTimer + 0.8 : 0);
      }
    } else if (c.pit === "leaving") {
      if (t.wrap(t.pitExitS - prevS) <= ds) {
        c.pit = "none";
        c.lateral = 0;
        c.lateralTarget = 0;
      }
    }
  }

  private finishStop(c: CarState) {
    const next = c.boxRequest ?? c.compound;
    const add = Math.max(0, Math.min(c.boxFuel, FUEL_MAX - c.fuel));
    c.fuel += add;
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
    c.boxRequest = null;
    c.overtaking = null;
    c.spin = 0;
    if (c.pit !== "none") {
      c.pit = "none";
      c.lateral = 0;
    }
    const msg = reason === "Acidente" ? `${c.driver.name} bateu! Está fora da corrida.` : `${c.driver.name} ficou sem combustível! Abandono.`;
    this.log(msg, true, c.isHuman ? c.team.id : undefined, reason === "Acidente" ? "crash" : "out");
  }

  private crossLine(c: CarState) {
    if (c.finished) return;
    c.lap++;
    // instante exato em que cruzou a linha (s já passou um pouco do zero)
    const crossT = this.time - c.s / Math.max(c.v, 1);
    if (c.lap >= 1) {
      c.tyreLaps++;
      const lt = crossT - c.lapStartTime;
      c.lastLap = lt;
      if (c.bestLap === null || lt < c.bestLap) c.bestLap = lt;
      if (!this.sc.active && (!this.fastestLap || lt < this.fastestLap.time)) {
        this.fastestLap = { carId: c.id, time: lt };
        if (c.lap > 1) this.log(`Volta mais rápida: ${c.driver.name} ${fmtLap(lt)}`, c.isHuman, c.team.id, "fastest");
      }
    }
    c.lapStartTime = crossT;
    c.lapNoise = this.rng.gauss(0.22);

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

  private onOvertake(c: CarState, o: CarState) {
    if (this.dist(c) - this.dist(o) > this.track.L / 2) return; // retardatário
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

    if (c.pit !== "none" || c.boxRequest) return;

    // clima: troca se o pneu certo ganhar bastante tempo (engenheiro ruim demora a reagir)
    const best = bestForWet(this.wet);
    const want: Compound = best === "dry" ? this.aiDryFor(lapsLeft) : best;
    const current = isWetTyre(c.compound) ? c.compound : "dry";
    const threshold = 1.0 + (1 - q) * 2.5;
    const weatherSwap = current !== best && wetPenalty(c.compound, this.wet) - wetPenalty(want, this.wet) > threshold && lapsLeft > 1;

    const nextIdx = c.pitStops + 1;
    const plannedDry =
      c.aiCompounds[nextIdx] ?? (c.usedCompounds.includes("M") ? (c.usedCompounds.includes("H") ? "S" : "H") : "M");
    const nextCompound: Compound = weatherSwap || best !== "dry" ? want : plannedDry;

    const needsRule = !c.usedCompounds.some(isWetTyre) && c.usedCompounds.filter((x) => DRY.includes(x)).length < 2;
    const wornOut = c.wear > 0.8 && lapsLeft > 2;
    const planDue = best === "dry" && nextPlanned !== undefined && c.lap + 1 >= nextPlanned && (lapsLeft > 3 || needsRule);
    const lastChance = needsRule && lapsLeft <= 2;
    const lowFuel = fuelLaps < 1.6 && fuelLaps < this.lapsLeft(c);
    // safety car = parada mais barata; engenheiro esperto aproveita
    const scChance =
      this.sc.active && q > 0.35 && lapsLeft > 3 && best === "dry" &&
      ((nextPlanned !== undefined && nextPlanned - c.lap <= this.laps * 0.25) || c.wear > 0.5);
    if (lapsLeft >= 1 && (weatherSwap || wornOut || planDue || lastChance || lowFuel || scChance)) {
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
