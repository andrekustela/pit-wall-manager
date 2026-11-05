// Barreiras do autódromo (guard-rail, muro, concreto, pneus, alambrado) como pontos no chão, pra corrida
// bater nelas (Race.setWalls). Sem three.js: roda também no servidor do online, que lê o
// public/autodromos/<slug>.pecas.json (o mesmo que o autódromo 3D usa).

export const WALL_PATHS = new Set(["guardrail", "muro", "jersey", "pneus", "blocopneus", "alambrado"]);
export const WALL_PIECES = new Set(["pneu", "blocopneus", "barreira", "guardrail", "muro", "jersey"]);
/** prédios e casas (caixa sx × sz, centrada): o contorno também segura o carro (rua: "isso é um objeto, não deveria ser obstrução?") */
const BOX_PIECES = new Set(["edificio", "casa"]);

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

/**
 * medida de cada barreira como é desenhada (trackParts/paths3d): peça = meio comprimento (x local) e de onde até
 * onde vai de lado (z local); linha = meia espessura. Antes toda peça era o meio ± 2 m e a linha do meio: o muro de
 * pedra (10 m) e o guard-rail (8 m) tinham buraco nas pontas, a pilha de pneus (0,7 m) virava parede de 4 m, e o
 * carro batia no meio do bloco de pneus (entrava 0,5 m)
 */
const PIECE_SIZE: Record<string, [number, number, number]> = {
  muro: [5, 0, 0.8],
  guardrail: [4, -0.04, 0.2],
  barreira: [3, -0.45, 0.45],
  blocopneus: [1, -0.55, 0.55],
  jersey: [2, -0.3, 0.3],
  pneu: [0.34, -0.34, 0.34],
};
const PATH_HALF: Record<string, number> = { pneus: 0.34, blocopneus: 0.55, jersey: 0.3, guardrail: 0.2 };

/** linhas (a cada 1 m, nas duas faces) e peças (a cada 1 m do comprimento, nas duas faces) que são barreira */
export function wallPoints(
  paths: { t: string; p: Pt[]; reto?: boolean }[],
  pieces: { k: string; x: number; z: number; r: number; s?: number; sx?: number; sz?: number }[],
): Pt[] {
  const wp: Pt[] = [];
  for (const it of paths) {
    if (!WALL_PATHS.has(it.t) || !Array.isArray(it.p)) continue;
    const ln = sampleLine(it.p, !!it.reto, 1), h = PATH_HALF[it.t] ?? 0;
    if (!h) {
      wp.push(...ln);
      continue;
    }
    // (a face de cada lado: a corrida fica com a mais perto da pista)
    for (let i = 0; i < ln.length; i++) {
      const a = ln[Math.max(0, i - 1)], b = ln[Math.min(ln.length - 1, i + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
      wp.push([ln[i][0] + nx * h, ln[i][1] + ny * h], [ln[i][0] - nx * h, ln[i][1] - ny * h]);
    }
  }
  for (const p of pieces) {
    if (BOX_PIECES.has(p.k) && p.sx && p.sz) {
      const sc = p.s ?? 1, hx = (p.sx * sc) / 2, hz = (p.sz * sc) / 2;
      const ax = Math.cos(p.r), az = -Math.sin(p.r), bx = Math.sin(p.r), bz = Math.cos(p.r);
      const at = (u: number, w: number): Pt => [p.x + ax * u + bx * w, p.z + az * u + bz * w];
      for (let i = 0, n = Math.ceil(2 * hx); i <= n; i++) wp.push(at(-hx + (2 * hx * i) / n, -hz), at(-hx + (2 * hx * i) / n, hz));
      for (let i = 1, n = Math.ceil(2 * hz); i < n; i++) wp.push(at(-hx, -hz + (2 * hz * i) / n), at(hx, -hz + (2 * hz * i) / n));
      continue;
    }
    if (!WALL_PIECES.has(p.k)) continue;
    const [hl0, z0, z1] = PIECE_SIZE[p.k] ?? [2, 0, 0], sc = p.s ?? 1, hl = hl0 * sc;
    // (rotation.y = r: o x local vai pra (cos r, −sen r) e o z local pra (sen r, cos r))
    const ax = Math.cos(p.r), az = -Math.sin(p.r), bx = Math.sin(p.r), bz = Math.cos(p.r);
    const n = Math.max(1, Math.ceil((2 * hl) / 1));
    for (let i = 0; i <= n; i++) {
      const u = -hl + (2 * hl * i) / n;
      for (const zf of z0 === z1 ? [z0] : [z0 * sc, z1 * sc]) wp.push([p.x + ax * u + bx * zf, p.z + az * u + bz * zf]);
    }
  }
  return wp;
}

/** barreiras de um arquivo .pecas.json (formato do editor: "pecas" em linhas [k, x, z, r, s, ...] e "linhas") */
export function wallPointsFromJson(text: string): Pt[] {
  const d = JSON.parse(text) as { pecas?: unknown[][]; linhas?: { t: string; p: Pt[]; reto?: boolean }[] };
  const pieces = (Array.isArray(d.pecas) ? d.pecas : []).map(([k, x, z, r, s]) => ({ k: String(k), x: Number(x), z: Number(z), r: Number(r), s: s == null ? undefined : Number(s) }));
  return wallPoints(Array.isArray(d.linhas) ? d.linhas.filter((it) => it && Array.isArray(it.p)) : [], pieces);
}
