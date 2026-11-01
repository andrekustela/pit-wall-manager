// Efeitos dos carros (só desenho, a simulação não muda): rodada com giro natural, batida com impacto,
// fumaça de pneu, faíscas, tremor da câmera e as MARCAS e a SUJEIRA de cada chão (ground.ts):
// - asfalto/concreto: borracha preta (das 4 rodas rodando de lado) e fumaça de pneu;
// - brita: sulcos das 4 rodas, poeira clara e pedrinhas voando; voltando pra pista, pedrisco espalhado nela;
// - grama: trilha de lama, pedaços de grama e de terra; voltando, torrões de terra na pista;
// - batida: estilhaços de fibra e da carenagem (cor da equipe) voando e espalhados no chão, mancha de óleo e
//   raspão. As manchas e os pedaços ficam um tempo (Configurações > Gráficos > marcas de pneu).
import { LV_AMOUNT, gfx } from "./gfx";
import { looseGround, type Ground } from "./ground";
import type { CarState } from "../sim/types";

type PartKind = "fumaca" | "poeira" | "faisca" | "pedra" | "grama" | "lama" | "fibra";
interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  kind: PartKind;
  /** cor (poeira, pedaços) e giro (pedaços) */
  c?: string;
  rot?: number;
  vr?: number;
}
/** marca no chão: borracha, sulco na brita, trilha de lama/areia, raspão */
export type MarkKind = "pneu" | "brita" | "lama" | "areia" | "risco";
export interface Skid {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  k: MarkKind;
  /** largura (m) */
  w: number;
}
/** mancha ou pedaço no chão: óleo, pedrisco/terra que o carro trouxe pra pista, pedaço do carro */
export type SpotKind = "oleo" | "pedrisco" | "terra" | "detrito";
export interface Spot {
  x: number;
  y: number;
  /** tamanho (m) */
  r: number;
  rot: number;
  k: SpotKind;
  /** cor do pedaço (detrito) */
  c: string;
  t: number;
}
/** cor (r, g, b) e opacidade de cada marca */
export const MARK_COLOR: Record<MarkKind, [number, number, number, number]> = {
  pneu: [16, 16, 16, 0.5],
  brita: [104, 66, 34, 0.62],
  lama: [58, 40, 24, 0.66],
  areia: [140, 112, 74, 0.5],
  risco: [34, 34, 36, 0.6],
};
export const SPOT_COLOR: Record<Exclude<SpotKind, "detrito">, [number, number, number, number]> = {
  oleo: [24, 21, 19, 0.58],
  pedrisco: [196, 132, 72, 0.85],
  terra: [86, 62, 38, 0.8],
};
interface St {
  /**
   * a batida já aconteceu no desenho: a corrida avisa que bateu antes de o carro desenhado (um instante atrás,
   * interpolado) chegar no muro — o estrago, os pedaços e o óleo esperam ele parar ali
   */
  landed: boolean;
  /** quanto tempo está esperando o carro desenhado parar (se demorar demais, solta assim mesmo) */
  crashWait: number;
  /** onde o carro estava desenhado no quadro anterior e a velocidade desenhada (m/s) */
  prevP: [number, number] | null;
  vDraw: number;
  /** onde cada roda deixou a última marca (traseira esq/dir, dianteira esq/dir) */
  last: [number, number][] | null;
  /** chão solto de onde o carro saiu por último e quanto tempo ainda espalha ele na pista */
  dirt: Ground | null;
  dirtT: number;
  wasLoose: boolean;
  /** a maior velocidade do último segundo (na batida a corrida já zerou a velocidade) */
  vRecent: number;
  /** por onde o carro passou (um ponto a cada 0,1 s, ~1,5 s): o risco do assoalho na batida */
  trail: [number, number][];
  trailT: number;
}

/** abandonos que são batida de verdade (o resto só para: motor, combustível...) */
const CRASH = new Set(["Acidente", "Bateu no muro"]);
const CARBON = ["#16171a", "#22242a", "#2c2f36"];

/** brilho macio da faísca (desenhado uma vez) */
let glowCv: HTMLCanvasElement | null = null;
function glow() {
  if (glowCv) return glowCv;
  const c = (glowCv = document.createElement("canvas"));
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,245,210,1)");
  gr.addColorStop(0.25, "rgba(255,190,80,0.55)");
  gr.addColorStop(1, "rgba(255,90,20,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return c;
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class CarFx {
  /** partículas que já existiam no fim do último passo */
  private kept = 0;
  /** acumulador pra deixar passar só uma fração das partículas novas */
  private acc = 0;
  private st = new Map<string, St>();
  private parts: Part[] = [];
  private skids: Skid[] = [];
  private spots: Spot[] = [];
  private shake = 0;
  private shakeT = 0;
  /** que chão tem em (s, lateral): o renderer passa o da pista (ground.groundMap) */
  ground: (s: number, lat: number) => Ground = (_s, lat) => (Math.abs(lat) > 9 ? "grama" : "asfalto");
  /** ponto do mundo em (s, lateral) da pista (Track.pose): os pedaços da batida se espalham seguindo a pista */
  pose: ((s: number, lat: number) => { x: number; y: number }) | null = null;

  /** batida: o carro está destruído (pro desenho tirar asa e uma roda) */
  crashed(c: CarState): boolean {
    return !!c.retired && CRASH.has(c.retireReason ?? "");
  }
  /** a batida já chegou no carro desenhado (até lá ele aparece inteiro, ainda deslizando) */
  landed(id: string): boolean {
    return !!this.st.get(id)?.landed;
  }
  /** a maior velocidade do carro desenhado no último segundo (m/s): com quanto os pedaços saem voando */
  recentSpeed(id: string): number {
    return this.st.get(id)?.vRecent ?? 0;
  }

  /**
   * chamado uma vez por carro por quadro: devolve o giro extra do desenho (rad). `drawn`: onde o carro está
   * desenhado na volta (s, lateral; o renderer interpola um instante atrás da corrida) — o chão é lido ali
   */
  update(c: CarState, p: { x: number; y: number; h: number }, dt: number, curv: number, street: boolean, follow: boolean, bump = 0, drawn?: { s: number; lat: number }): number {
    let s = this.st.get(c.id);
    if (!s) this.st.set(c.id, (s = { landed: false, crashWait: 0, prevP: null, vDraw: 0, last: null, dirt: null, dirtT: 0, wasLoose: false, vRecent: 0, trail: [], trailT: 0 }));
    const ds = drawn?.s ?? c.s, dl = drawn?.lat ?? c.lateral;
    const fx = Math.cos(p.h), fy = Math.sin(p.h);
    const at = (dx: number, dy: number) => [p.x + fx * dx - fy * dy, p.y + fy * dx + fx * dy] as [number, number];
    /** direção no mundo de (ao longo da pista, de lado) */
    const dir = (dx: number, dy: number) => [fx * dx - fy * dy, fy * dx + fx * dy] as [number, number];
    // velocidade do carro desenhado (a da corrida está adiantada e na batida já é zero)
    if (dt > 0) {
      // (até 95 m/s: quando o relógio da tela corrige, o carro desenhado pula uns metros num quadro)
      if (s.prevP) s.vDraw = s.vDraw * 0.5 + Math.min(95, Math.hypot(p.x - s.prevP[0], p.y - s.prevP[1]) / dt) * 0.5;
      s.prevP = [p.x, p.y];
    }
    s.vRecent = Math.max(s.vDraw, s.vRecent - 25 * dt);
    s.trailT += dt;
    if (s.trailT > 0.1) {
      s.trailT = 0;
      s.trail.push([p.x, p.y]);
      if (s.trail.length > 15) s.trail.shift();
    }
    let yaw = 0, smoke = false, marks = false;

    // ---- solto (rodou, passou reto, bateu): o giro vem da física; fumaça e marca de pneu enquanto arrasta ----
    if (c.slide) {
      yaw = c.slide.yaw;
      // voltando: só canta pneu (fumaça e marca) no 180; o resto é o carro andando normal
      const back = c.slide.mode === "rejoin";
      // (velocidade do carro desenhado: a da corrida está adiantada — na brita ela zerava e o sulco parava cedo)
      marks = back ? !!c.slide.smoke : s.vDraw > 3;
      smoke = back ? !!c.slide.smoke : c.slide.mode !== "off" && s.vDraw > 6;
    } else if (c.retired && c.restYaw != null) yaw = c.restYaw;

    // o chão embaixo do carro (só quando interessa: fora da pista, rodando ou batendo)
    const g: Ground = c.slide || c.offTrack > 0 || (c.retired && !s.landed) ? this.ground(ds, dl) : "asfalto";
    const loose = looseGround(g);
    // passando pela brita/grama: as 4 rodas deixam sulco (mesmo sem rodar)
    if (loose && s.vDraw > 3) marks = true;
    // na terra solta não sai fumaça de pneu: sai poeira (abaixo)
    if (loose) smoke = false;

    // ---- batida: estoura no impacto, voa pedaço, fica mancha de óleo e os pedaços no chão ----
    if (this.crashed(c) && !s.landed) s.crashWait += dt;
    if (this.crashed(c) && !s.landed && (s.vDraw < 2.5 || s.crashWait > 3)) {
      s.landed = true;
      const team = c.team.livery?.base ?? c.team.color, v0 = Math.max(s.vRecent, 10);
      // o muro fica do lado de fora (o sinal da lateral): o que voa vai pra frente e volta pro lado da pista
      const toTrack = -Math.sign(dl || 1), v0c = Math.min(v0, 55);
      // (no chão, pela pista: numa curva, "pra frente" em linha reta saía pra fora do muro)
      const onTrack = (along: number, lat: number): [number, number] => {
        if (!this.pose) return at(along, lat - dl);
        const q = this.pose(ds + along, lat);
        return [q.x, q.y];
      };
      for (let i = 0; i < 36; i++) {
        const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 22;
        this.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v + fx * v0 * 0.3, vy: Math.sin(a) * v + fy * v0 * 0.3, t: 0, life: 0.25 + Math.random() * 0.35, size: 0.6, kind: "faisca" });
      }
      // estilhaços de fibra e da carenagem voando
      for (let i = 0; i < 26; i++) {
        const [vx, vy] = dir(v0c * rnd(0.15, 0.55) + rnd(-3, 3), toTrack * rnd(1, 9) + rnd(-2, 2));
        this.parts.push({ x: p.x, y: p.y, vx, vy, t: 0, life: rnd(0.5, 1.1), size: rnd(0.12, 0.3), kind: "fibra", c: i % 3 === 0 ? team : CARBON[i % 3], rot: rnd(0, 6.3), vr: rnd(-14, 14) });
      }
      // nuvem: poeira do chão (brita clara, terra) ou fumaça cinza (asfalto, muro de rua)
      for (let i = 0; i < 14; i++) {
        const [vx, vy] = dir(rnd(-2, 5), toTrack * rnd(0, 4) + rnd(-2, 2));
        this.parts.push({ x: p.x, y: p.y, vx, vy, t: 0, life: rnd(1.4, 2.6), size: rnd(0.6, 1.1), kind: looseGround(g) ? "poeira" : "fumaca", c: dustOf(g) });
      }
      // no chão: pedaços espalhados pra frente e pro lado da pista (no muro eles batem e voltam)
      for (let i = 0; i < 22; i++) {
        const [x, y] = i < 6 ? onTrack(rnd(-2.5, 2.5), dl + toTrack * rnd(0, 1.8)) : onTrack(rnd(-1, 2 + v0c * 0.22), dl + toTrack * rnd(0.8, 2.5 + v0c * 0.1));
        this.spots.push({ x, y, r: rnd(0.1, 0.38), rot: rnd(0, 6.3), k: "detrito", c: i % 4 === 0 ? team : CARBON[i % 3], t: 0 });
      }
      // óleo e água: a poça embaixo do carro (passa da carroceria pro lado da pista) e pingos de onde ele veio
      const [ox, oy] = at(-0.8, toTrack * 0.9), [px, py] = at(1.2, toTrack * 1.5);
      this.spots.push({ x: ox, y: oy, r: rnd(1.6, 2.2), rot: rnd(0, 6.3), k: "oleo", c: "", t: 0 });
      this.spots.push({ x: px, y: py, r: rnd(0.7, 1.1), rot: rnd(0, 6.3), k: "oleo", c: "", t: 0 });
      // o assoalho riscando o chão nos últimos ~12 m antes de parar (duas linhas: as bordas da prancha)
      const tr = [...s.trail, [p.x, p.y] as [number, number]];
      let run = 0;
      for (let i = tr.length - 1; i > 0 && run < 12; i--) {
        const [a, b] = [tr[i - 1], tr[i]], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l < 0.05 || l > 15) continue;
        run += l;
        const nx = (-(b[1] - a[1]) / l) * 0.35, ny = ((b[0] - a[0]) / l) * 0.35;
        for (const k of [1, -1]) this.skids.push({ x1: a[0] + nx * k, y1: a[1] + ny * k, x2: b[0] + nx * k, y2: b[1] + ny * k, t: 0, k: "risco", w: 0.1 });
        if (Math.random() < 0.5) this.spots.push({ x: b[0] + rnd(-0.4, 0.4), y: b[1] + rnd(-0.4, 0.4), r: rnd(0.2, 0.4), rot: rnd(0, 6.3), k: "oleo", c: "", t: 0 });
      }
      // borracha no pé do muro: os pneus arrastando de lado na batida
      for (let i = 0; i < 3; i++) {
        const [a, b] = [at(rnd(-3.5, -0.5), -toTrack * rnd(0.6, 1.1)), at(rnd(0.5, 3), -toTrack * rnd(0.6, 1.1))];
        this.skids.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], t: 0, k: "pneu", w: 0.36 });
      }
      if (follow) this.kick(0.9);
    }

    // ---- saída de pista: o que o chão joga pra cima; na rua, faísca no muro ----
    if (c.offTrack > 0 && s.vDraw > 6 && Math.random() < dt * 34) {
      const [x, y] = at(-1.6, (Math.random() - 0.5) * 1.4), back = s.vDraw * 0.18;
      if (street && !loose) this.parts.push({ x, y, vx: -fx * 8 + (Math.random() - 0.5) * 10, vy: -fy * 8 + (Math.random() - 0.5) * 10, t: 0, life: 0.3, size: 0.5, kind: "faisca" });
      else if (g === "brita" || g === "areia") {
        this.parts.push({ x, y, vx: -fx * back + rnd(-3, 3), vy: -fy * back + rnd(-3, 3), t: 0, life: rnd(1.4, 2.2), size: rnd(1, 1.6), kind: "poeira", c: dustOf(g) });
        for (let i = 0; i < 4; i++) {
          const a = p.h + Math.PI + rnd(-0.8, 0.8), v = rnd(5, 12) + s.vDraw * 0.12;
          this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rnd(0.35, 0.7), size: rnd(0.06, 0.12), kind: "pedra", c: g === "brita" ? pick(["#b9773f", "#8f6a4b", "#d8a066", "#6f5a4a"]) : "#c9a874" });
        }
      } else if (g === "grama") {
        this.parts.push({ x, y, vx: -fx * back + rnd(-2, 2), vy: -fy * back + rnd(-2, 2), t: 0, life: rnd(0.9, 1.4), size: rnd(0.7, 1.1), kind: "poeira", c: dustOf(g) });
        for (let i = 0; i < 4; i++) {
          const a = p.h + Math.PI + rnd(-0.9, 0.9), v = rnd(3, 9) + s.vDraw * 0.1;
          this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rnd(0.4, 0.8), size: rnd(0.07, 0.15), kind: i % 2 ? "grama" : "lama", c: i % 2 ? pick(["#3f8f34", "#4fa63c", "#2f7a2a"]) : pick(["#5a3f25", "#6b4a2c", "#4a3320"]), rot: rnd(0, 6.3), vr: rnd(-10, 10) });
        }
      } else if (!street) this.parts.push({ x, y, vx: -fx * back + rnd(-2, 2), vy: -fy * back + rnd(-2, 2), t: 0, life: 1, size: 0.8, kind: "poeira", c: dustOf("concreto") });
    }
    // ---- voltou pra pista vindo da brita/grama: espalha pedrisco ou terra no asfalto por um tempo ----
    if (loose) {
      s.dirt = g;
      s.wasLoose = true;
    } else if (s.wasLoose) {
      s.wasLoose = false;
      s.dirtT = 2.6;
    }
    if (s.dirtT > 0 && !loose) {
      s.dirtT -= dt;
      if (s.vDraw > 4 && Math.random() < dt * 14) {
        const [x, y] = at(-1.8 + rnd(-0.6, 0.6), rnd(-0.8, 0.8));
        this.spots.push({ x, y, r: rnd(0.35, 0.75) * (0.5 + s.dirtT / 2.6), rot: rnd(0, 6.3), k: s.dirt === "grama" ? "terra" : "pedrisco", c: "", t: 0 });
      }
    }
    // ---- assoalho batendo na ondulação: faíscas saindo por trás, como na F1 ----
    // mais rápido, mais baixo (acerto) e mais pesado (combustível) = mais faísca
    if (bump > 0 && c.v > 55 && c.spin <= 0 && c.offTrack <= 0) {
      const h = c.tuning?.h ?? 50;
      const low = Math.max(0.25, 1.7 - h / 55);
      const k = bump * Math.min(1, (c.v - 55) / 25) * low * (1 + Math.min(1, c.fuel / 100) * 0.6);
      let n = k * 140 * dt;
      while (n > 0 && (n >= 1 || Math.random() < n)) {
        n -= 1;
        const side = (Math.random() - 0.5) * 1.1;
        const [x, y] = at(-1.9 - Math.random() * 0.4, side);
        // o pedaço do assoalho raspa e a faísca fica pra trás (no chão ela anda mais devagar que o carro)
        const fwd = c.v * (0.35 + Math.random() * 0.35), lat = side * 6 + (Math.random() - 0.5) * 5;
        this.parts.push({ x, y, vx: fx * fwd - fy * lat, vy: fy * fwd + fx * lat, t: 0, life: 0.12 + Math.random() * 0.22, size: 0.5, kind: "faisca" });
      }
    }
    if (smoke && Math.random() < dt * 18) {
      const [x, y] = at(-1.6, (Math.random() < 0.5 ? -1 : 1) * 0.65);
      this.parts.push({ x, y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, t: 0, life: 1.1, size: 0.45, kind: "fumaca" });
    }

    // ---- marcas: rodas traseiras; as 4 quando roda de lado ou passa pela terra solta ----
    const wheels = [at(-1.65, -0.63), at(-1.65, 0.63), at(1.55, -0.6), at(1.55, 0.6)];
    const all4 = loose || Math.abs(yaw) > 0.35;
    const kind: MarkKind = g === "brita" ? "brita" : g === "grama" ? "lama" : g === "areia" ? "areia" : "pneu";
    // (de lado a borracha arrasta a largura do pneu; no sulco a roda afunda e empurra a pedra pros lados)
    const w = kind === "brita" ? 0.75 : kind === "lama" ? 0.55 : kind === "areia" ? 0.65 : Math.abs(yaw) > 0.3 ? 0.4 : 0.28;
    if (marks && s.last) {
      // cada roda guarda onde deixou a última marca e só marca de novo depois de andar 30 cm (antes a conta era
      // por quadro: a 60 FPS só marcava acima de ~65 km/h, e quem escorregava devagar na brita não deixava nada)
      for (let i = 0; i < 4; i++) {
        const [a, b] = [s.last[i], wheels[i]], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (i >= (all4 ? 4 : 2) || d > 8) s.last[i] = b;
        else if (d > 0.3) {
          this.skids.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], t: 0, k: kind, w });
          s.last[i] = b;
        }
      }
    } else s.last = marks ? wheels : null;
    if (this.skids.length > 900) this.skids.splice(0, this.skids.length - 900);
    if (this.spots.length > 500) this.spots.splice(0, this.spots.length - 500);
    if (this.parts.length > 700) this.parts.splice(0, this.parts.length - 700);
    return yaw;
  }

  /** tremor da câmera (batida do carro seguido) */
  kick(power: number) {
    this.shake = Math.max(this.shake, power);
  }

  /** deslocamento da câmera neste quadro (m) */
  shakeOffset(dt: number): [number, number] {
    if (this.shake <= 0.01) return [0, 0];
    this.shakeT += dt;
    const k = this.shake * this.shake * 1.6;
    this.shake = Math.max(0, this.shake - dt * 1.4);
    return [Math.sin(this.shakeT * 47) * k, Math.cos(this.shakeT * 39) * k];
  }

  /** anda as partículas e envelhece as marcas */
  step(dt: number) {
    // Configurações > Gráficos: menos (ou nenhuma) partícula e marca de pneu
    const g = gfx();
    if (this.parts.length > this.kept) {
      // das que nasceram neste quadro, fica a fração do nível de cada tipo
      const keep = (k: string) => LV_AMOUNT[k === "faisca" ? g.sparks : g.smoke];
      const fresh = this.parts.splice(this.kept).filter((p) => {
        const a = keep(p.kind);
        return a >= 1 || (a > 0 && (this.acc = (this.acc + a) % 1) < a);
      });
      this.parts.push(...fresh);
    }
    if (g.skids === "off") {
      this.skids.length = 0;
      this.spots.length = 0;
    }
    for (const p of this.parts) {
      p.t += dt;
      const f = Math.exp(-(p.kind === "faisca" ? 3 : p.kind === "pedra" || p.kind === "fibra" || p.kind === "grama" || p.kind === "lama" ? 2.4 : 1.6) * dt);
      p.vx *= f;
      p.vy *= f;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr) p.rot = (p.rot ?? 0) + p.vr * dt * f;
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    const life = { off: 0, baixo: 12, medio: 25, alto: 45 }[g.skids];
    for (const s of this.skids) s.t += dt;
    // (sulco, lama e raspão duram mais que borracha: a pista não "limpa" sozinha)
    this.skids = this.skids.filter((s) => s.t < (s.k === "pneu" ? life : life * 3));
    // manchas e pedaços: até o fim da corrida no alto
    const spotLife = { off: 0, baixo: 60, medio: 150, alto: 600 }[g.skids];
    for (const s of this.spots) s.t += dt;
    this.spots = this.spots.filter((s) => s.t < spotLife);
    this.kept = this.parts.length;
  }

  /** as marcas no chão (as câmeras 3D desenham elas na cena: RealCars.skidMarks) */
  get skidList(): readonly Skid[] {
    return this.skids;
  }
  /** as manchas e os pedaços no chão (RealCars.skidMarks) */
  get spotList(): readonly Spot[] {
    return this.spots;
  }

  /** no chão, embaixo dos carros: manchas, marcas e pedaços */
  drawGround(o: CanvasRenderingContext2D, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number) {
    if (!this.skids.length && !this.spots.length) return;
    o.save();
    // manchas (óleo, pedrisco, terra) por baixo
    for (const s of this.spots) {
      if (s.k === "detrito") continue;
      const [r, g, b, a] = SPOT_COLOR[s.k], q = toCss(s), fade = Math.max(0, 1 - s.t / 600);
      if (s.k === "oleo") {
        o.fillStyle = `rgba(${r},${g},${b},${(a * fade).toFixed(3)})`;
        o.beginPath();
        o.ellipse(q.x, q.y, s.r * m, s.r * 0.7 * m, s.rot, 0, Math.PI * 2);
        o.fill();
      } else {
        // pedrisco/terra: pontinhos espalhados
        o.fillStyle = `rgba(${r},${g},${b},${(a * fade).toFixed(3)})`;
        for (let i = 0; i < 6; i++) {
          const ang = s.rot + i * 1.9, d = ((i * 37) % 10) / 10;
          o.fillRect(q.x + Math.cos(ang) * d * s.r * m, q.y + Math.sin(ang) * d * s.r * m, Math.max(1, 0.09 * m), Math.max(1, 0.09 * m));
        }
      }
    }
    o.lineCap = "round";
    for (const s of this.skids) {
      const a = toCss({ x: s.x1, y: s.y1 }), b = toCss({ x: s.x2, y: s.y2 }), [r, g, bl, al] = MARK_COLOR[s.k];
      const life = s.k === "pneu" ? 45 : 135;
      o.lineWidth = Math.max(1, s.w * m);
      o.strokeStyle = `rgba(${r},${g},${bl},${(al * Math.max(0, 1 - s.t / life)).toFixed(3)})`;
      o.beginPath();
      o.moveTo(a.x, a.y);
      o.lineTo(b.x, b.y);
      o.stroke();
    }
    // pedaços do carro por cima
    for (const s of this.spots) {
      if (s.k !== "detrito") continue;
      const q = toCss(s);
      o.save();
      o.translate(q.x, q.y);
      o.rotate(s.rot);
      o.fillStyle = s.c;
      o.fillRect(-s.r * m, -s.r * 0.4 * m, s.r * 2 * m, s.r * 0.8 * m);
      o.restore();
    }
    o.restore();
  }

  /** por cima dos carros: fumaça, poeira, faíscas e o que voa (pedra, grama, terra, pedaço do carro) */
  /** `sparks`: só as faíscas (desenhadas antes dos carros: saem de baixo deles) ou só o resto */
  /** `soft` < 1: câmeras 3D de perto (o carro fica grande na tela e o brilho virava uma bola de fogo) */
  drawAir(o: CanvasRenderingContext2D, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number, sparks: boolean, soft = 1) {
    if (!this.parts.length) return;
    o.save();
    for (const p of this.parts) {
      if ((p.kind === "faisca") !== sparks) continue;
      const q = p.t / p.life, { x, y } = toCss(p);
      if (p.kind === "faisca") {
        // titânio raspando: nasce branca de quente, passa pro amarelo e laranja e apaga vermelha;
        // rastro (largo e fraco + núcleo fino e forte) do tamanho da velocidade e um brilho na ponta
        const heat = 1 - q;
        const gc = Math.round(110 + 145 * heat), bc = Math.round(30 + 200 * heat * heat);
        // (o rastro é calculado no chão e projetado: nas câmeras 3D de lado e de trás ele segue o chão em vez
        // de subir na tela)
        const trail = 0.045 + 0.035 * heat;
        const { x: tx, y: ty } = toCss({ x: p.x - p.vx * trail, y: p.y - p.vy * trail });
        const mid = toCss({ x: p.x - p.vx * trail * 0.6, y: p.y - p.vy * trail * 0.6 });
        o.globalCompositeOperation = "lighter";
        o.lineCap = "round";
        o.strokeStyle = `rgba(255,${Math.round(gc * 0.75)},${Math.round(bc * 0.4)},${(0.32 * heat * soft).toFixed(3)})`;
        o.lineWidth = Math.max(1, 0.16 * m * soft);
        o.beginPath();
        o.moveTo(x, y);
        o.lineTo(tx, ty);
        o.stroke();
        o.strokeStyle = `rgba(255,${gc},${bc},${heat.toFixed(3)})`;
        o.lineWidth = Math.max(0.6, 0.05 * m * Math.max(0.5, soft));
        o.beginPath();
        o.moveTo(x, y);
        o.lineTo(mid.x, mid.y);
        o.stroke();
        const gs = (0.18 + 0.3 * heat) * m * (p.size / 0.5) * soft;
        o.globalAlpha = 0.6 * heat * soft;
        o.drawImage(glow(), x - gs, y - gs, gs * 2, gs * 2);
        o.globalAlpha = 1;
        o.globalCompositeOperation = "source-over";
      } else if (p.kind === "pedra" || p.kind === "grama" || p.kind === "lama" || p.kind === "fibra") {
        // pedaço voando: quadradinho (pedra) ou lasca girando (grama, terra, fibra), some no fim
        const sz = Math.max(1.2, p.size * m), al = Math.min(1, 2.5 * (1 - q));
        o.globalAlpha = al;
        o.fillStyle = p.c ?? "#777";
        if (p.kind === "pedra") o.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        else {
          o.save();
          o.translate(x, y);
          o.rotate(p.rot ?? 0);
          o.fillRect(-sz, -sz * 0.35, sz * 2, sz * 0.7);
          o.restore();
        }
        o.globalAlpha = 1;
      } else {
        // nuvem macia (a bola chapada parecia um borrão marrom): cresce e some devagar
        const r = (p.size + q * (p.kind === "fumaca" ? 1.4 : 2.2)) * m;
        o.globalAlpha = (p.kind === "poeira" ? 0.55 : 0.32) * Math.pow(1 - q, 1.3);
        o.drawImage(puff(p.kind === "poeira" ? (p.c ?? "rgb(160,132,92)") : (p.c ?? "rgb(210,210,214)")), x - r, y - r, r * 2, r * 2);
        o.globalAlpha = 1;
      }
    }
    o.restore();
  }
}

const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];
/** cor da poeira de cada chão (brita clara e alaranjada, grama marrom, concreto cinza) */
function dustOf(g: Ground): string {
  return g === "brita" ? "rgb(214,186,150)" : g === "areia" ? "rgb(220,196,150)" : g === "grama" ? "rgb(120,96,62)" : "rgb(178,174,168)";
}
/** nuvem macia de uma cor (desenhada uma vez por cor): miolo cheio, borda que some, com uns caroços */
const puffs = new Map<string, HTMLCanvasElement>();
function puff(rgb: string): HTMLCanvasElement {
  let c = puffs.get(rgb);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!, rgba = (a: number) => rgb.replace("rgb(", "rgba(").replace(")", `,${a})`);
  for (let i = 0; i < 7; i++) {
    const x = 32 + (i ? rnd(-11, 11) : 0), y = 32 + (i ? rnd(-11, 11) : 0), r = i ? rnd(10, 18) : 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(i ? 0.5 : 0.75));
    gr.addColorStop(0.55, rgba(i ? 0.25 : 0.35));
    gr.addColorStop(1, rgba(0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  puffs.set(rgb, c);
  return c;
}
