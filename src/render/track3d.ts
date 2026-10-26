// Autódromo em 3D (Three.js): a pista vem do traçado do jogo (asfalto, faixas, zebras, box) e o entorno
// dos dados reais do OpenStreetMap (public/autodromos/<pista>.json, scripts/osm-track.ts): grama, bosques,
// água, ruas, prédios e arquibancadas com altura, cercas, muros e fileiras de árvores.
// Mundo da pista (x, y) -> Three (X = x, Z = y), Y pra cima (igual aos carros).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PIT_LATERAL, TRACK_WIDTH, type Track } from "../sim/track";

type Kind = "pista" | "kart" | "rua" | "caminho" | "grama" | "bosque" | "arvores" | "agua" | "predio" | "arquibancada" | "cerca" | "muro" | "piscina" | "estacionamento";
interface Item { k: Kind; p: [number, number][]; h?: number; fechado?: boolean; w?: number }

/** nome da pista -> arquivo (sem acento, minúsculo) */
export const slugOf = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

const mat = (color: string, rough = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });

/** textura de ruído (grama, asfalto), repetida */
function noiseTex(base: string, spread: number, seed = 1) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  let r = seed * 9301;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2600; i++) {
    const v = (rnd() - 0.5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** faixa no chão ao longo de uma linha (rua, caminho, pista de kart), com largura w e altura y */
function ribbon(pts: [number, number][], w: number, y: number): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
    pos.push(pts[i][0] + nx, y, pts[i][1] + ny, pts[i][0] - nx, y, pts[i][1] - ny);
    if (i) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** parede fina em pé ao longo de uma linha (cerca, muro) */
function wall(pts: [number, number][], h: number): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;
  const pos: number[] = [], idx: number[] = [];
  pts.forEach(([x, z], i) => {
    pos.push(x, 0, z, x, h, z);
    if (i) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** polígono no chão (ou prédio com altura) */
function shapeOf(pts: [number, number][]) {
  // (no plano XY e depois deitado: o y do mundo vira -y da forma)
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
}
const flat = (pts: [number, number][], y: number) => {
  const g = new THREE.ShapeGeometry(shapeOf(pts));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
};
const extrude = (pts: [number, number][], h: number) => {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
};

const merge = (gs: (THREE.BufferGeometry | null)[]) => {
  const ok = gs.filter((g): g is THREE.BufferGeometry => !!g).map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ok) {
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
  }
  return ok.length ? mergeGeometries(ok) : null;
};

/**
 * Monta o autódromo. `shadows`: prédios e muros fazem sombra (pede mais da placa de vídeo).
 * Devolve o grupo e quanto tem (pra medir o peso).
 */
export async function buildTrack3d(track: Track, shadows: boolean): Promise<{ group: THREE.Group; tris: number; real: boolean } | null> {
  const group = new THREE.Group();
  let items: Item[] = [];
  try {
    const r = await fetch(`/autodromos/${slugOf(track.name)}.json`);
    if (r.ok) items = ((await r.json()) as { itens: Item[] }).itens;
  } catch {
    /* sem dados reais */
  }
  // (por enquanto só onde já tem o entorno real; nas outras, a pista 2D)
  if (!items.length) return null;
  // ---- chão: grama com ruído ----
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let s = 0; s < track.L; s += 10) {
    const p = track.pose(s, 0);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.y);
    z1 = Math.max(z1, p.y);
  }
  const size = Math.max(x1 - x0, z1 - z0) + 2000;
  const grassTex = noiseTex(track.def.grass?.[0] ?? "#3f6d33", 0.12, 3);
  grassTex.repeat.set(size / 24, size / 24);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat("#ffffff", 1, { map: grassTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((x0 + x1) / 2, -0.05, (z0 + z1) / 2);
  ground.receiveShadow = shadows;
  group.add(ground);

  // ---- entorno real ----
  const by = (k: Kind) => items.filter((i) => i.k === k);
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material, cast = false) => {
    if (!g) return;
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = shadows;
    mesh.castShadow = shadows && cast;
    group.add(mesh);
  };
  const areas: [Kind, string, number][] = [
    ["grama", "#4d8a3c", 0.0],
    ["bosque", "#2c5a28", 0.02],
    ["estacionamento", "#5b5d62", 0.03],
    ["agua", "#2f6fb8", 0.04],
    ["piscina", "#56b3e2", 0.05],
  ];
  for (const [k, col, y] of areas) add(merge(by(k).filter((i) => i.fechado && i.p.length > 3).map((i) => flat(i.p.slice(0, -1), y))), mat(col, k === "agua" || k === "piscina" ? 0.2 : 0.95));
  add(merge(by("rua").map((i) => ribbon(i.p, i.w ?? 6, 0.06))), mat("#55575c", 0.95));
  add(merge(by("caminho").map((i) => ribbon(i.p, 2, 0.065))), mat("#8a8272", 0.95));
  add(merge(by("kart").map((i) => ribbon(i.p, 8, 0.07))), mat("#3a3b40", 0.9));
  add(merge(by("predio").filter((i) => i.fechado && i.p.length > 3).map((i) => extrude(i.p.slice(0, -1), i.h ?? 6))), mat("#b6b2a8", 0.85), true);
  add(merge(by("arquibancada").filter((i) => i.fechado && i.p.length > 3).map((i) => extrude(i.p.slice(0, -1), i.h ?? 14))), mat("#c8ccd3", 0.7), true);
  add(merge(by("cerca").map((i) => wall(i.p, 1.8))), mat("#c9ced6", 0.6, { transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  add(merge(by("muro").map((i) => wall(i.p, 1.3))), mat("#d8d6cf", 0.9, { side: THREE.DoubleSide }), true);
  // fileiras de árvores: copas (uma malha só, repetida)
  const trees: [number, number][] = [];
  for (const i of by("arvores"))
    for (let j = 1; j < i.p.length; j++) {
      const [ax, az] = i.p[j - 1], [bx, bz] = i.p[j];
      const n = Math.max(1, Math.floor(Math.hypot(bx - ax, bz - az) / 7));
      for (let q = 0; q < n; q++) trees.push([ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n]);
    }
  if (trees.length) {
    const tm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 0), mat("#2f6b2a", 0.95), trees.length);
    const m4 = new THREE.Matrix4();
    trees.forEach(([x, z], i) => tm.setMatrixAt(i, m4.makeTranslation(x, 4.5, z)));
    tm.castShadow = shadows;
    group.add(tm);
  }

  // ---- a pista do jogo: asfalto, faixas brancas, zebras nas curvas, box e largada ----
  const W2 = TRACK_WIDTH / 2;
  const edge = (lat: number, step = 2) => {
    const pts: [number, number][] = [];
    for (let s = 0; s <= track.L; s += step) {
      const p = track.pose(s, lat);
      pts.push([p.x, p.y]);
    }
    return pts;
  };
  const asphaltTex = noiseTex("#3c3e44", 0.1, 7);
  asphaltTex.repeat.set(1, 1);
  const band = (lat0: number, lat1: number, y: number, from = 0, to = track.L, step = 2, uvScale = 0.1) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let i = 0;
    for (let s = from; s <= to + 0.01; s += step, i++) {
      const a = track.pose(s, lat0), b = track.pose(s, lat1);
      pos.push(a.x, y, a.y, b.x, y, b.y);
      uv.push(s * uvScale, 0, s * uvScale, 1);
      if (i) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // (a ordem do triângulo segue o sentido da pista: se a face sair virada pra baixo, mostra dos dois lados)
  add(band(-W2, W2, 0.1, 0, track.L, 2, 0.08), mat("#ffffff", 0.85, { map: asphaltTex, side: THREE.DoubleSide }));
  add(merge([band(W2 - 0.55, W2 - 0.3, 0.12), band(-W2 + 0.3, -W2 + 0.55, 0.12)]), mat("#e8e8e8", 0.6, { side: THREE.DoubleSide }));
  // zebras: nas curvas, dos dois lados, vermelho e branco a cada 2 m
  const kerbR: THREE.BufferGeometry[] = [], kerbW: THREE.BufferGeometry[] = [];
  for (let s = 0; s < track.L; s += 2) {
    const k = Math.abs(track.curvature[Math.floor(s)] ?? 0);
    if (k < 1 / 220) continue;
    const red = Math.floor(s / 2) % 2 === 0;
    for (const [l0, l1] of [[W2, W2 + 1.4], [-W2 - 1.4, -W2]] as const) (red ? kerbR : kerbW).push(band(l0, l1, 0.13, s, s + 2, 2));
  }
  add(merge(kerbR), mat("#d8262b", 0.7, { side: THREE.DoubleSide }));
  add(merge(kerbW), mat("#f2f2f2", 0.7, { side: THREE.DoubleSide }));
  // box: faixa de asfalto do pit lane
  const pitW = 9;
  const pitPts: [number, number][] = [];
  const ps = track.pitEntryS, pe = track.pitExitS + track.L;
  for (let s = ps; s <= pe; s += 3) {
    const p = track.pose(s % track.L, track.pitLateralAt(s % track.L));
    pitPts.push([p.x, p.y]);
  }
  add(ribbon(pitPts, pitW, 0.09), mat("#45474d", 0.85));
  void PIT_LATERAL;
  // largada: faixa quadriculada
  const chk: THREE.BufferGeometry[] = [];
  for (let q = 0; q < 12; q++) chk.push(band(-W2 + (q * TRACK_WIDTH) / 12, -W2 + ((q + 1) * TRACK_WIDTH) / 12, 0.14, q % 2 ? 0 : 1.5, q % 2 ? 1.5 : 3, 1.5));
  add(merge(chk), mat("#f0f0f0", 0.6, { side: THREE.DoubleSide }));
  void edge;

  let tris = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    tris += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
  });
  return { group, tris: Math.round(tris), real: items.length > 0 };
}
