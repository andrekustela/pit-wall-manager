// Barreiras do autódromo (guard-rail, muro, concreto, pneus, alambrado) como pontos no chão, pra corrida
// bater nelas (Race.setWalls). Sem three.js: roda também no servidor do online, que lê o
// public/autodromos/<slug>.pecas.json (o mesmo que o autódromo 3D usa).

export const WALL_PATHS = new Set(["guardrail", "muro", "jersey", "pneus", "blocopneus", "alambrado"]);
export const WALL_PIECES = new Set(["pneu", "blocopneus", "barreira", "guardrail", "muro", "jersey"]);

export const slugOf = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

type Pt = [number, number];

/** pontos a cada ~step m ao longo da linha (curva suave centrípeta entre os pontos, ou reta) */
function sampleLine(p: Pt[], reto: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  if (p.length < 2) return p.slice();
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    if (reto || p.length < 3) {
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      continue;
    }
    // Catmull-Rom centrípeta (pontas: repete o ponto de fora)
    const p0 = p[i - 2] ?? [2 * a[0] - b[0], 2 * a[1] - b[1]], p3 = p[i + 1] ?? [2 * b[0] - a[0], 2 * b[1] - a[1]];
    const dt = (u: Pt, v: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(v[0] - u[0], v[1] - u[1])));
    const t1 = dt(p0, a), t2 = t1 + dt(a, b), t3 = t2 + dt(b, p3);
    const lerp = (u: Pt, v: Pt, tu: number, tv: number, t: number): Pt => {
      const w = (t - tu) / (tv - tu);
      return [u[0] + (v[0] - u[0]) * w, u[1] + (v[1] - u[1]) * w];
    };
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const A1 = lerp(p0, a, 0, t1, t), A2 = lerp(a, b, t1, t2, t), A3 = lerp(b, p3, t2, t3, t);
      const B1 = lerp(A1, A2, 0, t2, t), B2 = lerp(A2, A3, t1, t3, t);
      out.push(lerp(B1, B2, t1, t2, t));
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

/** linhas (a cada 1 m) e peças (o meio e as pontas, ~4 m) que são barreira */
export function wallPoints(
  paths: { t: string; p: Pt[]; reto?: boolean }[],
  pieces: { k: string; x: number; z: number; r: number; s?: number }[],
): Pt[] {
  const wp: Pt[] = [];
  for (const it of paths) if (WALL_PATHS.has(it.t) && Array.isArray(it.p)) wp.push(...sampleLine(it.p, !!it.reto, 1));
  for (const p of pieces)
    if (WALL_PIECES.has(p.k)) {
      const h = 2 * (p.s ?? 1), cx = Math.cos(p.r) * h, cz = -Math.sin(p.r) * h;
      wp.push([p.x, p.z], [p.x + cx, p.z + cz], [p.x - cx, p.z - cz]);
    }
  return wp;
}

/** barreiras de um arquivo .pecas.json (formato do editor: "pecas" em linhas [k, x, z, r, s, ...] e "linhas") */
export function wallPointsFromJson(text: string): Pt[] {
  const d = JSON.parse(text) as { pecas?: unknown[][]; linhas?: { t: string; p: Pt[]; reto?: boolean }[] };
  const pieces = (Array.isArray(d.pecas) ? d.pecas : []).map(([k, x, z, r, s]) => ({ k: String(k), x: Number(x), z: Number(z), r: Number(r), s: s == null ? undefined : Number(s) }));
  return wallPoints(Array.isArray(d.linhas) ? d.linhas.filter((it) => it && Array.isArray(it.p)) : [], pieces);
}
