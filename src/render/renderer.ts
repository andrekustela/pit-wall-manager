import type { Race } from "../sim/race";
import { CAR_LEN, CAR_WID, carSprite, safetyCarSprite } from "./sprites";
import { PPM, buildWorld, type World } from "./worldArt";

interface Disp {
  s: number;
  lat: number;
}

/** Desenha a corrida em baixa resolução, com câmera seguindo um carro. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private world: World;
  private cam = { x: 0, y: 0, ready: false };
  private disp = new Map<string, Disp>();
  private scDisp: Disp | null = null;
  private drops: { x: number; y: number; l: number }[] = [];
  private screenPos = new Map<string, { x: number; y: number }>();
  followId: string;
  pixelScale = 3;

  constructor(private canvas: HTMLCanvasElement, private race: Race, followId: string, onPick: (id: string) => void) {
    this.ctx = canvas.getContext("2d")!;
    this.world = buildWorld(race.track);
    this.followId = followId;
    this.resize();
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * canvas.width;
      const y = ((e.clientY - r.top) / r.height) * canvas.height;
      let best: string | null = null;
      let bestD = 16;
      for (const [id, p] of this.screenPos) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) onPick(best);
    });
  }

  destroy() {
    window.removeEventListener("resize", this.resize);
  }

  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.pixelScale = w < 700 ? 2 : h > 1100 ? 4 : 3;
    this.canvas.width = Math.ceil(w / this.pixelScale);
    this.canvas.height = Math.ceil(h / this.pixelScale);
    this.ctx.imageSmoothingEnabled = false;
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
    d.s += v * simDt;
    let err = s - d.s;
    if (err > L / 2) err -= L;
    if (err < -L / 2) err += L;
    if (Math.abs(err) > 80) d.s = s;
    else d.s += err * Math.min(1, realDt * 8);
    d.s = ((d.s % L) + L) % L;
    d.lat += (lat - d.lat) * Math.min(1, realDt * 10);
    return d;
  }

  private px(s: number, lat: number) {
    const p = this.race.track.pose(s, lat);
    return { x: (p.x - this.world.minX) * PPM, y: (p.y - this.world.minY) * PPM, h: p.h };
  }

  draw(realDt: number, speed: number) {
    const g = this.ctx;
    const race = this.race;
    const cw = this.canvas.width, ch = this.canvas.height;
    const simDt = race.phase === "racing" ? realDt * speed : 0;

    // posições suavizadas
    const pos = new Map<string, { x: number; y: number; h: number }>();
    for (const c of race.cars) {
      const jump = c.pit === "stopped" || c.pit === "parked";
      const d = this.smooth(c.id, c.s, c.lateral, c.v, simDt, realDt, jump);
      pos.set(c.id, this.px(d.s, d.lat));
    }

    // safety car (posição suavizada) — também pode ser seguido pela câmera
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

    g.fillStyle = race.track.def.grass[0];
    g.fillRect(0, 0, cw, ch);
    g.drawImage(this.world.canvas, ox, oy, cw, ch, 0, 0, cw, ch);

    // pista molhada escurece tudo um pouco
    if (race.wet > 0.02) {
      g.fillStyle = `rgba(20,40,75,${(race.wet * 0.3).toFixed(3)})`;
      g.fillRect(0, 0, cw, ch);
    }

    // carros
    this.screenPos.clear();
    const sorted = [...race.cars].sort((a, b) => Number(a.id === this.followId) - Number(b.id === this.followId));
    for (const c of sorted) {
      const p = pos.get(c.id)!;
      const x = p.x - ox, y = p.y - oy;
      if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
      this.screenPos.set(c.id, { x, y });
      if (race.wet > 0.25 && c.v > 25) this.spray(g, x, y, p.h, race.wet);
      g.save();
      g.translate(Math.round(x), Math.round(y));
      // rodada: carro gira
      g.rotate(p.h + (c.spin > 0 ? c.spin * 2.2 : 0));
      if (c.retired) g.globalAlpha = 0.65;
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(-CAR_LEN / 2 + 1, -CAR_WID / 2 + 1, CAR_LEN, CAR_WID);
      g.drawImage(carSprite(c.team), -CAR_LEN / 2, -CAR_WID / 2);
      g.restore();
      if (c.retired) this.smoke(g, x, y);
    }

    // safety car
    if (scPos) {
      const p = scPos;
      const x = p.x - ox, y = p.y - oy;
      this.screenPos.set("SC", { x, y });
      g.save();
      g.translate(Math.round(x), Math.round(y));
      g.rotate(p.h);
      g.drawImage(safetyCarSprite(Math.floor(performance.now() / 250) % 2 === 0), -6, -3);
      g.restore();
      this.label(g, Math.round(x), Math.round(y) - 8, this.followId === "SC" ? "SAFETY CAR" : "SC", "#ffcc00", "#111");
    }

    // etiquetas: carro seguido e carros do jogador (empilha quando se sobrepõem)
    const placed: { x: number; y: number; w: number }[] = [];
    for (const c of race.cars) {
      const sp = this.screenPos.get(c.id);
      if (!sp) continue;
      const mine = c.isHuman;
      if (!mine && c.id !== this.followId) continue;
      const txt = c.retired ? `OUT ${c.driver.short}` : `P${c.position} ${c.driver.short}`;
      this.label(g, Math.round(sp.x), Math.round(sp.y) - 8, txt, mine ? c.team.color : "#111", mine && isLight(c.team.color) ? "#111" : "#fff", placed);
    }

    if (race.rain > 0) this.drawRain(g, cw, ch, realDt, race.rain);
    if (race.phase === "lights") this.drawLights(g, cw);
  }

  private smoothSc(s: number, v: number, simDt: number, realDt: number): Disp {
    const L = this.race.track.L;
    const d = this.scDisp!;
    d.s += v * simDt;
    let err = s - d.s;
    if (err > L / 2) err -= L;
    if (err < -L / 2) err += L;
    if (Math.abs(err) > 80) d.s = s;
    else d.s += err * Math.min(1, realDt * 8);
    return d;
  }

  private label(g: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, placed?: { x: number; y: number; w: number }[]) {
    g.font = "8px Silkscreen, monospace";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    const w = Math.ceil(g.measureText(text).width) + 4;
    const anchor = y;
    if (placed) {
      // sobe a etiqueta até não encostar em nenhuma já desenhada
      const hits = () => placed.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 + 2 && Math.abs(r.y - y) < 11);
      for (let k = 0; k < 6 && hits(); k++) y -= 11;
      placed.push({ x, y, w });
      if (y !== anchor) {
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.fillRect(x, y, 1, anchor - y);
      }
    }
    g.fillStyle = bg;
    g.fillRect(x - w / 2, y - 9, w, 9);
    g.fillStyle = "#000";
    g.fillRect(x - 1, y, 2, 2);
    g.fillStyle = fg;
    g.fillText(text, x, y);
  }

  private spray(g: CanvasRenderingContext2D, x: number, y: number, h: number, wet: number) {
    const n = Math.round(4 + wet * 8);
    for (let i = 0; i < n; i++) {
      const back = 7 + Math.random() * 10;
      const side = (Math.random() - 0.5) * 6;
      const sx = x - Math.cos(h) * back - Math.sin(h) * side;
      const sy = y - Math.sin(h) * back + Math.cos(h) * side;
      g.fillStyle = `rgba(220,230,245,${(0.15 + Math.random() * 0.25).toFixed(2)})`;
      g.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    }
  }

  private smoke(g: CanvasRenderingContext2D, x: number, y: number) {
    const t = performance.now() / 1000;
    for (let i = 0; i < 6; i++) {
      const k = (t * 0.8 + i / 6) % 1;
      g.fillStyle = `rgba(160,160,160,${(0.5 * (1 - k)).toFixed(2)})`;
      g.fillRect(Math.round(x + Math.sin(i * 3.1 + t) * 3), Math.round(y - k * 14), 2, 2);
    }
  }

  private drawRain(g: CanvasRenderingContext2D, cw: number, ch: number, dt: number, rain: number) {
    const want = Math.round(rain * 260 * (cw * ch) / (480 * 270));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * cw, y: Math.random() * ch, l: 2 + Math.random() * 3 });
    if (this.drops.length > want) this.drops.length = want;
    g.fillStyle = "rgba(180,200,235,0.55)";
    for (const d of this.drops) {
      d.x -= 60 * dt;
      d.y += 260 * dt;
      if (d.y > ch) {
        d.y = -4;
        d.x = Math.random() * (cw + 40);
      }
      if (d.x < -4) d.x = cw + 4;
      g.fillRect(Math.round(d.x), Math.round(d.y), 1, Math.round(d.l));
    }
  }

  private drawLights(g: CanvasRenderingContext2D, cw: number) {
    const lit = Math.min(5, Math.floor(this.race.time));
    const x0 = Math.round(cw / 2 - 5 * 9);
    g.fillStyle = "#111";
    g.fillRect(x0 - 4, 30, 5 * 18 + 6, 22);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i < lit ? "#ff2a2a" : "#3a1010";
      g.fillRect(x0 + i * 18, 34, 12, 14);
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

