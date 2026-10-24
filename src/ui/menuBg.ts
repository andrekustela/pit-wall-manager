// Fundo animado do menu: um circuito grande com brilho e alguns "carros" de luz
// dando volta, com rastro. Quando o líder completa a volta, a faixa vermelha sai
// pela esquerda e outra entra pela direita "varrendo" a tela: atrás dela (à
// direita) já aparece a pista nova; na frente (à esquerda) ainda é a antiga.
import { CIRCUITS, getTrack, type Vec } from "../sim/track";

const RUNNERS = [
  { color: "#ff2a32", speed: 0.06, start: 0 }, // líder: a volta dele troca a pista
  { color: "#38c6ff", speed: 0.056, start: -0.04 },
  { color: "#ffc21a", speed: 0.053, start: -0.08 },
];
/** faixa saindo pela esquerda / a nova entrando pela direita (ms) */
const EXIT_MS = 420;
const SWEEP_MS = 1100;
/** geometria da faixa (igual ao CSS de .m2stripe): esquerda em 33vw, 9vw de largura, inclinada -18° em volta de 55vh */
const STRIPE_LEFT = 0.33, STRIPE_W = 0.09, STRIPE_CY = 0.55, SKEW = Math.tan((18 * Math.PI) / 180);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
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

/** pista pronta pra desenhar: geometria + imagem do traçado + escala na tela */
interface Scene {
  tr: TrackGeo;
  layer: HTMLCanvasElement;
  map: { sc: number; ox: number; oy: number };
  t0: number; // quando a volta começou
}

/**
 * Monta o fundo no canvas. `stripe` é a faixa vermelha (o fundo move ela durante a
 * troca). `onTrack(idx)` avisa quando a pista nova começa a entrar.
 */
export function mountMenuBackdrop(cv: HTMLCanvasElement, trackIndex: number, stripe?: HTMLElement | null, onTrack?: (idx: number) => void) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const g = cv.getContext("2d")!;
  let grid: HTMLCanvasElement | null = null;
  let W = 0, H = 0, dpr = 1;

  const build = (idx: number, t0: number): Scene => {
    const tr = geo(idx);
    const [minX, minY, maxX, maxY] = tr.bounds;
    const areaX = W * 0.42, areaW = W * 0.54, areaY = H * 0.12, areaH = H * 0.72;
    const sc = Math.min(areaW / (maxX - minX), areaH / (maxY - minY));
    const map = { sc, ox: areaX + (areaW - (maxX - minX) * sc) / 2 - minX * sc, oy: areaY + (areaH - (maxY - minY) * sc) / 2 - minY * sc };
    const layer = document.createElement("canvas");
    layer.width = cv.width;
    layer.height = cv.height;
    const l = layer.getContext("2d")!;
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    const path = new Path2D();
    tr.pts.forEach((p, i) => {
      const x = map.ox + p.x * map.sc, y = map.oy + p.y * map.sc;
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
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
    const s0 = pointAt(tr, 0);
    l.fillStyle = "#fff";
    l.fillRect(map.ox + s0.x * map.sc - 2, map.oy + s0.y * map.sc - 9, 4, 18);
    return { tr, layer, map, t0 };
  };

  let cur: Scene;
  let next: Scene | null = null;
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
    cur = build(cur ? cur.tr.idx : trackIndex, cur ? cur.t0 : performance.now());
    if (next) next = build(next.tr.idx, next.t0);
  };
  layout();
  const onResize = () => layout();
  window.addEventListener("resize", onResize);

  // troca: "exit" (faixa sai pela esquerda) -> "sweep" (nova faixa varre da direita)
  let phase: "run" | "exit" | "sweep" = "run";
  let phaseT0 = 0;
  const nextIdx = () => {
    let i = cur.tr.idx;
    while (CIRCUITS.length > 1 && i === cur.tr.idx) i = Math.floor(Math.random() * CIRCUITS.length);
    return i;
  };

  /** desenha uma pista e os carros dela, recortada por `clip` (ou inteira) e deslocada em x */
  const drawScene = (s: Scene, now: number, clip: Path2D | null, dx: number, frozenAt?: number, alpha = 1) => {
    g.save();
    g.globalAlpha = alpha;
    if (clip) g.clip(clip);
    g.setTransform(1, 0, 0, 1, dx * dpr, 0);
    g.drawImage(s.layer, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, dx * dpr, 0);
    const t = ((frozenAt ?? now) - s.t0) / 1000;
    for (const r of RUNNERS) {
      const u = r.start + t * r.speed;
      if (u < 0) continue; // ainda não largou
      for (let k = 14; k >= 0; k--) {
        const uk = u - k * 0.0035;
        if (uk < 0) continue;
        const p = pointAt(s.tr, uk);
        g.globalAlpha = alpha * (1 - k / 15) * 0.8;
        g.fillStyle = r.color;
        g.beginPath();
        g.arc(s.map.ox + p.x * s.map.sc, s.map.oy + p.y * s.map.sc, k === 0 ? 5 : 3.2 - k * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      const p = pointAt(s.tr, u);
      g.globalAlpha = alpha;
      g.shadowColor = r.color;
      g.shadowBlur = 18;
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(s.map.ox + p.x * s.map.sc, s.map.oy + p.y * s.map.sc, 2.4, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
    g.restore();
  };

  /** região à direita do centro da faixa (deslocada `tx` px da posição de descanso) */
  const rightOfStripe = (tx: number) => {
    const xc = (y: number) => W * (STRIPE_LEFT + STRIPE_W / 2) + tx - SKEW * (y - H * STRIPE_CY);
    const p = new Path2D();
    p.moveTo(xc(0) * dpr, 0);
    p.lineTo(cv.width + 10, 0);
    p.lineTo(cv.width + 10, cv.height);
    p.lineTo(xc(H) * dpr, cv.height);
    p.closePath();
    return p;
  };
  const setStripe = (tx: number) => {
    if (stripe) stripe.style.transform = `translateX(${tx}px) skewX(-18deg)`;
  };

  let raf = 0;
  const frame = (now: number) => {
    if (!cv.isConnected) {
      window.removeEventListener("resize", onResize);
      return;
    }
    // líder completou a volta: começa a troca
    if (phase === "run" && !reduce && RUNNERS[0].start + ((now - cur.t0) / 1000) * RUNNERS[0].speed >= 1) {
      phase = "exit";
      phaseT0 = now;
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (grid) g.drawImage(grid, 0, 0);

    if (phase === "run") {
      drawScene(cur, now, null, 0);
    } else if (phase === "exit") {
      // a faixa de agora sai pela esquerda; a pista ainda é a antiga (carros parados na largada)
      const k = Math.min(1, (now - phaseT0) / EXIT_MS);
      setStripe(-easeInOut(k) * W * (STRIPE_LEFT + STRIPE_W + 0.12));
      drawScene(cur, now, null, 0, phaseT0);
      if (k >= 1) {
        next = build(nextIdx(), now + SWEEP_MS * 0.35);
        onTrack?.(next.tr.idx);
        phase = "sweep";
        phaseT0 = now;
      }
    } else if (phase === "sweep" && next) {
      // nova faixa vem da direita até o lugar dela; atrás dela já é a pista nova
      const k = Math.min(1, (now - phaseT0) / SWEEP_MS);
      const e = easeOut(k);
      const startTx = W * (1 - STRIPE_LEFT) + W * 0.12;
      const tx = startTx * (1 - e);
      setStripe(tx);
      const clipNew = rightOfStripe(tx);
      const clipOld = new Path2D();
      clipOld.rect(0, 0, cv.width, cv.height);
      clipOld.addPath(clipNew); // "evenodd": tudo menos a região da pista nova
      g.save();
      g.clip(clipOld, "evenodd");
      drawScene(cur, now, null, -60 * e, now, 1 - Math.max(0, (e - 0.55) / 0.45)); // a antiga escorrega pra esquerda e some no fim
      g.restore();
      drawScene(next, Math.max(now, next.t0), clipNew, 80 * (1 - e)); // a nova chega da direita
      if (k >= 1) {
        cur = next;
        next = null;
        phase = "run";
        setStripe(0);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
