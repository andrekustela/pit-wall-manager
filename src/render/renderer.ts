import type { Race } from "../sim/race";
import { CAR_LEN_M, carImage } from "./carArt";
import { buildWorld, type World } from "./worldArt";

interface Disp {
  s: number;
  lat: number;
}

/**
 * Desenha a corrida em duas camadas:
 *  - pista em pixel art (canvas de baixa resolução, ampliado sem suavizar)
 *  - carros, safety car, etiquetas, chuva e luzes numa camada de alta
 *    resolução por cima (carros em vetor, pré-desenhados por equipe)
 * A câmera segue um carro; roda do mouse / +/- dão zoom.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private world: World;
  private cam = { x: 0, y: 0, ready: false };
  private disp = new Map<string, Disp>();
  private scDisp: Disp | null = null;
  private drops: { x: number; y: number; l: number }[] = [];
  private screenPos = new Map<string, { x: number; y: number }>();
  private dpr = 1;
  private zoom = 0;
  followId: string;
  pixelScale = 3;

  constructor(private canvas: HTMLCanvasElement, private race: Race, followId: string, onPick: (id: string) => void) {
    this.ctx = canvas.getContext("2d")!;
    this.overlay = document.createElement("canvas");
    this.overlay.id = "view-hd";
    canvas.after(this.overlay);
    this.octx = this.overlay.getContext("2d")!;
    this.world = buildWorld(race.track);
    this.followId = followId;
    this.resize();
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: string | null = null;
      let bestD = Math.max(24, CAR_LEN_M * this.m2css() * 0.7);
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
    this.overlay.remove();
  }

  /** zoom em passos inteiros (mantém a pixel art nítida) */
  setZoom(z: number) {
    const base = this.baseScale();
    this.zoom = Math.max(1 - base, Math.min(6, z));
    this.resize();
  }

  zoomIn() {
    this.setZoom(this.zoom + 1);
  }

  zoomOut() {
    this.setZoom(this.zoom - 1);
  }

  private baseScale() {
    // ~200 m de pista visíveis na largura (carros grandes o bastante pra ver os detalhes)
    return Math.max(1, Math.round(window.innerWidth / (200 * this.world.ppm)));
  }

  /** metros -> pixels CSS na tela */
  private m2css() {
    return this.world.ppm * this.pixelScale;
  }

  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.pixelScale = Math.max(1, this.baseScale() + this.zoom);
    this.canvas.width = Math.ceil(w / this.pixelScale);
    this.canvas.height = Math.ceil(h / this.pixelScale);
    this.ctx.imageSmoothingEnabled = false;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(w * this.dpr);
    this.overlay.height = Math.round(h * this.dpr);
  };

  /**
   * A simulação anda em passos de 1/20 s (e, online, chega 10x por segundo).
   * Aqui o carro é extrapolado pela velocidade e corrigido aos poucos em
   * direção à posição real, então o movimento fica liso a 60 fps.
   */
  private smooth(id: string, s: number, lat: number, v: number, simDt: number, realDt: number, snap: boolean): Disp {
    const L = this.race.track.L;
    let d = this.disp.get(id);
    if (!d || snap) {
      d = { s, lat };
      this.disp.set(id, d);
      return d;
    }
    // prevê pela velocidade e corrige aos poucos, mas NUNCA anda pra trás
    // (se a previsão passou do ponto, o carro só "espera" a simulação alcançar)
    let err = s - d.s;
    if (err > L / 2) err -= L;
    if (err < -L / 2) err += L;
    if (Math.abs(err) > 80) d.s = s;
    else {
      const step = v * simDt + err * Math.min(1, realDt * 6);
      d.s += Math.max(0, step);
    }
    d.s = ((d.s % L) + L) % L;
    d.lat += (lat - d.lat) * Math.min(1, realDt * 10);
    return d;
  }

  private px(s: number, lat: number) {
    const p = this.race.track.pose(s, lat);
    return { x: (p.x - this.world.minX) * this.world.ppm, y: (p.y - this.world.minY) * this.world.ppm, h: p.h };
  }

  draw(realDt: number, speed: number) {
    const g = this.ctx;
    const race = this.race;
    const cw = this.canvas.width, ch = this.canvas.height;
    const simDt = race.phase === "racing" ? realDt * speed : 0;

    // posições suavizadas (em pixels do mundo)
    const pos = new Map<string, { x: number; y: number; h: number }>();
    for (const c of race.cars) {
      const jump = c.pit === "stopped" || c.pit === "parked";
      const d = this.smooth(c.id, c.s, c.lateral, c.v, simDt, realDt, jump);
      pos.set(c.id, this.px(d.s, d.lat));
    }
    const scOn = race.sc.active && race.sc.onTrack;
    let scPos: { x: number; y: number; h: number } | null = null;
    if (scOn) {
      if (!this.scDisp) this.scDisp = { s: race.sc.s, lat: 0 };
      const d = this.smoothSc(race.sc.s, race.sc.v, simDt, realDt);
      scPos = this.px(d.s, 0);
    } else this.scDisp = null;

    const tp = (this.followId === "SC" ? scPos : pos.get(this.followId)) ?? pos.get(race.leader().id)!;
    if (!this.cam.ready) {
      this.cam = { x: tp.x, y: tp.y, ready: true };
    } else {
      const k = 1 - Math.exp(-realDt * 6);
      this.cam.x += (tp.x - this.cam.x) * k;
      this.cam.y += (tp.y - this.cam.y) * k;
      const maxOff = Math.min(cw, ch) * 0.3;
      this.cam.x = Math.max(tp.x - maxOff, Math.min(tp.x + maxOff, this.cam.x));
      this.cam.y = Math.max(tp.y - maxOff, Math.min(tp.y + maxOff, this.cam.y));
    }
    const ox = Math.round(this.cam.x - cw / 2);
    const oy = Math.round(this.cam.y - ch / 2);

    // ---- camada 1: pista em pixel art ----
    g.fillStyle = race.track.def.grass[0];
    g.fillRect(0, 0, cw, ch);
    g.drawImage(this.world.canvas, ox, oy, cw, ch, 0, 0, cw, ch);
    if (race.wet > 0.02) {
      g.fillStyle = `rgba(20,40,75,${(race.wet * 0.3).toFixed(3)})`;
      g.fillRect(0, 0, cw, ch);
    }

    // ---- camada 2: alta resolução ----
    const o = this.octx;
    const W = window.innerWidth, H = window.innerHeight;
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.clearRect(0, 0, W, H);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = "high";
    const ps = this.pixelScale;
    const m = this.m2css();
    const toCss = (p: { x: number; y: number }) => ({ x: (p.x - ox) * ps, y: (p.y - oy) * ps });

    this.screenPos.clear();
    const rainLight = race.wet > 0.2 && Math.floor(performance.now() / 300) % 2 === 0;
    const sorted = [...race.cars].sort((a, b) => Number(a.id === this.followId) - Number(b.id === this.followId));
    for (const c of sorted) {
      const p = pos.get(c.id)!;
      const { x, y } = toCss(p);
      const margin = CAR_LEN_M * m;
      if (x < -margin || y < -margin || x > W + margin || y > H + margin) continue;
      this.screenPos.set(c.id, { x, y });
      if (race.wet > 0.25 && c.v > 25) this.spray(o, x, y, p.h, race.wet, m);
      this.drawCar(o, x, y, p.h + (c.spin > 0 ? c.spin * 2.2 : 0), carImage(c.team, rainLight), m, c.retired ? 0.6 : 1);
      if (c.retired) this.smoke(o, x, y, m);
    }

    if (scPos) {
      const { x, y } = toCss(scPos);
      this.screenPos.set("SC", { x, y });
      const blink = Math.floor(performance.now() / 250) % 2 === 0;
      this.drawCar(o, x, y, scPos.h, carImage(race.cars[0].team, blink, true), m, 1);
    }

    // etiquetas: carro seguido, carros dos jogadores e safety car (empilham quando se sobrepõem)
    const placed: { x: number; y: number; w: number }[] = [];
    const lift = Math.max(14, 1.6 * m);
    if (scPos) {
      const sp = this.screenPos.get("SC")!;
      this.label(o, sp.x, sp.y - lift, this.followId === "SC" ? "SAFETY CAR" : "SC", "#ffcc00", "#111", placed);
    }
    for (const c of race.cars) {
      const sp = this.screenPos.get(c.id);
      if (!sp) continue;
      const mine = c.isHuman;
      if (!mine && c.id !== this.followId) continue;
      const txt = c.retired ? `OUT ${c.driver.short}` : `P${c.position} ${c.driver.short}`;
      this.label(o, sp.x, sp.y - lift, txt, mine ? c.team.color : "#111", mine && isLight(c.team.color) ? "#111" : "#fff", placed);
    }

    if (race.rain > 0) this.drawRain(o, W, H, realDt, race.rain);
    if (race.phase === "lights") this.drawLights(o, W);
  }

  private drawCar(o: CanvasRenderingContext2D, x: number, y: number, h: number, img: ReturnType<typeof carImage>, m: number, alpha: number) {
    o.save();
    o.translate(x, y);
    o.rotate(h);
    o.globalAlpha = alpha;
    o.drawImage(img.canvas, (-img.wM / 2) * m, (-img.hM / 2) * m, img.wM * m, img.hM * m);
    o.restore();
  }

  private smoothSc(s: number, v: number, simDt: number, realDt: number): Disp {
    const L = this.race.track.L;
    const d = this.scDisp!;
    let err = s - d.s;
    if (err > L / 2) err -= L;
    if (err < -L / 2) err += L;
    if (Math.abs(err) > 80) d.s = s;
    else d.s += Math.max(0, v * simDt + err * Math.min(1, realDt * 6));
    d.s = ((d.s % L) + L) % L;
    return d;
  }

  private label(o: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, placed: { x: number; y: number; w: number }[]) {
    o.font = "11px Silkscreen, monospace";
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

  private spray(o: CanvasRenderingContext2D, x: number, y: number, h: number, wet: number, m: number) {
    const n = Math.round(6 + wet * 14);
    for (let i = 0; i < n; i++) {
      const back = (2.6 + Math.random() * 4) * m;
      const side = (Math.random() - 0.5) * 2.2 * m;
      const sx = x - Math.cos(h) * back - Math.sin(h) * side;
      const sy = y - Math.sin(h) * back + Math.cos(h) * side;
      o.fillStyle = `rgba(220,230,245,${(0.1 + Math.random() * 0.22).toFixed(2)})`;
      const r = (0.15 + Math.random() * 0.35) * m;
      o.beginPath();
      o.arc(sx, sy, r, 0, Math.PI * 2);
      o.fill();
    }
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

  private drawRain(o: CanvasRenderingContext2D, W: number, H: number, dt: number, rain: number) {
    const want = Math.round(rain * 420 * (W * H) / (1600 * 1000));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * W, y: Math.random() * H, l: 8 + Math.random() * 10 });
    if (this.drops.length > want) this.drops.length = want;
    o.strokeStyle = "rgba(180,200,235,0.45)";
    o.lineWidth = 1.2;
    o.beginPath();
    for (const d of this.drops) {
      d.x -= 160 * dt;
      d.y += 800 * dt;
      if (d.y > H) {
        d.y = -10;
        d.x = Math.random() * (W + 80);
      }
      if (d.x < -10) d.x = W + 10;
      o.moveTo(d.x, d.y);
      o.lineTo(d.x - d.l * 0.2, d.y + d.l);
    }
    o.stroke();
  }

  private drawLights(o: CanvasRenderingContext2D, W: number) {
    const lit = Math.min(5, Math.floor(this.race.time));
    const r = 16, gap = 46;
    const x0 = W / 2 - gap * 2;
    o.fillStyle = "#111";
    o.fillRect(x0 - 30, 70, gap * 4 + 60, 56);
    for (let i = 0; i < 5; i++) {
      o.beginPath();
      o.arc(x0 + i * gap, 98, r, 0, Math.PI * 2);
      o.fillStyle = i < lit ? "#ff2a2a" : "#3a1010";
      if (i < lit) {
        o.shadowColor = "#ff2a2a";
        o.shadowBlur = 18;
      }
      o.fill();
      o.shadowBlur = 0;
    }
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
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * canvas.width;
      const y = ((e.clientY - r.top) / r.height) * canvas.height;
      let best: string | null = null;
      let bestD = 10;
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

