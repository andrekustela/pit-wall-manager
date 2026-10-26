// Efeitos dos carros (só desenho, a simulação não muda): rodada com giro natural, batida com impacto,
// fumaça de pneu, poeira de brita, faíscas, marcas de pneu no asfalto e tremor da câmera.
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
  spinDur: number;
  spinTotal: number;
  prevSpin: number;
  crashT: number;
  crashYaw: number;
  last: [number, number][] | null;
}

/** abandonos que são batida de verdade (o resto só para: motor, combustível...) */
const CRASH = new Set(["Acidente", "Bateu no muro"]);
const ease = (q: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, q)), 3);

export class CarFx {
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
    if (!s) this.st.set(c.id, (s = { spinDur: 0, spinTotal: 0, prevSpin: 0, crashT: -1, crashYaw: 0, last: null }));
    const fx = Math.cos(p.h), fy = Math.sin(p.h);
    const at = (dx: number, dy: number) => [p.x + fx * dx - fy * dy, p.y + fy * dx + fx * dy] as [number, number];
    let yaw = 0, smoke = false, marks = false;

    // ---- rodada: gira rápido e vai freando, fica virado um instante, depois o piloto dá a volta ----
    if (c.spin > 0 && s.prevSpin <= 0) {
      s.spinDur = c.spin;
      // a traseira escapa pro lado da curva; meia volta ou volta inteira
      const dir = curv >= 0 ? 1 : -1;
      s.spinTotal = dir * (Math.random() < 0.6 ? Math.PI * (0.85 + Math.random() * 0.3) : Math.PI * 2);
    }
    s.prevSpin = c.spin;
    if (c.spin > 0 && s.spinDur > 0) {
      const q = 1 - c.spin / s.spinDur;
      const full = Math.abs(s.spinTotal) > Math.PI * 1.5;
      if (q < 0.35) {
        yaw = s.spinTotal * ease(q / 0.35);
        smoke = marks = true;
      } else if (q < 0.7) yaw = s.spinTotal + Math.sin(q * 40) * 0.02;
      else yaw = full ? s.spinTotal : s.spinTotal + Math.sign(s.spinTotal) * (Math.PI * 2 - Math.abs(s.spinTotal)) * ease((q - 0.7) / 0.3);
    }

    // ---- batida: estoura no impacto e gira até parar torto ----
    if (this.crashed(c)) {
      if (s.crashT < 0) {
        s.crashT = performance.now();
        s.crashYaw = (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.8);
        for (let i = 0; i < 36; i++) {
          const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 22;
          this.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v + fx * c.v * 0.3, vy: Math.sin(a) * v + fy * c.v * 0.3, t: 0, life: 0.25 + Math.random() * 0.35, size: 0.6, kind: "faisca" });
        }
        for (let i = 0; i < 10; i++) this.parts.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, t: 0, life: 1.2 + Math.random(), size: 1.2, kind: street ? "fumaca" : "poeira" });
        if (follow) this.kick(0.9);
      }
      yaw = s.crashYaw * ease((performance.now() - s.crashT) / 900);
      if (c.v > 3) marks = true;
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
    this.skids = this.skids.filter((s) => s.t < 45);
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
  drawAir(o: CanvasRenderingContext2D, toCss: (p: { x: number; y: number }) => { x: number; y: number }, m: number) {
    if (!this.parts.length) return;
    o.save();
    for (const p of this.parts) {
      const q = p.t / p.life, { x, y } = toCss(p);
      if (p.kind === "faisca") {
        // risco brilhante (somando luz) com a ponta quase branca
        o.globalCompositeOperation = "lighter";
        o.strokeStyle = `rgba(255,${150 + Math.round(90 * (1 - q))},${40 + Math.round(80 * (1 - q))},${(1 - q).toFixed(3)})`;
        o.lineWidth = Math.max(1.4, 0.16 * m);
        o.beginPath();
        o.moveTo(x, y);
        o.lineTo(x - p.vx * 0.045 * m, y - p.vy * 0.045 * m);
        o.stroke();
        o.fillStyle = `rgba(255,250,220,${(0.9 * (1 - q)).toFixed(3)})`;
        o.fillRect(x - 1, y - 1, 2, 2);
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
