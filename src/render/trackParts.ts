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
export function standModule(green = "#18b04f", yellow = "#f6d21a") {
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
