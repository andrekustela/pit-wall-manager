// Carro de teste da IA: acha o traçado mais rápido de cada pista (rota ideal).
// O traçado = distância até o meio da pista a cada 10 m (dentro do asfalto); o tempo de volta
// usa a mesma física do jogo (curva limita a velocidade, freada e aceleração). Recozimento
// simulado: mexe um trecho, dá a volta de novo e guarda se ficou mais rápido (às vezes aceita
// uma piora pequena pra não ficar preso). Saída: src/sim/racingLines.ts
// uso: npx tsx scripts/racing-line.ts [iterações por pista, padrão 25000] [só a pista N]
import { writeFileSync } from "node:fs";
import { ACTIVE_TRACKS, CIRCUITS, TRACK_WIDTH, getTrack } from "../src/sim/track";

const ITERS = Number(process.argv[2] ?? 25000);
const ONLY = process.argv[3] !== undefined ? Number(process.argv[3]) : null;
const STEP = 10; // m entre os pontos do traçado
const EDGE = TRACK_WIDTH / 2 - 1.6; // até onde o carro chega da borda (metade do carro + folga)
const LAT = 36, VMAX = 90, BRAKE = 40;

interface Geo { x: Float64Array; y: Float64Array; nx: Float64Array; ny: Float64Array; L: number }

function geometry(i: number): Geo {
  const t = getTrack(i), L = t.L;
  const g: Geo = { x: new Float64Array(L), y: new Float64Array(L), nx: new Float64Array(L), ny: new Float64Array(L), L };
  for (let s = 0; s < L; s++) {
    const p = t.pose(s, 0);
    g.x[s] = p.x;
    g.y[s] = p.y;
    g.nx[s] = -Math.sin(p.h);
    g.ny[s] = Math.cos(p.h);
  }
  return g;
}

/** offsets nos nós -> offset a cada metro (Catmull-Rom, fecha a volta) */
function dense(o: Float64Array, L: number, out: Float64Array) {
  const N = o.length;
  for (let s = 0; s < L; s++) {
    const u = s / STEP, j = Math.floor(u) % N, f = u - Math.floor(u);
    const p0 = o[(j - 1 + N) % N], p1 = o[j], p2 = o[(j + 1) % N], p3 = o[(j + 2) % N];
    out[s] = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  }
}

const ang = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);

/** tempo de volta seguindo o traçado (mesma física do jogo, com o comprimento real de cada metro) */
function lapTime(g: Geo, off: Float64Array, buf: { px: Float64Array; py: Float64Array; h: Float64Array; ds: Float64Array; v: Float64Array }): number {
  const L = g.L, { px, py, h, ds, v } = buf;
  for (let s = 0; s < L; s++) {
    px[s] = g.x[s] + g.nx[s] * off[s];
    py[s] = g.y[s] + g.ny[s] * off[s];
  }
  for (let s = 0; s < L; s++) {
    const a = (s - 2 + L) % L, b = (s + 2) % L;
    h[s] = Math.atan2(py[b] - py[a], px[b] - px[a]);
    const n = (s + 1) % L;
    ds[s] = Math.hypot(px[n] - px[s], py[n] - py[s]);
  }
  const W = 12;
  for (let s = 0; s < L; s++) {
    // curvatura = giro do rumo / distância percorrida na janela (o traçado tem metros mais curtos/longos)
    let len = 0;
    for (let k = -W; k < W; k++) len += ds[(s + k + L) % L];
    const k = ang(h[(s + W) % L] - h[(s - W + L) % L]) / Math.max(1, len);
    v[s] = Math.min(VMAX, Math.sqrt(LAT / Math.max(Math.abs(k), 1e-6)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let s = L - 1; s >= 0; s--) {
      const nx = v[(s + 1) % L];
      v[s] = Math.min(v[s], Math.sqrt(nx * nx + 2 * BRAKE * ds[s]));
    }
    for (let s = 0; s < L; s++) {
      const pv = v[(s - 1 + L) % L];
      const acc = Math.max(2, 14 * (1 - pv / (VMAX + 6)));
      v[s] = Math.min(v[s], Math.sqrt(pv * pv + 2 * acc * ds[(s - 1 + L) % L]));
    }
  }
  let t = 0;
  for (let s = 0; s < L; s++) t += ds[s] / v[s];
  return t;
}

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
}

const out: Record<string, { o: number[]; gain: number; lap: number }> = {};
const list = ONLY !== null ? [ONLY] : ACTIVE_TRACKS;
const t0 = Date.now();
for (const i of list) {
  const g = geometry(i), L = g.L, N = Math.floor(L / STEP);
  const o = new Float64Array(N), cand = new Float64Array(N), off = new Float64Array(L);
  const buf = { px: new Float64Array(L), py: new Float64Array(L), h: new Float64Array(L), ds: new Float64Array(L), v: new Float64Array(L) };
  dense(o, L, off);
  const center = lapTime(g, off, buf);
  let cur = center, best = center;
  const bestO = new Float64Array(o);
  for (let it = 0; it < ITERS; it++) {
    const T = 0.03 * Math.pow(0.0005 / 0.03, it / ITERS); // temperatura (s): começa ousado, termina fino
    cand.set(o);
    const j = Math.floor(Math.random() * N), w = 1 + Math.floor(Math.random() * 10), a = gauss() * (0.4 + 2.2 * (1 - it / ITERS));
    for (let k = -w; k <= w; k++) {
      const idx = (j + k + N) % N;
      cand[idx] = Math.max(-EDGE, Math.min(EDGE, cand[idx] + a * 0.5 * (1 + Math.cos((Math.PI * k) / (w + 1)))));
    }
    dense(cand, L, off);
    const t = lapTime(g, off, buf);
    if (t < cur || Math.random() < Math.exp((cur - t) / T)) {
      o.set(cand);
      cur = t;
      if (t < best) {
        best = t;
        bestO.set(o);
      }
    }
  }
  const name = CIRCUITS[i].name;
  out[name] = { o: [...bestO].map((x) => Math.round(x * 10) / 10), gain: Math.round((center - best) * 1000) / 1000, lap: Math.round(best * 1000) / 1000 };
  console.log(`${name.padEnd(20)} meio ${center.toFixed(2)}s -> traçado ${best.toFixed(2)}s (ganho ${(center - best).toFixed(2)}s) [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}
if (ONLY === null) {
  writeFileSync(
    "src/sim/racingLines.ts",
    `// GERADO por scripts/racing-line.ts — traçado ideal de cada pista achado pelo carro de teste da IA.
// o = distância até o meio da pista (m, + = direita) a cada ${STEP} m a partir da largada; gain = segundos ganhos sobre o meio.
export const LINE_STEP = ${STEP};
export const RACING_LINES: Record<string, { o: number[]; gain: number; lap: number }> = ${JSON.stringify(out)};
`,
  );
  console.log("gravado src/sim/racingLines.ts");
}
