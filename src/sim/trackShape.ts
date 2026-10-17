// Monta o traçado de uma pista com retas e curvas de raio fixo (fica igual ao
// desenhado). Sem dependências: usado pelas definições das pistas.

/** reta (comprimento; true = ajustável pra fechar), curva à direita/esquerda (graus, raio), marca */
export type Seg = ["S", number, boolean?] | ["R" | "L", number, number] | ["M", string];

export interface Shape {
  points: [number, number][];
  targetLength: number;
  marks?: Record<string, number>;
  /** quanto a pista teve que ser entortada pra fechar (m), e o giro da curva automática (graus) */
  closeError?: number;
  autoTurn?: number;
}

/**
 * Texto compacto -> pedaços. Ex.: "S500 R90/40 L60/120 R0/45 M:t0"
 * S = reta (com * = ajustável), R/L = direita/esquerda graus/raio, R0 = curva que completa o giro.
 */
export function parseShape(src: string): Seg[] {
  return src
    .trim()
    .split(/\s+/)
    .map((tok): Seg => {
      if (tok.startsWith("M:")) return ["M", tok.slice(2)];
      if (tok[0] === "S") return ["S", Number(tok.slice(1).replace("*", "")), tok.endsWith("*")];
      const [deg, r] = tok.slice(1).split("/").map(Number);
      return [tok[0] as "R" | "L", deg, r];
    });
}

/**
 * A curva com 0° completa o giro (volta inteira; "oito" = giro zero). Pra fechar
 * no ponto de partida: com duas retas marcadas, elas esticam/encolhem; sem isso,
 * o erro é espalhado ao longo da volta (entorta um pouquinho o desenho todo).
 */
export function turtle(input: Seg[] | string, opts: { figure8?: boolean } = {}): Shape {
  const segs = (typeof input === "string" ? parseShape(input) : input).map((g) => [...g] as Seg);
  const rad = Math.PI / 180;
  const signed = (g: Seg) => (g[0] === "R" ? (g[1] as number) : g[0] === "L" ? -(g[1] as number) : 0);
  const autoIdx = segs.findIndex((g) => (g[0] === "R" || g[0] === "L") && g[1] === 0);
  const net = segs.reduce((a, g) => a + signed(g), 0);
  const target = opts.figure8 ? 0 : net >= 0 ? 360 : -360;
  let autoTurn = 0;
  if (autoIdx >= 0) {
    const need = target - net;
    const r = segs[autoIdx][2] as number;
    segs[autoIdx] = [need >= 0 ? "R" : "L", Math.abs(need), r];
    autoTurn = need;
  }
  const run = (adj: number[]) => {
    let x = 0, y = 0, h = 0, k = 0, len = 0;
    const pts: [number, number][] = [];
    const at: number[] = [];
    const marks: Record<string, number> = {};
    const step = 4;
    for (const g of segs) {
      if (g[0] === "M") {
        marks[g[1]] = len;
      } else if (g[0] === "S") {
        const l = Math.max(1, g[1] + (g[2] ? (adj[k++] ?? 0) : 0));
        for (let d = 0; d < l; d += step) {
          pts.push([x + Math.cos(h) * d, y + Math.sin(h) * d]);
          at.push(len + d);
        }
        x += Math.cos(h) * l;
        y += Math.sin(h) * l;
        len += l;
      } else {
        const a = g[1] * rad * (g[0] === "R" ? 1 : -1);
        const r = g[2];
        const arc = Math.abs(a) * r;
        const n = Math.max(2, Math.ceil(arc / step));
        // centro da curva fica do lado pra onde vira
        const side = g[0] === "R" ? 1 : -1;
        const cx = x - Math.sin(h) * r * side, cy = y + Math.cos(h) * r * side;
        for (let i = 0; i < n; i++) {
          const hh = h + (a * i) / n;
          pts.push([cx + Math.sin(hh) * r * side, cy - Math.cos(hh) * r * side]);
          at.push(len + (arc * i) / n);
        }
        h += a;
        x = cx + Math.sin(h) * r * side;
        y = cy - Math.cos(h) * r * side;
        len += arc;
      }
    }
    return { pts, at, x, y, len, marks };
  };
  // direção das retas ajustáveis
  const dirs: [number, number][] = [];
  let h = 0;
  for (const g of segs) {
    if (g[0] === "S" && g[2]) dirs.push([Math.cos(h), Math.sin(h)]);
    h += signed(g) * rad;
  }
  if (dirs.length >= 2) {
    const r0 = run([0, 0]);
    const [u, v] = dirs;
    const det = u[0] * v[1] - u[1] * v[0];
    const a = (-r0.x * v[1] + r0.y * v[0]) / det;
    const b = (-u[0] * r0.y + u[1] * r0.x) / det;
    const out = run([a, b]);
    return { points: out.pts, targetLength: out.len, marks: out.marks, closeError: Math.hypot(a, b), autoTurn };
  }
  // sem retas marcadas: todas as retas esticam/encolhem (as longas mais), mínimo de quadrado
  const straights: { dir: [number, number]; len: number }[] = [];
  h = 0;
  for (const g of segs) {
    if (g[0] === "S") straights.push({ dir: [Math.cos(h), Math.sin(h)], len: g[1] });
    h += signed(g) * rad;
  }
  const adj = straights.map(() => 0);
  const fixed = straights.map(() => false);
  const mark = () => segs.forEach((g) => g[0] === "S" && (g[2] = true));
  mark();
  for (let iter = 0; iter < 8; iter++) {
    const r = run(adj);
    const ex = r.x, ey = r.y;
    if (Math.hypot(ex, ey) < 0.5) break;
    // M = sum w u u^T (só retas livres), w = len²
    let m00 = 0, m01 = 0, m11 = 0;
    straights.forEach((st, i) => {
      if (fixed[i]) return;
      const w = st.len * st.len;
      m00 += w * st.dir[0] * st.dir[0];
      m01 += w * st.dir[0] * st.dir[1];
      m11 += w * st.dir[1] * st.dir[1];
    });
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-6) break;
    const lx = (-ex * m11 + ey * m01) / det, ly = (ex * m01 - ey * m00) / det;
    let clamped = false;
    straights.forEach((st, i) => {
      if (fixed[i]) return;
      adj[i] += st.len * st.len * (st.dir[0] * lx + st.dir[1] * ly);
      const min = Math.max(25, st.len * 0.35);
      if (st.len + adj[i] < min) {
        adj[i] = min - st.len;
        fixed[i] = true;
        clamped = true;
      }
    });
    if (!clamped && iter > 0) break;
  }
  const out = run(adj);
  // o que ainda sobrar, espalha ao longo da volta
  const ex = out.x, ey = out.y;
  const points = out.pts.map(([x, y], i): [number, number] => [x - (ex * out.at[i]) / out.len, y - (ey * out.at[i]) / out.len]);
  const changed = adj.reduce((acc, d) => acc + Math.abs(d), 0);
  return { points, targetLength: out.len, marks: out.marks, closeError: changed + Math.hypot(ex, ey), autoTurn };
}
