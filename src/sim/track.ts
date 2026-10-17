// Pista: spline fechada amostrada a cada 1 m, com perfil de velocidade
// (curva limita a velocidade, frenagem/aceleração suavizam).

export interface Vec {
  x: number;
  y: number;
}

export interface TrackDef {
  name: string;
  /** frase curta que aparece na tela inicial */
  blurb: string;
  points: [number, number][];
  targetLength: number;
  /** altura mínima (1..11) antes do carro bater no chão: pista ondulada = alto */
  minHeight: number;
  /** diferença ideal asa dianteira - traseira (equilíbrio do carro) */
  balance: number;
  /** chance de chover na corrida (0..1) */
  rainChance: number;
  grass: [string, string];
}

export const TRACK_WIDTH = 18;
export const PIT_LATERAL = TRACK_WIDTH / 2 + 10;
/** lateral (beira da pista, lado do box) onde o carro entra/sai do pit lane */
export const PIT_MERGE = TRACK_WIDTH / 2 - 3;
/** a vaga da garagem fica ao lado do pit lane, pra quem passa não atravessar quem está parado */
export const BOX_SHIFT = 3;

export const CIRCUITS: TrackDef[] = [
  {
    name: "Autódromo Costa Azul",
    blurb: "Equilibrado: retas boas e curvas de média. Asfalto com algumas ondulações.",
    targetLength: 4600,
    minHeight: 4,
    balance: 0,
    rainChance: 0.35,
    grass: ["#3d8a3a", "#418f3d"],
    points: [
      [0, 0], [300, 0], [600, 0], [900, 0], [1050, 20], [1100, 150], [1000, 260],
      [850, 280], [750, 380], [800, 520], [950, 600], [1150, 620], [1300, 700],
      [1280, 850], [1100, 900], [700, 900], [350, 900], [150, 860], [80, 760],
      [180, 620], [120, 500], [-60, 450], [-200, 330], [-200, 150], [-120, 30],
    ],
  },
  {
    name: "Circuito Serra Verde",
    blurb: "Travado e ondulado, no meio da serra. Pede muita asa e carro alto. Chove bastante.",
    targetLength: 4100,
    minHeight: 7,
    balance: 1,
    rainChance: 0.6,
    grass: ["#2f7a35", "#34823a"],
    points: [
      [0, 0], [300, 0], [600, 0], [720, 40], [760, 140], [680, 240], [580, 260],
      [520, 340], [580, 440], [720, 460], [840, 400], [920, 300], [1020, 280],
      [1100, 360], [1080, 500], [960, 600], [760, 640], [560, 620], [420, 560],
      [360, 460], [260, 420], [120, 400], [-20, 340], [-80, 220], [-60, 90],
    ],
  },
  {
    name: "Anel Veloz Delta",
    blurb: "Retas enormes e curvas rápidas. Pouca asa é o segredo. Asfalto liso, quase não chove.",
    targetLength: 5200,
    minHeight: 2,
    balance: -1,
    rainChance: 0.15,
    grass: ["#4a8f3a", "#4f963f"],
    points: [
      [0, 0], [500, 0], [1000, 0], [1400, 0], [1600, 60], [1660, 250], [1560, 420],
      [1300, 480], [1180, 470], [1120, 530], [1000, 540], [600, 540], [300, 540],
      [100, 500], [0, 400], [-40, 250], [-60, 120], [-30, 30],
    ],
  },
];

const BRAKE = 40;

/** perfil padrão (acerto médio), usado quando não importa o carro */
export const DEFAULT_PHYS = { latAcc: 36, vmax: 90 };

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function sampleSpline(ctrl: Vec[], stepsPerSeg = 200): Vec[] {
  const out: Vec[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < stepsPerSeg; k++) out.push(catmull(p0, p1, p2, p3, k / stepsPerSeg));
  }
  return out;
}

function polyLength(pts: Vec[]): number {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

function resample(pts: Vec[], step: number): Vec[] {
  const out: Vec[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += step;
    }
    carry = seg - (d - step);
  }
  // remove ponto duplicado no fechamento
  const last = out[out.length - 1];
  if (Math.hypot(last.x - out[0].x, last.y - out[0].y) < step * 0.5) out.pop();
  return out;
}

function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export interface Profile {
  v: Float32Array;
  lap: number;
  top: number;
}

export class Track {
  readonly def: TrackDef;
  name: string;
  pts: Vec[] = [];
  heading: number[] = [];
  curvature: number[] = [];
  /** perfil com acerto médio */
  vProfile: Float32Array;
  L = 0;
  /** tempo de volta ideal seguindo o perfil médio */
  idealLap = 0;
  pitEntryS = 0;
  pitExitS = 0;
  pitBoxStart = 0;
  pitBoxEnd = 0;
  mainStraight: [number, number] = [0, 0];
  private profiles = new Map<string, Profile>();

  constructor(def: TrackDef) {
    this.def = def;
    this.name = def.name;
    let ctrl = def.points.map(([x, y]) => ({ x, y }));
    const rawLen = polyLength(sampleSpline(ctrl));
    const k = def.targetLength / rawLen;
    ctrl = ctrl.map((p) => ({ x: p.x * k, y: p.y * k }));
    let pts = resample(sampleSpline(ctrl), 1);

    let { heading, curvature } = this.computeGeometry(pts);
    // largada no meio da maior reta
    const run = this.longestStraight(curvature);
    const startIdx = Math.floor(run[0] + (run[1] - run[0]) * 0.55) % pts.length;
    pts = pts.slice(startIdx).concat(pts.slice(0, startIdx));
    ({ heading, curvature } = this.computeGeometry(pts));

    this.pts = pts;
    this.heading = heading;
    this.curvature = curvature;
    this.L = pts.length;

    const runLen = run[1] - run[0];
    this.mainStraight = [this.L - runLen * 0.55, runLen * 0.45];
    this.pitEntryS = this.L - runLen * 0.5;
    this.pitExitS = runLen * 0.42;
    this.pitBoxStart = this.L - runLen * 0.28;
    this.pitBoxEnd = runLen * 0.2;

    const p = this.profile(DEFAULT_PHYS.latAcc, DEFAULT_PHYS.vmax);
    this.vProfile = p.v;
    this.idealLap = p.lap;
  }

  private computeGeometry(pts: Vec[]) {
    const n = pts.length;
    const heading: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 2 + n) % n], b = pts[(i + 2) % n];
      heading[i] = Math.atan2(b.y - a.y, b.x - a.x);
    }
    const W = 12;
    const curvature: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      curvature[i] = angDiff(heading[(i - W + n) % n], heading[(i + W) % n]) / (2 * W);
    }
    return { heading, curvature };
  }

  private longestStraight(curv: number[]): [number, number] {
    const n = curv.length;
    let best: [number, number] = [0, 0];
    let start = -1;
    for (let i = 0; i < n * 2; i++) {
      const straight = Math.abs(curv[i % n]) < 0.0015;
      if (straight && start < 0) start = i;
      if ((!straight || i === n * 2 - 1) && start >= 0) {
        if (i - start > best[1] - best[0] && i - start < n) best = [start, i];
        start = -1;
      }
    }
    return best;
  }

  /** perfil de velocidade para uma aderência lateral e velocidade máxima (com cache) */
  profile(latAcc: number, vmax: number): Profile {
    const key = `${latAcc.toFixed(3)}|${vmax.toFixed(3)}`;
    const hit = this.profiles.get(key);
    if (hit) return hit;
    const n = this.L;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt(latAcc / Math.max(Math.abs(this.curvature[i]), 1e-6)));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const nx = v[(i + 1) % n];
        v[i] = Math.min(v[i], Math.sqrt(nx * nx + 2 * BRAKE));
      }
      for (let i = 0; i < n; i++) {
        const pv = v[(i - 1 + n) % n];
        const acc = Math.max(2, 14 * (1 - pv / (vmax + 6)));
        v[i] = Math.min(v[i], Math.sqrt(pv * pv + 2 * acc));
      }
    }
    let lap = 0, top = 0;
    for (let i = 0; i < n; i++) {
      lap += 1 / v[i];
      if (v[i] > top) top = v[i];
    }
    const p = { v, lap, top };
    this.profiles.set(key, p);
    return p;
  }

  wrap(s: number): number {
    return ((s % this.L) + this.L) % this.L;
  }

  speedAt(s: number): number {
    return this.vProfile[Math.floor(this.wrap(s)) % this.L];
  }

  isStraight(s: number): boolean {
    return this.speedAt(s) > 72;
  }

  pose(s: number, lateral: number): { x: number; y: number; h: number } {
    s = this.wrap(s);
    const i = Math.floor(s) % this.L;
    const j = (i + 1) % this.L;
    const t = s - Math.floor(s);
    const a = this.pts[i], b = this.pts[j];
    const h = this.heading[i] + angDiff(this.heading[i], this.heading[j]) * t;
    const x = a.x + (b.x - a.x) * t - Math.sin(h) * lateral;
    const y = a.y + (b.y - a.y) * t + Math.cos(h) * lateral;
    return { x, y, h };
  }

  /** deslocamento lateral do pit lane em s (rampas na entrada/saída) */
  pitLateralAt(s: number): number {
    const ramp = 70;
    const d1 = this.wrap(s - this.pitEntryS);
    const d2 = this.wrap(this.pitExitS - s);
    const k = Math.min(1, d1 / ramp, d2 / ramp);
    return PIT_MERGE + (PIT_LATERAL - PIT_MERGE) * Math.max(0, k);
  }
}

const trackCache = new Map<number, Track>();
export function getTrack(index: number): Track {
  let t = trackCache.get(index);
  if (!t) {
    t = new Track(CIRCUITS[index] ?? CIRCUITS[0]);
    trackCache.set(index, t);
  }
  return t;
}
