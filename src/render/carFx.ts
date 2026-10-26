// Efeitos dos carros (só desenho, a simulação não muda): rodada com giro natural, batida com impacto,
// fumaça de pneu, poeira de brita, faíscas, marcas de pneu no asfalto e tremor da câmera.
import { LV_AMOUNT, gfx } from "./gfx";
import type { CarState } from "../sim/types";

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  kind: "fumaca" | "poeira" | "faisca";
}
interface Skid {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
}
interface St {
  crashT: number;
  last: [number, number][] | null;
}

/** abandonos que são batida de verdade (o resto só para: motor, combustível...) */
const CRASH = new Set(["Acidente", "Bateu no muro"]);

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

export class CarFx {
  /** partículas que já existiam no fim do último passo */
  private kept = 0;
  /** acumulador pra deixar passar só uma fração das partículas novas */
  private acc = 0;
  private st = new Map<string, St>();
  private parts: Part[] = [];
  private skids: Skid[] = [];
  private shake = 0;
  private shakeT = 0;

  /** batida: o carro está destruído (pro desenho tirar asa e uma roda) */
  crashed(c: CarState): boolean {
    return !!c.retired && CRASH.has(c.retireReason ?? "");
  }

  /** chamado uma vez por carro por quadro: devolve o giro extra do desenho (rad) */
  update(c: CarState, p: { x: number; y: number; h: number }, dt: number, curv: number, street: boolean, follow: boolean, bump = 0): number {
    let s = this.st.get(c.id);
    if (!s) this.st.set(c.id, (s = { crashT: -1, last: null }));
    const fx = Math.cos(p.h), fy = Math.sin(p.h);
    const at = (dx: number, dy: number) => [p.x + fx * dx - fy * dy, p.y + fy * dx + fx * dy] as [number, number];
    let yaw = 0, smoke = false, marks = false;

    // ---- solto (rodou, passou reto, bateu): o giro vem da física; fumaça e marca de pneu enquanto arrasta ----
    if (c.slide) {
      yaw = c.slide.yaw;
      // voltando: só canta pneu (fumaça e marca) no 180; o resto é o carro andando normal
      const back = c.slide.mode === "rejoin";
      marks = back ? !!c.slide.smoke : c.v > 3;
      smoke = back ? !!c.slide.smoke : c.slide.mode !== "off" && c.v > 6;
    } else if (c.retired && c.restYaw != null) yaw = c.restYaw;

    // ---- batida: estoura no impacto e gira até parar torto ----
    if (this.crashed(c)) {
      if (s.crashT < 0) {
        s.crashT = performance.now();
        for (let i = 0; i < 36; i++) {
          const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 22;
          this.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v + fx * c.v * 0.3, vy: Math.sin(a) * v + fy * c.v * 0.3, t: 0, life: 0.25 + Math.random() * 0.35, size: 0.6, kind: "faisca" });
        }
        for (let i = 0; i < 10; i++) this.parts.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, t: 0, life: 1.2 + Math.random(), size: 1.2, kind: street ? "fumaca" : "poeira" });
        if (follow) this.kick(0.9);
      }
    }

    // ---- saída de pista: poeira na brita, faísca no muro ----
    if (c.offTrack > 0 && c.v > 8 && Math.random() < dt * 30) {
      const [x, y] = at(-1.6, (Math.random() - 0.5) * 1.2);
      if (street) this.parts.push({ x, y, vx: -fx * 8 + (Math.random() - 0.5) * 10, vy: -fy * 8 + (Math.random() - 0.5) * 10, t: 0, life: 0.3, size: 0.5, kind: "faisca" });
      else this.parts.push({ x, y, vx: -fx * c.v * 0.15 + (Math.random() - 0.5) * 3, vy: -fy * c.v * 0.15 + (Math.random() - 0.5) * 3, t: 0, life: 1.4, size: 1.1, kind: "poeira" });
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

    // ---- marcas de pneu (rodas traseiras) ----
    const wheels = [at(-1.65, -0.63), at(-1.65, 0.63)];
    if (marks && s.last) {
      for (let i = 0; i < 2; i++) {
        const [a, b] = [s.last[i], wheels[i]];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3) this.skids.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], t: 0 });
      }
      s.last = wheels;
    } else s.last = marks ? wheels : null;
    if (this.skids.length > 600) this.skids.splice(0, this.skids.length - 600);
    if (this.parts.length > 500) this.parts.splice(0, this.parts.length - 500);
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
    if (g.skids === "off") this.skids.length = 0;
    for (const p of this.parts) {
      p.t += dt;
      const f = Math.exp(-(p.kind === "faisca" ? 3 : 1.6) * dt);
      p.vx *= f;
      p.vy *= f;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const s of this.skids) s.t += dt;
    const life = { off: 0, baixo: 12, medio: 25, alto: 45 }[gfx().skids];
    this.skids = this.skids.filter((s) => s.t < life);
    this.kept = this.parts.length;
  }

  /** no chão, embaixo dos carros: marcas de pneu */
  drawGround(o: CanvasRenderingContext2D, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number) {
    if (!this.skids.length) return;
    o.save();
    o.lineCap = "round";
    o.lineWidth = Math.max(1, 0.28 * m);
    for (const s of this.skids) {
      const a = toCss({ x: s.x1, y: s.y1 }), b = toCss({ x: s.x2, y: s.y2 });
      o.strokeStyle = `rgba(15,15,15,${(0.45 * (1 - s.t / 45)).toFixed(3)})`;
      o.beginPath();
      o.moveTo(a.x, a.y);
      o.lineTo(b.x, b.y);
      o.stroke();
    }
    o.restore();
  }

  /** por cima dos carros: fumaça, poeira e faíscas */
  /** `sparks`: só as faíscas (desenhadas antes dos carros: saem de baixo deles) ou só fumaça e poeira */
  drawAir(o: CanvasRenderingContext2D, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number, sparks: boolean) {
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
        const trail = (0.045 + 0.035 * heat) * m;
        const tx = x - p.vx * trail, ty = y - p.vy * trail;
        o.globalCompositeOperation = "lighter";
        o.lineCap = "round";
        o.strokeStyle = `rgba(255,${Math.round(gc * 0.75)},${Math.round(bc * 0.4)},${(0.32 * heat).toFixed(3)})`;
        o.lineWidth = Math.max(1.2, 0.16 * m);
        o.beginPath();
        o.moveTo(x, y);
        o.lineTo(tx, ty);
        o.stroke();
        o.strokeStyle = `rgba(255,${gc},${bc},${heat.toFixed(3)})`;
        o.lineWidth = Math.max(0.6, 0.05 * m);
        o.beginPath();
        o.moveTo(x, y);
        o.lineTo(x - p.vx * trail * 0.6, y - p.vy * trail * 0.6);
        o.stroke();
        const gs = (0.18 + 0.3 * heat) * m * (p.size / 0.5);
        o.globalAlpha = 0.6 * heat;
        o.drawImage(glow(), x - gs, y - gs, gs * 2, gs * 2);
        o.globalAlpha = 1;
        o.globalCompositeOperation = "source-over";
      } else {
        const r = (p.size + q * (p.kind === "fumaca" ? 1.2 : 2)) * m;
        o.fillStyle = p.kind === "poeira" ? `rgba(160,132,92,${(0.45 * (1 - q)).toFixed(3)})` : `rgba(210,210,214,${(0.24 * (1 - q)).toFixed(3)})`;
        o.beginPath();
        o.arc(x, y, r, 0, Math.PI * 2);
        o.fill();
      }
    }
    o.restore();
  }
}
