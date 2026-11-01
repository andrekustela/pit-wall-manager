import { LV_AMOUNT, gfx, setGfx, type Cam3d } from "./gfx";
import { gearOf } from "./gear";
import { BakedWorld, mapSlug } from "./bakedWorld";
import type { CamSpec, CarDraw, PropDraw, RealCars } from "./cars3dReal";
import { drawProp, prop } from "./props";
import { fmtLap, type Race } from "../sim/race";
import { CAR_LEN_M, carImage, type CarImage } from "./carArt";
import { car3dPref, drawCar3d, lookOf, partPiece, type CarLook } from "./car3d";
import { CarFx, type FxEvent } from "./carFx";
import { outerCorner } from "../sim/slidePhysics";
import { groundMap } from "./ground";
import { OnboardCam } from "./onboard";
import { WorldTiles } from "./worldTiles";
import { TRACK_WIDTH, angDiff } from "../sim/track";
import { tr } from "../ui/i18n";

/**
 * Desenha a corrida num canvas de alta resolução: a pista em vetor (em tiles,
 * ver worldVector.ts) e por cima carros, safety car, etiquetas, chuva e luzes.
 * A câmera segue um carro; roda do mouse / +/- dão zoom.
 */
/** pronto do modelo 3D (vem junto do módulo dos carros 3D, carregado sob demanda) */
let realCarsReadyFn: (() => boolean) | null = null;
/** teste: `?camera=tv` (atrás do carro) ou `?camera=iso` (de lado) começa a corrida nessa câmera */
/** pedaço solto de um carro (asa, roda, bico...) ou pneu da barreira: posição, altura, giro, capotada */
type Debris = { img: CarImage | null; node: string; carId: string; c?: string; x: number; y: number; h: number; vx: number; vy: number; spin: number; t: number; z: number; vz: number; tx: number; tz: number; wx: number; wz: number; roll: number; s: number; r: number; born?: number; ghost?: boolean };
/** um estado conhecido de um carro (Renderer.hist) */
type Snap = { t: number; d: number; lat: number; yaw: number; imp: number };
/** estado gravado pro replay: o do Snap + o que muda o desenho (fora da corrida, escorregando, rodando, box, velocidade) */
type RSnap = Snap & { v: number; ret: boolean; sl: string; spin: boolean; pit: string };
/** replay da batida: quanto mais devagar que a corrida ele passa */
const REPLAY_SPEED = 0.45;

/**
 * BANDEIRAS. Amarela: carro escorregando/rodando ou parado fora da corrida esperando o guindaste (dupla quando ele
 * ficou em cima da pista). Azul: retardatário com quem vai colocar volta a menos de 60 m atrás
 */
export function yellowZones(race: Race) {
  const out: { s: number; lat: number; double: boolean }[] = [];
  for (const c of race.cars) {
    const sliding = !!c.slide && c.slide.mode !== "rejoin";
    const stopped = c.retired && c.pit === "none" && c.v < 1;
    if (sliding || stopped) out.push({ s: c.s, lat: c.lateral, double: stopped && Math.abs(c.lateral) < TRACK_WIDTH / 2 + 2 });
  }
  return out;
}
function blueFlagged(race: Race) {
  const out = new Set<string>(), L = race.track.L;
  const run = race.cars.filter((c) => !c.retired && !c.finished && c.pit === "none");
  for (const c of run)
    for (const o of run) {
      if (o === c) continue;
      const ahead = (((o.s - c.s) % L) + L) % L;
      if (ahead < 60 && race.dist(c) > race.dist(o) + L / 2) out.add(o.id);
    }
  return out;
}
/** padrão xadrez da bandeira quadriculada (casas de 5 px) */
let checker: CanvasPattern | null = null;
function checkerPattern(o: CanvasRenderingContext2D) {
  const c = document.createElement("canvas");
  c.width = c.height = 10;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 10, 10);
  g.fillStyle = "#111";
  g.fillRect(0, 0, 5, 5);
  g.fillRect(5, 5, 5, 5);
  return o.createPattern(c, "repeat");
}
/** bandeira tremulando, na tela: mastro de (x, y) até (tx, ty) e o pano (w × h px) saindo do topo */
function drawFlag(o: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, w: number, h: number, color: string, t: number) {
  o.strokeStyle = "#2b2d33";
  o.lineWidth = Math.max(1, w * 0.07);
  o.beginPath();
  o.moveTo(x, y);
  o.lineTo(tx, ty);
  o.stroke();
  // pano: as bordas de cima e de baixo ondulam, mais na ponta solta
  const n = 8, amp = h * 0.16, wave = (u: number) => Math.sin(t * 9 - u * 5) * amp * u;
  o.beginPath();
  for (let i = 0; i <= n; i++) o.lineTo(tx + (w * i) / n, ty + wave(i / n));
  for (let i = n; i >= 0; i--) o.lineTo(tx + (w * i) / n, ty + h + wave(i / n));
  o.closePath();
  o.fillStyle = color === "xadrez" ? (checker ??= checkerPattern(o)) ?? "#fff" : color;
  o.fill();
  o.strokeStyle = "rgba(0,0,0,0.45)";
  o.lineWidth = 1;
  o.stroke();
}
const TILT_CAM = typeof location !== "undefined" && new URLSearchParams(location.search).get("camera");
/** câmera inclinada agora: a do link (?camera=) manda; senão a das configurações (só no modo 3D) */
function tiltMode(): "tv" | "iso" | "piloto" | null {
  // (o link só vale pra começar: trocou a câmera nas configurações ou nas teclas F1-F4, vale a escolhida)
  // (carros 2D ou 2D estilizado: só a de cima)
  if (car3dPref.style !== "real") return null;
  if (urlCam && gfx().cam3d === camAtStart) return urlCam;
  const c = gfx().cam3d;
  // (TV MultiCam: a base é a de lado; quem escolhe o ângulo a cada momento é o Renderer.shotOf)
  return c === "lado" || c === "multicam" ? "iso" : c === "tras" ? "tv" : c === "piloto" ? "piloto" : null;
}
/** TV (MultiCam) ligada: a câmera troca sozinha (largada, chegada, briga, box) */
function multiCam() {
  return car3dPref.style === "real" && (urlCam ? URL_MULTI && gfx().cam3d === camAtStart : gfx().cam3d === "multicam");
}
/** "tv" (atrás do carro) ou "iso" (de lado e de cima) */
const TILT_URL = TILT_CAM === "tv" || TILT_CAM === "iso" || TILT_CAM === "piloto" ? TILT_CAM : TILT_CAM === "multicam" ? "iso" : null;
const URL_MULTI = TILT_CAM === "multicam";
const camAtStart = gfx().cam3d;
let urlCam: "tv" | "iso" | "piloto" | null = TILT_URL;
/** a câmera do 3D que está valendo agora */
export function currentCam3d(): Cam3d {
  const t = tiltMode();
  if (multiCam()) return "multicam";
  return t === "iso" ? "lado" : t === "tv" ? "tras" : t === "piloto" ? "piloto" : "cima";
}
/** troca a câmera do 3D (teclas F1-F4): passa a valer a escolhida, mesmo vindo do link */
export function setCam3d(c: Cam3d) {
  urlCam = null;
  setGfx({ cam3d: c });
}
let realPropReady: ((k: "sc" | "crane") => boolean) | null = null;

/** nuvem macia de água (desenhada uma vez): o spray é feito delas */
let puffCv: HTMLCanvasElement | null = null;
function puff() {
  if (puffCv) return puffCv;
  const c = (puffCv = document.createElement("canvas"));
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, "rgba(232,238,246,1)");
  gr.addColorStop(0.45, "rgba(232,238,246,0.55)");
  gr.addColorStop(1, "rgba(232,238,246,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  return c;
}

export class Renderer {
  private octx: CanvasRenderingContext2D;
  private world: WorldTiles;
  /** a pista já está desenhável? (pra tirar a tela de "preparando a pista") */
  get trackReady(): boolean {
    return this.world.ready;
  }
  private cam = { x: 0, y: 0, ready: false };
  private drops: { x: number; y: number; l: number; v: number; z: number }[] = [];
  /** rajada de vento da chuva (muda o ângulo aos poucos) */
  private gust = 0;
  private screenPos = new Map<string, { x: number; y: number }>();
  private dpr = 1;
  private zoom = 0;
  followId: string;

  /** giro da câmera de lado (rad; 0 = norte pra cima, como no 2D) */
  private isoYaw = 0;
  /** no quadro anterior estava numa câmera inclinada (pra deslizar de volta pra de cima) */
  private wasTilt = false;
  /** mapa 2D gerado do 3D desta pista (se tiver) */
  private baked: BakedWorld | null = null;
  /** já usou uma câmera inclinada nesta corrida */
  private usedTilt = false;
  constructor(private canvas: HTMLCanvasElement, private race: Race, followId: string, onPick: (id: string) => void) {
    this.octx = canvas.getContext("2d")!;
    canvas.style.imageRendering = "auto";
    this.world = new WorldTiles(race.opts.trackIndex);
    this.followId = followId;
    // câmera de lado e câmera piloto: arrastar com o botão direito gira em volta do carro
    {
      let dragX: number | null = null;
      const turns = () => tiltMode() === "iso" || tiltMode() === "piloto";
      canvas.addEventListener("contextmenu", (e) => {
        if (turns()) e.preventDefault();
      });
      canvas.addEventListener("pointerdown", (e) => {
        if (e.button === 2 && turns()) dragX = e.clientX;
        // (câmera piloto: clique esquerdo volta pra frente)
        if (e.button === 0 && tiltMode() === "piloto") this.pilotYaw = 0;
      });
      window.addEventListener("pointermove", (e) => {
        if (dragX === null) return;
        if (tiltMode() === "piloto") this.pilotYaw -= (e.clientX - dragX) * 0.006;
        else this.isoYaw -= (e.clientX - dragX) * 0.008;
        dragX = e.clientX;
      });
      window.addEventListener("pointerup", () => (dragX = null));
    }
    this.resize();
    window.addEventListener("resize", this.resize);
    // na hora que aperta (o carro anda entre apertar e soltar); área de toque generosa
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (this.replay) return this.endReplay();
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: string | null = null;
      let bestD = Math.max(36, CAR_LEN_M * this.m2css() * 1.1);
      for (const [id, p] of this.screenPos) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) onPick(best);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
  }

  destroy() {
    window.removeEventListener("resize", this.resize);
    this.world.destroy();
    this.baked?.destroy();
  }

  /** zoom em passos de 25% */
  setZoom(z: number) {
    this.zoom = Math.max(-4, Math.min(8, z));
  }

  zoomIn() {
    this.setZoom(this.zoom + 1);
  }

  zoomOut() {
    this.setZoom(this.zoom - 1);
  }

  /** metros -> pixels CSS na tela (~200 m visíveis na largura sem zoom) */
  private m2css() {
    return (window.innerWidth / 200) * Math.pow(1.25, this.zoom) * (this.replay ? 1.6 : 1);
  }

  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  };

  /** um estado conhecido do carro (vindo da simulação) */
  /**
   * estados conhecidos de cada carro: distância, lateral e, no carro solto/batido, pra onde o bico aponta (yaw) e
   * quantas batidas na barreira (imp). O yaw também é interpolado: vindo do estado mais novo ele girava aos saltos
   * (até 14° de uma vez) e adiantado da posição — o carro parecia escorregar de lado, pra lá e pra cá
   */
  private hist = new Map<string, Snap[]>();
  private scHist: Snap[] = [];
  private snapT = 0;
  private snapReal = 0;
  private interval = 0.05; // s reais entre estados (média)
  private simSpeed = 1;
  private camFrom: { x: number; y: number; t: number } | null = null;
  private lastFollow = "";

  /**
   * Chamado a cada estado novo da simulação. Guarda um histórico curto de
   * posições; a tela desenha um instantinho atrás e desliza entre dois
   * estados conhecidos (interpolação) — liso, sem tremer e sem voltar.
   */
  onSnapshot(speed: number) {
    const race = this.race;
    const now = performance.now();
    const t = race.time;
    if (t < this.snapT - 1e-6) {
      // o relógio da corrida zerou (largada): recomeça o histórico
      this.hist.clear();
      this.scHist = [];
      this.rbuf.clear();
      this.scRbuf = [];
      this.clock = t;
    }
    const gap = (now - this.snapReal) / 1000;
    if (this.snapReal && gap < 1) this.interval = this.interval * 0.85 + gap * 0.15;
    this.snapReal = now;
    this.snapT = t;
    this.simSpeed = speed;
    for (const c of race.cars) {
      let h = this.hist.get(c.id);
      if (!h) this.hist.set(c.id, (h = []));
      const snap = { t, d: race.dist(c), lat: c.lateral, yaw: c.slide ? c.slide.yaw : (c.restYaw ?? 0), imp: c.impact?.n ?? 0 };
      h.push(snap);
      if (h.length > 6) h.shift();
      let rb = this.rbuf.get(c.id);
      if (!rb) this.rbuf.set(c.id, (rb = []));
      rb.push({ ...snap, v: c.v, ret: c.retired, sl: c.slide?.mode ?? "", spin: c.spin > 0, pit: c.pit });
      while (rb.length && rb[0].t < t - 30) rb.shift();
    }
    if (race.sc.active && race.sc.onTrack) {
      const L = race.track.L;
      const last = this.scHist[this.scHist.length - 1];
      let d = race.sc.s;
      if (last) {
        let delta = race.sc.s - (((last.d % L) + L) % L);
        if (delta < -L / 2) delta += L;
        if (delta > L / 2) delta -= L;
        d = last.d + delta;
      }
      this.scHist.push({ t, d, lat: 0, yaw: 0, imp: 0 });
      if (this.scHist.length > 6) this.scHist.shift();
      this.scRbuf.push({ t, d, lat: 0, yaw: 0, imp: 0 });
      while (this.scRbuf.length && this.scRbuf[0].t < t - 30) this.scRbuf.shift();
    } else this.scHist = [];
  }

  private clock = 0;
  /** atraso do relógio da tela em relação ao alvo, filtrado (segundos reais) */
  private errSm = 0;
  /** velocidade da corrida da última conta do relógio */
  private clockSpeed = 1;

  /**
   * Relógio da tela (tempo de corrida mostrado): anda sozinho no ritmo real e
   * só se ajusta aos poucos pro alvo (um pouco atrás do último estado). Nunca
   * volta — é isso que deixa o movimento liso mesmo com estados chegando
   * adiantados ou atrasados.
   */
  private renderTime(realDt: number): number {
    if (this.race.phase !== "racing" || this.simSpeed === 0 || !this.snapReal) {
      if (this.clock > this.snapT + 1e-6 || this.clock < this.snapT - 2) this.clock = this.snapT;
      return Math.min(this.clock, this.snapT);
    }
    // (folga de 2,5 estados: com a correção mansa, 1,5 deixava o relógio alcançar o último estado e o carro
    // parava um quadro)
    const delay = Math.max(0.08, this.interval * 2.5) * this.simSpeed;
    const target = this.snapT + ((performance.now() - this.snapReal) / 1000) * this.simSpeed - delay;
    const err = target - this.clock;
    // trocou a velocidade (16x -> 1x...): a folga muda de tamanho de uma vez. Vai direto pro alvo se ele
    // está à frente (nunca volta) e esquece o erro velho, que estava na escala da velocidade antiga e
    // empurrava o relógio até bater no último estado (o carro parava um quadro, várias vezes)
    if (this.simSpeed !== this.clockSpeed) {
      this.clockSpeed = this.simSpeed;
      this.errSm = 0;
      if (err > 0) this.clock = target;
      return Math.min(this.clock, this.snapT);
    }
    // (o erro chega tremido: cada estado vem uns milissegundos antes ou depois. Corrigir forte a cada quadro
    // mudava a velocidade do mundo em até 25% de um quadro pro outro, e na câmera de trás tudo engasgava.
    // Agora o erro é filtrado e a correção é mansa, ~1 s pra alcançar. Em segundos reais: vale igual em
    // qualquer velocidade)
    this.errSm += (err / this.simSpeed - this.errSm) * Math.min(1, realDt * 4);
    if (Math.abs(err) > 2 * this.simSpeed + 1) {
      this.clock = target; // muito longe: pula
      this.errSm = 0;
    } else this.clock += realDt * this.simSpeed * (1 + Math.max(-0.2, Math.min(0.2, this.errSm)));
    this.clock = Math.min(this.clock, this.snapT);
    return this.clock;
  }

  private sample(h: Snap[] | undefined, rt: number): Snap | null {
    if (!h || h.length === 0) return null;
    if (rt <= h[0].t) return h[0];
    for (let i = 0; i < h.length - 1; i++) {
      const a = h[i], b = h[i + 1];
      if (rt <= b.t) {
        const k = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
        // (o yaw pelo caminho mais curto: na volta pra pista ele é trazido de volta pra -180..180°; a batida conta
        // quando o desenho chega no estado dela)
        return { t: rt, d: a.d + (b.d - a.d) * k, lat: a.lat + (b.lat - a.lat) * k, yaw: a.yaw + angDiff(a.yaw, b.yaw) * k, imp: a.imp };
      }
    }
    return h[h.length - 1];
  }

  /** posição na pista em metros */
  private px(s: number, lat: number) {
    return this.race.track.pose(s, lat);
  }

  private pos = new Map<string, { x: number; y: number; h: number }>();
  /** quanto o bico está virado em relação ao rumo da pista (suavizado), por carro */
  private yawOff = new Map<string, number>();
  /** estado das peças visto no último quadro (pra soltar o pedaço quando algo quebra) */
  private lookSeen = new Map<string, CarLook>();
  /** rodada, batida, fumaça, poeira, faíscas, marcas de pneu, tremor */
  private fx = new CarFx();
  private wallsFor = "";
  /** quem roda a corrida de verdade recebe as barreiras do autódromo 3D (main.ts: a sala, no solo) */
  onWalls: ((trackName: string, pts: [number, number][]) => void) | null = null;
  /** lateral desenhada (suavizada) e quanto o carro tinha andado, por carro */
  private latSm = new Map<string, { lat: number; d: number; trail: [number, number][] }>();
  private lastRt = 0;
  /** equipe do jogador (retorno dos acontecimentos: câmera lenta, tela cinza, textos em cima do carro) */
  myTeam = "";
  /** acontecimentos da corrida já vistos */
  private evSeen = 0;
  /** textos que sobem em cima do carro por um instante (volta mais rápida, tempo do box, undercut) */
  private floaters: { id: string; text: string; bg: string; fg: string; t0: number; dur: number }[] = [];
  /** câmera lenta curtinha (batida forte) e tela cinza (abandono do seu carro), até quando (ms) */
  private slowUntil = 0;
  private greyFrom = 0;
  /** correção de traseira na saída de curva: velocidade do quadro anterior, tempo desde que começou, tamanho */
  private wiggle = new Map<string, { v: number; t: number; amp: number; cool: number }>();
  /** box: fase e tempo de cada carro no quadro anterior (pro cronômetro em cima dele) */
  private pitSeen = new Map<string, string>();
  /** macaco do box: altura (m) e velocidade de cada carro (mola: sobe rápido, cai e quica no pneu) */
  private jacks = new Map<string, { h: number; v: number }>();
  /** câmera piloto: quanto ela está virada (botão direito; volta pra frente ao trocar de câmera) */
  private pilotYaw = 0;
  /**
   * pedaços de asa e roda voando / caídos na pista (metros do mundo): a figura (2D e vista de cima) e qual peça do
   * carro é (câmeras 3D: RealCars.debris3d põe a peça 3D de verdade)
   */
  private debris: Debris[] = [];
  /** quantas batidas de cada carro o desenho já mostrou (Snap.imp) */
  private impSeen = new Map<string, number>();
  /** a roda que o carro destruído perdeu (a do canto que bateu) */
  private lostWheel = new Map<string, number>();
  /** som das batidas e da brita (main.ts liga no sound) */
  onSound: ((e: FxEvent) => void) | null = null;
  /** o chão que os efeitos de acidente estão usando (pista e se veio do autódromo 3D) */
  private groundKey = "";
  /** posição suavizada na pista (s, lateral) de cada carro, do último quadro: a câmera onboard usa */
  readonly interp = new Map<string, { s: number; lat: number; yaw: number; imp: number; rs?: RSnap | null }>();
  /**
   * REPLAY DA BATIDA (seu carro ou o seguido): a tela guarda os últimos 30 s de cada carro (rbuf) e, ~1,7 s depois
   * da batida, volta REPLAY_BEFORE s e passa de novo em câmera lenta (no 3D, de uma câmera na beira da pista). No
   * solo a corrida espera parada (onReplay); clique ou Esc pula. Os carros aparecem como estavam (replayCar), a
   * batida solta faísca/lasca/som de novo (efeitos "ghost") e os pedaços dela ficam escondidos até ela acontecer
   */
  private rbuf = new Map<string, RSnap[]>();
  private scRbuf: Snap[] = [];
  private replay: { id: string; tImp: number; from: number; to: number; t: number; cam: { x: number; y: number } | null } | null = null;
  private replayWant: { id: string; tImp: number; at: number } | null = null;
  private replayLast = -1e9;
  /** quando cada carro bateu (tempo da corrida) e a batida: no replay, antes disso ele aparece inteiro */
  private crashAt = new Map<string, { t: number; imp: NonNullable<Race["cars"][number]["impact"]> }>();
  private rImpSeen = new Map<string, number>();
  private flashAt = 0;
  /** câmera parada na beira da pista neste quadro (o som vem dela: sound.update); null = o som vai com o carro */
  ear: { x: number; y: number } | null = null;
  /** céu fechando (0..1): a chuva, a previsão chegando (a 1,5 volta do começo dela) e a pista ainda molhada */
  private cloudSm = 0;
  /** Modo TV (main): corta sozinho entre câmera da beira da pista, de trás, de lado e de cima (só no 3D) */
  tvDirector = false;
  /** tomada da MultiCam: tipo, câmera (kind pro RealCars + spec fixa/presa), até quando, momento (ctx), giro do "de lado" */
  private shot: { type: string; kind: "tv" | "iso" | "cima" | "piloto"; id: string; until: number; spec: CamSpec | null; s: number; ctx: string; yaw?: number; n: number } | null = null;
  private shotN = 0;
  /** largada e bandeirada: câmera na beira da pista (de frente pro grid; na linha de chegada) */
  private special: { k: "start" | "finish"; id: string; cam: { x: number; y: number }; until: number } | null = null;
  private finishShown = false;
  private camSig = "";
  /** bandeirada: quando foi (fogos e bandeira quadriculada na linha) e os fogos no ar */
  private finishAt = 0;
  private fireworks: { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string }[] = [];
  private fwNext = 0;
  /** DRS de cada carro (0 fechada, 1 aberta), suavizado */
  private drsSm = new Map<string, number>();
  /** pista molhada no 2D: secando (sem chuva) e os caminhos da pista/traçado ideal/poças, por pista */
  private drySm = 0;
  private wet2d: { name: string; road: Path2D; line: Path2D; puddles: [number, number, number, number, number][] } | null = null;
  private shotOf(race: Race, nowMs: number) {
    const c = race.cars.find((x) => x.id === this.followId), L = race.track.L, sh = this.shot;
    const ahead = sh && c ? (((c.s - sh.s) % L) + L) % L : 0;
    // o momento: no box, brigando (a menos de 0,6 s de alguém) ou correndo sozinho
    let ctx: "box" | "briga" | "livre" = "livre";
    if (c && c.pit !== "none") ctx = "box";
    else if (c) {
      const order = race.ordered(), i = order.indexOf(c);
      for (const o of [order[i - 1], order[i + 1]])
        if (o && !o.retired && o.pit === "none" && Math.abs(race.dist(o) - race.dist(c)) / Math.max(20, c.v) < 0.6) ctx = "briga";
    }
    // câmera fixa: acaba quando o carro passou 25 m dela (a de frente, antes de chegar nela); mudou o momento, corta
    const fixed = !!sh?.spec?.fixa, passed = fixed && (sh!.type === "frontal" ? L - ahead < 14 || (ahead > 0 && ahead < L / 2) : ahead > 25 && ahead < L / 2);
    if (!sh || sh.id !== this.followId || nowMs > sh.until || passed || sh.ctx !== ctx) {
      // tomadas sorteadas, nunca a mesma duas vezes seguidas
      const pool =
        ctx === "box"
          ? c?.pit === "stopped" ? ["muro", "cima", "lado", "orbita"] : ["cima", "lado"]
          : ctx === "briga"
            ? ["baixa", "frontal", "persegue", "lateral", "heli", "onboard", "alta", "grua", "asa", "drone", "roda", "chao"]
            : ["baixa", "alta", "grua", "frontal", "heli", "persegue", "lateral", "onboard", "lado", "cima", "drone", "roda", "torre", "chao", "orbita"];
      const opts = pool.filter((t) => t !== sh?.type);
      const type = c && (c.v > 5 || ctx === "box") ? opts[Math.floor(Math.random() * opts.length)] : "lado";
      const r = (a: number, b: number) => a + Math.random() * (b - a), tr0 = race.track, W2 = TRACK_WIDTH / 2;
      // câmera parada na beira, a "frente" m à frente do carro: do lado de fora da curva que vem (onde fica a de TV
      // de verdade) ou de qualquer lado na reta
      const fixa = (frente: number, fora: number, h: number, fov: number): [CamSpec, number] => {
        const s = tr0.wrap((c?.s ?? 0) + frente), k = tr0.curvature[Math.floor(s)] ?? 0;
        const side = Math.abs(k) > 1 / 900 ? (k > 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1, q = tr0.pose(s, side * (W2 + fora));
        return [{ fixa: true, x: q.x, y: q.y, h, back: 0, side: 0, fov, look: 0 }, s];
      };
      const presa = (back: number, side: number, h: number, fov: number, look: number): CamSpec => ({ fixa: false, x: 0, y: 0, h, back, side, fov, look });
      const lado = () => (Math.random() < 0.5 ? -1 : 1);
      let kind: "tv" | "iso" | "cima" | "piloto" = "tv", spec: CamSpec | null = null, s = 0, yaw: number | undefined, dur = r(4.5, 8);
      if (type === "baixa") [spec, s] = fixa(r(45, 100), r(2.5, 6), r(1.2, 3), r(20, 30));
      else if (type === "alta") [spec, s] = fixa(r(60, 130), r(12, 30), r(10, 20), r(30, 40));
      else if (type === "grua") [spec, s] = fixa(r(25, 60), r(6, 12), r(6, 10), r(40, 52));
      else if (type === "frontal") [spec, s] = fixa(r(110, 170), r(1.5, 3), r(2, 4), r(14, 20));
      else if (type === "heli") spec = presa(r(40, 70), lado() * r(25, 55), r(40, 70), r(28, 38), 15);
      else if (type === "persegue") spec = presa(r(8, 22), r(-2, 2), r(2.2, 7), r(42, 56), r(15, 30));
      else if (type === "lateral") spec = presa(r(-3, 5), lado() * r(9, 16), r(1.5, 4), r(38, 50), 2);
      // drone na frente, filmando o carro chegando (olha pro carro)
      else if (type === "drone") spec = presa(-r(10, 22), r(-4, 4), r(3, 8), r(40, 52), 0);
      // presa do lado de fora da roda de trás, rente ao chão, olhando pra frente
      else if (type === "roda") spec = presa(1.4, lado() * 1.3, 0.4, r(58, 66), 30);
      // na asa traseira olhando pra trás: quem vem atrás (boa na briga)
      else if (type === "asa") spec = presa(2.5, 0, 1.15, r(48, 58), -40);
      // girando em volta do carro
      else if (type === "orbita") spec = { ...presa(r(12, 20), lado() * r(2, 8), r(3, 7), r(40, 50), 0), orbit: lado() * r(0.25, 0.45) };
      // torre alta do lado de dentro da curva que vem, vendo a curva toda
      else if (type === "torre") {
        const s0 = tr0.wrap((c?.s ?? 0) + r(50, 110)), k = tr0.curvature[Math.floor(s0)] ?? 0, q = tr0.pose(s0, (k >= 0 ? 1 : -1) * (W2 + r(8, 15)));
        spec = { fixa: true, x: q.x, y: q.y, h: r(22, 35), back: 0, side: 0, fov: r(26, 34), look: 0 };
        s = s0;
      }
      // no chão, quase na zebra: o carro passa raspando a câmera
      else if (type === "chao") [spec, s] = fixa(r(30, 70), r(0.6, 1.5), r(0.25, 0.6), r(55, 70));
      else if (type === "muro" && c) {
        // box: do muro do pit, do lado da pista, olhando o carro e os mecânicos
        const q = tr0.pose(c.s, c.lateral - Math.sign(c.lateral || 1) * 9);
        spec = { fixa: true, x: q.x, y: q.y, h: 2.6, back: 0, side: 0, fov: 38, look: 0 };
        s = c.s;
      } else if (type === "onboard") kind = "piloto";
      else if (type === "lado") [kind, yaw] = ["iso", Math.random() * Math.PI * 2];
      else kind = "cima";
      if (spec?.fixa) dur = 10;
      this.shot = { type, kind, id: this.followId, until: nowMs + dur * 1000, spec, s, ctx, yaw, n: ++this.shotN };
    }
    return this.shot!;
  }
  private specialOf(race: Race, nowMs: number) {
    const tr0 = race.track, W2 = TRACK_WIDTH / 2;
    // (do lado contrário ao dos boxes: do lado deles a câmera caía dentro do prédio)
    const pl = tr0.pitLateralAt(22), side = pl > 0.5 ? -1 : pl < -0.5 ? 1 : 1;
    if (this.special && nowMs > this.special.until) this.special = null;
    // largada: de frente pro grid (30 m depois da linha), até 3,5 s depois de apagar as luzes
    const starting = race.phase === "lights" || (race.phase === "racing" && race.time < 3.5 && race.leader().lap < 1);
    if (starting && !this.special) {
      const pole = race.cars.find((c) => c.grid === 1) ?? race.ordered()[0];
      const q = tr0.pose(30, side * (W2 + 5));
      this.special = { k: "start", id: pole.id, cam: { x: q.x, y: q.y }, until: Infinity };
    }
    if (this.special?.k === "start" && !starting) this.special = null;
    // bandeirada: o líder na última volta a menos de 250 m da linha; fica 4,5 s depois dela
    const ld = race.leader();
    if (!this.finishShown && !race.checkered && ld.lap === race.laps - 1 && ld.s > tr0.L - 250) {
      const q = tr0.pose(22, side * (W2 + 5));
      this.special = { k: "finish", id: ld.id, cam: { x: q.x, y: q.y }, until: Infinity };
      this.finishShown = true;
    }
    if (this.special?.k === "finish" && race.checkered && this.special.until === Infinity) this.special.until = nowMs + 4500;
    return this.special;
  }
  /** pista molhada no 2D: escurece o asfalto, a trajetória seca primeiro e junta poça nas bordas */
  private drawWet2d(o: CanvasRenderingContext2D, race: Race, viewX: number, viewY: number, m: number) {
    const tr0 = race.track, W2 = TRACK_WIDTH / 2;
    if (this.wet2d?.name !== tr0.name) {
      const road = new Path2D(), line = new Path2D(), puddles: [number, number, number, number, number][] = [];
      for (let s = 0; s <= tr0.L; s += 4) {
        const a = tr0.pose(tr0.wrap(s), 0), b = tr0.pose(tr0.wrap(s), tr0.lineAt(tr0.wrap(s)));
        if (s === 0) {
          road.moveTo(a.x, a.y);
          line.moveTo(b.x, b.y);
        } else {
          road.lineTo(a.x, a.y);
          line.lineTo(b.x, b.y);
        }
      }
      road.closePath();
      // poças: sorteio fixo por pista (o mesmo lugar sempre), perto das bordas
      let seed = 0;
      for (const ch of tr0.name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let s = 0; s < tr0.L; s += 23)
        if (rnd() < 0.3) {
          const side = rnd() < 0.5 ? -1 : 1, q = tr0.pose(s, side * (W2 - 1.2 - rnd() * 1.8));
          puddles.push([q.x, q.y, 0.9 + rnd() * 2.2, 0.5 + rnd() * 0.9, q.h]);
        }
      this.wet2d = { name: tr0.name, road, line, puddles };
    }
    const wet = race.wet, w2d = this.wet2d;
    o.save();
    o.setTransform(m * this.dpr, 0, 0, m * this.dpr, -viewX * m * this.dpr, -viewY * m * this.dpr);
    o.lineJoin = "round";
    o.strokeStyle = `rgba(12,22,42,${(0.34 * wet).toFixed(3)})`;
    o.lineWidth = TRACK_WIDTH;
    o.stroke(w2d.road);
    if (this.drySm > 0.05) {
      o.strokeStyle = `rgba(150,152,158,${(0.2 * wet * this.drySm).toFixed(3)})`;
      o.lineWidth = 1.8;
      o.stroke(w2d.line);
    }
    if (wet > 0.3) {
      const k = Math.min(1, (wet - 0.3) / 0.4);
      for (const [x, y, rx, ry, h] of w2d.puddles) {
        if ((x - viewX) * m < -60 || (y - viewY) * m < -60 || (x - viewX) * m > o.canvas.width / this.dpr + 60 || (y - viewY) * m > o.canvas.height / this.dpr + 60) continue;
        o.beginPath();
        o.ellipse(x, y, rx, ry, h, 0, Math.PI * 2);
        o.fillStyle = `rgba(60,86,122,${(0.42 * k).toFixed(3)})`;
        o.fill();
        o.strokeStyle = `rgba(200,220,240,${(0.25 * k).toFixed(3)})`;
        o.lineWidth = 0.08;
        o.stroke();
      }
    }
    o.restore();
  }
  /** o replay começou (true) ou acabou (false): o solo pausa a corrida enquanto ele passa */
  onReplay: ((on: boolean) => void) | null = null;
  replaying() {
    return !!this.replay;
  }
  /** tEnd: quando o carro parou (a corrida avisou a batida) */
  private startReplay(id: string, tEnd: number, rb: RSnap[]) {
    // volta até 1,2 s antes de ele perder o controle (o último trecho escorregando antes de parar), no máx. 6 s
    let i = rb.length - 1;
    while (i > 0 && rb[i].t > tEnd) i--;
    while (i > 0 && (rb[i].sl || rb[i - 1].sl)) i--;
    const from = Math.max(rb[0].t, rb[i].t - 1.2, tEnd - 6), to = tEnd + 1;
    // câmera da beira da pista (3D): 30 m à frente de onde ele parou, colada na beira do lado dele (o carro vem na
    // direção dela; mais pra fora caía no meio das árvores)
    const smp = this.sample(rb, tEnd), tr0 = this.race.track;
    let cam: { x: number; y: number } | null = null;
    if (smp) {
      const side = this.crashAt.get(id)?.imp.side ?? (smp.lat >= 0 ? 1 : -1);
      const q = tr0.pose(tr0.wrap(smp.d + 30), side * (TRACK_WIDTH / 2 + 3));
      cam = { x: q.x, y: q.y };
    }
    this.replay = { id, tImp: tEnd, from, to, t: from, cam };
    this.rImpSeen.clear();
    for (const [cid, rb] of this.rbuf) {
      const s0 = this.sample(rb, from);
      if (s0) this.rImpSeen.set(cid, s0.imp);
    }
    this.cam.ready = false;
    this.flashAt = performance.now();
    this.onReplay?.(true);
  }
  /** acaba o replay (ou pula) e volta pra corrida ao vivo */
  endReplay() {
    if (!this.replay) return;
    this.replayLast = this.replay.tImp;
    this.replay = null;
    this.debris = this.debris.filter((d) => !d.ghost);
    this.cam.ready = false;
    this.flashAt = performance.now();
    this.onReplay?.(false);
  }
  /** o carro como estava no instante do replay (o resto do estado é o de agora) */
  private replayCar(c: Race["cars"][number]): Race["cars"][number] {
    const r = this.interp.get(c.id)?.rs;
    if (!r) return c;
    const over: Record<string, unknown> = { retired: r.ret, slide: r.sl ? { mode: r.sl, psi: 0, yaw: r.yaw, yawRate: 0, stop: 0 } : null, spin: r.spin ? 1 : 0, recover: null, v: r.v, pit: r.pit };
    return new Proxy(c, { get: (t, k) => (typeof k === "string" && k in over ? over[k] : Reflect.get(t, k)) });
  }
  /** online: etiqueta dos carros dos jogadores mostra o engenheiro */
  showEngineers = false;
  /** altura de baixo coberta pelo painel (px); a câmera centraliza acima dela */
  private inset = 0;
  private insetTarget = 0;
  setBottomInset(px: number) {
    this.insetTarget = Math.min(px, window.innerHeight * 0.6);
  }

  draw(realDt: number, speed: number) {
    // voltando pra câmera de cima: a cena 3D continua até a câmera terminar de deslizar
    const want = tiltMode();
    if (want !== "piloto") this.pilotYaw = 0;
    let TILT: "tv" | "iso" | "piloto" | "cima" | null = want ?? (car3dPref.style === "real" && (this.wasTilt || this.real3d?.transitioning()) ? "cima" : null);
    this.wasTilt = !!want;
    // câmera de TV (só no 3D, fora da câmera piloto e do replay): largada e bandeirada na beira da pista; no Modo TV
    // corta sozinho entre os ângulos
    let shotCam: { x: number; y: number } | null = null, shotId: string | null = null, shotSpec: CamSpec | null = null;
    this.tvDirector = multiCam();
    if (TILT && this.tvDirector && !this.replay) {
      const sp = this.specialOf(this.race, performance.now());
      if (sp) [shotCam, shotId] = [sp.cam, sp.id];
      else {
        const sh = this.shotOf(this.race, performance.now());
        shotSpec = sh.spec;
        TILT = sh.kind;
      }
    }
    const race = this.race;
    const L = race.track.L;
    const W = window.innerWidth, H = window.innerHeight;
    const m = this.m2css();

    // acontecimentos novos: retorno na tela (por importância: toque é só faísca; batida forte do seu carro
    // ou do seguido = tremor + câmera lenta de ~0,12 s; abandono do seu carro = tela fica cinza um instante)
    const calm = !!gfx().calm, nowMs = performance.now();
    if (race.events.length < this.evSeen) this.evSeen = 0;
    for (; this.evSeen < race.events.length; this.evSeen++) {
      const e = race.events[this.evSeen], c = e.carId ? race.cars.find((x) => x.id === e.carId) : undefined;
      const mine = !!c && c.team.id === this.myTeam;
      if (e.kind === "fastest" && c && race.fastestLap) this.floaters.push({ id: c.id, text: `⏱ ${fmtLap(race.fastestLap.time)}`, bg: "#9b30ff", fg: "#fff", t0: nowMs, dur: 1600 });
      if (e.kind === "undercut" && c) this.floaters.push({ id: c.id, text: "UNDERCUT!", bg: "#ffcc00", fg: "#111", t0: nowMs, dur: 2600 });
      if ((e.kind === "crash" || e.kind === "out") && c && (mine || c.id === this.followId) && !calm) {
        if (e.kind === "crash") {
          this.slowUntil = nowMs + 120;
          this.fx.kick(0.9);
        }
        if (mine) this.greyFrom = nowMs;
      }
      // batida (no muro ou parado na brita) do seu carro ou do seguido: replay daqui a pouco (um por vez, no máx.
      // um a cada 25 s de corrida)
      if ((e.kind === "crash" || e.kind === "out") && c && (mine || c.id === this.followId) && /Acidente|muro|brita/.test(c.retireReason ?? "") && !this.replay && !this.replayWant && e.time - this.replayLast > 25)
        this.replayWant = { id: c.id, tImp: e.time, at: nowMs + 1700 };
    }
    // box: cronômetro em cima dos seus carros e do seguido; na saída fica o tempo final, verde (limpa) ou
    // vermelho (os mecânicos erraram)
    for (const c of race.cars) {
      const was = this.pitSeen.get(c.id) ?? "none", near = c.team.id === this.myTeam || c.id === this.followId;
      if (was === "stopped" && c.pit !== "stopped" && near && c.pitTotal) {
        // parada só de pneu bem feita (até 2,6 s): raio dourado
        const slow = c.pitTotal > (c.pitClean ?? c.pitTotal) + 0.5, fast = !slow && c.pitTotal <= 2.6;
        this.floaters.push({ id: c.id, text: `${slow ? "▼" : fast ? "⚡" : "✔"} ${c.pitTotal.toFixed(1).replace(".", ",")} s`, bg: slow ? "#e0303a" : fast ? "#ffcc00" : "#22a85a", fg: fast ? "#111" : "#fff", t0: nowMs, dur: fast ? 2600 : 1800 });
      }
      // som do box (pistolas, macaco, saída), só do seu carro e do seguido e até 4x
      if (near && speed > 0 && speed <= 4) {
        if (was !== "stopped" && c.pit === "stopped") this.fx.events.push({ k: "box", dur: c.pitTimer / speed, follow: c.id === this.followId });
        if (was === "stopped" && c.pit !== "stopped") this.fx.events.push({ k: "saida", follow: c.id === this.followId });
      }
      this.pitSeen.set(c.id, c.pit);
    }
    // posições interpoladas (em pixels do mundo)
    // replay da batida: começa ~1,7 s depois dela; só com a corrida até 2x (mais rápido, perderia muita coisa)
    if (this.replayWant && !this.replay && nowMs >= this.replayWant.at && speed > 0) {
      const w = this.replayWant, rb = this.rbuf.get(w.id);
      this.replayWant = null;
      if (rb && rb.length > 4 && speed <= 2 && rb[0].t <= w.tImp - 1) this.startReplay(w.id, w.tImp, rb);
    }
    const liveRt = this.renderTime(nowMs < this.slowUntil ? realDt * 0.15 : realDt);
    if (this.replay) {
      this.replay.t += Math.min(0.1, realDt) * REPLAY_SPEED;
      if (this.replay.t >= this.replay.to) this.endReplay();
    }
    const rt = this.replay ? this.replay.t : liveRt;
    // (no replay a câmera fica no carro que bateu)
    const fid = this.replay ? this.replay.id : (shotId ?? this.followId);
    this.ear = this.replay?.cam ?? shotCam ?? (shotSpec?.fixa ? { x: shotSpec.x, y: shotSpec.y } : null);
    // nuvens: chovendo, a previsão de chuva chegando ou a pista ainda molhada
    const fc0 = this.race.weather?.forecast, lapNow = this.race.leader().lap;
    const coming = fc0 && fc0.chance >= 50 ? Math.max(0, Math.min(1, (lapNow - (fc0.from - 1.5)) / 1.5)) * (lapNow <= fc0.to ? 0.65 : 0) : 0;
    this.cloudSm += (Math.max(Math.min(1, this.race.rain * 1.4), coming, this.race.wet * 0.5) - this.cloudSm) * Math.min(1, realDt * 0.15);
    // quanto a corrida andou neste quadro no relógio da tela (as suavizações usam este, não o tempo real:
    // o relógio acelera/freia um pouco pra acompanhar a simulação, e com tempos diferentes a lateral e o
    // quanto o carro andou saíam do passo um do outro e o bico balançava)
    const drt = Math.max(0, Math.min(0.5 * Math.max(1, speed), rt - this.lastRt));
    this.lastRt = rt;
    const pos = this.pos;
    pos.clear();
    for (const c of race.cars) {
      const smp = this.replay ? this.sample(this.rbuf.get(c.id), rt) : this.sample(this.hist.get(c.id), rt);
      const s = smp ? (((smp.d % L) + L) % L) : c.s;
      const d = smp ? smp.d : c.s;
      // troca de faixa em curva de S, não em linha reta: a lateral desenhada persegue a da simulação com
      // atraso curto (a simulação muda a velocidade lateral de uma vez, e o carro "escorregava" de lado).
      // Pulo grande (box, batida, volta pra pista) ou carro rodando: vai direto
      const latSim = smp ? smp.lat : c.lateral;
      const ls = this.latSm.get(c.id);
      // (carro solto — rodando, passando reto ou voltando pra pista —: quem manda no bico é o yaw dele; a inclinação
      // do caminho somava por cima e o bico balançava)
      const free = !c.slide && c.spin <= 0 && !c.recover;
      let lat = latSim;
      if (ls && free && Math.abs(latSim - ls.lat) < 4) lat = ls.lat + (latSim - ls.lat) * (1 - Math.exp(-drt / 0.16));
      const q = this.px(s, lat);
      // o bico aponta pra onde o carro está indo (seguindo o traçado ele atravessa a pista: com o ângulo
      // da linha do meio parecia drift): inclinação do caminho desenhado nos últimos ~4 m (a corda de um
      // quadro só pegava qualquer tremidinha e o carro rebolava). Não passa de 35° do rumo da pista
      const trail = ls && free && d >= ls.d - 0.01 && d - ls.d < 30 ? ls.trail : [];
      if (!trail.length || d - trail[trail.length - 1][0] > 0.4) trail.push([d, lat]);
      while (trail.length > 2 && d - trail[1][0] > 4) trail.shift();
      const [d0, l0] = trail[0];
      let off = this.yawOff.get(c.id) ?? 0;
      if (!free) off = 0;
      else if (d - d0 > 1) off = Math.max(-0.6, Math.min(0.6, Math.atan2(lat - l0, d - d0)));
      this.latSm.set(c.id, { lat, d, trail });
      // carro de verdade não gira de uma vez: quando ele muda de lado de repente (começa a ultrapassar,
      // desvia), o bico acompanha em ~0,08 s em vez de pular
      const was = this.yawOff.get(c.id) ?? off;
      const sm = was + (off - was) * (1 - Math.exp(-drt / 0.08));
      this.yawOff.set(c.id, sm);
      q.h += sm;
      pos.set(c.id, q);
      this.interp.set(c.id, { s, lat, yaw: smp ? smp.yaw : (c.slide?.yaw ?? c.restYaw ?? 0), imp: smp ? smp.imp : (c.impact?.n ?? 0), rs: this.replay ? (smp as RSnap | null) : null });
    }
    let scPos: { x: number; y: number; h: number } | null = null;
    if (this.replay ? this.scRbuf.length > 0 && this.scRbuf[0].t <= rt && this.scRbuf[this.scRbuf.length - 1].t >= rt : race.sc.active && race.sc.onTrack) {
      const smp = this.sample(this.replay ? this.scRbuf : this.scHist, rt);
      scPos = this.px(smp ? (((smp.d % L) + L) % L) : race.sc.s, 0);
    }

    // câmera presa no carro seguido (transição suave quando troca de carro)
    const tp = (fid === "SC" ? scPos : pos.get(fid)) ?? pos.get(race.leader().id)!;
    if (fid !== this.lastFollow) {
      if (this.cam.ready) this.camFrom = { x: this.cam.x, y: this.cam.y, t: performance.now() };
      this.lastFollow = fid;
    }
    let cx = tp.x, cy = tp.y;
    if (this.camFrom) {
      const k = Math.min(1, (performance.now() - this.camFrom.t) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      cx = this.camFrom.x + (tp.x - this.camFrom.x) * e;
      cy = this.camFrom.y + (tp.y - this.camFrom.y) * e;
      if (k >= 1) this.camFrom = null;
    }
    this.cam = { x: cx, y: cy, ready: true };
    void realDt;

    // ---- pista (vetor, em tiles) ----
    const o = this.octx;
    // o carro seguido fica no meio da parte da tela que o painel não cobre (desliza junto)
    this.inset += (this.insetTarget - this.inset) * Math.min(1, realDt * 12);
    // (o tremor continua passando mesmo desligado, pra não aparecer guardado quando ligar de novo)
    const shk = this.fx.shakeOffset(realDt), [shx, shy] = calm ? [0, 0] : shk;
    const viewX = cx - W / m / 2 + shx, viewY = cy - (H - this.inset) / m / 2 + shy;
    o.setTransform(1, 0, 0, 1, 0, 0);
    // resolução cheia sempre: os tiles são desenhados no Worker, sem travar o jogo
    void speed;
    // modo 3D com a pista 3D ligada: o autódromo em 3D (enquanto monta, a pista 2D)
    // (usou as câmeras 3D nesta corrida: a de cima também fica com o autódromo 3D, senão o mapa trocava de cor)
    if (TILT) this.usedTilt = true;
    const real3 = car3dPref.style === "real" && (gfx().track3d || TILT || this.usedTilt) ? this.realCars() : null;
    let drew3d = false;
    // onboard em 3D de verdade quando o autódromo 3D está pronto (senão, o desenho de sempre)
    OnboardCam.world3d = real3?.wallPts && gfx().onboard3d ? (g, W, H, id, x, y, h) => real3.drawOnboard(g, W, H, id, x, y, h) : null;
    // a corrida bate nas barreiras do autódromo 3D (quando ele fica pronto): na de verdade (onWalls: a sala, no
    // solo) e na da tela
    if (real3?.wallPts && this.wallsFor !== race.track.name) {
      this.wallsFor = race.track.name;
      race.setWalls(real3.wallPts);
      this.onWalls?.(race.track.name, real3.wallPts);
    }
    // câmera inclinada (protótipo): a cena 3D cobre tudo, a pista 2D nem é desenhada
    if (real3 && TILT && real3.ensureTrack(race.track)) drew3d = true;
    else if (real3) {
      o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drew3d = real3.drawTrack(o, W, H, m, viewX, viewY, race.track);
      o.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (!drew3d) {
      // 2D gerado do 3D (Editor > Autódromo 3D > GERAR 2D): se esta pista tiver, usa as imagens dele
      const bw = (this.baked ??= new BakedWorld(mapSlug(race.track.name)));
      const vec = () => this.world.draw(o, viewX, viewY, W / m, H / m, m * this.dpr, 1);
      if (bw.ready) bw.draw(o, viewX, viewY, W / m, H / m, m * this.dpr, vec);
      else vec();
    }
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = "medium";
    if (race.wet > 0.02) {
      o.fillStyle = `rgba(20,40,75,${(race.wet * 0.3).toFixed(3)})`;
      o.fillRect(0, 0, W, H);
    }

    // ---- carros e o resto por cima ----
    const toCss = (p: { x: number; y: number }) => ({ x: (p.x - viewX) * m, y: (p.y - viewY) * m });

    this.screenPos.clear();
    const rainLight = race.wet > 0.2 && Math.floor(performance.now() / 300) % 2 === 0;
    // o guindaste já levou (fora da corrida e "na garagem"): some da pista. O que abandonou pelo box fica no box
    const sorted = [...race.cars]
      .filter((c) => !(c.retired && c.pit === "parked" && c.retireReason !== "Abandono"))
      .sort((a, b) => Number(a.id === this.followId) - Number(b.id === this.followId));
    // pedaços de asa: voam um pouco, escorregam e ficam na pista até sumir
    // pausado: fumaça, faíscas e pedaços param junto com a corrida
    const dt = speed === 0 ? 0 : Math.min(0.1, realDt) * Math.min(4, Math.max(1, speed));
    this.debris = this.debris.filter((d) => (d.t += dt) < 40);
    for (const d of this.debris) this.stepDebris(d, dt);
    // câmera inclinada: a cena 3D cobre a tela toda, então marcas, faíscas, fumaça, spray e pedaços vão
    // depois dela, com cada ponto do mundo levado pra tela pela câmera 3D (em vez do toCss de cima)
    const tiltOn = !!(TILT && drew3d && real3);
    const later: ((cv: typeof toCss, mm: number) => void)[] = [];
    /** direção na tela de quem está em p virado pra h */
    const hOn = (cv: typeof toCss, p: { x: number; y: number }, h: number) => {
      const a = cv(p), b = cv({ x: p.x + Math.cos(h), y: p.y + Math.sin(h) });
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    // (no replay, os pedaços da batida de verdade ficam escondidos: os que voam são as cópias dele)
    const rp = this.replay, debrisShown = rp ? this.debris.filter((d) => d.ghost || (d.born ?? -1e9) < rp.from) : this.debris;
    const drawDebris = (cv: typeof toCss, mm: number) => {
      // (câmeras 3D: os pedaços são as peças 3D do carro, na cena — RealCars.debris3d)
      if (tiltOn) return;
      for (const d of debrisShown) {
        if (!d.img) continue;
        const air = 1 + Math.min(0.5, d.z * 0.3); // no ar parece maior
        const { x, y } = cv(d);
        this.drawCar(o, x, y, hOn(cv, d, d.h), d.img, mm * air, d.t > 37 ? (40 - d.t) / 3 : 1);
      }
    };
    // o chão dos efeitos de acidente: o do autódromo 3D, se montado; senão a regra da beira da pista
    const gsrc = real3?.groundSrc ?? null, gkey = `${race.track.name}|${gsrc ? "3d" : "2d"}`;
    if (this.groundKey !== gkey) {
      this.groundKey = gkey;
      this.fx.ground = groundMap(race.track, gsrc);
      this.fx.pose = (s, lat) => race.track.pose(s, lat);
    }
    this.fx.step(dt);
    const under = (cv: typeof toCss, mm: number, soft = 1, scaleAt?: (x: number, y: number) => number, skipNear?: { x: number; y: number } | null) => {
      drawDebris(cv, mm);
      // (câmeras 3D: as marcas de pneu já estão no chão da cena, embaixo dos carros)
      if (!tiltOn) this.fx.drawGround(o, cv, mm);
      this.mistStep(o, dt, cv, mm, scaleAt, skipNear);
      // faíscas por baixo dos carros (o assoalho raspa embaixo: só o rastro aparece saindo por trás)
      this.fx.drawAir(o, cv, mm, true, soft);
    };
    this.drySm += ((race.rain > 0.02 ? 0 : 1) - this.drySm) * Math.min(1, realDt * 0.4);
    // 2D: nublado deixa tudo um pouco mais escuro e frio (no 3D quem faz é a luz: RealCars.cloud)
    if (!tiltOn && !real3 && this.cloudSm > 0.03) {
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.fillStyle = `rgba(32,40,52,${(0.22 * this.cloudSm).toFixed(3)})`;
      o.fillRect(0, 0, o.canvas.width, o.canvas.height);
      o.restore();
    }
    if (!tiltOn && race.wet > 0.03) this.drawWet2d(o, race, viewX, viewY, m);
    if (!tiltOn) under(toCss, m);
    // 3D de verdade: os carros vão pra camada do Three.js (desenhada de uma vez depois do laço)
    const real = car3dPref.style === "real" ? this.realCars() : null;
    const realList: CarDraw[] = [];
    this.realProps.length = 0;
    this.realOn = !!real;
    for (const c0 of sorted) {
      const c = this.replay ? this.replayCar(c0) : c0;
      const p = pos.get(c.id)!;
      let { x, y } = toCss(p);
      // câmeras de trás e piloto: vale a distância de verdade até o carro seguido (pela tela do 2D, com um
      // zoom que nem aparece nelas, os carros sumiam e voltavam). De cima e de lado: a tela, com folga
      if (TILT === "tv" || TILT === "piloto") {
        const fp = pos.get(this.followId) ?? scPos;
        if (fp && Math.hypot(p.x - fp.x, p.y - fp.y) > 900) continue;
      } else {
        const margin = TILT ? Math.max(W, H) * 1.6 : CAR_LEN_M * m * (c.recover ? 12 : 1);
        if (x < -margin || y < -margin || x > W + margin || y > H + margin) continue;
      }
      this.screenPos.set(c.id, { x, y });
      if (race.wet > 0.25 && c.v > 25 && gfx().rain !== "off") {
        const wet = race.wet * LV_AMOUNT[gfx().rain], v = c.v;
        if (tiltOn)
          later.push((cv, mm) => {
            const q = cv(p);
            this.spray(o, q.x, q.y, hOn(cv, p, p.h), wet, mm, p, v, dt);
          });
        else this.spray(o, x, y, p.h, wet, m, p, v, dt);
      }
      const curv = race.track.curvature[Math.floor(race.track.wrap(c.s)) % L] ?? 0;
      // bateu na barreira: quando o carro DESENHADO chega no estado da batida (faísca, pedaço, som na hora certa)
      const it = this.interp.get(c.id);
      if (it) {
        // (no replay a batida passa de novo só com o que não fica: faísca, lasca, nuvem e som)
        const seenMap = this.replay ? this.rImpSeen : this.impSeen, seen = seenMap.get(c.id);
        if (seen !== undefined && it.imp > seen && c.impact) this.onImpact(c, p, it, real3 ?? null, !!this.replay);
        seenMap.set(c.id, it.imp);
      }
      const yaw = this.fx.update(c, p, dt, curv, !!race.track.def.street, c.id === this.followId, race.track.bumpAt(c.s), this.interp.get(c.id));
      // largada: pneu de trás patinando nos primeiros 2,2 s
      if (!this.replay && race.phase === "racing" && race.time < 2.2 && c.v < 40 && speed > 0) this.fx.launchPuff(p.x, p.y, p.h, 1 - race.time / 2.2);
      // (o estrago aparece quando o carro desenhado chega no muro, não quando a corrida avisa)
      const crashed = this.fx.landed(c.id) && !(this.replay && rt < (this.crashAt.get(c.id)?.t ?? -1e9));
      // saída de curva lenta acelerando forte: às vezes a traseira escapa um pouco e o piloto corrige (2-4°,
      // some em ~0,6 s). Mais comum com piloto agressivo e na chuva. Só no desenho: a corrida não muda
      let wig = this.wiggle.get(c.id);
      const vPrev = wig?.v ?? c.v, acc = drt > 0 ? (c.v - vPrev) / drt : 0;
      if (!wig) this.wiggle.set(c.id, (wig = { v: c.v, t: 9, amp: 0, cool: 0 }));
      wig.v = c.v;
      wig.t += drt;
      // freada forte: às vezes a roda da frente de um lado trava (fumacinha e marca curta); bem rápido, o assoalho
      // raspa quando o bico afunda (faísca)
      if (!this.replay && acc < -26 && c.v > 30 && !c.slide && c.spin <= 0 && c.pit === "none") {
        if (Math.random() < drt * (0.35 + race.wet * 0.8)) this.fx.lockUp(p, Math.random() < 0.5 ? 1 : -1);
        if (c.v > 68 && Math.random() < drt * 5) this.fx.floorSpark(p, c.v);
      }
      wig.cool -= drt;
      if (wig.cool <= 0 && wig.t > 1 && !c.slide && c.spin <= 0 && acc > 5 && c.v > 14 && c.v < 45 && Math.abs(curv) > 1 / 160) {
        const aggr = (c.driver.profile?.aggression ?? 55) / 100;
        if (Math.random() < (0.25 + aggr * 0.5 + race.wet * 0.3) * 0.5) {
          wig.t = 0;
          wig.amp = (0.035 + Math.random() * 0.035) * (Math.random() < 0.5 ? -1 : 1) * (1 + race.wet * 0.3);
        }
        wig.cool = 2.5; // (uma chance por curva)
      }
      // (câmera piloto no próprio carro: a câmera segue a pista e o carro girava embaixo dela, parecia que
      // escorregava/tremia; ali não tem)
      const onboardMe = TILT === "piloto" && c.id === this.followId;
      const wy = wig.t < 0.8 && !onboardMe ? wig.amp * Math.exp(-wig.t * 5) * Math.sin((wig.t / 0.3) * Math.PI * 2) : 0;
      let hh = p.h + yaw + wy, alpha = c.retired && !crashed ? 0.6 : 1, mm = m;
      // guindaste retirando o carro: desenha o caminhão e leva o carro junto
      const lift = c.recover ? this.crane(o, c, p, hh, toCss, m) : null;
      if (lift) ({ x, y, h: hh, scale: mm, alpha } = { ...lift, scale: m * lift.scale, alpha: alpha * lift.alpha });
      let look = lookOf(c.dmg, c.dmgSide, c.flatWheel, c.fault === "puncture", this.steerOf(c, p.h));
      // bateu: sem asa dianteira e com uma roda arrancada (os pedaços voam pelo dropParts)
      if (crashed) {
        const lost = this.lostWheel.get(c.id) ?? [...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 4;
        look = { ...look, fw: { state: "none", side: "l" }, wheels: look.wheels.map((w, i) => (i === lost ? "off" : w)) as CarLook["wheels"] };
      }
      this.dropParts(c, look, p);
      if (lift && lift.scale > 1.01 && !real) {
        // no ar: sombra no chão, deslocada (no 3D a sombra de verdade já aparece)
        o.fillStyle = "rgba(0,0,0,.28)";
        o.beginPath();
        o.ellipse(x + (lift.scale - 1) * 6 * m, y + (lift.scale - 1) * 9 * m, 1 * m, 2.6 * m, hh + Math.PI / 2, 0, Math.PI * 2);
        o.fill();
      }
      if (real) {
        // sombra baixa: mancha simples no chão (barata); média/alta: o 3D faz a sombra de verdade
        if (gfx().shadows === "baixo") {
          o.fillStyle = "rgba(0,0,0,.32)";
          o.beginPath();
          o.ellipse(x + 0.25 * m, y + 0.35 * m, 2.5 * mm, 0.95 * mm, hh, 0, Math.PI * 2);
          o.fill();
        }
        let jk = this.jacks.get(c.id);
        if (!jk) this.jacks.set(c.id, (jk = { h: 0, v: 0 }));
        if (drt > 0 || jk.h !== 0) {
          const st = Math.min(0.05, Math.max(drt, 1 / 120));
          jk.v += (380 * ((c.pit === "stopped" ? 0.07 : 0) - jk.h) - 16 * jk.v) * st;
          jk.h = Math.max(-0.02, jk.h + jk.v * st);
          if (Math.abs(jk.h) < 1e-4 && Math.abs(jk.v) < 1e-3) jk.h = jk.v = 0;
        }
        const dw = this.drsSm.get(c.id) ?? 0, dTo = c.drs && !this.replay ? 1 : 0;
        const drs = dw + (dTo - dw) * Math.min(1, realDt * 7);
        this.drsSm.set(c.id, drs);
        const pitP = c.pit === "stopped" && c.pitTotal ? Math.max(0, Math.min(1, 1 - c.pitTimer / c.pitTotal)) : -1;
        realList.push({ id: c.id, team: c.team, x: x / m + viewX, y: y / m + viewY, h: hh, scale: mm / m, look, v: c.v, compound: c.compound, lift: lift ? (lift.scale - 1) / 0.18 : 0, jack: jk.h, drs, pit: pitP });
      } else if (!(car3dPref.on && drawCar3d(o, c.team, x, y, hh, mm, alpha, look, rainLight, performance.now() / 1000)))
        this.drawCar(o, x, y, hh, carImage(c.team, rainLight), mm, alpha);
      if (!lift && c.retired) {
        if (tiltOn)
          later.push((cv, mm) => {
            const q = cv(p);
            this.smoke(o, q.x, q.y, mm);
          });
        else this.smoke(o, x, y, m);
      }
    }
    if (scPos) {
      const { x, y } = toCss(scPos);
      this.screenPos.set("SC", { x, y });
      const blink = Math.floor(performance.now() / 250) % 2 === 0;
      const sc3d = car3dPref.on ? prop("sc") : null;
      if (real && realPropReady?.("sc")) this.realProps.push({ kind: "sc", id: "SC", x: scPos.x, y: scPos.y, h: scPos.h, blink });
      else if (sc3d) {
        drawProp(o, sc3d, x, y, scPos.h, m);
        // giroflex no teto: laranja piscando, um lado de cada vez
        const fx = Math.cos(scPos.h), fy = Math.sin(scPos.h);
        o.save();
        o.globalCompositeOperation = "lighter";
        for (const sd of [-1, 1]) {
          const on = blink === (sd > 0);
          const lx = x + (-fx * 0.15 - fy * sd * 0.45) * m, ly = y + (-fy * 0.15 + fx * sd * 0.45) * m;
          const gl = o.createRadialGradient(lx, ly, 0, lx, ly, (on ? 2.2 : 0.6) * m);
          gl.addColorStop(0, on ? "rgba(255,180,40,.95)" : "rgba(255,150,20,.35)");
          gl.addColorStop(1, "rgba(255,150,20,0)");
          o.fillStyle = gl;
          o.beginPath();
          o.arc(lx, ly, (on ? 2.2 : 0.6) * m, 0, Math.PI * 2);
          o.fill();
        }
        o.restore();
      } else this.drawCar(o, x, y, scPos.h, carImage(race.cars[0].team, blink, true), m, 1);
    }
    if (real) {
      // câmera inclinada: segue o carro seguido (ou o safety car)
      const fp = fid === "SC" ? scPos : pos.get(fid);
      real.followId = fid;
      real.replayCam = this.replay?.cam ?? shotCam;
      real.camSpec = this.replay || shotCam ? null : shotSpec;
      const camKind = this.replay || shotCam ? "tv" : TILT;
      // (cada tomada nova, o replay e os momentos de TV: corte seco; trocar de câmera na mão continua com a transição)
      const sig = this.replay ? `r${this.replay.tImp}` : shotCam ? `s${shotCam.x.toFixed(0)}` : this.tvDirector && this.shot ? `d${this.shot.n}` : `${camKind}`;
      if (sig !== this.camSig && (this.tvDirector || /^[rsd]/.test(this.camSig) || /^[rsd]/.test(sig))) real.cutNow = true;
      this.camSig = sig;
      real.scMode = race.sc.active;
      real.tilt = TILT && real.ensureTrack(race.track) && fp ? camKind !== "tv" && camKind !== "piloto" ? { x: viewX + W / m / 2, y: viewY + H / m / 2, h: 0, iso: true, span: H / m, yaw: this.tvDirector && this.shot?.yaw != null && camKind === "iso" ? this.shot.yaw : this.isoYaw, kind: camKind ?? undefined } : { x: fp.x, y: fp.y, h: fp.h, kind: camKind, yaw: (window as unknown as { __pilotYaw?: number }).__pilotYaw ?? this.pilotYaw, cover: this.inset } : null;
      real.liveScreen(race);
      real.cloud = this.cloudSm;
      // telões: 12 s a classificação, 8 s a câmera ao vivo do carro seguido; no replay e nos momentos de TV, a câmera
      real.screenLive = !!this.replay || !!shotCam || Math.floor(performance.now() / 1000) % 20 >= 12;
      real.setWet(race.wet, race.rain);
      real.skidMarks(tiltOn ? this.fx.skidList : null, tiltOn ? this.fx.spotList : null);
      real.debris3d(tiltOn ? debrisShown : null);
      // (fumaça, poeira e pedaços que voam na cena 3D: ficam atrás dos carros e das barreiras quando devem)
      real.airFx(tiltOn ? this.fx.partList : null);
      real.draw(o, W, H, m, viewX, viewY, realList, dt, this.realProps);
    }
    // câmera inclinada: os efeitos por cima da cena 3D, e as posições na tela (etiquetas, clique) pela câmera 3D
    let cvAir: typeof toCss = toCss, mAir = m;
    if (tiltOn && real) {
      if (race.wet > 0.02) {
        o.fillStyle = `rgba(20,40,75,${(race.wet * 0.3).toFixed(3)})`;
        o.fillRect(0, 0, W, H);
      }
      cvAir = (q) => real.project(q.x, q.y);
      const fp = fid === "SC" ? scPos : pos.get(fid);
      // (câmera piloto: o carro está colado na câmera; o tamanho dos efeitos é o de 15 m à frente, senão
      // faísca e spray cobriam a tela)
      const pil = TILT === "piloto" && fp;
      mAir = fp ? (pil ? real.scaleAt(fp.x + Math.cos(fp.h) * 15, fp.y + Math.sin(fp.h) * 15) : real.scaleAt(fp.x, fp.y)) : m;
      // (câmeras 3D: faísca fina e brilho pequeno, senão parecia o motor explodindo)
      under(cvAir, mAir, pil ? 0.2 : 0.35, (x, y) => real.scaleAt(x, y), pil ? fp : null);
      for (const f of later) f(cvAir, mAir);
      for (const id of [...this.screenPos.keys()]) {
        const q = id === "SC" ? scPos : pos.get(id);
        if (q) this.screenPos.set(id, real.project(q.x, q.y, 1.2));
      }
    }

    this.fx.drawAir(o, cvAir, mAir, false, 1, tiltOn);
    // som das batidas e da brita deste quadro
    for (const e of this.fx.events) this.onSound?.(e);
    this.fx.events.length = 0;

    // túnel: o teto cobre os carros (as etiquetas continuam aparecendo)
    if (race.track.tunnel) {
      o.setTransform(this.dpr * m, 0, 0, this.dpr * m, -viewX * m * this.dpr, -viewY * m * this.dpr);
      const tp = (this.tunnelPaths ??= tunnelPaths(race.track));
      o.fillStyle = "rgba(0,0,0,0.35)";
      o.fill(tp.shadow);
      o.fillStyle = "#3d4048";
      o.fill(tp.roof);
      o.strokeStyle = "#585c66";
      o.lineWidth = 0.6;
      o.stroke(tp.roof);
      o.strokeStyle = "#ffd98a";
      o.lineWidth = 0.5;
      o.setLineDash([1.2, 6]);
      o.stroke(tp.lights);
      o.setLineDash([]);
      o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // ---- bandeiras (fora do replay: elas são do agora) ----
    if (!this.replay) {
      const t = nowMs / 1000, W2 = TRACK_WIDTH / 2;
      // amarela: dois postos antes do acidente, na beira do lado dele (o pano balança; dupla = duas)
      for (const z of yellowZones(race)) {
        const side = z.lat >= 0 ? 1 : -1;
        for (const back of [70, 160]) {
          const q = race.track.pose(race.track.wrap(z.s - back), side * (W2 + 3.5));
          let bx: number, by: number, tx: number, ty: number, k: number;
          if (tiltOn && real) {
            const a = real.project(q.x, q.y), b = real.project(q.x, q.y, 2.8);
            if (a.x < -100 || a.x > W + 100 || a.y < -100 || a.y > H + 100) continue;
            [bx, by, tx, ty, k] = [a.x, a.y, b.x, b.y, Math.max(0.9, Math.min(3, real.scaleAt(q.x, q.y) / 8))];
          } else {
            const a = toCss(q);
            if (a.x < -100 || a.x > W + 100 || a.y < -100 || a.y > H + 100) continue;
            [bx, by, k] = [a.x, a.y, Math.max(0.9, Math.min(3, m / 8))];
            [tx, ty] = [bx, by - 2.8 * m];
          }
          drawFlag(o, bx, by, tx, ty, 20 * k, 13 * k, "#ffd400", t + back);
          if (z.double) drawFlag(o, bx, by, tx - 2 * k, ty + 15 * k, 20 * k, 13 * k, "#ffd400", t + back + 0.4);
        }
      }
      // azul: em cima do retardatário
      for (const id of blueFlagged(race)) {
        const sp = this.screenPos.get(id);
        if (sp) drawFlag(o, sp.x + 8, sp.y - 8, sp.x + 8, sp.y - 30, 15, 10, "#1f6bff", t);
      }
    }

    // etiquetas: carro seguido, carros dos jogadores e safety car (empilham quando se sobrepõem)
    const placed: { x: number; y: number; w: number }[] = [];
    const lift = Math.max(14, 1.6 * mAir);
    if (scPos) {
      const sp = this.screenPos.get("SC")!;
      this.label(o, sp.x, sp.y - lift, this.followId === "SC" ? "SAFETY CAR" : "SC", "#ffcc00", "#111", placed);
    }
    // disputa do carro seguido: a menos de 0,8 s do da frente (ou do de trás), etiqueta ⚔ com a diferença no meio
    // dos dois
    if (!this.replay && race.phase === "racing") {
      const order = race.ordered(), i = order.findIndex((c) => c.id === this.followId), fc = order[i];
      if (fc && !fc.retired && !fc.finished && fc.pit === "none")
        for (const o2 of [order[i - 1], order[i + 1]]) {
          if (!o2 || o2.retired || o2.finished || o2.pit !== "none") continue;
          const [a, b] = o2 === order[i - 1] ? [o2, fc] : [fc, o2], gap = (race.dist(a) - race.dist(b)) / Math.max(20, b.v);
          const pa = this.screenPos.get(a.id), pb = this.screenPos.get(b.id);
          if (gap < 0.8 && pa && pb) this.label(o, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2 - lift * 0.4, `⚔ ${gap.toFixed(1).replace(".", ",")} s`, "#ff7a00", "#111", placed);
        }
    }
    for (const c0 of race.cars) {
      // (no replay a etiqueta é a de como o carro estava: P20, não OUT)
      const c = this.replay ? this.replayCar(c0) : c0;
      const sp = this.screenPos.get(c.id);
      if (!sp) continue;
      const mine = c.isHuman;
      if (!mine && c.id !== this.followId) continue;
      // (câmera piloto: a etiqueta do próprio carro ficaria em cima da câmera)
      if (c.id === this.followId && tiltMode() === "piloto") continue;
      const eng = this.showEngineers && c.isHuman ? ` (${race.engineers[c.team.id]?.name ?? ""})` : "";
      const txt = (c.retired ? `OUT ${c.driver.short}` : `P${c.position} ${c.driver.short}`) + eng;
      this.label(o, sp.x, sp.y - lift, txt, mine ? c.team.color : "#111", mine && isLight(c.team.color) ? "#111" : "#fff", placed);
    }
    // box: o cronômetro correndo enquanto os mecânicos trabalham
    for (const c of race.cars) {
      if (c.pit !== "stopped" || !c.pitTotal || (c.team.id !== this.myTeam && c.id !== this.followId)) continue;
      const sp = this.screenPos.get(c.id);
      if (sp) this.label(o, sp.x, sp.y - lift, `⏱ ${Math.max(0, c.pitTotal - c.pitTimer).toFixed(1).replace(".", ",")} s`, "#111", "#fff", placed);
    }
    // textos que sobem em cima do carro e somem (entram com um pulinho)
    this.floaters = this.floaters.filter((f) => nowMs - f.t0 < f.dur);
    for (const f of this.floaters) {
      const sp = this.screenPos.get(f.id);
      if (!sp) continue;
      const k = (nowMs - f.t0) / f.dur;
      o.save();
      o.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      // (pulinho na entrada: passa um pouco do tamanho e volta; calmo: sem)
      const pop = calm ? 1 : k < 0.12 ? 1 + 0.35 * Math.sin((k / 0.12) * Math.PI) : 1;
      const y = sp.y - lift - 22 - k * 18;
      o.translate(sp.x, y);
      o.scale(pop, pop);
      this.label(o, 0, 0, f.text, f.bg, f.fg, []);
      o.restore();
    }
    if (this.replay) this.drawReplayBadge(o, W, nowMs);
    // bandeirada: bandeira quadriculada tremulando na linha (dos dois lados) e fogos por 4,5 s
    if (race.checkered && !this.finishAt) {
      this.finishAt = nowMs;
      this.fwNext = nowMs + 300;
    }
    if (this.finishAt && nowMs - this.finishAt < 15000) {
      for (const side of [1, -1]) {
        const q = race.track.pose(0, side * (TRACK_WIDTH / 2 + 2.5));
        if (tiltOn && real) {
          const a = real.project(q.x, q.y), b = real.project(q.x, q.y, 3.2), k = Math.max(0.9, Math.min(3, real.scaleAt(q.x, q.y) / 8));
          drawFlag(o, a.x, a.y, b.x, b.y, 26 * k, 17 * k, "xadrez", nowMs / 1000 + side);
        } else {
          const a = toCss(q), k = Math.max(0.9, Math.min(3, m / 8));
          drawFlag(o, a.x, a.y, a.x, a.y - 3.2 * m, 26 * k, 17 * k, "xadrez", nowMs / 1000 + side);
        }
      }
      if (nowMs - this.finishAt < 4500 && nowMs >= this.fwNext) {
        this.fwNext = nowMs + 380 + Math.random() * 420;
        const win = race.ordered()[0], cols = [win?.team.color ?? "#ffcc00", "#ffd84a", "#ffffff", "#ff5a3c", "#5ac8ff"];
        const bx = W * (0.2 + Math.random() * 0.6), by = H * (0.12 + Math.random() * 0.25), n = calm ? 22 : 46, col = cols[Math.floor(Math.random() * cols.length)];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, sp = 110 + Math.random() * 120;
          this.fireworks.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 1.1 + Math.random() * 0.6, c: col });
        }
      }
    }
    if (this.fireworks.length) {
      const dtf = Math.min(0.05, realDt);
      o.save();
      o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      o.globalCompositeOperation = "lighter";
      this.fireworks = this.fireworks.filter((f) => (f.t += dtf) < f.life);
      for (const f of this.fireworks) {
        f.vy += 120 * dtf;
        f.vx *= 1 - 1.2 * dtf;
        f.vy *= 1 - 1.2 * dtf;
        f.x += f.vx * dtf;
        f.y += f.vy * dtf;
        o.globalAlpha = Math.max(0, 1 - f.t / f.life);
        o.fillStyle = f.c;
        o.beginPath();
        o.arc(f.x, f.y, 3, 0, Math.PI * 2);
        o.fill();
      }
      o.restore();
    }
    // corte pro replay e de volta: clarão branco rápido (como na transmissão)
    if (this.flashAt && nowMs - this.flashAt < 260 && !calm) {
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalAlpha = 0.55 * (1 - (nowMs - this.flashAt) / 260);
      o.fillStyle = "#fff";
      o.fillRect(0, 0, o.canvas.width, o.canvas.height);
      o.restore();
    }
    // seu carro abandonou: a tela perde a cor por um instante e volta
    if (this.greyFrom && nowMs - this.greyFrom < 1600) {
      const k = (nowMs - this.greyFrom) / 1600;
      o.save();
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = "saturation";
      o.globalAlpha = 0.75 * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      o.fillStyle = "#808080";
      o.fillRect(0, 0, o.canvas.width, o.canvas.height);
      o.restore();
    }

    if (race.rain > 0) {
      const fcr = race.cars.find((c) => c.id === this.followId);
      // (de cima cai pro chão, de lado desce a tela, de trás e piloto vem na direção da câmera)
      // (câmera piloto virada pra trás: a chuva não vem mais na direção da câmera, só cai)
      const back = TILT === "piloto" && Math.cos(((window as unknown as { __pilotYaw?: number }).__pilotYaw ?? this.pilotYaw)) < 0;
      const rm = (TILT === "tv" || TILT === "piloto") && !back ? "fwd" : TILT === "iso" || back ? "iso" : "top";
      this.drawRain(o, W, H, realDt, race.rain, rm, fcr ? fcr.v * 3.6 : 0);
    }
    // câmeras 3D: gotas na lente (aparecem, umas escorrem, secam); some aos poucos quando a chuva para
    if (TILT && TILT !== "cima") {
      const fc = race.cars.find((c) => c.id === this.followId);
      // (pausado: as gotas param; acelerado: andam no tempo real, não 16x)
      // (o vento só joga as gotas pras bordas olhando pra frente)
      const look = TILT === "piloto" ? Math.max(0, Math.cos(((window as unknown as { __pilotYaw?: number }).__pilotYaw ?? this.pilotYaw))) : 1;
      this.drawLens(o, W, H, speed > 0 ? realDt : 0, race.rain, fc ? fc.v * 3.6 * look : 0, real3?.canvas);
    } else {
      this.lens.length = 0;
      this.rivulets.length = 0;
    }
    // câmera piloto: velocímetro do carro seguido
    if (TILT === "piloto" && real3) {
      const fc = race.cars.find((c) => c.id === this.followId);
      if (fc) this.drawGauge(o, fc, H, realDt);
    }
    if (race.phase === "lights" || (race.phase === "racing" && race.time < 0.7 && race.leader().lap < 1)) this.drawLights(o, W);
  }

  private tunnelPaths: ReturnType<typeof tunnelPaths> | null = null;

  /** ângulo das rodas da frente: a curvatura um pouco à frente (exagerado pra ler de cima); rodando, contra-esterço */
  private steerSmooth = new Map<string, { v: number; t: number }>();
  /** direção desenhada e posição de cada carro no quadro anterior (pra medir a curva que ele faz de verdade) */
  private headSeen = new Map<string, { h: number; s: number; k: number }>();
  private steerOf(c: Race["cars"][number], h: number): number {
    const tr = this.race.track;
    let target: number;
    // curva que o carro está fazendo de verdade: quanto a direção dele muda por metro (inclui troca de
    // faixa, ultrapassagem e desvio, que a curvatura da pista não mostra)
    // (pela posição desenhada, que anda junto com o bico; a da simulação anda aos saltos. Mede a cada
    // meio metro pelo menos: em pedacinhos menores qualquer tremida virava esterço)
    const s = this.interp.get(c.id)?.s ?? c.s;
    const prev = this.headSeen.get(c.id);
    let kPath = prev?.k ?? 0;
    const ds = prev ? tr.wrap(s - prev.s) : 0;
    if (prev && ds > 0.5 && ds < 40) kPath += (angDiff(prev.h, h) / ds - kPath) * 0.35;
    if (!prev || ds > 0.5) this.headSeen.set(c.id, { h, s, k: kPath });
    if (c.spin > 0) target = Math.sin(performance.now() / 90) * 0.45; // contra-esterço rodando
    else {
      // curvatura logo à frente (o piloto já vira na entrada) misturada com a curva real do carro;
      // ângulo proporcional: raio 300 m ≈ 5°, 100 m ≈ 14°, grampo = batente (exagerado de propósito pra ler de cima)
      let k = 0;
      for (const d of [2, 5, 8, 11]) k += tr.curvature[Math.floor(tr.wrap(c.s + d)) % tr.L] ?? 0;
      // (nas câmeras 3D de lado e de trás o exagero lia errado: lá o ângulo fica perto do de verdade, batente ~20°)
      // (carros 3D: ângulo real em todas as câmeras; o exagero era pros carros 2D vistos de cima)
      const tilt = !!tiltMode() || car3dPref.style === "real", gain = tilt ? 8 : 25, cap = tilt ? 0.24 : 0.5;
      target = Math.max(-cap, Math.min(cap, (0.45 * (k / 4) + 0.55 * kPath) * gain));
    }
    // suave: o volante não pula de uma posição pra outra
    const now = performance.now();
    const st = this.steerSmooth.get(c.id) ?? { v: target, t: now };
    st.v += (target - st.v) * Math.min(1, ((now - st.t) / 1000) * 7);
    st.t = now;
    this.steerSmooth.set(c.id, st);
    return st.v;
  }

  /** alguma peça saiu neste quadro: solta o pedaço (voa pra frente, girando, e fica na pista) */
  private dropParts(c: Race["cars"][number], look: CarLook, p: { x: number; y: number; h: number }) {
    const prev = this.lookSeen.get(c.id);
    this.lookSeen.set(c.id, look);
    if (!prev) return;
    // (a figura do carro estilizado só existe com ele carregado; a peça do 3D vem do próprio carro 3D)
    const fig = (part: "asa_d" | "asa_t" | "roda", which: "full" | "l" | "r" | number) => (car3dPref.on ? partPiece(c.team, part, which) : null);
    // onde cada peça fica no carro (m), quando não tem a figura
    const AT: Record<string, [number, number]> = { asa_d: [2.35, 0], asa_t: [-2.4, 0], roda_fe: [1.55, 0.72], roda_fd: [1.55, -0.72], roda_te: [-1.6, 0.72], roda_td: [-1.6, -0.72] };
    const out: { node: string; piece: ReturnType<typeof partPiece> }[] = [];
    const wing = (part: "asa_d" | "asa_t", a: CarLook["fw"], b: CarLook["fw"]) => {
      if (a.state === b.state) return;
      if (b.state === "half") out.push({ node: part, piece: fig(part, b.side) });
      else if (b.state === "none") out.push({ node: part, piece: fig(part, a.state === "half" ? (a.side === "l" ? "r" : "l") : "full") });
    };
    wing("asa_d", prev.fw, look.fw);
    wing("asa_t", prev.rw, look.rw);
    look.wheels.forEach((w, i) => {
      if (w === "off" && prev.wheels[i] !== "off") out.push({ node: (["roda_fe", "roda_fd", "roda_te", "roda_td"] as const)[i], piece: fig("roda", i) });
    });
    const fx = Math.cos(p.h), fy = Math.sin(p.h), v0 = Math.min(55, Math.max(c.v, this.fx.recentSpeed(c.id)));
    // (bateu fora da pista: o muro fica do lado de fora, o pedaço volta pro lado da pista)
    const toTrack = c.offTrack > 0 || Math.abs(c.lateral) > TRACK_WIDTH / 2 ? -Math.sign(c.lateral) : 0;
    for (const { node, piece } of out) {
      const [dx, dy] = piece ? [piece.dx, piece.dy] : AT[node];
      const side = toTrack ? toTrack * (3 + Math.random() * 6) : (Math.random() - 0.5) * 8 + dy * 3;
      // sai de onde a peça estava no carro e gira em volta de si mesma
      const x = p.x + fx * dx - fy * dy, y = p.y + fy * dx + fx * dy;
      const fwd = v0 * (0.3 + Math.random() * 0.3);
      this.addDebris({ img: piece?.img ?? null, node, carId: c.id, x, y, h: p.h, vx: fx * fwd - fy * side, vy: fy * fwd + fx * side, s: c.s, r: node.startsWith("roda") ? 0.33 : 0.6, z: 0.4, vz: 2.5 + Math.random() * 3 });
    }
    while (!this.replay && this.debris.length > 40) this.debris.shift();
  }

  /** pedaço solto (com altura, girando e capotando) */
  private addDebris(d: Partial<Debris> & { node: string; x: number; y: number; vx: number; vy: number; s: number; r: number }) {
    const sg = () => (Math.random() < 0.5 ? -1 : 1);
    // (no replay: pedaço "fantasma", que some quando ele acaba)
    this.debris.push({ img: null, carId: "", h: Math.random() * 6.3, spin: (Math.random() - 0.5) * 12, t: 0, z: 0.4, vz: 3, tx: 0, tz: 0, wx: sg() * (4 + Math.random() * 8), wz: sg() * (3 + Math.random() * 7), roll: 0, born: this.lastRt, ghost: !!this.replay, ...d });
  }

  /**
   * um passo de um pedaço solto: no ar cai e capota; no chão quica (cada vez menos), escorrega e para — a roda rola
   * em pé enquanto tem velocidade e depois tomba; bate na barreira da pista e volta
   */
  private stepDebris(d: Debris, dt: number) {
    if (dt <= 0) return;
    const track = this.race.track, wheel = d.node.startsWith("roda") || d.node === "pneu";
    if (d.z > 0 || d.vz > 0) {
      d.vz -= 9.8 * dt;
      d.z += d.vz * dt;
      d.tx += d.wx * dt;
      d.tz += d.wz * dt;
      d.h += d.spin * dt;
      if (d.z <= 0) {
        d.z = 0;
        if (d.vz < -1.8) {
          // quicou: perde força, gira menos
          d.vz = -d.vz * 0.35;
          d.vx *= 0.72;
          d.vy *= 0.72;
          d.wx *= 0.5;
          d.wz *= 0.5;
          d.spin *= 0.6;
        } else d.vz = 0;
      }
    } else {
      const sp = Math.hypot(d.vx, d.vy);
      // (a roda em pé rola longe; o resto arrasta e para logo)
      const rolling = wheel && sp > 2.2;
      const f = Math.exp(-(rolling ? 0.35 : 3.2) * dt);
      d.vx *= f;
      d.vy *= f;
      d.spin *= Math.exp(-4 * dt);
      d.h += d.spin * dt;
      const ease = 1 - Math.exp(-8 * dt), up = Math.round(d.tx / Math.PI) * Math.PI;
      d.tx += (up - d.tx) * ease;
      if (rolling) {
        // em pé, na direção em que anda
        d.tz += (Math.round(d.tz / Math.PI) * Math.PI - d.tz) * ease;
        d.h += Math.atan2(Math.sin(Math.atan2(d.vy, d.vx) - d.h), Math.cos(Math.atan2(d.vy, d.vx) - d.h)) * ease;
        d.roll += (sp * dt) / 0.33;
      } else {
        // deitado: a roda tomba pro lado; a asa e as placas ficam de barriga pra baixo
        const lie = wheel ? (d.tz >= 0 ? Math.PI / 2 : -Math.PI / 2) : Math.round(d.tz / Math.PI) * Math.PI;
        d.tz += (lie - d.tz) * ease;
      }
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    // onde fica na pista (pra bater na barreira): anda o s junto
    const q0 = track.pose(d.s, 0);
    d.s = track.wrap(d.s + (d.vx * Math.cos(q0.h) + d.vy * Math.sin(q0.h)) * dt);
    const q = track.pose(d.s, 0);
    const lat = -Math.sin(q.h) * (d.x - q.x) + Math.cos(q.h) * (d.y - q.y), side = lat >= 0 ? 1 : -1;
    const bar = this.race.barrierAt(d.s, side) - d.r;
    if (Math.abs(lat) > bar) {
      const nx = -Math.sin(q.h) * side, ny = Math.cos(q.h) * side, over = Math.abs(lat) - bar;
      d.x -= nx * over;
      d.y -= ny * over;
      const vn = d.vx * nx + d.vy * ny;
      if (vn > 0) {
        d.vx -= 1.35 * vn * nx;
        d.vy -= 1.35 * vn * ny;
        d.spin = -d.spin * 0.5;
      }
    }
  }

  /**
   * o carro desenhado chegou na batida (Snap.imp subiu): efeitos no canto que encostou, marca na barreira e, se
   * destruiu, os pedaços grandes (bico, espelhos, placas de fibra; asa e roda saem pelo dropParts) e os pneus da
   * barreira espalhados
   */
  private onImpact(c: Race["cars"][number], p: { x: number; y: number; h: number }, it: { s: number; lat: number; yaw: number }, real: RealCars | null, ghost = false) {
    // (replay: a batida de verdade foi a guardada em crashAt; a última do carro pode ser um toque depois dela)
    const was = this.crashAt.get(c.id), atCrash = ghost && !!was && Math.abs(this.lastRt - was.t) < 0.3;
    const imp = atCrash ? was!.imp : c.impact!, track = this.race.track, follow = c.id === this.followId;
    const { reach, rx, lx, ly } = outerCorner(it.yaw, 2.4, 0.95, imp.side);
    const cp = track.pose(it.s + rx, it.lat + imp.side * reach);
    const barreira = real?.barrierKindAt(cp.x, cp.y) ?? (track.def.street ? "muro" : "");
    const crash = imp.crash && (ghost ? atCrash : !this.fx.landed(c.id));
    // (a roda que sai é a do canto que bateu: frente/trás e o lado do carro)
    if (crash && !ghost) this.lostWheel.set(c.id, (lx > 0 ? 0 : 2) + (ly > 0 ? 1 : 0));
    this.fx.impact(c, p, it.yaw, imp.v, crash, imp.side, follow || ghost, barreira, it, cp, ghost);
    const th = track.pose(it.s, 0).h, team = c.team.livery?.base ?? c.team.color;
    if (!ghost && real && (barreira === "guardrail" || barreira === "muro")) real.scuff(cp.x, cp.y, th, imp.side, 1.5 + Math.min(4, imp.v * 0.15), team);
    if (!crash) return;
    if (!ghost) this.crashAt.set(c.id, { t: this.lastRt, imp: { ...imp } });
    const v0 = Math.min(55, Math.max(c.v, this.fx.recentSpeed(c.id))), toTrack = -imp.side;
    const fx = Math.cos(th), fy = Math.sin(th);
    const go = (along: number, lat: number): [number, number] => [fx * along - fy * lat, fy * along + fx * lat];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const bits: [string, number, string][] = [["bico", 0.5, team], ["placa", 0.3, "#1e2026"], ["placa", 0.3, "#24262c"], ["espelho", 0.12, "#16171a"]];
    if (Math.random() < 0.6) bits.push(["espelho", 0.12, team]);
    for (const [node, r, col] of bits) {
      if (node === "bico" && lx < 0) continue;
      const [vx, vy] = go(v0 * rnd(0.15, 0.5) + rnd(-2, 2), toTrack * rnd(1, 7) + rnd(-1.5, 1.5));
      this.addDebris({ node, carId: c.id, c: col, x: cp.x, y: cp.y, s: it.s, r, vx, vy, z: rnd(0.3, 0.7), vz: rnd(2, 6) });
    }
    // pneus da barreira: os que o carro acertou saem rolando e quicando
    if (barreira === "pneu")
      for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) {
        const [vx, vy] = go(v0 * rnd(0.15, 0.45) + rnd(-2, 2), toTrack * rnd(0.5, 5) + rnd(-1.5, 1.5));
        this.addDebris({ node: "pneu", c: i % 2 ? "#f2f2f2" : "#1c1c1c", x: cp.x + rnd(-0.6, 0.6), y: cp.y + rnd(-0.6, 0.6), s: it.s, r: 0.32, vx, vy, z: rnd(0.2, 0.9), vz: rnd(1.5, 4.5) });
      }
  }


  /** selo do replay no alto da tela: bolinha vermelha piscando, REPLAY e "clique pra pular" */
  private drawReplayBadge(o: CanvasRenderingContext2D, W: number, nowMs: number) {
    const dpr = o.canvas.width / Math.max(1, W);
    o.save();
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    // (abaixo dos botões de velocidade e da faixa do safety car)
    const x = W / 2, y = 128, hint = tr("clique pra pular");
    const big = "800 20px 'Barlow Condensed', 'Rajdhani', sans-serif", small = "600 12px 'Barlow Condensed', 'Rajdhani', sans-serif";
    o.font = big;
    const w1 = o.measureText("REPLAY").width;
    o.font = small;
    const w2 = o.measureText(hint).width, bw = 34 + w1 + 14 + w2 + 14, x0 = x - bw / 2;
    o.fillStyle = "rgba(12,14,20,0.82)";
    o.beginPath();
    o.roundRect(x0, y - 18, bw, 36, 6);
    o.fill();
    o.fillStyle = "#e10600";
    o.fillRect(x0, y - 18, 4, 36);
    if (Math.floor(nowMs / 450) % 2 === 0) {
      o.beginPath();
      o.arc(x0 + 20, y, 6, 0, Math.PI * 2);
      o.fill();
    }
    o.textBaseline = "middle";
    o.fillStyle = "#fff";
    o.font = big;
    o.fillText("REPLAY", x0 + 34, y + 1);
    o.fillStyle = "rgba(255,255,255,0.6)";
    o.font = small;
    o.fillText(hint, x0 + 34 + w1 + 14, y + 1);
    o.restore();
  }

  private drawCar(o: CanvasRenderingContext2D, x: number, y: number, h: number, img: ReturnType<typeof carImage>, m: number, alpha: number) {
    o.save();
    o.translate(x, y);
    o.rotate(h);
    o.globalAlpha = alpha;
    o.drawImage(img.canvas, (-img.wM / 2) * m, (-img.hM / 2) * m, img.wM * m, img.hM * m);
    o.restore();
  }

  /** acelerador e freio do velocímetro (de quanto a velocidade sobe ou desce), suavizados */
  private ped = { v: 0, thr: 0, brk: 0 };
  /** velocímetro da câmera piloto (desenho do jogo): anel da velocidade com marcas, marcha no meio, giro em
   * cima e as barras de acelerador (verde) e freio (vermelho) do lado */
  private drawGauge(o: CanvasRenderingContext2D, car: Race["cars"][number], H: number, dt: number) {
    const p = this.ped, kmh = Math.max(0, car.v * 3.6);
    if (dt > 0) {
      const acc = (car.v - p.v) / dt;
      p.thr += ((acc > 0.4 ? 1 : acc > -1 ? 0.35 : 0) - p.thr) * Math.min(1, dt * 8);
      p.brk += ((acc < -6 ? 1 : acc < -2 ? 0.5 : 0) - p.brk) * Math.min(1, dt * 10);
      p.v = car.v;
    }
    const { gear, rev } = gearOf(car.id, kmh, this.race.sc.active);
    const r = Math.max(52, Math.min(80, H * 0.075)), cx = 28 + r, cy = H - 92 - r;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, at = (f: number) => a0 + (a1 - a0) * Math.max(0, Math.min(1, f));
    o.save();
    // fundo
    o.fillStyle = "rgba(10,14,22,.78)";
    o.beginPath();
    o.arc(cx, cy, r + 8, 0, Math.PI * 2);
    o.fill();
    // marcas a cada 20 km/h (0 a 360)
    o.strokeStyle = "rgba(255,255,255,.55)";
    for (let k = 0; k <= 360; k += 20) {
      const a = at(k / 360), big = k % 60 === 0;
      o.lineWidth = big ? 2 : 1;
      o.beginPath();
      o.moveTo(cx + Math.cos(a) * (r - (big ? 9 : 5)), cy + Math.sin(a) * (r - (big ? 9 : 5)));
      o.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      o.stroke();
    }
    // anel da velocidade
    o.lineCap = "round";
    o.lineWidth = 5;
    o.strokeStyle = "rgba(255,255,255,.12)";
    o.beginPath();
    o.arc(cx, cy, r + 2, a0, a1);
    o.stroke();
    o.strokeStyle = kmh > 300 ? "#ff5a3c" : "#2ec4ff";
    o.beginPath();
    o.arc(cx, cy, r + 2, a0, at(kmh / 360));
    o.stroke();
    // giro: risquinho fino por dentro
    o.lineWidth = 3;
    o.strokeStyle = rev > 0.85 ? "#ff3b3b" : "#ffd21a";
    o.beginPath();
    o.arc(cx, cy, r - 14, a0, at(rev));
    o.stroke();
    // marcha e velocidade
    o.textAlign = "center";
    o.fillStyle = "#fff";
    o.font = `800 ${Math.round(r * 0.62)}px "Titillium Web", "Segoe UI", sans-serif`;
    o.fillText(gear, cx, cy + r * 0.12);
    o.font = `700 ${Math.round(r * 0.3)}px "Titillium Web", "Segoe UI", sans-serif`;
    o.fillText(String(Math.round(kmh)), cx, cy + r * 0.5);
    o.font = `600 ${Math.round(r * 0.14)}px sans-serif`;
    o.fillStyle = "rgba(255,255,255,.6)";
    o.fillText("KM/H", cx, cy + r * 0.68);
    // acelerador e freio: duas barras do lado
    const bh = r * 1.5, bx = cx + r + 16, by = cy - bh / 2;
    const bar = (x: number, f: number, col: string) => {
      o.fillStyle = "rgba(10,14,22,.78)";
      o.fillRect(x - 1, by - 1, 10, bh + 2);
      o.fillStyle = col;
      o.fillRect(x, by + bh * (1 - f), 8, bh * f);
    };
    bar(bx, p.thr, "#2fd36b");
    bar(bx + 13, p.brk, "#ff3b3b");
    o.restore();
  }

  private label(o: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, placed: { x: number; y: number; w: number }[]) {
    o.font = "600 12px Oswald, sans-serif";
    o.textAlign = "center";
    o.textBaseline = "middle";
    const w = Math.ceil(o.measureText(text).width) + 10;
    const anchor = y;
    // sobe a etiqueta até não encostar em nenhuma já desenhada
    const hits = () => placed.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 + 3 && Math.abs(r.y - y) < 17);
    for (let k = 0; k < 6 && hits(); k++) y -= 17;
    placed.push({ x, y, w });
    o.fillStyle = "rgba(0,0,0,0.55)";
    o.fillRect(x - 0.75, y + 7, 1.5, anchor - y + 4);
    o.fillStyle = "rgba(0,0,0,0.5)";
    o.fillRect(x - w / 2 + 2, y - 7 + 2, w, 15);
    o.fillStyle = bg;
    o.fillRect(x - w / 2, y - 7, w, 15);
    o.fillStyle = fg;
    o.fillText(text, x, y + 1);
  }

  /** água no ar (m, mundo da pista): sai das rodas de trás, abre, perde velocidade e some */
  private mist: { x: number; y: number; vx: number; vy: number; r: number; a: number; t: number; life: number }[] = [];

  /**
   * Spray na chuva: uma névoa contínua atrás do carro (mais forte quanto mais rápido e mais molhado) e a
   * água das duas rodas de trás subindo pra trás. `wet` já vem multiplicado pelo nível nas configurações.
   */
  private spray(o: CanvasRenderingContext2D, x: number, y: number, h: number, wet: number, m: number, p: { x: number; y: number }, v: number, dt: number) {
    const fx = Math.cos(h), fy = Math.sin(h);
    const k = Math.min(1, (v - 25) / 45) * wet;
    // névoa: mancha comprida e macia atrás do carro
    const bx = x - fx * 4.2 * m, by = y - fy * 4.2 * m;
    o.save();
    o.translate(bx, by);
    o.rotate(h);
    o.scale(1, 0.42);
    const gr = o.createRadialGradient(0, 0, 0, 0, 0, 4.6 * m);
    gr.addColorStop(0, `rgba(225,232,242,${(0.3 * k).toFixed(3)})`);
    gr.addColorStop(1, "rgba(225,232,242,0)");
    o.fillStyle = gr;
    o.beginPath();
    o.arc(0, 0, 4.6 * m, 0, Math.PI * 2);
    o.fill();
    o.restore();
    // água das rodas: nasce rápida (quase na velocidade do carro) e vai ficando pra trás
    let n = k * 60 * dt;
    while (n > 0 && (n >= 1 || Math.random() < n)) {
      n -= 1;
      const side = Math.random() < 0.5 ? -0.75 : 0.75;
      const sx = p.x - fx * 1.7 - fy * side, sy = p.y - fy * 1.7 + fx * side;
      const sp = v * (0.55 + Math.random() * 0.2), lat = (Math.random() - 0.5) * 5 + side * 2.5;
      this.mist.push({ x: sx, y: sy, vx: fx * sp - fy * lat, vy: fy * sp + fx * lat, r: 0.35, a: 0.16 + Math.random() * 0.12, t: 0, life: 0.7 + Math.random() * 0.5 });
    }
    if (this.mist.length > 900) this.mist.splice(0, this.mist.length - 900);
  }

  /** anda e desenha a água no ar (antes dos carros: ela fica atrás deles) */
  /**
   * `scaleAt`: nas câmeras 3D, o tamanho de cada nuvem pela distância dela (perto grande, longe pequena; um
   * tamanho só pra tela toda bugava); `skipNear`: câmera piloto, o spray que nasce no próprio carro não aparece
   */
  private mistStep(o: CanvasRenderingContext2D, dt: number, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number, scaleAt?: (x: number, y: number) => number, skipNear?: { x: number; y: number } | null) {
    if (!this.mist.length) return;
    o.save();
    for (const d of this.mist) {
      d.t += dt;
      const drag = Math.exp(-2.6 * dt);
      d.vx *= drag;
      d.vy *= drag;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.r += dt * 2.6;
      const q = d.t / d.life;
      if (q >= 1) continue;
      if (skipNear && Math.hypot(d.x - skipNear.x, d.y - skipNear.y) < 7) continue;
      // (nunca maior que um quarto da tela: perto da câmera virava uma parede branca)
      const c = toCss(d), r = Math.min(o.canvas.height * 0.25, d.r * (scaleAt ? scaleAt(d.x, d.y) : m));
      if (!Number.isFinite(c.x) || !Number.isFinite(r) || r <= 0) continue;
      o.globalAlpha = d.a * (1 - q) * (q < 0.15 ? q / 0.15 : 1);
      o.drawImage(puff(), c.x - r, c.y - r, r * 2, r * 2);
    }
    o.restore();
    this.mist = this.mist.filter((d) => d.t < d.life);
  }

  /**
   * Guindaste (render do Blender, visto de cima): chega por trás pela área de escape, para com o gancho
   * em cima do carro, levanta e vai embora com ele pendurado. Devolve onde o carro está (px), virado pra
   * onde, escala (no ar) e opacidade.
   */
  private crane(o: CanvasRenderingContext2D, c: Race["cars"][number], p: { x: number; y: number; h: number }, carH: number, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number) {
    const r = c.recover!, q = Math.min(1, r.t / r.dur);
    const t = this.race.track;
    const ease = (v: number) => {
      const k = Math.max(0, Math.min(1, v));
      return k * k * (3 - 2 * k);
    };
    const seg = (a: number, b: number) => ease((q - a) / (b - a));
    const cr = prop("crane");
    // (no 3D a lança é estendida 3 m: art/export_props_glb.py; o carro sobe por cima da cabine)
    const hookF = (cr?.hookF ?? 5.8) + (this.realOn ? 3 : 0), hookL = cr?.hookL ?? 0;
    // direções: frente da pista e "pra fora" (lado em que o carro parou)
    const fx = Math.cos(p.h), fy = Math.sin(p.h);
    const a = t.pose(c.s, c.lateral), b = t.pose(c.s, c.lateral + 1);
    const side = c.lateral >= 0 ? 1 : -1;
    const nx = (b.x - a.x) * side, ny = (b.y - a.y) * side;
    const at = (f: number, n: number) => ({ x: p.x + fx * f + nx * n, y: p.y + fy * f + ny * n });
    // o gancho para em cima do carro: o caminhão fica atrás dele, alinhado com a pista
    const park = at(-hookF, 0), from = at(-60, 10), away = at(70, 18);
    const inn = seg(0, 0.3), out = seg(0.7, 1);
    const tx = from.x + (park.x - from.x) * inn + (away.x - park.x) * out;
    const ty = from.y + (park.y - from.y) * inn + (away.y - park.y) * out;
    const turn = (h0: number, h1: number, k: number) => h0 + angDiff(h0, h1) * k;
    const th = q < 0.3 ? turn(Math.atan2(park.y - from.y, park.x - from.x), p.h, inn) : turn(p.h, Math.atan2(away.y - park.y, away.x - park.x), Math.min(1, out * 3));
    const tfx = Math.cos(th), tfy = Math.sin(th);
    // gancho no mundo (anda com o caminhão)
    const hook = { x: tx + tfx * hookF - tfy * hookL, y: ty + tfy * hookF + tfx * hookL };
    // carro: parado até o gancho chegar; depois sobe e vai pendurado (girando pra ficar alinhado)
    const up = seg(0.4, 0.55);
    const hang = q >= 0.4;
    const carW = hang ? hook : { x: p.x, y: p.y };
    const fade = 1 - seg(0.92, 1);
    const tp = toCss({ x: tx, y: ty });
    // modo 3D: o guindaste vai pra camada 3D (com sombra), senão a imagem vista de cima
    if (this.realOn && realPropReady?.("crane")) this.realProps.push({ kind: "crane", id: `crane-${c.id}`, x: tx, y: ty, h: th });
    else if (cr) drawProp(o, cr, tp.x, tp.y, th, m, fade);
    const cp = toCss(carW);
    return { x: cp.x, y: cp.y, h: turn(carH, th, seg(0.55, 0.75)), scale: 1 + up * 0.18, alpha: fade };
  }

  /** a camada dos carros 3D de verdade (o Three.js só é baixado na primeira vez); null enquanto carrega */
  private real3d: RealCars | null = null;
  /** safety car e guindaste deste quadro (modo 3D) */
  private realProps: PropDraw[] = [];
  private realOn = false;
  private real3dLoading = false;
  private realCars(): RealCars | null {
    if (this.real3d) return realCarsReadyFn?.() ? this.real3d : null;
    if (!this.real3dLoading) {
      this.real3dLoading = true;
      void import("./cars3dReal").then((mod) => {
        realCarsReadyFn = mod.realCarsReady;
        realPropReady = mod.propReady;
        mod.realCarsReady();
        this.real3d = new mod.RealCars();
      });
    }
    return null;
  }

  private smoke(o: CanvasRenderingContext2D, x: number, y: number, m: number) {
    const t = performance.now() / 1000;
    for (let i = 0; i < 8; i++) {
      const k = (t * 0.7 + i / 8) % 1;
      o.fillStyle = `rgba(150,150,150,${(0.45 * (1 - k)).toFixed(2)})`;
      o.beginPath();
      o.arc(x + Math.sin(i * 3.1 + t) * 0.8 * m, y - k * 4 * m, (0.4 + k * 0.8) * m, 0, Math.PI * 2);
      o.fill();
    }
  }

  /**
   * chuva caindo. Vista de cima: cada pingo com velocidade e tamanho próprios e o vento mudando o ângulo
   * aos poucos. Câmeras 3D (`perspective`): a chuva vem na direção da câmera, saindo do ponto de fuga e se
   * abrindo pras bordas, mais rápida e comprida quanto mais rápido o carro anda
   */
  private drawRain(o: CanvasRenderingContext2D, W: number, H: number, dt: number, rain: number, mode: "top" | "iso" | "fwd" = "top", kmh = 0) {
    const perspective = mode === "fwd";
    const want = Math.round(rain * 420 * (W * H) / (1600 * 1000));
    const vx0 = W / 2, vy0 = H * 0.42;
    const spawn = (d?: { x: number; y: number; l: number; v: number; z: number }) => {
      const nd = d ?? { x: 0, y: 0, l: 0, v: 0, z: 0 };
      nd.z = Math.random();
      if (perspective) {
        // perto do ponto de fuga, num leque
        const a = Math.random() * Math.PI * 2, r = Math.random() * Math.min(W, H) * 0.35;
        nd.x = vx0 + Math.cos(a) * r;
        nd.y = vy0 + Math.sin(a) * r * 0.7;
      } else {
        // (de cima: em qualquer lugar da tela, cai pro chão; de lado: entra por cima)
        nd.x = Math.random() * (W + 160) - 80;
        nd.y = mode === "top" || !d ? Math.random() * H : -20;
        (nd as { t?: number }).t = 0;
      }
      nd.l = 6 + Math.random() * 14;
      nd.v = 0.7 + Math.random() * 0.6;
      return nd;
    };
    while (this.drops.length < want) this.drops.push(spawn());
    if (this.drops.length > want) this.drops.length = want;
    this.gust += ((Math.sin(performance.now() / 2300) + Math.sin(performance.now() / 870) * 0.4) * 140 - this.gust) * Math.min(1, dt * 2);
    const go = Math.min(1, kmh / 280);
    o.lineCap = "round";
    // (três camadas: os de trás finos e fracos, os da frente grossos)
    for (const layer of [0, 1, 2]) {
      o.strokeStyle = `rgba(185,205,235,${(0.22 + layer * 0.12).toFixed(2)})`;
      o.lineWidth = 0.8 + layer * 0.55;
      o.beginPath();
      for (const d of this.drops) {
        if (Math.min(2, Math.floor(d.z * 3)) !== layer) continue;
        let dx: number, dy: number;
        if (perspective) {
          // sai do ponto de fuga e acelera pra fora (quanto mais longe do meio, mais rápido), e cai um pouco
          const ox = d.x - vx0, oy = d.y - vy0;
          const k = (0.9 + go * 2.4) * d.v;
          dx = ox * k + this.gust * 0.3;
          dy = oy * k + 380 * d.v;
        } else if (mode === "iso") {
          // câmera inclinada pra baixo: cai descendo a tela, juntando um pouco num ponto bem abaixo dela
          const tx = W / 2 - d.x, ty = H * 3 - d.y, tl = Math.hypot(tx, ty) || 1;
          dx = (tx / tl) * 820 * d.v + this.gust * 0.4;
          dy = (ty / tl) * 820 * d.v;
        } else {
          // de cima: o pingo cai pra longe da câmera, então anda pro meio da tela e some no chão
          dx = (W / 2 - d.x) * 1.6 * d.v + this.gust * 0.15;
          dy = (H / 2 - d.y) * 1.6 * d.v;
          const dd = d as { t?: number };
          dd.t = (dd.t ?? 0) + dt;
          if (dd.t > 0.25 + d.v * 0.2) {
            spawn(d);
            continue;
          }
        }
        d.x += dx * dt;
        d.y += dy * dt;
        if (d.y > H + 20 || d.x < -40 || d.x > W + 40 || d.y < -40) {
          spawn(d);
          continue;
        }
        // risco na direção do movimento, do tamanho da velocidade
        const sp = Math.hypot(dx, dy) || 1, len = d.l * (0.6 + d.z * 0.8) * (perspective ? 0.6 + sp / 900 : mode === "top" ? 0.5 : 1);
        o.moveTo(d.x, d.y);
        o.lineTo(d.x - (dx / sp) * len, d.y - (dy / sp) * len);
      }
      o.stroke();
    }
  }


  /**
   * gotas na lente: posição, raio, idade, vida, velocidade (escorrer e vento), forma (ovalada e girada) e
   * de onde soltou a última gotinha do rastro
   */
  private lens: { x: number; y: number; r: number; t: number; life: number; vx: number; vy: number; ax: number; rot: number; lx: number; ly: number; slide: boolean; dead?: boolean }[] = [];
  /** filetes compridos de água escorrendo (chuva forte) */
  private rivulets: { x: number; y: number; len: number; w: number; t: number; life: number; v: number }[] = [];
  /**
   * gotas na lente das câmeras 3D, como em vidro: quase transparentes, formas irregulares, um brilho pequeno e
   * a borda escura só de um lado. Gotas que se encostam viram uma maior (que escorre); quem escorre deixa
   * gotinhas pelo caminho. Com o carro rápido o vento empurra tudo pras bordas. Chuva forte: véu e filetes
   */
  /** foto pequena da cena 3D deste quadro (cada gota grande mostra o pedaço de trás dela, invertido) */
  private snap: HTMLCanvasElement | null = null;
  private drawLens(o: CanvasRenderingContext2D, W: number, H: number, dt: number, rain: number, kmh = 0, scene?: HTMLCanvasElement) {
    const k = H / 1000, cx = W / 2, cy = H * 0.45;
    // (um terço do tamanho: barato e a gota é pequena)
    let snap: HTMLCanvasElement | null = null;
    if (scene && scene.width > 0 && this.lens.some((d) => d.r >= 2.4 * k)) {
      snap = this.snap ??= document.createElement("canvas");
      const sw = Math.max(1, Math.round(W / 3)), sh = Math.max(1, Math.round(H / 3));
      if (snap.width !== sw || snap.height !== sh) {
        snap.width = sw;
        snap.height = sh;
      }
      try {
        snap.getContext("2d")!.drawImage(scene, 0, 0, scene.width, scene.height, 0, 0, sw, sh);
      } catch {
        snap = null;
      }
    }
    // (chuva normal, ~55%: ~280 gotas; forte, 85%: ~430; fraca, menos)
    const amt = rain / 0.55;
    const max = Math.min(450, 280 * amt);
    const born = dt * (90 + kmh * 1.6) * 0.55 * amt;
    const add = (x: number, y: number, r: number, life: number, slide: boolean) =>
      this.lens.push({ x, y, r, t: 0, life, vx: 0, vy: 0, ax: 0.72 + Math.random() * 0.28, rot: Math.random() * Math.PI, lx: x, ly: y, slide });
    for (let n = Math.floor(born) + (Math.random() < born % 1 ? 1 : 0); n > 0 && this.lens.length < max; n--) {
      const roll = Math.random();
      const r = (roll < 0.62 ? 1.2 + Math.random() * 2.6 : roll < 0.95 ? 3.8 + Math.random() * 6 : 9.5 + Math.random() * 9) * k;
      add(Math.random() * W, Math.random() * H, r, 1.5 + Math.random() * (r > 5 * k ? 5 : 2.5), false);
    }
    const wind = Math.min(1, kmh / 250);
    // gotas que se encostam viram uma só (área somada) e a maior começa a escorrer
    for (let i = 0; i < this.lens.length; i++) {
      const A = this.lens[i];
      if (A.dead || A.r < 2 * k) continue;
      for (let j = i + 1; j < this.lens.length; j++) {
        const B = this.lens[j];
        if (B.dead || B.r < 2 * k) continue;
        if (Math.hypot(A.x - B.x, A.y - B.y) < (A.r + B.r) * 0.8) {
          const big = A.r >= B.r ? A : B, small = big === A ? B : A;
          big.r = Math.min(24 * k, Math.hypot(big.r, small.r));
          big.slide = big.r > 4 * k;
          big.life = Math.max(big.life, big.t + 3);
          small.dead = true;
        }
      }
    }
    o.save();
    if (rain > 0.3) {
      o.fillStyle = `rgba(175,190,210,${(0.06 * rain).toFixed(3)})`;
      o.fillRect(0, 0, W, H);
    }
    const trail: [number, number, number][] = [];
    for (const d of this.lens) {
      if (d.dead) continue;
      d.t += dt;
      const ox = (d.x - cx) / W, oy = (d.y - cy) / H;
      d.vx += (ox * 420 * wind - d.vx) * Math.min(1, dt * 3);
      const fall = d.slide && d.t > 0.3 ? 30 + d.r * 7 : 0;
      d.vy += (oy * 330 * wind + fall - d.vy) * Math.min(1, dt * 3);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // rastro: quem anda solta gotinhas pelo caminho (e vai encolhendo um tiquinho)
      if (d.r > 2 * k && Math.hypot(d.x - d.lx, d.y - d.ly) > d.r * 1.3) {
        trail.push([d.lx + (Math.random() - 0.5) * d.r * 0.6, d.ly, (0.5 + Math.random() * 0.6) * k]);
        d.lx = d.x;
        d.ly = d.y;
        d.r *= 0.985;
      }
      const fade = Math.min(1, d.t * 8) * Math.max(0, 1 - Math.max(0, d.t - d.life + 0.8) / 0.8);
      if (fade <= 0) continue;
      const sp = Math.hypot(d.vx, d.vy), stretch = 1 + Math.min(1.6, sp / 280);
      o.save();
      o.translate(d.x, d.y);
      // (esticada pra onde anda; parada, ovalada no próprio ângulo)
      o.rotate(sp > 20 ? Math.atan2(d.vy, d.vx) : d.rot);
      o.scale(sp > 20 ? stretch : 1, (sp > 20 ? 1 / Math.sqrt(stretch) : 1) * d.ax);
      if (d.r < 2 * k) {
        o.fillStyle = `rgba(225,235,250,${(0.38 * fade).toFixed(3)})`;
        o.beginPath();
        o.arc(0, 0, d.r, 0, Math.PI * 2);
        o.fill();
      } else {
        // a gota é uma lente: mostra, invertido e encolhido, o que está atrás dela (as luzes viram pontinhos
        // dentro da gota)
        if (snap) {
          o.save();
          o.beginPath();
          o.arc(0, 0, d.r, 0, Math.PI * 2);
          o.clip();
          o.scale(1, -1);
          const R = d.r * 4.5;
          o.globalAlpha = 0.9 * fade;
          o.drawImage(snap, (d.x - R) / 3, (d.y - R) / 3, (2 * R) / 3, (2 * R) / 3, -d.r, -d.r, 2 * d.r, 2 * d.r);
          o.restore();
        }
        // vidro molhado: quase transparente no meio, um pouco mais claro na borda
        const g = o.createRadialGradient(0, d.r * 0.2, d.r * 0.15, 0, 0, d.r);
        g.addColorStop(0, `rgba(55,70,92,${(0.15 * fade).toFixed(3)})`);
        g.addColorStop(0.7, `rgba(170,188,210,${(0.13 * fade).toFixed(3)})`);
        g.addColorStop(1, `rgba(225,236,250,${(0.32 * fade).toFixed(3)})`);
        o.fillStyle = g;
        o.beginPath();
        o.arc(0, 0, d.r, 0, Math.PI * 2);
        o.fill();
        // borda escura embaixo (a gota escurece onde a luz não passa) e o brilho em cima
        o.strokeStyle = `rgba(10,15,25,${(0.38 * fade).toFixed(3)})`;
        o.lineWidth = Math.max(0.7, d.r * 0.16);
        o.beginPath();
        o.arc(0, 0, d.r * 0.9, Math.PI * 0.15, Math.PI * 0.85);
        o.stroke();
        o.fillStyle = `rgba(255,255,255,${(0.7 * fade).toFixed(3)})`;
        o.beginPath();
        o.arc(-d.r * 0.32, -d.r * 0.36, Math.max(0.6, d.r * 0.14), 0, Math.PI * 2);
        o.fill();
      }
      o.restore();
    }
    for (const [x, y, r] of trail) add(x, y, r, 0.8 + Math.random() * 1.4, false);
    // filetes (chuva forte e devagar; rápido o vento leva): fino, ondulado, some em cima
    if (rain > 0.45 && wind < 0.5 && this.rivulets.length < 6 * rain && Math.random() < dt * 1.2 * rain)
      this.rivulets.push({ x: Math.random() * W, y: -20, len: (60 + Math.random() * 160) * k, w: (1.2 + Math.random() * 2) * k, t: 0, life: 3 + Math.random() * 3, v: (60 + Math.random() * 120) * k });
    for (const f of this.rivulets) {
      f.t += dt;
      f.y += f.v * dt;
      f.x += Math.sin(f.t * 3 + f.len) * 6 * k * dt;
      const al = Math.min(1, f.t * 3) * Math.max(0, 1 - f.t / f.life);
      const gr = o.createLinearGradient(f.x, f.y - f.len, f.x, f.y);
      gr.addColorStop(0, "rgba(210,225,245,0)");
      gr.addColorStop(1, `rgba(220,232,250,${(0.2 * al).toFixed(3)})`);
      o.strokeStyle = gr;
      o.lineWidth = f.w;
      o.lineCap = "round";
      // (torto, em zigue-zague, com uma borda escura e o miolo claro, como água escorrendo no vidro)
      const pts: [number, number][] = [];
      for (let q = 0; q <= 8; q++) pts.push([f.x + Math.sin(q * 1.7 + f.len) * 7 * k + Math.sin(q * 0.6 + f.t) * 3 * k, f.y - f.len + (f.len * q) / 8]);
      const line = () => {
        o.beginPath();
        pts.forEach(([x, y], q) => (q ? o.lineTo(x, y) : o.moveTo(x, y)));
      };
      o.lineJoin = "round";
      line();
      o.strokeStyle = `rgba(10,15,25,${(0.22 * al).toFixed(3)})`;
      o.lineWidth = f.w + 1.5 * k;
      o.stroke();
      line();
      o.strokeStyle = gr;
      o.lineWidth = f.w;
      o.stroke();
    }
    o.restore();
    this.lens = this.lens.filter((d) => !d.dead && d.t < d.life && d.y > -40 && d.y < H + 40 && d.x > -40 && d.x < W + 40);
    this.rivulets = this.rivulets.filter((f) => f.t < f.life && f.y - f.len < H);
  }

  /** luzes da largada: pórtico de F1, 5 colunas com 2 luzes vermelhas cada, acendendo uma por segundo; ao
   *  apagar, o pórtico some em 0,7 s */
  private drawLights(o: CanvasRenderingContext2D, W: number) {
    const racing = this.race.phase === "racing";
    const lit = racing ? 0 : Math.min(5, Math.floor(this.race.time));
    const r = 15, gap = 58, x0 = W / 2 - gap * 2, y0 = 116;
    o.save();
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.globalAlpha = racing ? Math.max(0, 1 - this.race.time / 0.7) : 1;
    // trave e as 5 caixas pretas
    o.fillStyle = "#2a2d33";
    o.fillRect(x0 - 44, y0 - 52, gap * 4 + 88, 8);
    for (let i = 0; i < 5; i++) {
      const x = x0 + i * gap;
      o.fillStyle = "#0c0d10";
      o.beginPath();
      o.roundRect(x - 23, y0 - 46, 46, 92, 7);
      o.fill();
      o.strokeStyle = "rgba(255,255,255,0.08)";
      o.lineWidth = 1;
      o.stroke();
      for (const dy of [-20, 20]) {
        o.beginPath();
        o.arc(x, y0 + dy, r, 0, Math.PI * 2);
        if (i < lit) {
          o.fillStyle = "#ff2a1f";
          o.shadowColor = "#ff2a1f";
          o.shadowBlur = 26;
        } else o.fillStyle = "#2a0c0c";
        o.fill();
        o.shadowBlur = 0;
        // reflexo no vidro
        o.fillStyle = "rgba(255,255,255,0.12)";
        o.beginPath();
        o.arc(x - 5, y0 + dy - 5, 4, 0, Math.PI * 2);
        o.fill();
      }
    }
    o.restore();
  }
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return r * 0.299 + gg * 0.587 + b * 0.114 > 160;
}

/** Minimapa com a pista inteira e os carros como pontos (clicável). */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private path: Path2D;
  private tf: (x: number, y: number) => [number, number];
  private dots = new Map<string, [number, number]>();

  constructor(private canvas: HTMLCanvasElement, private race: Race, onPick: (id: string) => void) {
    this.ctx = canvas.getContext("2d")!;
    const pts = race.track.pts;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 10;
    const sc = Math.min((canvas.width - pad * 2) / (maxX - minX), (canvas.height - pad * 2 - 14) / (maxY - minY));
    const offX = (canvas.width - (maxX - minX) * sc) / 2, offY = (canvas.height - 14 - (maxY - minY) * sc) / 2;
    this.tf = (x, y) => [offX + (x - minX) * sc, offY + (y - minY) * sc];
    this.path = new Path2D();
    pts.forEach((p, i) => {
      const [x, y] = this.tf(p.x, p.y);
      if (i === 0) this.path.moveTo(x, y); else this.path.lineTo(x, y);
    });
    this.path.closePath();
    canvas.style.cursor = "pointer";
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * canvas.width;
      const y = ((e.clientY - r.top) / r.height) * canvas.height;
      let best: string | null = null;
      let bestD = 16;
      for (const [id, [dx, dy]] of this.dots) {
        const d = Math.hypot(dx - x, dy - y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) onPick(best);
    });
  }

  draw(followId: string) {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.lineJoin = "round";
    g.strokeStyle = "#0b0d12";
    g.lineWidth = 7;
    g.stroke(this.path);
    g.strokeStyle = this.race.wet > 0.25 ? "#5a7fa8" : "#8b8f99";
    g.lineWidth = 3;
    g.stroke(this.path);
    const [sx, sy] = this.tf(this.race.track.pts[0].x, this.race.track.pts[0].y);
    g.fillStyle = "#fff";
    g.fillRect(sx - 1, sy - 4, 2, 8);
    // bandeira amarela: o trecho do acidente pisca em amarelo
    if (Math.floor(performance.now() / 350) % 3 !== 2) {
      const tr0 = this.race.track;
      g.strokeStyle = "#ffd400";
      g.lineWidth = 4;
      g.lineCap = "round";
      for (const z of yellowZones(this.race)) {
        g.beginPath();
        for (let d = -170; d <= 25; d += 8) {
          const q = tr0.pose(tr0.wrap(z.s + d), 0), [x, y] = this.tf(q.x, q.y);
          if (d === -170) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.lineCap = "butt";
    }

    this.dots.clear();
    const cars = [...this.race.cars].sort((a, b) => Number(a.isHuman) - Number(b.isHuman));
    for (const c of cars) {
      if (c.pit === "parked") continue;
      const p = this.race.track.pose(c.s, c.lateral);
      const [x, y] = this.tf(p.x, p.y);
      this.dots.set(c.id, [x, y]);
      const r = c.isHuman ? 4 : 3;
      g.fillStyle = "#000";
      g.fillRect(Math.round(x - r - 1), Math.round(y - r - 1), r * 2 + 2, r * 2 + 2);
      g.fillStyle = c.retired ? "#555" : c.team.color;
      g.fillRect(Math.round(x - r), Math.round(y - r), r * 2, r * 2);
      if (c.id === followId) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1;
        g.strokeRect(Math.round(x - r - 2) + 0.5, Math.round(y - r - 2) + 0.5, r * 2 + 3, r * 2 + 3);
      }
    }
    if (this.race.sc.active && this.race.sc.onTrack) {
      const p = this.race.track.pose(this.race.sc.s, 0);
      const [x, y] = this.tf(p.x, p.y);
      g.fillStyle = "#000";
      g.fillRect(Math.round(x - 4), Math.round(y - 4), 8, 8);
      g.fillStyle = "#ffcc00";
      g.fillRect(Math.round(x - 3), Math.round(y - 3), 6, 6);
      this.dots.set("SC", [x, y]);
      if (followId === "SC") {
        g.strokeStyle = "#fff";
        g.strokeRect(Math.round(x - 6) + 0.5, Math.round(y - 6) + 0.5, 11, 11);
      }
    }
  }
}


/** teto do túnel (cobre a pista e um pouco de cada lado) */
function tunnelPaths(t: import("../sim/track").Track) {
  const [a, b0] = t.tunnel!;
  const b = b0 < a ? b0 + t.L : b0;
  const half = TRACK_WIDTH / 2 + 4;
  const band = (l0: number, l1: number, dx = 0, dy = 0) => {
    const p = new Path2D();
    const pts: { x: number; y: number }[] = [];
    for (let s = a; s <= b; s += 3) pts.push(t.pose(s, l0));
    for (let s = b; s >= a; s -= 3) pts.push(t.pose(s, l1));
    pts.forEach((q, i) => (i ? p.lineTo(q.x + dx, q.y + dy) : p.moveTo(q.x + dx, q.y + dy)));
    p.closePath();
    return p;
  };
  const lights = new Path2D();
  for (const side of [-1, 1]) {
    let first = true;
    for (let s = a + 4; s <= b - 4; s += 3) {
      const q = t.pose(s, side * (half - 2.5));
      if (first) lights.moveTo(q.x, q.y);
      else lights.lineTo(q.x, q.y);
      first = false;
    }
  }
  return { roof: band(-half, half), shadow: band(-half, half, 1.6, 2), lights };
}
