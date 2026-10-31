// Sons sintetizados com Web Audio (sem arquivos): motor estilo F1 do carro
// seguido (com marchas, turbo e estalos), carros passando perto, chuva,
// torcida e efeitos (largada, rádio, pit, batida, safety car, bandeirada).
import { storeGet, storeSet } from "../ui/common";
import type { Race } from "../sim/race";
import type { CarState, RaceEvent } from "../sim/types";
import { teamVoice } from "./voice";

/** velocidade (m/s) a 12.000 rpm em cada marcha */
const GEAR_TOP = [22, 32, 41, 50, 59, 68, 78, 94];
const MAX_RPM = 12000;

/** curva de distorção: deixa o som "rasgado" como um motor de verdade */
function driveCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** cada equipe com um tom de motor um pouco diferente (até ~6%), pra distinguir quem passa */
function teamTone(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 0.94 + ((Math.abs(h) % 13) / 12) * 0.12;
}

/** grupos de volume (mixer): o jogador ajusta cada um; música fica no player */
export type MixGroup = "motor" | "ambiente" | "efeitos" | "radio" | "musica";
export const MIX_GROUPS: { id: MixGroup; label: string }[] = [
  { id: "motor", label: "Motores" },
  { id: "ambiente", label: "Torcida e chuva" },
  { id: "efeitos", label: "Efeitos" },
  { id: "radio", label: "Rádio" },
  { id: "musica", label: "Música" },
];

/** uma "voz" de motor: harmônicos + distorção + filtro + assobio do turbo */
class EngineVoice {
  private oscs: OscillatorNode[] = [];
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private pan: StereoPannerNode;
  private turbo: OscillatorNode;
  private turboGain: GainNode;
  gear = 0;
  private prevV = 0;
  private cut = 0; // corte de ignição na troca de marcha
  private carId = "";

  constructor(private ctx: AudioContext, out: AudioNode, private noise: (dur: number, vol: number, freq: number) => void) {
    const mix = ctx.createGain();
    mix.gain.value = 0.25;
    // fundamental (dente de serra) + harmônicos: o V6 turbo tem som "zumbido-grito"
    const parts: [OscillatorType, number, number][] = [
      ["sawtooth", 1, 0.9],
      ["sawtooth", 2, 0.5],
      ["square", 0.5, 0.35],
      ["sawtooth", 3.01, 0.25],
    ];
    for (const [type, mult, vol] of parts) {
      const o = ctx.createOscillator();
      o.type = type;
      (o as OscillatorNode & { mult: number }).mult = mult;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g).connect(mix);
      o.start();
      this.oscs.push(o);
    }
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(6) as Float32Array<ArrayBuffer>;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 110;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 2.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    mix.connect(shaper).connect(hp).connect(this.filter).connect(this.gain).connect(this.pan).connect(out);

    this.turbo = ctx.createOscillator();
    this.turbo.type = "sine";
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.pan);
    this.turbo.start();
  }

  /** atualiza a partir do estado do carro; vol 0..1, pan -1..1, doppler = multiplicador de frequência */
  update(car: CarState | null, dt: number, vol: number, pan = 0, doppler = 1) {
    const t = this.ctx.currentTime;
    if (!car || vol <= 0.001) {
      this.gain.gain.setTargetAtTime(0, t, 0.08);
      this.turboGain.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    if (car.id !== this.carId) {
      // trocou de carro: escolhe a marcha certa pra velocidade
      this.carId = car.id;
      this.gear = Math.max(0, GEAR_TOP.findIndex((top) => car.v < top * 0.92));
      this.prevV = car.v;
    }
    const v = car.v;
    const accel = dt > 0 ? (v - this.prevV) / dt : 0;
    this.prevV = v;
    let rpm = (v / GEAR_TOP[this.gear]) * MAX_RPM;
    if (rpm > 11600 && this.gear < GEAR_TOP.length - 1) {
      this.gear++;
      this.cut = 0.05;
    } else if (rpm < 7400 && this.gear > 0) {
      this.gear--;
      // redução com o carro freando: estouro no escapamento
      if (accel < -5 && Math.random() < 0.7) this.noise(0.05, 0.05 * vol, 1800);
    }
    rpm = Math.max(v < 2 ? 4200 : 6000, Math.min(MAX_RPM, (v / GEAR_TOP[this.gear]) * MAX_RPM));
    const throttle = accel > -4 ? 1 : 0.25;
    this.cut = Math.max(0, this.cut - dt);

    const base = (rpm / 60) * 1.5 * doppler * teamTone(car.team.id); // ~150 a 300 Hz (cada equipe com seu tom)
    for (const o of this.oscs) o.frequency.setTargetAtTime(base * (o as OscillatorNode & { mult: number }).mult, t, 0.015);
    const rf = rpm / MAX_RPM;
    this.filter.frequency.setTargetAtTime(700 + throttle * rf * rf * 5200, t, 0.03);
    const g = (this.cut > 0 ? 0.25 : 1) * vol * (throttle > 0.5 ? 0.55 + rf * 0.45 : 0.3);
    this.gain.gain.setTargetAtTime(g * 0.22, t, 0.02);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
    this.turbo.frequency.setTargetAtTime((2600 + rf * 3200) * doppler, t, 0.05);
    this.turboGain.gain.setTargetAtTime(throttle > 0.5 ? rf * 0.006 * vol : 0, t, 0.1);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, t, 0.05);
    this.turboGain.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      this.oscs.forEach((o) => o.stop());
      this.turbo.stop();
      this.pan.disconnect();
    }, 300);
  }
}

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** grupos: o nível do jogador (mix) e, pra motor/ambiente, um abaixador quando o rádio fala */
  private bus!: Record<Exclude<MixGroup, "musica">, GainNode>;
  private duck!: GainNode;
  mix: Record<MixGroup, number> = (() => {
    const d: Record<MixGroup, number> = { motor: 1, ambiente: 1, efeitos: 1, radio: 1, musica: 1 };
    try {
      return { ...d, ...(JSON.parse(storeGet("pwm.mix") || "{}") as Partial<Record<MixGroup, number>>) };
    } catch {
      return d;
    }
  })();
  private crowdBoost = 0;
  private main: EngineVoice | null = null;
  private passBy: EngineVoice | null = null;
  private passDist = new Map<string, number>();
  private rain: { gain: GainNode } | null = null;
  private crowd: { gain: GainNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lightsShown = -1;
  private lastT = 0;
  muted = storeGet("pwm.mute") === "1";
  volume = Number(storeGet("pwm.vol") || 0.7);
  private listeners = new Set<() => void>();

  constructor() {
    // aba minimizada: o navegador para de desenhar a página, então pausa o som
    // em vez de deixar o motor travado numa nota
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** o navegador só libera áudio depois de um clique */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.level();
    // compressor evita estourar quando junta tudo
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // motor e ambiente passam pelo "abaixador" (rádio falando); efeitos e rádio vão direto
    this.duck = this.ctx.createGain();
    this.duck.connect(this.master);
    const mk = (to: AudioNode, k: MixGroup) => {
      const g = this.ctx!.createGain();
      g.gain.value = this.mix[k];
      g.connect(to);
      return g;
    };
    this.bus = { motor: mk(this.duck, "motor"), ambiente: mk(this.duck, "ambiente"), efeitos: mk(this.master, "efeitos"), radio: mk(this.master, "radio") };
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private level() {
    return this.muted ? 0 : this.volume;
  }

  private applyLevel() {
    if (this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
    this.listeners.forEach((f) => f());
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** muda o volume de um grupo (0..1) */
  setMix(k: MixGroup, v: number) {
    this.mix[k] = Math.max(0, Math.min(1, v));
    storeSet("pwm.mix", JSON.stringify(this.mix));
    if (this.ctx && k !== "musica") this.bus[k].gain.setTargetAtTime(this.mix[k], this.ctx.currentTime, 0.05);
    this.listeners.forEach((f) => f());
  }

  /** rádio falando: motor e ambiente baixam (~8 dB) e voltam devagar no fim */
  duckFor(seconds: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.4, t, 0.05);
    g.setTargetAtTime(1, t + seconds + 0.15, 0.25);
  }

  toggleMute() {
    this.muted = !this.muted;
    storeSet("pwm.mute", this.muted ? "1" : "0");
    this.applyLevel();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    storeSet("pwm.vol", String(this.volume));
    if (this.volume > 0 && this.muted) {
      this.muted = false;
      storeSet("pwm.mute", "0");
    }
    this.applyLevel();
  }

  // ---------- sons contínuos da corrida ----------

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  startRace() {
    if (!this.ctx) return;
    const c = this.ctx;
    this.stopRace();
    const noise = (dur: number, vol: number, freq: number) => this.noise(dur, vol, freq);
    this.main = new EngineVoice(c, this.bus.motor, noise);
    this.passBy = new EngineVoice(c, this.bus.motor, noise);

    // chuva: ruído agudo
    const rs = this.noiseSource();
    const rf = c.createBiquadFilter();
    rf.type = "highpass";
    rf.frequency.value = 1800;
    const rg = c.createGain();
    rg.gain.value = 0;
    rs.connect(rf).connect(rg).connect(this.bus.ambiente);
    rs.start();
    this.rain = { gain: rg };

    // torcida/ambiente: ruído grave bem baixinho
    const cs = this.noiseSource();
    const cf = c.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 500;
    cf.Q.value = 0.6;
    const cg = c.createGain();
    cg.gain.value = 0.015;
    cs.connect(cf).connect(cg).connect(this.bus.ambiente);
    cs.start();
    this.crowd = { gain: cg };
    this.lightsShown = -1;
    this.lastT = performance.now();
  }

  stopRace() {
    teamVoice.stop();
    this.main?.stop();
    this.passBy?.stop();
    this.rain?.gain.disconnect();
    this.crowd?.gain.disconnect();
    this.main = null;
    this.passBy = null;
    this.rain = null;
    this.crowd = null;
    this.passDist.clear();
  }

  /** chamado todo frame da corrida */
  update(race: Race, followId: string, speed: number) {
    if (!this.ctx || !this.main) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000) * Math.max(1, speed);
    this.lastT = now;
    const t = this.ctx.currentTime;
    const car = race.cars.find((c) => c.id === followId) ?? null;
    const running = race.phase !== "finished" && speed > 0 && !!car && !car.retired && car.pit !== "parked" && car.pit !== "stopped";
    // em 8x/16x o motor fica mais baixo (senão vira só zumbido)
    const speedVol = speed > 4 ? 0.35 : speed > 2 ? 0.7 : 1;
    this.main.update(running ? car : null, dt, speedVol);

    // carro mais próximo passando (com efeito doppler)
    if (car && running && speed <= 4) {
      const me = race.track.pose(car.s, car.lateral);
      let best: CarState | null = null;
      let bestD = 140;
      for (const o of race.cars) {
        if (o === car || o.retired || o.pit === "parked") continue;
        const p = race.track.pose(o.s, o.lateral);
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        const prev = this.passDist.get(best.id) ?? bestD;
        this.passDist.clear();
        this.passDist.set(best.id, bestD);
        const closing = dt > 0 ? (prev - bestD) / dt : 0; // m/s se aproximando
        const doppler = Math.max(0.8, Math.min(1.25, 343 / (343 - closing)));
        const p = race.track.pose(best.s, best.lateral);
        const pan = Math.cos(me.h) * (p.y - me.y) - Math.sin(me.h) * (p.x - me.x) > 0 ? 0.5 : -0.5;
        this.passBy!.update(best, dt, speedVol * Math.pow(1 - bestD / 140, 2) * 0.7, pan, doppler);
      } else this.passBy!.update(null, dt, 0);
    } else this.passBy!.update(null, dt, 0);

    this.rain!.gain.gain.setTargetAtTime(race.rain * 0.12, t, 0.5);
    // torcida: cresce nas ultrapassagens, na última volta e na bandeirada, e volta devagar
    this.crowdBoost *= Math.exp(-dt / Math.max(1, speed) / 2.5);
    this.crowd!.gain.gain.setTargetAtTime((race.checkered ? 0.06 : 0.015) + this.crowdBoost, t, 0.35);

    // luzes de largada: um bip por luz
    if (race.phase === "lights") {
      const lit = Math.min(5, Math.floor(race.time));
      if (lit !== this.lightsShown && lit > 0) this.beep(440, 0.12, 0.12);
      this.lightsShown = lit;
    }
  }

  // ---------- efeitos ----------

  private env(gain: GainNode, peak: number, attack: number, dur: number) {
    const t = this.ctx!.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private clips = new Map<string, Promise<AudioBuffer | null>>();

  /** fala gravada do rádio, com filtro de rádio (banda estreita + saturação) e chiado por baixo.
   * Resolve com a duração (s), ou null se o arquivo não existir / o áudio estiver travado. */
  async playRadio(url: string): Promise<number | null> {
    if (!this.ctx || !this.noiseBuf) return null;
    // áudio pausado (aba voltou, etc.): tenta retomar antes de desistir
    if (this.ctx.state !== "running") await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    if (this.ctx.state !== "running") return null;
    const c = this.ctx;
    let p = this.clips.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok && /audio|wav|octet/.test(r.headers.get("content-type") ?? "") ? r.arrayBuffer() : null))
        .then((b) => (b ? c.decodeAudioData(b) : null))
        .catch(() => null);
      this.clips.set(url, p);
    }
    const buf = await p;
    if (!buf || this.ctx !== c) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 380;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3300;
    const mid = c.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1800;
    mid.gain.value = 5;
    const sat = c.createWaveShaper();
    sat.curve = driveCurve(6) as Float32Array<ArrayBuffer>;
    const g = c.createGain();
    g.gain.value = 0.55;
    src.connect(hp).connect(lp).connect(mid).connect(sat).connect(g).connect(this.bus.radio);
    this.duckFor(buf.duration + 0.12);
    const t = c.currentTime + 0.12;
    src.start(t);
    // chiado do rádio durante a fala
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 2600;
    const ng = c.createGain();
    ng.gain.value = 0.018;
    n.connect(nf).connect(ng).connect(this.bus.radio);
    n.start(t);
    n.stop(t + buf.duration + 0.05);
    return buf.duration + 0.12;
  }

  beep(freq: number, dur: number, vol = 0.1, type: OscillatorType = "square", delay = 0, group: "efeitos" | "radio" = "efeitos") {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g).connect(this.bus[group]);
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = "bandpass", group: "efeitos" | "radio" = "efeitos") {
    if (!this.ctx || !this.noiseBuf) return;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    src.connect(f).connect(g).connect(this.bus[group]);
    this.env(g, vol, 0.005, dur);
    src.start();
    src.stop(this.ctx.currentTime + dur + 0.05);
  }

  click() {
    this.beep(1200, 0.03, 0.04, "square");
  }

  radio() {
    // abre o rádio: estalo curto + "bip" limpo e agudo (como na transmissão da F1)
    this.noise(0.05, 0.06, 3000, "bandpass", "radio");
    this.beep(1760, 0.09, 0.07, "sine", 0.02, "radio");
    this.beep(3520, 0.05, 0.012, "sine", 0.02, "radio");
  }

  /** fim da fala no rádio: bipe curto */
  radioOut() {
    // fecha o rádio: "bip-bip" descendo + chiado cortando
    this.beep(1760, 0.06, 0.06, "sine", 0, "radio");
    this.beep(1320, 0.08, 0.06, "sine", 0.08, "radio");
    this.noise(0.09, 0.05, 2600, "bandpass", "radio");
  }

  go() {
    this.beep(880, 0.4, 0.12, "square");
  }

  pitWrench() {
    // macaco baixando (pancada grave), as 4 pistolas e um grito curto da equipe soltando o carro
    this.noise(0.22, 0.2, 140, "lowpass");
    for (let i = 0; i < 4; i++) setTimeout(() => this.noise(0.18, 0.12, 3200, "highpass"), 120 + i * 150);
    setTimeout(() => {
      this.noise(0.25, 0.09, 140, "lowpass");
      this.noise(0.3, 0.05, 900, "bandpass");
    }, 820);
  }

  crash() {
    this.noise(0.6, 0.35, 300, "lowpass");
    this.noise(0.25, 0.15, 2500);
  }

  alarm() {
    for (let i = 0; i < 3; i++) {
      this.beep(660, 0.18, 0.08, "triangle", i * 0.4);
      this.beep(990, 0.18, 0.08, "triangle", i * 0.4 + 0.2);
    }
  }

  fanfare() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((n, i) => this.beep(n, 0.25, 0.09, "square", i * 0.14));
  }

  thunderRain() {
    this.noise(1.2, 0.1, 150, "lowpass");
  }

  /** seu carro ganhou (sobe) ou perdeu (desce) posição: dois bipes curtos; no máximo um a cada 0,4 s */
  private posAt = 0;
  position(gained: boolean) {
    const now = performance.now();
    if (now - this.posAt < 400) return;
    this.posAt = now;
    const [a, b] = gained ? [880, 1319] : [659, 440];
    this.beep(a, 0.08, 0.05, "triangle");
    this.beep(b, 0.12, 0.05, "triangle", 0.08);
  }

  /** som pros eventos novos da corrida */
  events(list: RaceEvent[], myTeam: string) {
    for (const e of list) {
      const mine = e.teamId === myTeam;
      // piloto reclamando no rádio (box lento, toque, punição, abandono...)
      if (mine && teamVoice.enabled && e.kind && REACT_KINDS.has(e.kind)) teamVoice.react(e.text);
      switch (e.kind) {
        case "start": this.go(); break;
        case "radio":
        case "plan":
        case "fault": {
          if (!mine) break;
          // rádio falado (com bipe/chiado na voz); desligado, só o bipe
          if (!(teamVoice.enabled && teamVoice.radio(e.text, e.kind))) this.radio();
          break;
        }
        case "pitout": if (mine) this.pitWrench(); break;
        case "crash": this.crash(); this.crowdBoost += 0.05; break;
        case "overtake": this.crowdBoost = Math.min(0.08, this.crowdBoost + 0.025); break;
        case "spin": if (mine) this.noise(0.4, 0.15, 900); break;
        case "sc": this.alarm(); break;
        case "green": this.go(); break;
        case "lastlap": this.beep(1047, 0.15, 0.08, "square"); this.beep(1047, 0.15, 0.08, "square", 0.2); this.crowdBoost += 0.05; break;
        case "checkered": this.fanfare(); break;
        case "rain": this.thunderRain(); break;
        case "fastest": if (mine) this.beep(1568, 0.12, 0.06, "triangle"); break;
        // estratégia que deu certo: arpejo subindo
        case "undercut": if (mine) [784, 988, 1175, 1568].forEach((n, i) => this.beep(n, 0.14, 0.07, "triangle", i * 0.09)); break;
        // seu carro abandonou por quebra: dois tons descendo, graves
        case "out": if (mine) { this.beep(294, 0.3, 0.08, "sawtooth"); this.beep(196, 0.5, 0.08, "sawtooth", 0.28); } break;
      }
    }
  }
}

/** eventos que podem gerar reação do piloto no rádio */
const REACT_KINDS = new Set(["pitin", "penalty", "damage", "spin", "crash", "out", "overtake", "touch"]);

export const sound = new Sound();
teamVoice.volume = () => (sound.muted ? 0 : sound.volume);
teamVoice.beepIn = () => sound.radio();
teamVoice.beepOut = () => sound.radioOut();
teamVoice.playClip = (url) => sound.playRadio(url);
