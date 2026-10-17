// Pista em vetor. O mundo é grande demais pra virar uma imagem só em alta
// resolução, então é desenhado em "tiles" (pedaços quadrados), só os que
// aparecem na tela, na resolução do zoom atual, e guardados pra reaproveitar.
// Em velocidade alta usa tiles mais leves (LOD) e, enquanto um tile não fica
// pronto, mostra uma versão de baixa resolução do mapa inteiro (sem buracos).
import { TEAMS } from "../sim/data";
import { Rng } from "../sim/rng";
import { PIT_LATERAL, TRACK_WIDTH, Track } from "../sim/track";

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Chunk {
  path: Path2D;
  box: Box;
  /** distância (m) do início do traço, pra tracejado contínuo entre pedaços */
  offset: number;
}

interface Layer {
  chunks: Chunk[];
  /** metade da largura do traço (m), pra saber se encosta no tile */
  pad: number;
  apply: (g: CanvasRenderingContext2D) => void;
}

interface Shape {
  box: Box;
  draw: (g: CanvasRenderingContext2D) => void;
}

const MARGIN = 90; // m em volta da pista
export const TILE_PX = 256;
export const BLEED = 1;
export const OVERVIEW_PPM = 1;
const CROWD = ["#e8202a", "#f2f2f2", "#1c6ed4", "#f2c230", "#ff8a1c", "#16c2b0", "#d8b48a", "#7b3fe4", "#222"];

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D;

/** canvas da página ou OffscreenCanvas (dentro do Web Worker não existe document) */
export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof document === "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: AnyCanvas): Ctx {
  return c.getContext("2d") as unknown as Ctx;
}

function hits(a: Box, x0: number, y0: number, x1: number, y1: number, pad = 0) {
  return a.x1 + pad >= x0 && a.x0 - pad <= x1 && a.y1 + pad >= y0 && a.y0 - pad <= y1;
}

function patternCanvas(size: number, base: string | null, dots: [string, number][], seed: number): AnyCanvas {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  if (base) {
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
  }
  const rng = new Rng(seed);
  for (const [col, n] of dots) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) g.fillRect(Math.floor(rng.next() * size), Math.floor(rng.next() * size), 1, 1);
  }
  return c;
}

export class VectorWorld {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  private layers: Layer[] = [];
  private shapes: Shape[] = [];
  private pats: Record<string, CanvasPattern> = {};

  constructor(private track: Track) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    this.minX = minX - MARGIN;
    this.minY = minY - MARGIN;
    this.maxX = maxX + MARGIN;
    this.maxY = maxY + MARGIN;
    this.makePatterns();
    this.build();
  }

  // ---------- montagem das peças (uma vez) ----------

  private makePatterns() {
    const ctx = ctx2d(makeCanvas(1, 1));
    const pat = (c: AnyCanvas, metersPerPx: number) => {
      const p = ctx.createPattern(c, "repeat")!;
      p.setTransform(new DOMMatrix().scaleSelf(metersPerPx, metersPerPx));
      return p;
    };
    this.pats.asphalt = pat(patternCanvas(64, "#55565c", [["#4d4e54", 900], ["#5f6067", 700], ["#46474c", 120]], 1), 0.12);
    this.pats.gravel = pat(patternCanvas(48, "#bba97b", [["#a39268", 500], ["#cfbf92", 400], ["#8f8059", 60]], 2), 0.14);
    this.pats.grass = pat(patternCanvas(64, null, [["rgba(30,90,30,0.35)", 160], ["rgba(120,190,100,0.25)", 120]], 3), 0.3);
    const crowd = makeCanvas(40, 20);
    const cg = ctx2d(crowd);
    cg.fillStyle = "#4a505c";
    cg.fillRect(0, 0, 40, 20);
    const rng = new Rng(4);
    for (let y = 1; y < 20; y += 2) for (let x = 0; x < 40; x++) {
      cg.fillStyle = CROWD[Math.floor(rng.next() * CROWD.length)];
      cg.fillRect(x, y, 1, 1);
    }
    this.pats.crowd = pat(crowd, 0.35);
  }

  /** pontos ao longo da pista (s de a até b) num deslocamento lateral */
  private line(a: number, b: number, lat: (s: number) => number, step = 2): [number, number][] {
    const pts: [number, number][] = [];
    for (let s = a; s <= b + 1e-6; s += step) {
      const p = this.track.pose(s, lat(s));
      pts.push([p.x, p.y]);
    }
    return pts;
  }

  /** quebra uma linha comprida em pedaços com caixa (pra só desenhar o que aparece) */
  private chunks(pts: [number, number][], closed: boolean, per = 40): Chunk[] {
    const out: Chunk[] = [];
    if (closed) pts = [...pts, pts[0]];
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i += per) {
      const seg = pts.slice(i, Math.min(pts.length, i + per + 1));
      const path = new Path2D();
      const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      seg.forEach(([x, y], k) => {
        if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
        box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
        box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
      });
      out.push({ path, box, offset: dist });
      for (let k = 0; k < seg.length - 1; k++) dist += Math.hypot(seg[k + 1][0] - seg[k][0], seg[k + 1][1] - seg[k][1]);
    }
    return out;
  }

  /** faixa (polígono) entre duas laterais, de s0 a s1 */
  private band(s0: number, s1: number, l0: number, l1: number, step = 2): Shape["box"] & { path: Path2D } {
    const a = this.line(s0, s1, () => l0, step);
    const b = this.line(s0, s1, () => l1, step).reverse();
    const path = new Path2D();
    const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    [...a, ...b].forEach(([x, y], k) => {
      if (k === 0) path.moveTo(x, y); else path.lineTo(x, y);
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    });
    path.closePath();
    return { ...box, path };
  }

  /** trechos de curva (onde vai zebra e brita) */
  private cornerRuns(minCurv: number): { a: number; b: number; side: number }[] {
    const t = this.track;
    const runs: { a: number; b: number; side: number }[] = [];
    let start = -1, side = 0;
    for (let s = 0; s <= t.L; s++) {
      const k = t.curvature[s % t.L];
      const on = Math.abs(k) >= minCurv;
      const sd = k > 0 ? 1 : -1;
      if (on && start < 0) { start = s; side = sd; }
      if (start >= 0 && (!on || sd !== side || s === t.L)) {
        if (s - start > 6) runs.push({ a: start, b: s, side });
        start = on ? s : -1;
        side = sd;
      }
    }
    return runs;
  }

  private build() {
    const t = this.track;
    const W = TRACK_WIDTH;
    const L = t.L;
    const stroke = (chunks: Chunk[], width: number, apply: (g: CanvasRenderingContext2D) => void) =>
      this.layers.push({ chunks, pad: width / 2 + 1, apply });

    const street = !!t.def.street;
    // rua: calçada larga em volta da pista (por baixo de tudo)
    if (street) {
      const walk = this.chunks(this.line(0, L - 1, () => 0, 2), true);
      stroke(walk, W + 14, (g) => {
        g.strokeStyle = "#8e9198";
        g.lineWidth = W + 14;
      });
      stroke(walk, W + 4.2, (g) => {
        g.strokeStyle = "#5d6068";
        g.lineWidth = W + 4.2;
      });
    }
    // brita do lado de fora das curvas
    const gravel: Chunk[] = [];
    if (!street) for (const r of this.cornerRuns(1 / 260)) {
      const out = -r.side; // lado de fora
      gravel.push(...this.chunks(this.line(r.a - 8, r.b + 8, () => out * (W / 2 + 9)), false));
    }
    stroke(gravel, 19, (g) => {
      g.strokeStyle = this.pats.gravel;
      g.lineWidth = 19;
    });

    // pit lane (antes da pista, pra pista ficar por cima na junção)
    const pitPts = this.line(t.pitEntryS, t.pitExitS + L, (s) => t.pitLateralAt(s), 1.5);
    const pit = this.chunks(pitPts, false);
    stroke(pit, 9.8, (g) => {
      g.strokeStyle = "#2a2a2e";
      g.lineWidth = 9.8;
    });
    stroke(pit, 8.6, (g) => {
      g.strokeStyle = this.pats.asphalt;
      g.lineWidth = 8.6;
    });

    // pista: borda escura + asfalto com textura
    const center = this.chunks(this.line(0, L - 1, () => 0, 2), true);
    stroke(center, W + 3, (g) => {
      g.strokeStyle = "#232327";
      g.lineWidth = W + 3;
    });
    stroke(center, W, (g) => {
      g.strokeStyle = this.pats.asphalt;
      g.lineWidth = W;
    });
    // borracha do traçado
    const rubber = this.chunks(this.line(0, L - 1, (s) => Math.max(-W / 2 + 2.5, Math.min(W / 2 - 2.5, t.curvature[Math.floor(s) % L] * 900)), 2), true);
    // cor sólida: com transparência, as emendas entre trechos viravam bolinhas escuras
    stroke(rubber, 2.2, (g) => {
      g.strokeStyle = "#4a4b50";
      g.lineWidth = 2.2;
      g.lineCap = "butt";
    });
    // linhas brancas
    for (const side of [-1, 1]) {
      const edge = this.chunks(this.line(0, L - 1, () => side * (W / 2 - 0.45), 2), true);
      stroke(edge, 0.3, (g) => {
        g.strokeStyle = "#e8e8e8";
        g.lineWidth = 0.3;
      });
    }
    // zebras: base branca + vermelho tracejado
    for (const r of this.cornerRuns(1 / 300)) {
      for (const side of [-1, 1]) {
        const k = this.chunks(this.line(r.a, r.b, () => side * (W / 2 + 0.55), 1), false);
        stroke(k, 1.2, (g) => {
          g.strokeStyle = "#f2f2f2";
          g.lineWidth = 1.2;
        });
        this.layers.push({
          chunks: k,
          pad: 2,
          apply: (g) => {
            g.strokeStyle = "#d42a2a";
            g.lineWidth = 1.2;
            g.setLineDash([2.5, 2.5]);
            g.lineCap = "butt";
          },
        });
      }
    }
    // rua: muro colado na pista (do lado do box, só fora do pit lane)
    if (street) {
      for (const side of [-1, 1]) {
        const pts = side < 0 ? this.line(0, L - 1, () => -(W / 2 + 1.6), 2) : this.line(t.pitExitS + 6, t.pitEntryS - 6, () => W / 2 + 1.6, 2);
        const wl = this.chunks(pts, side < 0);
        stroke(wl, 1.1, (g) => {
          g.strokeStyle = "#d9dce1";
          g.lineWidth = 1.1;
        });
        this.layers.push({
          chunks: wl,
          pad: 2,
          apply: (g) => {
            g.strokeStyle = "#7b818c";
            g.lineWidth = 1.1;
            g.setLineDash([0.5, 3.5]);
            g.lineCap = "butt";
          },
        });
      }
    }
    // muro do pit
    const wall = this.chunks(this.line(t.pitEntryS + 80, t.pitExitS + L - 80, () => W / 2 + 3.75, 2), false);
    this.layers.push({
      chunks: wall,
      pad: 2,
      apply: (g) => {
        g.strokeStyle = "#cfd2d6";
        g.lineWidth = 1.3;
        g.setLineDash([5, 1]);
        g.lineCap = "butt";
      },
    });

    // ---- formas ----
    const span = t.wrap(t.pitBoxEnd - t.pitBoxStart);
    TEAMS.forEach((team, i) => {
      const c = t.pitBoxStart + (span * (i + 0.5)) / TEAMS.length;
      const half = (span / TEAMS.length) * 0.42;
      const garage = this.band(c - half, c + half, PIT_LATERAL + 5, PIT_LATERAL + 16, 1);
      const front = this.band(c - half, c + half, PIT_LATERAL + 5, PIT_LATERAL + 6, 1);
      const roof = this.band(c - half, c + half, PIT_LATERAL + 14.5, PIT_LATERAL + 16, 1);
      const spot = this.band(c - half * 0.7, c + half * 0.7, PIT_LATERAL + 1.6, PIT_LATERAL + 4.4, 1);
      this.shapes.push({
        box: garage,
        draw: (g) => {
          g.fillStyle = "#3a3f4a";
          g.fill(garage.path);
          g.fillStyle = "#20242c";
          g.fill(roof.path);
          g.fillStyle = team.color;
          g.fill(front.path);
          g.strokeStyle = team.color;
          g.lineWidth = 0.25;
          g.stroke(spot.path);
        },
      });
    });

    // arquibancada e placas na reta principal
    // só ao longo da reta (em pista de reta curta não entra na curva)
    const sa = Math.max(L - 320, t.mainStraight[0] + 10), sb = Math.min(L + 260, L + t.mainStraight[1] - 10);
    const stand = this.band(sa, sb, -(W / 2 + 8), -(W / 2 + 22), 2);
    const roof = this.band(sa, sb, -(W / 2 + 21), -(W / 2 + 24), 2);
    const rail = this.band(sa, sb, -(W / 2 + 7), -(W / 2 + 8), 2);
    this.shapes.push({
      box: { x0: Math.min(stand.x0, roof.x0), y0: Math.min(stand.y0, roof.y0), x1: Math.max(stand.x1, roof.x1), y1: Math.max(stand.y1, roof.y1) },
      draw: (g) => {
        g.fillStyle = this.pats.crowd;
        g.fill(stand.path);
        g.fillStyle = "#2b2f38";
        g.fill(roof.path);
        g.fillStyle = "#9aa0aa";
        g.fill(rail.path);
      },
    });
    const signs = ["#e8202a", "#1c6ed4", "#f2c230", "#16c2b0", "#ffffff"];
    for (let s = sa + 20, i = 0; s < sb - 20; s += 40, i++) {
      const b = this.band(s, s + 24, -(W / 2 + 5), -(W / 2 + 6.5), 2);
      const col = signs[i % signs.length];
      this.shapes.push({ box: b, draw: (g) => { g.fillStyle = col; g.fill(b.path); } });
    }

    // largada (quadriculado) e marcas do grid
    const p0 = t.pose(0, 0);
    this.shapes.push({
      box: { x0: p0.x - 12, y0: p0.y - 12, x1: p0.x + 12, y1: p0.y + 12 },
      draw: (g) => {
        g.save();
        g.translate(p0.x, p0.y);
        g.rotate(p0.h);
        const cell = 0.6;
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < Math.ceil(W / cell); k++) {
            g.fillStyle = (r + k) % 2 ? "#141414" : "#f5f5f5";
            g.fillRect(r * cell, -W / 2 + k * cell, cell, cell);
          }
        g.restore();
      },
    });
    for (let i = 0; i < 20; i++) {
      const s = L - 14 - i * 8 + 3.2;
      const lat = i % 2 === 0 ? -3.4 : 3.4;
      const p = t.pose(s, lat);
      this.shapes.push({
        box: { x0: p.x - 4, y0: p.y - 4, x1: p.x + 4, y1: p.y + 4 },
        draw: (g) => {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.h);
          g.strokeStyle = "#e8e8e8";
          g.lineWidth = 0.25;
          g.beginPath();
          g.moveTo(0, -1.4);
          g.lineTo(0, 1.4);
          g.moveTo(0, -1.4);
          g.lineTo(-1.2, -1.4);
          g.moveTo(0, 1.4);
          g.lineTo(-1.2, 1.4);
          g.stroke();
          g.restore();
        },
      });
    }

    // árvores longe da pista (na rua: prédios)
    const rng = new Rng(1234);
    const near = this.nearGrid();
    if (street) this.buildings(rng, near);
    for (let i = 0; i < (street ? 0 : 2600); i++) {
      const x = rng.range(this.minX, this.maxX), y = rng.range(this.minY, this.maxY);
      if (near(x, y, 45)) continue;
      const r = rng.range(3, 7);
      const tone = rng.range(-0.06, 0.06);
      this.shapes.push({
        box: { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1.5, y1: y + r + 1.5 },
        draw: (g) => {
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.beginPath(); g.arc(x + 1.2, y + 1.4, r, 0, Math.PI * 2); g.fill();
          g.fillStyle = `hsl(125 ${48 + tone * 100}% ${24 + tone * 60}%)`;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          g.fillStyle = `hsl(118 ${45 + tone * 100}% ${33 + tone * 60}%)`;
          g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2); g.fill();
        },
      });
    }
  }

  /** quarteirões de prédios (circuito de rua) */
  private buildings(rng: Rng, near: (x: number, y: number, d: number) => boolean) {
    const tones = ["#d8c6a2", "#e7ddcb", "#c9a37f", "#bab4a8", "#ebe5d9", "#cf9f7b", "#a9b4bf", "#e2cfa8"];
    const boxes: Box[] = [];
    for (let i = 0; i < 6000; i++) {
      const w = rng.range(16, 46), h = rng.range(16, 46);
      const x = rng.range(this.minX, this.maxX - w), y = rng.range(this.minY, this.maxY - h);
      const cx = x + w / 2, cy = y + h / 2;
      if (near(cx, cy, Math.max(w, h) / 2 + 16)) continue;
      if (boxes.some((b) => x < b.x1 + 3 && x + w > b.x0 - 3 && y < b.y1 + 3 && y + h > b.y0 - 3)) continue;
      const box = { x0: x, y0: y, x1: x + w + 3, y1: y + h + 3 };
      boxes.push(box);
      const col = tones[Math.floor(rng.next() * tones.length)];
      const roof = rng.chance(0.4) ? "#b5523b" : null; // telhado de telha
      const tall = rng.range(1.5, 3.2);
      this.shapes.push({
        box,
        draw: (g) => {
          g.fillStyle = "rgba(0,0,0,0.3)";
          g.fillRect(x + tall, y + tall, w, h);
          g.fillStyle = col;
          g.fillRect(x, y, w, h);
          g.fillStyle = roof ?? "rgba(0,0,0,0.08)";
          g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
          g.strokeStyle = "rgba(0,0,0,0.25)";
          g.lineWidth = 0.4;
          g.strokeRect(x, y, w, h);
        },
      });
    }
  }

  private nearGrid() {
    const cell = 20;
    const set = new Set<string>();
    for (let s = 0; s < this.track.L; s += 5) {
      const p = this.track.pts[s];
      set.add(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`);
    }
    return (x: number, y: number, dist: number) => {
      const r = Math.ceil(dist / cell);
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (set.has(`${cx + dx},${cy + dy}`)) return true;
      return false;
    };
  }

  // ---------- desenho ----------

  /** desenha a região [x0,x1]x[y0,y1] (m) num contexto já transformado pra metros */
  private renderRegion(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const grass = this.track.def.grass;
    g.fillStyle = grass[0];
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (!this.track.def.street) this.grassBands(g, x0, y0, x1, y1, grass);
    this.drawLayers(g, x0, y0, x1, y1);
  }

  private grassBands(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, grass: [string, string]) {
    // faixas de corte da grama
    const band = 24;
    for (let y = Math.floor(y0 / band) * band; y < y1; y += band) {
      if (Math.floor(y / band) % 2) continue;
      g.fillStyle = grass[1];
      g.fillRect(x0, y, x1 - x0, band);
    }
    g.fillStyle = this.pats.grass;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  private drawLayers(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {

    g.lineJoin = "round";
    g.lineCap = "round";
    for (const layer of this.layers) {
      let applied = false;
      for (const ch of layer.chunks) {
        if (!hits(ch.box, x0, y0, x1, y1, layer.pad)) continue;
        if (!applied) {
          g.setLineDash([]);
          g.lineCap = "round";
          layer.apply(g);
          applied = true;
        }
        g.lineDashOffset = ch.offset;
        g.stroke(ch.path);
      }
    }
    g.setLineDash([]);
    for (const sh of this.shapes) if (hits(sh.box, x0, y0, x1, y1)) sh.draw(g);
    if (this.track.def.night) this.drawNight(g, x0, y0, x1, y1);
  }

  /** postes de refletor ao longo da pista (só nas corridas de noite) */
  private lights: { x: number; y: number }[] = [];

  /** noite: escurece tudo e acende os refletores (fica pronto no tile, sem custo por quadro) */
  private drawNight(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    if (!this.lights.length) {
      const t = this.track;
      for (let s = 0, i = 0; s < t.L; s += 42, i++) {
        const p = t.pose(s, (i % 2 ? 1 : -1) * (TRACK_WIDTH / 2 + 7));
        this.lights.push({ x: p.x, y: p.y });
      }
    }
    g.save();
    g.fillStyle = "rgba(4, 7, 20, 0.74)";
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.globalCompositeOperation = "lighter";
    const R = 34;
    for (const l of this.lights) {
      if (l.x < x0 - R || l.x > x1 + R || l.y < y0 - R || l.y > y1 + R) continue;
      const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, R);
      gr.addColorStop(0, "rgba(255, 228, 170, 0.44)");
      gr.addColorStop(0.5, "rgba(255, 214, 150, 0.2)");
      gr.addColorStop(1, "rgba(255, 210, 140, 0)");
      g.fillStyle = gr;
      g.fillRect(l.x - R, l.y - R, R * 2, R * 2);
    }
    g.globalCompositeOperation = "source-over";
    // o poste em si (pontinho claro)
    g.fillStyle = "#fff6d8";
    for (const l of this.lights) {
      if (l.x < x0 - 2 || l.x > x1 + 2 || l.y < y0 - 2 || l.y > y1 + 2) continue;
      g.beginPath();
      g.arc(l.x, l.y, 0.9, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** mapa inteiro em baixa resolução (aparece enquanto um tile não fica pronto) */
  renderOverview(ppm = OVERVIEW_PPM): AnyCanvas {
    const c = makeCanvas(Math.ceil((this.maxX - this.minX) * ppm), Math.ceil((this.maxY - this.minY) * ppm));
    const g = ctx2d(c);
    g.setTransform(ppm, 0, 0, ppm, -this.minX * ppm, -this.minY * ppm);
    this.renderRegion(g, this.minX, this.minY, this.maxX, this.maxY);
    return c;
  }

  /** um tile (TILE_PX) com 1 px de sobra em cada lado, pra não ficar emenda entre tiles */
  renderTile(ppm: number, tx: number, ty: number): AnyCanvas {
    const sizeM = TILE_PX / ppm;
    const x0 = tx * sizeM, y0 = ty * sizeM;
    const c = makeCanvas(TILE_PX + 2 * BLEED, TILE_PX + 2 * BLEED);
    const g = ctx2d(c);
    g.setTransform(ppm, 0, 0, ppm, -x0 * ppm + BLEED, -y0 * ppm + BLEED);
    const b = BLEED / ppm;
    this.renderRegion(g, x0 - b, y0 - b, x0 + sizeM + b, y0 + sizeM + b);
    return c;
  }
}
