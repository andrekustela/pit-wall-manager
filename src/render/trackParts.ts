// Peças 3D dos autódromos (estilo cartoon low-poly), feitas por código e repetidas com InstancedMesh.
// Usadas pelo autódromo 3D (track3d.ts) em qualquer pista; o editor de autódromo vai usar as mesmas.
// Medidas em metros; cada peça tem a origem no chão.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const rng = (seed: number) => {
  let r = seed >>> 0 || 1;
  return () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296;
};
export const angDiff = (a: number, b: number) => ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** grade de pontos com raio: distância até o mais perto (já descontando o raio dele), até R */
export class Grid {
  private m = new Map<number, number[]>();
  private maxR = 0;
  constructor(private cell = 20) {}
  private key(i: number, j: number) {
    return (i + 30000) * 60000 + (j + 30000);
  }
  add(x: number, z: number, r = 0) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let a = this.m.get(k);
    if (!a) this.m.set(k, (a = []));
    a.push(x, z, r);
    if (r > this.maxR) this.maxR = r;
  }
  near(x: number, z: number, R: number) {
    const n = Math.ceil((R + this.maxR) / this.cell), ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    let best = R;
    for (let i = ci - n; i <= ci + n; i++)
      for (let j = cj - n; j <= cj + n; j++) {
        const a = this.m.get(this.key(i, j));
        if (!a) continue;
        for (let q = 0; q < a.length; q += 3) {
          const d = Math.hypot(a[q] - x, a[q + 1] - z) - a[q + 2];
          if (d < best) best = d;
        }
      }
    return best;
  }
}

export const inPoly = (x: number, z: number, p: [number, number][]) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

/** retângulo mínimo em volta de um contorno (casa): centro, ângulo do lado comprido, comprimento e largura */
export function obb(p: [number, number][]) {
  let best = { a: 0, cx: 0, cz: 0, l: 0, w: 0, area: Infinity };
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
    const a = Math.atan2(bz - az, bx - ax), c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of p) {
      const u = x * c + z * s, v = -x * s + z * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      best = { a, cx: uc * c - vc * s, cz: uc * s + vc * c, l: u1 - u0, w: v1 - v0, area };
    }
  }
  if (best.w > best.l) best = { ...best, a: best.a + Math.PI / 2, l: best.w, w: best.l };
  return best;
}

/** monta malhas de triângulos soltos (com cor por vértice, opcional) */
export class GB {
  pos: number[] = [];
  col: number[] = [];
  constructor(private colors = true) {}
  tri(a: number[], b: number[], c: number[], color?: THREE.Color) {
    this.pos.push(...a, ...b, ...c);
    if (this.colors && color) for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }
  quad(a: number[], b: number[], c: number[], d: number[], color?: THREE.Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
  /** caixa (sem o fundo, que ninguém vê) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color?: THREE.Color) {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], color);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.colors) g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}
export const C = (hex: string) => new THREE.Color(hex);

/** copa de árvore: esfera facetada com o contorno irregular */
export function blob(detail: number) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 0.8 + (h - Math.floor(h)) * 0.36;
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** casa: paredes (caixa) e telhado de duas águas (cumeeira no eixo x), em 1×1×1 */
export function houseGeos() {
  const w = new GB(false);
  w.box(-0.5, 0, -0.5, 0.5, 1, 0.5);
  const r = new GB(false);
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], Cc = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], R1 = [-0.5, 1, 0], R2 = [0.5, 1, 0];
  r.quad(A, R1, R2, B);
  r.quad(D, Cc, R2, R1);
  r.tri(A, D, R1);
  r.tri(B, R2, Cc);
  return { walls: w.geo(), roof: r.geo() };
}

/** alambrado: losangos (transparente entre os fios) */
export function fenceTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#cfd4d9";
  g.lineWidth = 3;
  for (let i = -64; i <= 64; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.moveTo(i + 64, 0);
    g.lineTo(i, 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** grama de desenho: verde com manchas mais claras e mais escuras */
export function grassTex(base: string, dark: string, light: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const rnd = rng(11);
  // manchas grandes de borda facetada (cara de pintado à mão), escuras e claras por cima umas das outras
  for (let i = 0; i < 110; i++) {
    g.fillStyle = rnd() < 0.55 ? dark : light;
    g.globalAlpha = 0.45 + rnd() * 0.35;
    const x = rnd() * 256, y = rnd() * 256, r = 14 + rnd() * 40, n = 6 + Math.floor(rnd() * 4), rot = rnd() * 6.3;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const a = rot + (k / n) * Math.PI * 2, rr = r * (0.55 + rnd() * 0.6);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.75]);
    }
    // (repete nas bordas pra emendar sem costura)
    for (const dx of [-256, 0, 256])
      for (const dy of [-256, 0, 256]) {
        g.beginPath();
        pts.forEach(([px, py], k) => (k ? g.lineTo(x + dx + px, y + dy + py) : g.moveTo(x + dx + px, y + dy + py)));
        g.closePath();
        g.fill();
      }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** parede em pé ao longo de uma linha, de y0 a y1, com UV em metros/escala */
export function vwall(pts: [number, number][], y0: number, y1: number, uvm = 2.5) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let d = 0;
  pts.forEach(([x, z], i) => {
    if (i) d += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    pos.push(x, y0, z, x, y1, z);
    uv.push(d / uvm, 0, d / uvm, (y1 - y0) / uvm);
    if (i) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** módulo de arquibancada (14 m de frente, 12 de fundo): degraus, cadeiras em L em blocos verdes e amarelos, escada no meio, cobertura curva */
export function standModule(green = "#18b04f", yellow = "#f6d21a", covered = true) {
  const b = new GB();
  const concrete = C("#c4c8cc"), nose = C("#a9aeb3"), back = C("#8c9298"), steel = C("#9aa3ab"), g = C(green), y = C(yellow);
  const roof = C("#5bdc9f"), under = C("#3c9f73");
  const n = 8, D = 1.4, R = 0.9;
  for (let i = 0; i < n; i++) {
    const z0 = i * D, top = 1.2 + i * R;
    b.box(-7, 0, z0, 7, top, z0 + D, concrete);
    b.box(-7, top - 0.08, z0 - 0.04, 7, top, z0 + 0.1, nose);
    // escada no meio: degraus menores
    b.box(-0.45, top, z0, 0.45, top + R / 2, z0 + D / 2, nose);
    for (let x = -6.6; x <= 6.6; x += 0.62) {
      if (Math.abs(x) < 0.6) continue;
      const blk = Math.floor((x + 7) / 2.5);
      const c = (blk + i) % 2 ? y : g;
      const x0 = x - 0.24, x1 = x + 0.24, zs = z0 + 0.45, ze = z0 + 0.95, ys = top + 0.4;
      // assento (em cima e a frente)
      b.quad([x0, ys, zs], [x0, ys, ze], [x1, ys, ze], [x1, ys, zs], c);
      b.quad([x0, top + 0.12, zs], [x0, ys, zs], [x1, ys, zs], [x1, top + 0.12, zs], c);
      // encosto um pouco inclinado (frente, topo, costas)
      const zb = ze, yt = ys + 0.5;
      b.quad([x0, ys, zb], [x0, yt, zb + 0.1], [x1, yt, zb + 0.1], [x1, ys, zb], c);
      b.quad([x0, yt, zb + 0.1], [x0, yt, zb + 0.18], [x1, yt, zb + 0.18], [x1, yt, zb + 0.1], c);
      b.quad([x0, top, zb + 0.08], [x1, top, zb + 0.08], [x1, yt, zb + 0.18], [x0, yt, zb + 0.18], c);
    }
  }
  const topY = 1.2 + (n - 1) * R;
  b.box(-7, 0, n * D, 7, topY + 2.2, n * D + 0.3, back);
  // corrimão na frente
  b.box(-7, 1.2, -0.25, 7, 1.28, -0.17, steel);
  for (const x of [-6.8, -3.4, 3.4, 6.8]) b.box(x - 0.04, 0.0, -0.25, x + 0.04, 1.28, -0.17, steel);
  if (!covered) return b.geo();
  // pilares atrás e arcos da cobertura
  const arc: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    arc.push([12.2 - 13.4 * t, 11.0 + 1.8 * (1 - t) + 1.1 * Math.sin(Math.PI * t)]);
  }
  for (const x of [-6.8, 0, 6.8]) {
    b.box(x - 0.2, 0, n * D + 0.3, x + 0.2, 12.6, n * D + 0.7, steel);
    for (let i = 0; i < 8; i++) {
      const [zi, yi] = arc[i], [zj, yj] = arc[i + 1];
      b.quad([x - 0.1, yi - 0.55, zi], [x + 0.1, yi - 0.55, zi], [x + 0.1, yj - 0.55, zj], [x - 0.1, yj - 0.55, zj], steel);
      b.quad([x - 0.1, yi - 0.2, zi], [x - 0.1, yi - 0.55, zi], [x - 0.1, yj - 0.55, zj], [x - 0.1, yj - 0.2, zj], steel);
    }
  }
  for (let i = 0; i < 8; i++) {
    const [zi, yi] = arc[i], [zj, yj] = arc[i + 1];
    b.quad([-7.05, yi, zi], [7.05, yi, zi], [7.05, yj, zj], [-7.05, yj, zj], roof);
    b.quad([-7.05, yi - 0.2, zi], [-7.05, yj - 0.2, zj], [7.05, yj - 0.2, zj], [7.05, yi - 0.2, zi], under);
  }
  return b.geo();
}

/** textura da frente dos boxes: porta amarela embaixo, janelas no andar de cima */
export function garageTex() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f4f2";
  g.fillRect(0, 0, 128, 256);
  // andar de cima: janela e faixa
  g.fillStyle = "#2c3e55";
  g.fillRect(22, 30, 84, 62);
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.fillRect(28, 34, 22, 54);
  g.fillStyle = "#d8d8d4";
  g.fillRect(0, 112, 128, 8);
  // porta
  g.fillStyle = "#f2c418";
  g.fillRect(12, 150, 104, 106);
  g.fillStyle = "rgba(0,0,0,0.13)";
  for (let y = 156; y < 256; y += 9) g.fillRect(12, y, 104, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** torre de controle (12 × 12, 20 m): base branca, faixa de vidro, laje em cima */
export function towerGeo() {
  const b = new GB();
  const w = C("#f4f4f2"), glass = C("#2c3e55"), slab = C("#d8d8d4");
  b.box(-6, 0, 0, 6, 13, 12, w);
  b.box(-6.6, 13, -0.6, 6.6, 13.4, 12.6, slab);
  b.box(-6.2, 13.4, -0.2, 6.2, 17, 12.2, glass);
  b.box(-6.8, 17, -0.8, 6.8, 17.6, 12.8, slab);
  b.box(-4, 17.6, 2, 4, 19.5, 10, w);
  return b.geo();
}

/** motorhome (8 × 2,5, origem no meio): carroceria clara (tinge pela cor da instância), janelas escuras */
export function motorhomeGeo() {
  const b = new GB();
  const w = C("#ffffff"), win = C("#2c3e55"), tyre = C("#222222");
  b.box(-4, 0.5, -1.25, 4, 3.4, 1.25, w);
  b.box(-3.6, 2.1, -1.27, 3.2, 2.9, 1.27, win);
  b.box(3.6, 1.6, -1.1, 4.02, 2.8, 1.1, win);
  for (const x of [-2.6, 2.6]) for (const z of [-1.0, 1.0]) b.box(x - 0.45, 0, z - 0.2, x + 0.45, 0.8, z + 0.2, tyre);
  return b.geo();
}

/** tenda branca (5 × 5): quatro postes e telhado em pirâmide */
export function tentGeo() {
  const b = new GB();
  const w = C("#fbfbfb"), p = C("#b8bec4");
  for (const x of [-2.4, 2.4]) for (const z of [-2.4, 2.4]) b.box(x - 0.06, 0, z - 0.06, x + 0.06, 2.4, z + 0.06, p);
  const A = [-2.6, 2.4, -2.6], B = [2.6, 2.4, -2.6], Cc = [2.6, 2.4, 2.6], D = [-2.6, 2.4, 2.6], T = [0, 3.6, 0];
  b.tri(A, T, B, w);
  b.tri(B, T, Cc, w);
  b.tri(Cc, T, D, w);
  b.tri(D, T, A, w);
  b.box(-2.6, 1.9, -2.6, 2.6, 2.4, -2.5, w);
  return b.geo();
}

/** pilha de pneus (barreira): cilindro baixo, a cor vem da instância */
export const tyreStackGeo = () => new THREE.CylinderGeometry(0.34, 0.34, 0.95, 8).translate(0, 0.475, 0);

/** pinheiro: dois cones facetados */
export function pineGeo() {
  const a = new THREE.ConeGeometry(1, 1.5, 7).translate(0, 0.75, 0);
  const b2 = new THREE.ConeGeometry(0.75, 1.2, 7).translate(0, 1.55, 0);
  const g = mergeGeometries([a.toNonIndexed(), b2.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}

/** placa de publicidade (6 × 2,6 m em dois postes; a frente olha pra -z) e as marcas inventadas */
export const BRANDS: [string, string, string][] = [
  ["PIT WALL", "#d62b2b", "#ffffff"],
  ["TURBO COLA", "#1f5fbf", "#ffd21a"],
  ["VELOX", "#121212", "#36e07a"],
  ["NITRO OIL", "#f2c418", "#1a1a1a"],
];
export function billboardTex(i: number) {
  const [txt, bg, fg] = BRANDS[i % BRANDS.length];
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 112;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 112);
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.lineWidth = 6;
  g.strokeRect(5, 5, 246, 102);
  g.fillStyle = fg;
  g.font = "bold 44px 'Arial Black', Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(txt, 128, 58, 230);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function billboardGeos() {
  const posts = new GB(false);
  for (const x of [-2.4, 2.4]) posts.box(x - 0.1, 0, -0.1, x + 0.1, 2.0, 0.1);
  posts.box(-3.05, 2.0, 0.02, 3.05, 4.7, 0.22);
  const face = new THREE.PlaneGeometry(6, 2.6).rotateY(Math.PI).translate(0, 3.35, 0);
  return { posts: posts.geo(), face };
}

/** asfalto: azul-marinho escuro com grão fino e uniforme (claro e escuro) */
export function asphaltTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#222a3c";
  g.fillRect(0, 0, 256, 256);
  const rnd = rng(5);
  for (let i = 0; i < 20000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.08 + rnd() * 0.1})` : `rgba(170,185,215,${0.05 + rnd() * 0.1})`;
    g.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** desgaste de borracha (atravessando a faixa em u, ao longo em v): borda que some, duas marcas de roda, riscos e falhas */
export function rubberTexture() {
  const W = 128, H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  const rnd = rng(17);
  // riscos ao longo: cada coluna com uma força própria que muda devagar
  const streak = Array.from({ length: W }, () => 0.6 + rnd() * 0.4);
  for (let x = 1; x < W - 1; x++) streak[x] = (streak[x - 1] + streak[x] + streak[x + 1]) / 3;
  // falhas (manchas mais claras) que se repetem sem emenda
  const holes: [number, number, number][] = Array.from({ length: 26 }, () => [rnd() * W, rnd() * H, 6 + rnd() * 16]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // perfil: base que some nas bordas + duas marcas de roda (bitola ~1,6 m numa faixa de ~4,5 m)
      const edge = Math.pow(Math.sin(Math.PI * u), 1.6);
      const wheel = Math.exp(-(((u - 0.32) / 0.08) ** 2)) + Math.exp(-(((u - 0.68) / 0.08) ** 2));
      let a = (0.6 * edge + 0.8 * wheel * edge) * streak[x];
      for (const [hx, hy, hr] of holes) {
        let dy = Math.abs(y - hy);
        dy = Math.min(dy, H - dy);
        const d = Math.hypot((x - hx) * 1.6, dy) / hr;
        if (d < 1) a *= 0.55 + 0.45 * d;
      }
      a *= 0.8 + rnd() * 0.4;
      const o = (y * W + x) * 4;
      img.data[o] = 14;
      img.data[o + 1] = 16;
      img.data[o + 2] = 22;
      img.data[o + 3] = Math.max(0, Math.min(255, a * 255));
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** carro parado (decoração; nariz pra +z, origem no meio, no chão): carroceria clara (tinge pela cor da instância), pneus pretos */
export function carGeo() {
  const b = new GB();
  const w = C("#ffffff"), dark = C("#1d1f24"), tyre = C("#151515");
  b.box(-0.42, 0.12, -1.9, 0.42, 0.62, 1.6, w); // corpo
  b.box(-0.18, 0.12, 1.6, 0.18, 0.42, 2.35, w); // bico
  b.box(-0.85, 0.15, -0.9, 0.85, 0.55, 0.5, w); // laterais
  b.box(-0.28, 0.62, -0.5, 0.28, 0.95, 0.3, dark); // cockpit
  b.box(-0.95, 0.08, 2.2, 0.95, 0.2, 2.5, w); // asa dianteira
  b.box(-0.55, 0.55, -2.35, 0.55, 1.0, -2.1, w); // asa traseira
  b.box(-0.08, 0.3, -2.25, 0.08, 0.6, -2.0, dark);
  for (const [x, z, r] of [[-0.82, 1.45, 0.34], [0.82, 1.45, 0.34], [-0.85, -1.4, 0.38], [0.85, -1.4, 0.38]] as const)
    b.box(x - 0.2, 0, z - r, x + 0.2, r * 2, z + r, tyre);
  return b.geo();
}

// ---- mais peças (Editor > Autódromo 3D) ----
/** geometria pronta do Three com uma cor só por vértice (pra juntar com as feitas no GB) */
function paint(g: THREE.BufferGeometry, hex: string) {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute("uv");
  const c = new THREE.Color(hex), cols = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) cols.set([c.r, c.g, c.b], i);
  n.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return n;
}
const join = (gs: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(gs.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.computeVertexNormals();
  return g;
};

/** palmeira (~9 m): tronco curvado em gomos e folhas compridas caindo */
export function palmGeo() {
  const b = new GB();
  const trunk = C("#8b6a43"), ring = C("#735632"), leaf = C("#3f8f2e"), leaf2 = C("#5aa83a");
  let x = 0;
  for (let i = 0; i < 7; i++) {
    const w = 0.24 - i * 0.015, nx = x + 0.05 + i * 0.03;
    b.box(x - w, i * 1.2, -w, x + w, i * 1.2 + 1.15, w, i % 2 ? ring : trunk);
    x = nx;
  }
  const T = [x, 8.4, 0];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3, dx = Math.cos(a), dz = Math.sin(a), px = -dz * 0.55, pz = dx * 0.55;
    const M = [T[0] + dx * 1.8, T[1] + 0.35, T[2] + dz * 1.8], tip = [T[0] + dx * 3.6, T[1] - 1.3, T[2] + dz * 3.6];
    const c = k % 2 ? leaf : leaf2;
    b.tri(T, [M[0] + px, M[1], M[2] + pz], tip, c);
    b.tri(T, tip, [M[0] - px, M[1], M[2] - pz], c);
  }
  return b.geo();
}

/** caixa d'água (~22 m): coluna e reservatório azuis */
export function waterTowerGeo() {
  return join([
    paint(new THREE.CylinderGeometry(0.6, 0.85, 18, 8).translate(0, 9, 0), "#2f7fd0"),
    paint(new THREE.CylinderGeometry(4, 1, 3.2, 12).translate(0, 19.6, 0), "#3a8ee0"),
    paint(new THREE.ConeGeometry(4.1, 1.3, 12).translate(0, 21.85, 0), "#5aa6ec"),
  ]);
}

/** prédio alto (16 × 16, 40 m): faixas de janela por andar (a cor da instância tinge a fachada) */
export function tallBuildingGeo() {
  const b = new GB();
  const wall = C("#ffffff"), glass = C("#2c3e55"), top = C("#d8d8d4");
  b.box(-8, 0, -8, 8, 40, 8, wall);
  for (let y = 3; y < 39; y += 3) {
    b.box(-8.05, y, -6.5, 8.05, y + 1.4, 6.5, glass);
    b.box(-6.5, y, -8.05, 6.5, y + 1.4, 8.05, glass);
  }
  b.box(-8.4, 40, -8.4, 8.4, 40.6, 8.4, top);
  b.box(-3, 40.6, -3, 3, 42.6, 3, top);
  return b.geo();
}

/** passarela por cima da pista (vão de 30 m em x): escadas nas pontas, piso, grade e cobertura curva */
export function bridgeGeo() {
  const b = new GB();
  const w = C("#f4f4f2"), rail = C("#9aa3ab"), roof = C("#cfd8e2"), dark = C("#5d636a");
  for (const s of [-1, 1]) b.box(s * 15, 0, -1.8, s * 18.5, 7.2, 1.8, w);
  b.box(-15, 6.4, -1.6, 15, 7.0, 1.6, w);
  for (const z of [-1.6, 1.5]) {
    b.box(-15, 7.0, z, 15, 8.1, z + 0.1, rail);
    for (let x = -15; x <= 15; x += 3) b.box(x - 0.06, 7.0, z, x + 0.06, 9.6, z + 0.1, dark);
  }
  const arc: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    arc.push([-1.9 + 3.8 * t, 9.6 + 0.8 * Math.sin(Math.PI * t)]);
  }
  for (let i = 0; i < 6; i++) {
    const [za, ya] = arc[i], [zb, yb] = arc[i + 1];
    b.quad([-15.2, ya, za], [-15.2, yb, zb], [15.2, yb, zb], [15.2, ya, za], roof);
    b.quad([-15.2, ya - 0.1, za], [15.2, ya - 0.1, za], [15.2, yb - 0.1, zb], [-15.2, yb - 0.1, zb], roof);
  }
  return b.geo();
}

/** pórtico de largada (22 m de vão): dois pilares, viga e o painel das luzes virado pra -z */
export function gantryGeo() {
  const b = new GB();
  const w = C("#f4f4f2"), dark = C("#1d1f24"), red = C("#e32222");
  for (const s of [-1, 1]) b.box(s * 11 - 0.45, 0, -0.45, s * 11 + 0.45, 8.2, 0.45, w);
  b.box(-11.5, 7.0, -0.6, 11.5, 8.4, 0.6, w);
  b.box(-4, 5.6, -0.75, 4, 7.0, -0.45, dark);
  for (let i = 0; i < 5; i++) {
    const x = -3.2 + i * 1.6;
    b.box(x - 0.3, 5.95, -0.85, x + 0.3, 6.55, -0.74, red);
  }
  return b.geo();
}

/** muro de pedra (10 m, 2,5 m de altura): pedras em tons de cinza um pouco saltadas */
export function stoneWallGeo() {
  const b = new GB();
  const tones = ["#8a8f94", "#9aa0a5", "#7b8085", "#a7acb0"].map(C);
  b.box(-5, 0, 0, 5, 2.5, 0.8, tones[0]);
  let k = 0;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 8; c++) {
      const x = -5 + c * 1.25 + (r % 2 ? 0.62 : 0);
      if (x + 1.2 > 5) continue;
      b.box(x + 0.04, r * 0.62 + 0.04, -0.06, x + 1.2, r * 0.62 + 0.58, 0.02, tones[k++ % tones.length]);
    }
  return b.geo();
}

/** guard-rail (8 m): postes e duas lâminas */
export function guardrailGeo() {
  const b = new GB();
  const steel = C("#b9c0c7"), post = C("#7d848b");
  for (let x = -4; x <= 4; x += 2) b.box(x - 0.07, 0, 0.05, x + 0.07, 0.85, 0.2, post);
  b.box(-4, 0.42, -0.04, 4, 0.62, 0.05, steel);
  b.box(-4, 0.66, -0.04, 4, 0.8, 0.05, steel);
  return b.geo();
}

/** barreira de blocos vermelhos e brancos (6 m) */
export function barrierGeo() {
  const b = new GB();
  const red = C("#d62b2b"), white = C("#f2f2f2");
  for (let i = 0; i < 6; i++) b.box(-3 + i + 0.02, 0, -0.45, -2 + i - 0.02, 0.95, 0.45, i % 2 ? white : red);
  return b.geo();
}

/** poste de luz (10 m) com braço pra -z */
export function lampGeo() {
  const b = new GB();
  const pole = C("#7d848b"), lamp = C("#fff3c4");
  b.box(-0.12, 0, -0.12, 0.12, 10, 0.12, pole);
  b.box(-0.08, 9.6, -2.2, 0.08, 9.8, 0.1, pole);
  b.box(-0.3, 9.3, -2.6, 0.3, 9.6, -1.8, lamp);
  return b.geo();
}

/** cone laranja com faixa branca */
export function coneGeo() {
  return join([
    paint(new THREE.BoxGeometry(0.55, 0.06, 0.55).translate(0, 0.03, 0), "#e2640f"),
    paint(new THREE.CylinderGeometry(0.05, 0.22, 0.42, 8).translate(0, 0.27, 0), "#f07a1a"),
    paint(new THREE.CylinderGeometry(0.11, 0.15, 0.16, 8).translate(0, 0.36, 0), "#f4f4f4"),
  ]);
}

/** ônibus (12 × 2,6 m, nariz pra +x): carroceria clara (tinge pela instância), janelas e pneus */
export function busGeo() {
  const b = new GB();
  const w = C("#ffffff"), win = C("#2c3e55"), tyre = C("#1a1a1a");
  b.box(-6, 0.5, -1.3, 6, 3.4, 1.3, w);
  b.box(-5.6, 1.9, -1.32, 5.2, 2.9, 1.32, win);
  b.box(5.95, 1.3, -1.15, 6.02, 3.0, 1.15, win);
  for (const x of [-4, 3.8]) for (const z of [-1.05, 1.05]) b.box(x - 0.5, 0, z - 0.25, x + 0.5, 1.0, z + 0.25, tyre);
  return b.geo();
}

/** torcida pra pôr em cima de um módulo de arquibancada (mesmos degraus): bonequinhos coloridos */
export function crowdGeo() {
  const b = new GB();
  const shirts = ["#e32222", "#1f5fbf", "#f6d21a", "#18b04f", "#ffffff", "#f07a1a", "#8a2be2", "#111111"].map(C);
  const skin = [C("#f1c9a5"), C("#c68a5c"), C("#8d5a3b")];
  const rnd = rng(23);
  for (let i = 0; i < 8; i++) {
    const z0 = i * 1.4, top = 1.2 + i * 0.9;
    for (let x = -6.6; x <= 6.6; x += 0.62) {
      if (Math.abs(x) < 0.6 || rnd() < 0.25) continue;
      const zs = z0 + 0.6;
      b.box(x - 0.17, top + 0.4, zs, x + 0.17, top + 0.95, zs + 0.28, shirts[Math.floor(rnd() * shirts.length)]);
      b.box(x - 0.11, top + 0.95, zs + 0.03, x + 0.11, top + 1.2, zs + 0.25, skin[Math.floor(rnd() * skin.length)]);
    }
  }
  return b.geo();
}

/** telão (12 × 7 m em dois pilares; a tela olha pra -z) */
export function screenGeo() {
  const b = new GB();
  const steel = C("#5d636a"), frame = C("#1d1f24"), scr = C("#1f5fbf"), glow = C("#7fd0ff");
  for (const x of [-4.5, 4.5]) b.box(x - 0.35, 0, -0.35, x + 0.35, 8, 0.35, steel);
  b.box(-6.3, 7.6, -0.5, 6.3, 15, 0.4, frame);
  b.box(-6, 7.9, -0.55, 6, 14.7, -0.5, scr);
  b.box(-5, 12.6, -0.6, 2, 13.6, -0.55, glow);
  b.box(-5, 9.4, -0.6, 4.5, 10.2, -0.55, glow);
  return b.geo();
}

/** mastro com bandeira (12 m): a bandeira tinge pela cor da instância */
export function flagpoleGeo() {
  const b = new GB();
  const pole = C("#c9ced6"), flag = C("#ffffff");
  b.box(-0.08, 0, -0.08, 0.08, 12, 0.08, pole);
  b.box(0.08, 9.6, -0.03, 3.4, 11.8, 0.03, flag);
  return b.geo();
}

/** posto de fiscal de pista: cabine branca e laranja com cobertura */
export function marshalGeo() {
  const b = new GB();
  const w = C("#f4f4f2"), o = C("#f07a1a"), dark = C("#2c3e55");
  b.box(-1.2, 0, -1, 1.2, 1.1, 1, w);
  b.box(-1.2, 1.1, -1, 1.2, 1.3, 1, o);
  for (const x of [-1.1, 1.1]) for (const z of [-0.9, 0.9]) b.box(x - 0.05, 1.3, z - 0.05, x + 0.05, 2.6, z + 0.05, w);
  b.box(-1.5, 2.6, -1.3, 1.5, 2.8, 1.3, o);
  b.box(-1.21, 0.5, -0.6, -1.2, 1.0, 0.6, dark);
  return b.geo();
}

/** torre de câmera de TV (andaime com plataforma e câmera) */
export function tvTowerGeo() {
  const b = new GB();
  const st = C("#9aa3ab"), plat = C("#5d636a"), cam = C("#1d1f24");
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(x - 0.07, 0, z - 0.07, x + 0.07, 8, z + 0.07, st);
  for (let y = 1; y < 8; y += 2) {
    b.box(-1, y, -1.05, 1, y + 0.08, -0.95, st);
    b.box(-1, y, 0.95, 1, y + 0.08, 1.05, st);
  }
  b.box(-1.3, 8, -1.3, 1.3, 8.2, 1.3, plat);
  b.box(-0.3, 8.2, -0.5, 0.3, 8.8, 0.4, cam);
  b.box(-0.12, 8.4, -0.9, 0.12, 8.65, -0.5, cam);
  return b.geo();
}

/** contêiner (12 × 2,4 m): tinge pela instância */
export function containerGeo() {
  const b = new GB();
  const w = C("#ffffff"), rib = C("#dcdcdc");
  b.box(-6, 0, -1.2, 6, 2.6, 1.2, w);
  for (let x = -5.5; x <= 5.5; x += 1) b.box(x - 0.06, 0.1, -1.25, x + 0.06, 2.5, 1.25, rib);
  return b.geo();
}

/** caminhão de equipe (cavalo + baú, 16 m, nariz pra +x): baú tinge pela instância */
export function truckGeo() {
  const b = new GB();
  const w = C("#ffffff"), cab = C("#e6e8ea"), win = C("#2c3e55"), tyre = C("#1a1a1a");
  b.box(-8, 1.1, -1.25, 5, 4.1, 1.25, w);
  b.box(5.3, 0.6, -1.2, 8, 3.4, 1.2, cab);
  b.box(7.95, 2.2, -1.05, 8.02, 3.1, 1.05, win);
  for (const x of [-6.6, -5.4, 6.6]) for (const z of [-1.05, 1.05]) b.box(x - 0.5, 0, z - 0.25, x + 0.5, 1.0, z + 0.25, tyre);
  return b.geo();
}

/** pódio (1º no meio) */
export function podiumGeo() {
  const b = new GB();
  const w = C("#f4f4f2"), g = C("#f6d21a"), s = C("#c0c6cc"), br = C("#c9864a");
  b.box(-1.5, 0, -1.2, 1.5, 1.6, 1.2, w);
  b.box(-1.5, 1.55, -1.25, 1.5, 1.62, 1.25, g);
  b.box(-4.5, 0, -1.2, -1.5, 1.1, 1.2, w);
  b.box(-4.5, 1.05, -1.25, -1.5, 1.12, 1.25, s);
  b.box(1.5, 0, -1.2, 4.5, 0.8, 1.2, w);
  b.box(1.5, 0.75, -1.25, 4.5, 0.82, 1.25, br);
  return b.geo();
}

/** heliponto: círculo com H no chão */
export function helipadGeo() {
  const b = new GB();
  const base = C("#3a3e45"), line = C("#f6d21a"), white = C("#f4f4f2");
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = ((i + 1) / n) * Math.PI * 2;
    b.tri([0, 0.09, 0], [Math.cos(c) * 10, 0.09, Math.sin(c) * 10], [Math.cos(a) * 10, 0.09, Math.sin(a) * 10], base);
    b.quad([Math.cos(a) * 9, 0.1, Math.sin(a) * 9], [Math.cos(a) * 9.6, 0.1, Math.sin(a) * 9.6], [Math.cos(c) * 9.6, 0.1, Math.sin(c) * 9.6], [Math.cos(c) * 9, 0.1, Math.sin(c) * 9], line);
  }
  b.box(-3, 0.1, -4, -1.8, 0.11, 4, white);
  b.box(1.8, 0.1, -4, 3, 0.11, 4, white);
  b.box(-1.8, 0.1, -0.6, 1.8, 0.11, 0.6, white);
  return b.geo();
}

/** pilha de paletes/caixas */
export function cratesGeo() {
  const b = new GB();
  const wd = C("#b48a52"), wd2 = C("#9a7342");
  b.box(-1.2, 0, -1, 1.2, 0.15, 1, wd2);
  b.box(-1.1, 0.15, -0.9, 0, 1.1, 0.9, wd);
  b.box(0.05, 0.15, -0.9, 1.1, 0.9, 0.9, wd);
  b.box(-0.9, 1.1, -0.7, 0.2, 1.9, 0.7, wd2);
  return b.geo();
}

/** placa de distância da freada (100/200/300 m), olhando pra -z */
export function brakeBoardTex(n: number) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 96);
  g.strokeStyle = "#111";
  g.lineWidth = 5;
  g.strokeRect(3, 3, 58, 90);
  g.fillStyle = "#111";
  g.font = "bold 34px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), 32, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function brakeBoardGeos() {
  const post = new GB(false);
  post.box(-0.06, 0, -0.06, 0.06, 1.2, 0.06);
  const face = new THREE.PlaneGeometry(1, 1.5).rotateY(Math.PI).translate(0, 1.9, -0.08);
  return { post: post.geo(), face };
}

/** semáforo da saída do box: poste e luzes vermelha/verde */
export function pitLightGeo() {
  const b = new GB();
  const p = C("#2a2d33"), r = C("#e32222"), gr = C("#22c55e");
  b.box(-0.1, 0, -0.1, 0.1, 3, 0.1, p);
  b.box(-0.35, 3, -0.3, 0.35, 4.4, 0.3, p);
  b.box(-0.2, 3.8, -0.32, 0.2, 4.2, -0.3, r);
  b.box(-0.2, 3.2, -0.32, 0.2, 3.6, -0.3, gr);
  return b.geo();
}

/** arco inflável de publicidade (vão de 12 m): tinge pela instância */
export function inflatableArchGeo() {
  const b = new GB();
  const w = C("#ffffff");
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI, a1 = ((i + 1) / n) * Math.PI;
    const x0 = -Math.cos(a0) * 6, y0 = Math.sin(a0) * 6, x1 = -Math.cos(a1) * 6, y1 = Math.sin(a1) * 6;
    b.box(Math.min(x0, x1) - 0.5, Math.min(y0, y1), -0.6, Math.max(x0, x1) + 0.5, Math.max(y0, y1) + 0.9, 0.6, w);
  }
  return b.geo();
}

/** cerca viva (6 m) */
export function hedgeGeo() {
  const b = new GB();
  const g1 = C("#2f6a22"), g2 = C("#3d7a26");
  for (let i = 0; i < 6; i++) b.box(-3 + i, 0, -0.5, -2 + i, 1.3 + (i % 2) * 0.15, 0.5, i % 2 ? g1 : g2);
  return b.geo();
}

/** pedra grande facetada */
export function rockGeo() {
  const g = new THREE.DodecahedronGeometry(1.4, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 43758.5;
    const k = 0.75 + (h - Math.floor(h)) * 0.45;
    p.setXYZ(i, x * k * 1.3, Math.max(0, y * k * 0.8 + 0.6), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** banheiro químico */
export function toiletGeo() {
  const b = new GB();
  const w = C("#1f5fbf"), top = C("#e6e8ea"), door = C("#174a96");
  b.box(-0.6, 0, -0.6, 0.6, 2.3, 0.6, w);
  b.box(-0.65, 2.3, -0.65, 0.65, 2.45, 0.65, top);
  b.box(-0.4, 0.1, -0.62, 0.4, 2.0, -0.6, door);
  return b.geo();
}

/** carrinho de golfe (nariz pra +z) */
export function golfCartGeo() {
  const b = new GB();
  const w = C("#ffffff"), seat = C("#2a2d33"), tyre = C("#151515"), roof = C("#e6e8ea");
  b.box(-0.6, 0.3, -1.2, 0.6, 0.8, 1.2, w);
  b.box(-0.55, 0.8, -0.6, 0.55, 1.1, 0.1, seat);
  for (const x of [-0.55, 0.55]) for (const z of [-1.0, 0.1]) b.box(x - 0.04, 0.8, z - 0.04, x + 0.04, 1.9, z + 0.04, w);
  b.box(-0.65, 1.9, -1.1, 0.65, 2.0, 0.3, roof);
  for (const x of [-0.6, 0.6]) for (const z of [-0.85, 0.85]) b.box(x - 0.12, 0, z - 0.22, x + 0.12, 0.44, z + 0.22, tyre);
  return b.geo();
}

/** gerador (caixa amarela com escape) */
export function generatorGeo() {
  const b = new GB();
  const y = C("#f2c418"), d = C("#2a2d33");
  b.box(-1.2, 0, -0.6, 1.2, 1.3, 0.6, y);
  b.box(-1.0, 0.3, -0.62, -0.2, 1.0, -0.6, d);
  b.box(0.8, 1.3, -0.1, 0.95, 1.9, 0.05, d);
  return b.geo();
}

/** bloco de barreira de pneus (2 m × 1,1 m, 0,9 m de altura): pneus em 2 fileiras de 4 por cima, cinta em volta
 *  (a cinta tinge pela cor da instância: preto e branco alternando) */
export function tyreBlockGeo() {
  const b = new GB();
  const belt = C("#ffffff"), rubber = C("#2a2b30"), hole = C("#0e0f12");
  b.box(-1, 0, -0.55, 1, 0.9, 0.55, belt);
  const gs: THREE.BufferGeometry[] = [b.geo()];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 2; j++) {
      const x = -0.75 + i * 0.5, z = -0.27 + j * 0.54;
      gs.push(paint(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 12).translate(x, 0.92, z), "#2a2b30"));
      gs.push(paint(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 10).translate(x, 0.93, z), "#0e0f12"));
    }
  void rubber;
  void hole;
  return join(gs);
}

// ---- cidade à beira-mar (circuito de rua): prédios variados, barcos, cais ----
/** prédio de apartamentos com sacadas: andares e largura pela variante; a fachada tinge pela instância */
export function apartmentGeo(floors: number, w = 14, d = 12) {
  const b = new GB();
  const wall = C("#ffffff"), balc = C("#dedbd2"), win = C("#33465e"), roof = C("#b9b4a8"), awning = C("#c8553d");
  const H = floors * 3;
  b.box(-w / 2, 0, -d / 2, w / 2, H, d / 2, wall);
  // térreo com toldo e vitrines
  b.box(-w / 2 - 0.02, 0.4, -d / 2 - 0.02, w / 2 + 0.02, 2.4, -d / 2, win);
  b.box(-w / 2, 2.5, -d / 2 - 1.1, w / 2, 2.7, -d / 2, awning);
  for (let f = 1; f < floors; f++) {
    const y = f * 3;
    // janelas nos quatro lados e sacada corrida na frente
    b.box(-w / 2 + 0.8, y + 0.8, -d / 2 - 0.03, w / 2 - 0.8, y + 2.2, -d / 2, win);
    b.box(-w / 2 + 0.8, y + 0.8, d / 2, w / 2 - 0.8, y + 2.2, d / 2 + 0.03, win);
    b.box(-w / 2 - 0.03, y + 0.8, -d / 2 + 0.8, -w / 2, y + 2.2, d / 2 - 0.8, win);
    b.box(w / 2, y + 0.8, -d / 2 + 0.8, w / 2 + 0.03, y + 2.2, d / 2 - 0.8, win);
    b.box(-w / 2 + 0.4, y, -d / 2 - 1.0, w / 2 - 0.4, y + 0.18, -d / 2, balc);
    b.box(-w / 2 + 0.4, y + 0.18, -d / 2 - 1.0, w / 2 - 0.4, y + 1.0, -d / 2 - 0.92, balc);
  }
  b.box(-w / 2 - 0.3, H, -d / 2 - 0.3, w / 2 + 0.3, H + 0.5, d / 2 + 0.3, roof);
  b.box(-2, H + 0.5, -2, 2, H + 2.5, 2, roof);
  return b.geo();
}

/** palacete clássico: colunas na frente, telhado de cobre esverdeado e cúpulas nas pontas */
export function palaceGeo() {
  const b = new GB();
  const w = C("#efe3c8"), col = C("#f7f1e2"), roof = C("#6fa38a"), win = C("#33465e"), stairs = C("#d9cfb8");
  b.box(-20, 0, -8, 20, 14, 8, w);
  b.box(-12, 0, -11, 12, 1.2, -8, stairs);
  for (let x = -10; x <= 10; x += 2.5) b.box(x - 0.45, 1.2, -10.2, x + 0.45, 12, -9.3, col);
  b.box(-11, 12, -10.6, 11, 13.4, -8, col);
  for (let x = -18; x <= 18; x += 3) {
    if (Math.abs(x) < 11) continue;
    b.box(x - 0.8, 3, -8.03, x + 0.8, 6, -8, win);
    b.box(x - 0.8, 8, -8.03, x + 0.8, 11, -8, win);
  }
  b.box(-20.4, 14, -8.4, 20.4, 14.6, 8.4, col);
  b.quad([-20, 14.6, -8], [20, 14.6, -8], [20, 18, 0], [-20, 18, 0], roof);
  b.quad([20, 14.6, 8], [-20, 14.6, 8], [-20, 18, 0], [20, 18, 0], roof);
  const gs: THREE.BufferGeometry[] = [b.geo()];
  for (const x of [-16, 16]) {
    gs.push(paint(new THREE.CylinderGeometry(3, 3, 6, 12).translate(x, 17, -3), "#efe3c8"));
    gs.push(paint(new THREE.SphereGeometry(3.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 20, -3), "#6fa38a"));
  }
  return join(gs);
}

/** hotel alto e largo, com terraços escalonados de um lado */
export function hotelGeo() {
  const b = new GB();
  const w = C("#ffffff"), glass = C("#2f4a66"), slab = C("#d8d8d4");
  for (let i = 0; i < 5; i++) {
    const x0 = -18 + i * 3, h = 30 - i * 4;
    b.box(x0, 0, -9, 18, h, 9, w);
    for (let y = 3; y < h - 1; y += 3) b.box(x0 - 0.03, y + 0.6, -7.5, x0, y + 2.2, 7.5, glass);
    b.box(x0 - 0.5, h, -9.3, 18.3, h + 0.4, 9.3, slab);
  }
  for (let y = 3; y < 30; y += 3) b.box(-3, y + 0.6, -9.03, 16, y + 2.2, -9, glass);
  return b.geo();
}

/** casa mediterrânea: parede clara (tinge), telhado de telha baixo, janelas com venezianas */
export function villaGeo() {
  const b = new GB();
  const w = C("#ffffff"), roof = C("#c4623a"), shut = C("#3f7a5a"), win = C("#33465e");
  b.box(-6, 0, -5, 6, 7, 5, w);
  for (const x of [-3.5, 0, 3.5])
    for (const y of [1.2, 4.4]) {
      b.box(x - 0.6, y, -5.03, x + 0.6, y + 1.6, -5, win);
      b.box(x - 1.1, y, -5.05, x - 0.6, y + 1.6, -5, shut);
      b.box(x + 0.6, y, -5.05, x + 1.1, y + 1.6, -5, shut);
    }
  b.quad([-6.4, 7, -5.4], [6.4, 7, -5.4], [6.4, 8.8, 0], [-6.4, 8.8, 0], roof);
  b.quad([6.4, 7, 5.4], [-6.4, 7, 5.4], [-6.4, 8.8, 0], [6.4, 8.8, 0], roof);
  b.tri([-6.4, 7, -5.4], [-6.4, 8.8, 0], [-6.4, 7, 5.4], roof);
  b.tri([6.4, 7, 5.4], [6.4, 8.8, 0], [6.4, 7, -5.4], roof);
  return b.geo();
}

/** casco de barco (nariz pra +x), comprimento L, largura W, altura H do convés */
function hull(b: GB, L: number, W: number, H: number, c: THREE.Color, deck: THREE.Color) {
  const n = 8;
  const half = (t: number) => (t < 0.7 ? W / 2 : (W / 2) * Math.max(0.05, (1 - t) / 0.3));
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, x0 = -L / 2 + t0 * L, x1 = -L / 2 + t1 * L, w0 = half(t0), w1 = half(t1);
    for (const s of [-1, 1]) b.quad([x0, -0.4, s * w0 * 0.75], [x1, -0.4, s * w1 * 0.75], [x1, H, s * w1], [x0, H, s * w0], c);
    b.quad([x0, H, -w0], [x1, H, -w1], [x1, H, w1], [x0, H, w0], deck);
  }
  b.quad([-L / 2, -0.4, -W * 0.375], [-L / 2, -0.4, W * 0.375], [-L / 2, H, W / 2], [-L / 2, H, -W / 2], c);
}
/** iate (pequeno 14 m ou grande 40 m): casco branco (tinge), cabines e vidros escuros */
export function yachtGeo(big: boolean) {
  const b = new GB();
  const L = big ? 40 : 14, W = big ? 8 : 4, H = big ? 2.8 : 1.4;
  const w = C("#ffffff"), deck = C("#c79b63"), glass = C("#22303f");
  hull(b, L, W, H, w, deck);
  const levels = big ? 3 : 1;
  for (let k = 0; k < levels; k++) {
    const l = L * (0.5 - k * 0.12), x0 = -L * 0.38 + k * L * 0.04, y = H + k * 2.4, ww = W * (0.7 - k * 0.1);
    b.box(x0, y, -ww / 2, x0 + l, y + 2.2, ww / 2, w);
    b.box(x0 + 0.3, y + 0.8, -ww / 2 - 0.02, x0 + l - 0.3, y + 1.8, ww / 2 + 0.02, glass);
  }
  if (big) b.box(-L * 0.1, H + 7.2, -0.2, -L * 0.1 + 0.4, H + 10, 0.2, w);
  return b.geo();
}
/** veleiro (11 m): casco, mastro e duas velas */
export function sailboatGeo() {
  const b = new GB();
  const w = C("#ffffff"), deck = C("#c79b63"), mast = C("#cfd4d9"), sail = C("#f4f4f2");
  hull(b, 11, 3.4, 1.1, w, deck);
  b.box(-2, 1.1, -1, 1.5, 2, 1, w);
  b.box(0.5, 1.1, -0.08, 0.66, 15, 0.08, mast);
  b.tri([0.58, 2.2, 0], [0.58, 14.5, 0], [-4.2, 2.4, 0], sail);
  b.tri([0.7, 2.2, 0], [5.3, 1.4, 0], [0.7, 13, 0], sail);
  return b.geo();
}
/** navio de cruzeiro (110 m): casco escuro, andares brancos com janelas, chaminé */
export function cruiseGeo() {
  const b = new GB();
  const hullC = C("#1d2c44"), deck = C("#e6e8ea"), w = C("#ffffff"), glass = C("#22303f"), funnel = C("#c8382f");
  hull(b, 110, 18, 6, hullC, deck);
  for (let k = 0; k < 6; k++) {
    const x0 = -46 + k * 2, x1 = 40 - k * 4, y = 6 + k * 3, hw = 8 - k * 0.4;
    b.box(x0, y, -hw, x1, y + 3, hw, w);
    b.box(x0 + 1, y + 1, -hw - 0.03, x1 - 1, y + 2.1, hw + 0.03, glass);
  }
  b.box(-30, 24, -2.5, -20, 32, 2.5, funnel);
  return b.geo();
}
/** píer de madeira (20 × 3 m) em estacas */
export function pierGeo() {
  const b = new GB();
  const wd = C("#a77d4f"), wd2 = C("#8b6640"), post = C("#5e4630");
  b.box(-10, 0.6, -1.5, 10, 0.8, 1.5, wd);
  for (let x = -9.6; x < 10; x += 0.6) b.box(x, 0.8, -1.5, x + 0.04, 0.81, 1.5, wd2);
  for (let x = -9.5; x <= 9.5; x += 4.75) for (const z of [-1.3, 1.3]) b.box(x - 0.15, -0.6, z - 0.15, x + 0.15, 1.6, z + 0.15, post);
  return b.geo();
}
/** farol de porto: torre branca e vermelha com a lanterna */
export function lighthouseGeo() {
  return join([
    paint(new THREE.CylinderGeometry(1.4, 2, 6, 10).translate(0, 3, 0), "#f4f4f2"),
    paint(new THREE.CylinderGeometry(1.2, 1.4, 4, 10).translate(0, 8, 0), "#d62b2b"),
    paint(new THREE.CylinderGeometry(1.0, 1.2, 3, 10).translate(0, 11.5, 0), "#f4f4f2"),
    paint(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10).translate(0, 13.8, 0), "#fff3c4"),
    paint(new THREE.ConeGeometry(1.2, 1.4, 10).translate(0, 15.3, 0), "#d62b2b"),
  ]);
}
/** entrada de túnel (boca de 20 m): pórtico de concreto com o morro em cima (a boca olha pra -z) */
export function tunnelGeo() {
  const b = new GB();
  const conc = C("#a9aaa4"), dark = C("#111216"), hill = C("#4a7a32");
  b.box(-12, 0, -1, -10, 7.5, 1, conc);
  b.box(10, 0, -1, 12, 7.5, 1, conc);
  b.box(-12, 7.5, -1, 12, 9, 1, conc);
  b.box(-10, 0, 0.6, 10, 7.5, 1, dark);
  b.box(-14, 9, -1, 14, 13, 12, hill);
  b.box(-12, 0, 1, -10, 9, 12, hill);
  b.box(10, 0, 1, 12, 9, 12, hill);
  return b.geo();
}
