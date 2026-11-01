// Medidas de uma pista pelo perfil de velocidade da volta ideal (scripts/track-stats.ts, scripts/gen-pistas.ts)
// e os "complexos" de curvas dela (pra montar pistas novas com pedaços que parecem de pista de verdade).
import type { Track } from "../src/sim/track";

export type Stats = { name: string; km: number; lap: number; corners: number; hair: number; slow: number; med: number; fast: number; brakes: number; longest: number; full: number; flips: number; complex: number; variety: number; perKm: number };

export function trackStats(t: Track): Stats {
  const v = t.vProfile, n = v.length, VMAX = 90;
  // curvas = mínimos do perfil com queda de pelo menos 6 m/s dos dois lados (até o próximo máximo)
  const mins: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = v[(i - 1 + n) % n], b = v[(i + 1) % n];
    if (v[i] <= a && v[i] < b) {
      let l = v[i], r = v[i];
      for (let k = 1; k < 600; k++) l = Math.max(l, v[(i - k + n) % n]);
      for (let k = 1; k < 600; k++) r = Math.max(r, v[(i + k) % n]);
      if (Math.min(l, r) - v[i] > 6 && v[i] < VMAX - 3) mins.push(i);
    }
  }
  const sp = mins.map((i) => v[i]);
  const hair = sp.filter((x) => x < 25).length, slow = sp.filter((x) => x >= 25 && x < 42).length, med = sp.filter((x) => x >= 42 && x < 62).length, fast = sp.filter((x) => x >= 62).length;
  // freada forte: o mínimo vem de uma velocidade 35 m/s maior nos 400 m antes
  let brakes = 0;
  for (const i of mins) {
    let top = 0;
    for (let k = 1; k < 400; k++) top = Math.max(top, v[(i - k + n) % n]);
    if (top - v[i] > 35) brakes++;
  }
  // retas: trechos a mais de 80 m/s
  let longest = 0, run = 0, full = 0;
  for (let k = 0; k < 2 * n; k++) {
    const x = v[k % n];
    if (x > 80) run++;
    else {
      longest = Math.max(longest, Math.min(run, n));
      run = 0;
    }
    if (k < n && x > VMAX - 1) full++;
  }
  // troca de direção entre curvas seguidas; complexo = curva que começa a menos de 150 m da anterior
  let flips = 0, complex = 0;
  for (let j = 0; j < mins.length; j++) {
    const a = mins[j], b = mins[(j + 1) % mins.length];
    if (Math.sign(t.curvature[a]) !== Math.sign(t.curvature[b])) flips++;
    if ((b - a + n) % n < 150) complex++;
  }
  const mean = sp.reduce((s, x) => s + x, 0) / Math.max(1, sp.length);
  const variety = Math.sqrt(sp.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, sp.length));
  return { name: t.name, km: n / 1000, lap: t.idealLap, corners: mins.length, hair, slow, med, fast, brakes, longest, full: full / n, flips, complex, variety, perKm: mins.length / (n / 1000) };
}

/** uma curva: giro em graus (com sinal: + = direita) e raio médio (m) */
export type Bend = { deg: number; r: number };
/** complexo: curvas com as retinhas entre elas (gaps[i] = reta depois da curva i) */
export type Complex = { bends: Bend[]; gaps: number[]; minR: number };

/**
 * corta a pista em curvas (trechos com raio < 600 m, giro ≥ 8°) e junta em complexos as que ficam a menos de
 * 120 m uma da outra. Serve de vocabulário: são pedaços de pista de verdade, que depois são misturados,
 * espelhados e deformados (nenhuma pista nova copia uma real)
 */
export function complexesOf(t: Track): Complex[] {
  const c = t.curvature, n = c.length, K = 1 / 600;
  // começa numa reta (pra não cortar uma curva no meio)
  let s0 = 0;
  for (let i = 0; i < n; i++) if (Math.abs(c[i]) < K / 2) {
    s0 = i;
    break;
  }
  const bends: { a: number; b: number; deg: number }[] = [];
  let i = 0;
  while (i < n) {
    const k = c[(s0 + i) % n];
    if (Math.abs(k) < K) {
      i++;
      continue;
    }
    // trecho no mesmo sentido acima do limite (com tolerância de 6 m pra ruído)
    const sg = Math.sign(k), a = i;
    let turn = 0, gap = 0;
    while (i < n) {
      const kk = c[(s0 + i) % n];
      if (Math.abs(kk) >= K && Math.sign(kk) === sg) gap = 0;
      else if (++gap > 6) break;
      turn += kk;
      i++;
    }
    const b = i - gap;
    const deg = (turn * 180) / Math.PI;
    if (Math.abs(deg) >= 8) bends.push({ a, b, deg });
  }
  const out: Complex[] = [];
  let cur: Complex | null = null;
  for (let j = 0; j < bends.length; j++) {
    const bd = bends[j], len = Math.max(4, bd.b - bd.a), r = Math.round(len / ((Math.abs(bd.deg) * Math.PI) / 180));
    const bend = { deg: Math.round(bd.deg), r: Math.max(12, r) };
    const prevGap = j > 0 ? bd.a - bends[j - 1].b : Infinity;
    if (cur && prevGap < 120) {
      cur.gaps.push(Math.max(5, prevGap));
      cur.bends.push(bend);
      cur.minR = Math.min(cur.minR, bend.r);
    } else {
      if (cur) out.push(cur);
      cur = { bends: [bend], gaps: [], minR: bend.r };
    }
  }
  if (cur) out.push(cur);
  return out;
}
