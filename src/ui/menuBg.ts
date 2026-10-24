// Fundo animado do menu: um circuito grande com brilho e alguns "carros" de luz
// dando volta, com rastro. A cada volta completa do líder a pista troca (some,
// a nova entra crescendo um pouco) e o menu é avisado pra animar a faixa e o nome.
import { CIRCUITS, getTrack, type Vec } from "../sim/track";

const RUNNERS = [
  { color: "#ff2a32", speed: 0.06, start: 0 }, // líder: a volta dele troca a pista
  { color: "#38c6ff", speed: 0.056, start: -0.04 },
  { color: "#ffc21a", speed: 0.053, start: -0.08 },
];
const OUT_MS = 380;
const IN_MS = 620;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function trackIndexByName(name: string): number {
  const i = CIRCUITS.findIndex((c) => c.name.toLowerCase().includes(name.toLowerCase()));
  return i >= 0 ? i : 0;
}

interface TrackGeo {
  idx: number;
  pts: Vec[];
  cum: number[];
  total: number;
  bounds: [number, number, number, number];
}

function geo(idx: number): TrackGeo {
  const pts = getTrack(idx).pts;
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { idx, pts, cum, total: cum[cum.length - 1], bounds: [minX, minY, maxX, maxY] };
}

function pointAt(t: TrackGeo, u: number) {
  const d = (((u % 1) + 1) % 1) * t.total;
  let lo = 0, hi = t.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t.cum[m] <= d) lo = m;
    else hi = m;
  }
  const a = t.pts[lo % t.pts.length], b = t.pts[(lo + 1) % t.pts.length];
  const k = (d - t.cum[lo]) / Math.max(1e-6, t.cum[lo + 1] - t.cum[lo]);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/**
 * Monta o fundo no canvas. `onTrack(idx)` é chamado quando a pista troca
 * (pra animar a faixa e o nome). Devolve uma função pra parar.
 */
export function mountMenuBackdrop(cv: HTMLCanvasElement, trackIndex: number, onTrack?: (idx: number) => void) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const g = cv.getContext("2d")!;
  let tr = geo(trackIndex);
  let grid: HTMLCanvasElement | null = null;
  let layer: HTMLCanvasElement | null = null;
  let map = { sc: 1, ox: 0, oy: 0 };
  let W = 0, H = 0, dpr = 1;

  const toScreen = (p: { x: number; y: number }) => ({ x: map.ox + p.x * map.sc, y: map.oy + p.y * map.sc });

  const drawTrack = () => {
    const [minX, minY, maxX, maxY] = tr.bounds;
    const areaX = W * 0.42, areaW = W * 0.54, areaY = H * 0.12, areaH = H * 0.72;
    const sc = Math.min(areaW / (maxX - minX), areaH / (maxY - minY));
    map = { sc, ox: areaX + (areaW - (maxX - minX) * sc) / 2 - minX * sc, oy: areaY + (areaH - (maxY - minY) * sc) / 2 - minY * sc };
    layer = document.createElement("canvas");
    layer.width = cv.width;
    layer.height = cv.height;
    const l = layer.getContext("2d")!;
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    const path = new Path2D();
    tr.pts.forEach((p, i) => {
      const s = toScreen(p);
      if (i) path.lineTo(s.x, s.y);
      else path.moveTo(s.x, s.y);
    });
    path.closePath();
    l.lineJoin = "round";
    l.lineCap = "round";
    l.shadowColor = "rgba(232,32,42,0.55)";
    l.shadowBlur = 28;
    l.strokeStyle = "rgba(232,32,42,0.35)";
    l.lineWidth = 16;
    l.stroke(path);
    l.shadowBlur = 0;
    l.strokeStyle = "#232a3a";
    l.lineWidth = 12;
    l.stroke(path);
    l.strokeStyle = "rgba(233,237,245,0.85)";
    l.lineWidth = 2;
    l.stroke(path);
    const s0 = toScreen(pointAt(tr, 0));
    l.fillStyle = "#fff";
    l.fillRect(s0.x - 2, s0.y - 9, 4, 18);
  };

  const layout = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth;
    H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    grid = document.createElement("canvas");
    grid.width = cv.width;
    grid.height = cv.height;
    const l = grid.getContext("2d")!;
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.strokeStyle = "rgba(120,140,180,0.06)";
    l.lineWidth = 1;
    for (let x = 0; x < W; x += 48) { l.beginPath(); l.moveTo(x, 0); l.lineTo(x, H); l.stroke(); }
    for (let y = 0; y < H; y += 48) { l.beginPath(); l.moveTo(0, y); l.lineTo(W, y); l.stroke(); }
    drawTrack();
  };
  layout();
  const onResize = () => layout();
  window.addEventListener("resize", onResize);

  // relógio da volta (recomeça a cada pista nova)
  let lapT0 = performance.now();
  let phase: "run" | "out" | "in" = "run";
  let phaseT0 = 0;

  const nextTrack = () => {
    let i = tr.idx;
    while (CIRCUITS.length > 1 && i === tr.idx) i = Math.floor(Math.random() * CIRCUITS.length);
    return i;
  };

  let raf = 0;
  const frame = (now: number) => {
    if (!cv.isConnected) {
      window.removeEventListener("resize", onResize);
      return;
    }
    const t = (now - lapT0) / 1000;
    // líder completou a volta: troca de pista
    if (phase === "run" && RUNNERS[0].start + t * RUNNERS[0].speed >= 1 && !reduce) {
      phase = "out";
      phaseT0 = now;
    }
    let alpha = 1, scale = 1;
    if (phase === "out") {
      const k = Math.min(1, (now - phaseT0) / OUT_MS);
      alpha = 1 - k;
      scale = 1 + 0.04 * k;
      if (k >= 1) {
        tr = geo(nextTrack());
        drawTrack();
        onTrack?.(tr.idx);
        phase = "in";
        phaseT0 = now;
        lapT0 = now;
      }
    } else if (phase === "in") {
      const k = Math.min(1, (now - phaseT0) / IN_MS);
      alpha = easeOut(k);
      scale = 0.94 + 0.06 * easeOut(k);
      if (k >= 1) phase = "run";
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (grid) g.drawImage(grid, 0, 0);
    // pista e carros com o mesmo zoom/opacidade (em volta do centro da área da pista)
    const cx = W * 0.69 * dpr, cy = H * 0.48 * dpr;
    g.setTransform(scale, 0, 0, scale, cx * (1 - scale), cy * (1 - scale));
    g.globalAlpha = alpha;
    if (layer) g.drawImage(layer, 0, 0);
    g.setTransform(dpr * scale, 0, 0, dpr * scale, cx * (1 - scale), cy * (1 - scale));
    const tt = phase === "out" ? (phaseT0 - lapT0) / 1000 : t;
    for (const r of RUNNERS) {
      const u = r.start + tt * r.speed;
      if (u < 0) continue; // ainda não largou
      for (let k = 14; k >= 0; k--) {
        const uk = u - k * 0.0035;
        if (uk < 0) continue;
        const s = toScreen(pointAt(tr, uk));
        g.globalAlpha = alpha * (1 - k / 15) * 0.8;
        g.fillStyle = r.color;
        g.beginPath();
        g.arc(s.x, s.y, k === 0 ? 5 : 3.2 - k * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      const s = toScreen(pointAt(tr, u));
      g.globalAlpha = alpha;
      g.shadowColor = r.color;
      g.shadowBlur = 18;
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(s.x, s.y, 2.4, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
