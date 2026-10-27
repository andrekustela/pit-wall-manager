// Autódromo em 3D (Three.js): a pista vem do traçado do jogo (asfalto, faixas, zebras, box) e o entorno
// dos dados reais do OpenStreetMap (public/autodromos/<pista>.json, scripts/osm-track.ts): grama, bosques,
// água, ruas, prédios e arquibancadas com altura, cercas, muros e fileiras de árvores.
// Mundo da pista (x, y) -> Three (X = x, Z = y), Y pra cima (igual aos carros).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { asphaltTexture, rubberTexture, rng, angDiff, Grid, inPoly, obb, C, standModule, blob, houseGeos, garageTex, fenceTex, grassTex, vwall, towerGeo, motorhomeGeo, tentGeo, tyreStackGeo, pineGeo, billboardGeos, billboardTex, BRANDS } from "./trackParts";
import { PIT_LATERAL, TRACK_WIDTH, type Track } from "../sim/track";

type Kind = "pista" | "kart" | "rua" | "caminho" | "grama" | "bosque" | "arvores" | "agua" | "predio" | "arquibancada" | "cerca" | "muro" | "piscina" | "estacionamento";
interface Item { k: Kind; p: [number, number][]; h?: number; fechado?: boolean; w?: number }

/** nome da pista -> arquivo (sem acento, minúsculo) */
export const slugOf = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** pintura por cima do asfalto: puxa pra frente na profundidade (só a altura de milímetros brigava de longe e serrilhava) */
const over = (k: number) => ({ polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k * 2 });
// (fosco: sem o brilho que muda com o ângulo, a câmera de cima e a de lado mostram a mesma cor; e pesa menos)
const mat = (color: string, _rough = 0.9, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });


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



/** como merge, mas guardando o UV (alambrado) */
const mergeUV = (gs: THREE.BufferGeometry[]) => (gs.length ? mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g))) : null);


/** zebras por pista (as outras: vermelho e branco) */
const KERBS: Record<string, string[]> = { interlagos: ["#159447", "#f4f4f4", "#f5d10f", "#f4f4f4"] };

/**
 * Monta o autódromo. `shadows`: prédios, árvores e arquibancadas fazem sombra (pede mais da placa de vídeo).
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
  // (sem o entorno real, só as peças em volta da pista)
  const rnd = rng(7);
  const W2 = TRACK_WIDTH / 2;
  const FENCE = W2 + 12; // alambrado (dos dois lados)
  const STAND = W2 + 14; // frente das arquibancadas
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material | THREE.Material[], cast = false) => {
    if (!g) return null;
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = shadows;
    mesh.castShadow = shadows && cast;
    group.add(mesh);
    return mesh;
  };
  const inst = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], n: number) => {
    const im = new THREE.InstancedMesh(g, m, Math.max(1, n));
    im.count = n;
    im.castShadow = shadows;
    im.receiveShadow = shadows;
    group.add(im);
    return im;
  };

  // ---- onde a pista passa (pra nada nascer em cima dela) ----
  const trk = new Grid(20);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let s = 0; s < track.L; s += 3) {
    const p = track.pose(s, 0);
    trk.add(p.x, p.y);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.y);
    z1 = Math.max(z1, p.y);
  }
  const taken = new Grid(20);
  const range = track.wrap(track.pitExitS - track.pitEntryS);
  /** 0 = fora do box, 1 = rampa de entrada/saída, 2 = trecho dos boxes */
  const pitZone = (s: number) => {
    const d1 = track.wrap(s - track.pitEntryS);
    if (d1 > range) return 0;
    return d1 < 70 || range - d1 < 70 ? 1 : 2;
  };
  /** curva pra que lado em s (+1: pra +lateral), e quanto */
  const turn = (s: number) => angDiff(track.pose(track.wrap(s - 20), 0).h, track.pose(track.wrap(s + 20), 0).h);
  /** matriz de uma peça na beira da pista: x ao longo, z pra longe da pista, origem na frente */
  const sideMatrix = (s: number, lat: number, side: number, out: THREE.Matrix4) => {
    const p = track.pose(track.wrap(s), lat);
    const X = new THREE.Vector3(Math.cos(p.h) * side, 0, Math.sin(p.h) * side);
    const Z = new THREE.Vector3(-Math.sin(p.h) * side, 0, Math.cos(p.h) * side);
    out.makeBasis(X, UP, Z).setPosition(p.x, 0, p.y);
    return { p, X, Z };
  };

  // ---- chão: grama de desenho ----
  const size = Math.max(x1 - x0, z1 - z0) + 2000;
  const gt = grassTex("#3b6421", "#2d5119", "#4b772a");
  gt.repeat.set(size / 200, size / 200);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat("#ffffff", 1, { map: gt }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((x0 + x1) / 2, -0.05, (z0 + z1) / 2);
  ground.receiveShadow = shadows;
  group.add(ground);

  // ---- boxes: prédio de dois andares (portas amarelas embaixo, janelas em cima), torre de controle e paddock atrás ----
  const pitW = 9;
  const garages: THREE.Matrix4[] = [];
  for (let d = 70; d <= range - 70 - 6; d += 6.2) {
    const s = track.pitEntryS + d + 3.1;
    const m = new THREE.Matrix4();
    const { p } = sideMatrix(s, PIT_LATERAL + pitW / 2 + 1.5, 1, m);
    garages.push(m);
    void p;
    const c = track.pose(track.wrap(s), PIT_LATERAL + pitW / 2 + 8);
    taken.add(c.x, c.y, 9);
  }
  if (garages.length) {
    const g = new THREE.BoxGeometry(6.2, 11, 14).translate(0, 5.5, 7);
    const white = mat("#f4f4f2", 0.8), door = mat("#ffffff", 0.7, { map: garageTex() });
    const im = inst(g, [white, white, white, white, white, door], garages.length);
    garages.forEach((m, i) => im.setMatrixAt(i, m));
    // telhado marrom passando um pouco da frente
    const rim = inst(new THREE.BoxGeometry(6.25, 0.7, 16).translate(0, 11.35, 7), mat("#a5653b", 0.85), garages.length);
    garages.forEach((m, i) => rim.setMatrixAt(i, m));
    // torre de controle antes do primeiro box
    const tm = new THREE.Matrix4();
    const tp = sideMatrix(track.pitEntryS + 70 - 7, PIT_LATERAL + pitW / 2 + 1.5, 1, tm).p;
    const tower = add(towerGeo(), mat("#ffffff", 0.8, { vertexColors: true, flatShading: true }), true)!;
    tower.applyMatrix4(tm);
    taken.add(tp.x, tp.y, 9);
  }
  // paddock: tendas na frente e motorhomes em fila atrás dos boxes
  const PAD = PIT_LATERAL + pitW / 2 + 1.5 + 14;
  const tents: THREE.Matrix4[] = [], homes: THREE.Matrix4[] = [];
  const free = (s: number, lat: number, r: number) => {
    const p = track.pose(track.wrap(s), lat);
    return trk.near(p.x, p.y, lat) >= lat - 2 && taken.near(p.x, p.y, r + 1) >= r ? p : null;
  };
  for (let d = 60; d <= range - 60; d += 6.5) {
    const s = track.pitEntryS + d;
    if (!free(s, PAD + 4, 3)) continue;
    const m = new THREE.Matrix4();
    sideMatrix(s, PAD + 4, 1, m);
    tents.push(m);
  }
  for (const row of [11, 15.5])
    for (let d = 60; d <= range - 60; d += 9.5) {
      const s = track.pitEntryS + d + (row > 12 ? 4 : 0);
      if (rnd() < 0.2 || !free(s, PAD + row, 4)) continue;
      const m = new THREE.Matrix4();
      sideMatrix(s, PAD + row, 1, m);
      homes.push(m);
    }
  for (const m of [...tents, ...homes]) {
    const e = new THREE.Vector3().setFromMatrixPosition(m);
    taken.add(e.x, e.z, 4.5);
  }
  if (tents.length) {
    const im = inst(tentGeo(), mat("#ffffff", 0.8, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }), tents.length);
    tents.forEach((m, i) => im.setMatrixAt(i, m));
  }
  if (homes.length) {
    const im = inst(motorhomeGeo(), mat("#ffffff", 0.7, { vertexColors: true }), homes.length);
    const hc = ["#ffffff", "#f3f1ea", "#e6cf96", "#d9dde2"].map(C);
    homes.forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, hc[Math.floor(rnd() * hc.length)]);
    });
  }

  // ---- arquibancadas: módulos de 14 m na reta (lado oposto ao box) e por fora das curvas ----
  const stands: THREE.Matrix4[] = [];
  const tryStand = (s: number, side: number) => {
    if (stands.length >= 90) return false;
    const m = new THREE.Matrix4();
    const { p, X, Z } = sideMatrix(s, STAND * side, side, m);
    for (const [lx, lz] of [[-7, 0], [7, 0], [-7, 12], [7, 12], [0, 6]]) {
      const wx = p.x + X.x * lx + Z.x * lz, wz = p.y + X.z * lx + Z.z * lz;
      if (trk.near(wx, wz, FENCE) < FENCE - 0.5) return false;
    }
    const cx = p.x + Z.x * 6, cz = p.y + Z.z * 6;
    if (taken.near(cx, cz, 10) < 9.5) return false;
    taken.add(cx, cz, 9.5);
    stands.push(m);
    return true;
  };
  for (let s = -240; s <= 240; s += 14.2) tryStand(s, -1);
  const corners: { s: number; k: number }[] = [];
  for (let s = 0; s < track.L; s += 14.2) {
    const k = turn(s);
    if (Math.abs(k) > 0.55) corners.push({ s, k });
  }
  corners.sort((a, b) => Math.abs(b.k) - Math.abs(a.k));
  for (const c of corners) tryStand(c.s, c.k > 0 ? -1 : 1);
  if (stands.length) {
    const im = inst(standModule(), mat("#ffffff", 0.8, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }), stands.length);
    stands.forEach((m, i) => im.setMatrixAt(i, m));
  }

  // ---- alambrado com mureta, dos dois lados (some onde outra parte da pista passa perto e no box) ----
  const runs: [number, number][][] = [];
  const posts: [number, number][] = [];
  for (const side of [1, -1]) {
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) runs.push(run);
      run = [];
    };
    for (let s = 0; s <= track.L; s += 3) {
      const z = side > 0 ? pitZone(s) : 0;
      if (z === 1) {
        flush();
        continue;
      }
      const lat = z === 2 ? W2 + 3 : FENCE;
      const p = track.pose(track.wrap(s), lat * side);
      if (trk.near(p.x, p.y, lat) < lat - 1.5) {
        flush();
        continue;
      }
      run.push([p.x, p.y]);
      if (Math.round(s / 3) % 2 === 0) posts.push([p.x, p.y]);
    }
    flush();
  }
  add(merge(runs.map((r) => vwall(r, 0, 1.0))), mat("#e2e4e6", 0.8, { side: THREE.DoubleSide }), true);
  const ft = fenceTex();
  add(mergeUV(runs.map((r) => vwall(r, 1.0, 4.2))), mat("#ffffff", 0.6, { map: ft, alphaTest: 0.35, side: THREE.DoubleSide }));
  if (posts.length) {
    const im = inst(new THREE.BoxGeometry(0.16, 4.4, 0.16).translate(0, 2.2, 0), mat("#6d737a", 0.6), posts.length);
    posts.forEach(([x, z], i) => im.setMatrixAt(i, m4.makeTranslation(x, 0, z)));
    im.castShadow = false;
  }

  // ---- entorno real (OpenStreetMap) ----
  const by = (k: Kind) => items.filter((i) => i.k === k);
  const areas: [Kind, string, number][] = [
    ["grama", "#3f6a23", 0.0],
    ["bosque", "#335a1d", 0.02],
    ["estacionamento", "#7f7a6e", 0.03],
    ["agua", "#3aaabf", 0.04],
    ["piscina", "#6fd6ef", 0.05],
  ];
  for (const [k, col, y] of areas) add(merge(by(k).filter((i) => i.fechado && i.p.length > 3).map((i) => flat(i.p.slice(0, -1), y))), mat(col, k === "agua" || k === "piscina" ? 0.25 : 0.95));
  add(merge(by("rua").map((i) => ribbon(i.p, i.w ?? 6, 0.06))), mat("#7b7d78", 0.95));
  add(merge(by("caminho").map((i) => ribbon(i.p, 2, 0.065))), mat("#bba77e", 0.95));
  add(merge(by("kart").map((i) => ribbon(i.p, 8, 0.07))), mat("#3a3b40", 0.9));
  add(merge(by("muro").map((i) => vwall(i.p, 0, 1.3))), mat("#d8d6cf", 0.9, { side: THREE.DoubleSide }), true);

  // prédios: os baixos viram casinhas (parede clara, telhado laranja), os outros blocos com altura
  const houses: { x: number; z: number; a: number; l: number; w: number; h: number }[] = [];
  const towers: Item[] = [];
  for (const i of [...by("predio"), ...by("arquibancada")]) {
    if (!i.fechado || i.p.length < 4) continue;
    const pts = i.p.slice(0, -1);
    const o = obb(pts);
    if (o.l < 2.5 || o.w < 2) continue;
    // (perto da pista do jogo não fica nada: é onde o desenho da pista e o mapa real menos batem)
    if (trk.near(o.cx, o.cz, 34) < 34 || taken.near(o.cx, o.cz, o.l / 2 + 1) < o.l / 2) continue;
    const h = i.h ?? 6;
    if (i.k === "predio" && h <= 9 && o.l < 40) houses.push({ x: o.cx, z: o.cz, a: o.a, l: o.l, w: o.w, h: h <= 6 ? 3.2 + rnd() * 1.6 : h });
    else towers.push(i);
    taken.add(o.cx, o.cz, Math.hypot(o.l, o.w) / 2);
  }
  if (houses.length) {
    const { walls, roof } = houseGeos();
    const wm = inst(walls, mat("#ffffff", 0.85), houses.length);
    const rm = inst(roof, mat("#ffffff", 0.75, { flatShading: true }), houses.length);
    const wallCols = ["#f5f1e8", "#fbfaf6", "#efe4cf", "#e9eef0"].map(C);
    const roofCols = ["#e46a24", "#ec7d32", "#d45e1e", "#f08c3c"].map(C);
    houses.forEach((h, i) => {
      q4.setFromAxisAngle(UP, -h.a);
      wm.setMatrixAt(i, m4.compose(v3.set(h.x, 0, h.z), q4, s3.set(h.l, h.h, h.w)));
      const rh = Math.min(3, 0.4 * h.w);
      rm.setMatrixAt(i, m4.compose(v3.set(h.x, h.h, h.z), q4, s3.set(h.l * 1.06, rh, h.w * 1.14)));
      wm.setColorAt(i, wallCols[Math.floor(rnd() * wallCols.length)]);
      rm.setColorAt(i, roofCols[Math.floor(rnd() * roofCols.length)]);
    });
  }
  add(merge(towers.map((i) => extrude(i.p.slice(0, -1), i.h ?? 14))), mat("#ecdcb4", 0.85), true);

  // ruas: árvore não nasce em cima
  for (const i of by("rua"))
    for (let j = 1; j < i.p.length; j++) {
      const [ax, az] = i.p[j - 1], [bx, bz] = i.p[j];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
      for (let q = 0; q <= n; q++) taken.add(ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n, (i.w ?? 6) / 2);
    }

  // ---- árvores low-poly: fileiras e bosques do mapa, mais espalhadas em volta da pista ----
  const water = by("agua").filter((i) => i.fechado).map((i) => i.p);
  const trees: { x: number; z: number; s: number; tall: boolean; near: boolean }[] = [];
  let nNear = 0;
  const tryTree = (x: number, z: number) => {
    if (trk.near(x, z, W2 + 15) < W2 + 14) return;
    if (taken.near(x, z, 4) < 1.2) return;
    if (water.some((p) => inPoly(x, z, p))) return;
    const near = trk.near(x, z, 140) < 140;
    if (near ? nNear >= 5000 : trees.length - nNear >= 9000) return;
    if (near) nNear++;
    trees.push({ x, z, s: 2.2 + rnd() * 1.8, tall: rnd() < 0.25, near });
  };
  for (const i of by("arvores"))
    for (let j = 1; j < i.p.length; j++) {
      const [ax, az] = i.p[j - 1], [bx, bz] = i.p[j];
      const n = Math.max(1, Math.floor(Math.hypot(bx - ax, bz - az) / 7));
      for (let q = 0; q < n; q++) tryTree(ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n);
    }
  const fill = (k: Kind, step: number, prob: number) => {
    for (const i of by(k)) {
      if (!i.fechado) continue;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of i.p) {
        a0 = Math.min(a0, x);
        a1 = Math.max(a1, x);
        b0 = Math.min(b0, z);
        b1 = Math.max(b1, z);
      }
      for (let x = a0; x < a1; x += step)
        for (let z = b0; z < b1; z += step) {
          const px = x + (rnd() - 0.5) * step * 0.7, pz = z + (rnd() - 0.5) * step * 0.7;
          if (rnd() < prob && inPoly(px, pz, i.p)) tryTree(px, pz);
        }
    }
  };
  fill("bosque", 7, 1);
  fill("grama", 22, 0.35);
  for (let n = 0; n < 7000; n++) {
    const s = rnd() * track.L, lat = (W2 + 16 + Math.pow(rnd(), 1.6) * 230) * (rnd() < 0.5 ? -1 : 1);
    const p = track.pose(s, lat);
    tryTree(p.x, p.y);
  }
  if (trees.length) {
    const leaf = mat("#ffffff", 0.9, { flatShading: true });
    const near = trees.filter((t) => t.near), far = trees.filter((t) => !t.near);
    const cols = ["#4a8a2c", "#3d7a26", "#5a9634", "#2f6a22", "#2a5e20", "#679f3a"].map(C);
    const trunk = inst(new THREE.CylinderGeometry(0.16, 0.26, 1, 5, 1, true).translate(0, 0.5, 0), mat("#7a5a3c", 0.9), trees.length);
    trees.forEach((t, i) => {
      const th = t.s * (t.tall ? 1.1 : 0.8);
      trunk.setMatrixAt(i, m4.compose(v3.set(t.x, 0, t.z), q4.identity(), s3.set(t.s * 0.9, th + t.s * 0.3, t.s * 0.9)));
    });
    trunk.castShadow = false;
    // as altas viram pinheiros
    const pines = trees.filter((t) => t.tall);
    if (pines.length) {
      const pm = inst(pineGeo(), leaf, pines.length);
      pines.forEach((t, i) => {
        pm.setMatrixAt(i, m4.compose(v3.set(t.x, t.s * 0.5, t.z), q4.setFromAxisAngle(UP, rnd() * 6.3), s3.set(t.s * 0.95, t.s * 2.2, t.s * 0.95)));
        pm.setColorAt(i, rnd() < 0.5 ? C("#24561f") : C("#2f6627"));
      });
    }
    for (const [all, detail] of [[near, 1], [far, 0]] as const) {
      const list = all.filter((t) => !t.tall);
      if (!list.length) continue;
      const im = inst(blob(detail), leaf, list.length);
      list.forEach((t, i) => {
        const th = t.s * (t.tall ? 1.1 : 0.8);
        q4.setFromAxisAngle(UP, rnd() * Math.PI * 2);
        im.setMatrixAt(i, m4.compose(v3.set(t.x, th + t.s * 0.75, t.z), q4, s3.set(t.s, t.s * (t.tall ? 1.55 : 1), t.s)));
        im.setColorAt(i, t.tall ? cols[4] : cols[Math.floor(rnd() * cols.length)]);
      });
    }
  }

  // ---- a pista do jogo: asfalto, faixas brancas, zebras e escape nas curvas, box e largada ----
  const asphaltTex = asphaltTexture();
  asphaltTex.repeat.set(2, 3);
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
  add(band(-W2, W2, 0.1, 0, track.L, 2, 0.08), mat("#ffffff", 1, { map: asphaltTex, side: THREE.DoubleSide }));
  add(merge([band(W2 - 0.14, W2, 0.12), band(-W2, -W2 + 0.14, 0.12)]), mat("#141821", 1, { side: THREE.DoubleSide, ...over(2) }));
  add(merge([band(W2 - 0.66, W2 - 0.14, 0.12), band(-W2 + 0.14, -W2 + 0.66, 0.12)]), mat("#f2f2f2", 0.6, { side: THREE.DoubleSide, ...over(2) }));
  // desgaste no traçado ideal: borracha das rodas com borda que some, duas marcas mais escuras e riscos;
  // mais forte nas curvas e freadas, mais fraco nas retas, e mais aberto nas curvas
  if (track.hasLine) {
    const n = Math.ceil(track.L / 2);
    // força do desgaste por trecho (curvatura suavizada + uma variação lenta)
    const raw: number[] = [];
    for (let i = 0; i <= n; i++) {
      let k = 0;
      for (let d = -30; d <= 30; d += 3) k = Math.max(k, Math.abs(track.curvature[Math.floor(track.wrap(i * 2 + d))] ?? 0));
      raw.push(Math.min(1, k * 140));
    }
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = track.wrap(i * 2);
      const k = raw[i];
      const wob = 0.5 + 0.5 * Math.sin(i * 0.37) * Math.sin(i * 0.113 + 1.3);
      const alpha = Math.min(1, 0.6 + 0.4 * k + 0.15 * wob);
      const w = 4.2 + 1.6 * k;
      const lat = Math.max(-W2 + w / 2, Math.min(W2 - w / 2, track.lineAt(s)));
      const pa = track.pose(s, lat - w / 2), pb = track.pose(s, lat + w / 2);
      pos.push(pa.x, 0.104, pa.y, pb.x, 0.104, pb.y);
      uv.push(0, (i * 2) / 14, 1, (i * 2) / 14);
      col.push(1, 1, 1, alpha, 1, 1, 1, alpha);
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    add(g, mat("#ffffff", 1, { map: rubberTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...over(1) }));
  }
  // zebras dos dois lados nas curvas; escape de asfalto por fora das curvas fechadas
  // zebras: blocos de 1 m na sequência de cores da pista
  const kc = KERBS[slugOf(track.name)] ?? ["#d8262b", "#f2f2f2"];
  const kerbs: THREE.BufferGeometry[][] = kc.map(() => []);
  for (let s = 0; s < track.L; s += 1) {
    const k = Math.abs(track.curvature[Math.floor(s)] ?? 0);
    if (k < 1 / 220) continue;
    for (const [l0, l1] of [[W2, W2 + 1.5], [-W2 - 1.5, -W2]] as const) kerbs[Math.floor(s) % kc.length].push(band(l0, l1, 0.13, s, s + 1, 1));
  }
  const runoff: THREE.BufferGeometry[] = [], paint: THREE.BufferGeometry[] = [], gravel: THREE.BufferGeometry[] = [];
  const tyres: [number, number, number][] = [], boards: THREE.Matrix4[][] = BRANDS.map(() => []);
  let lastBoard = -1e9;
  for (let s = 0; s < track.L; s += 2) {
    const t = turn(s);
    if (Math.abs(t) > 0.45 && !(t < 0 && pitZone(s))) {
      const side = t > 0 ? -1 : 1;
      // escape: faixa verde, asfalto e brita laranja
      const b2 = (l0: number, l1: number, y: number) => (side > 0 ? band(W2 + l0, W2 + l1, y, s, s + 2, 2) : band(-W2 - l1, -W2 - l0, y, s, s + 2, 2));
      paint.push(b2(1.4, 3, 0.095));
      runoff.push(b2(3, 6.5, 0.09));
      gravel.push(b2(6.5, 10, 0.085));
      if (Math.abs(t) > 0.6) {
        // pneus na beira da brita (onde outra parte da pista não passa perto)
        const lat = W2 + 10.4;
        for (let q = 0; q < 2; q += 0.75) {
          const p = track.pose(s + q, lat * side);
          if (trk.near(p.x, p.y, lat) >= lat - 1) tyres.push([p.x, p.y, Math.floor((s + q) / 2.25) % 2]);
        }
        // placa atrás do alambrado
        if (s - lastBoard > 45) {
          const m = new THREE.Matrix4();
          const { p } = sideMatrix(s, (FENCE + 1.5) * side, side, m);
          if (trk.near(p.x, p.y, FENCE + 1.5) >= FENCE && taken.near(p.x, p.y, 4) >= 3.5) {
            boards[Math.floor(s / 45) % BRANDS.length].push(m);
            taken.add(p.x, p.y, 3.5);
            lastBoard = s;
          }
        }
      }
    }
  }
  kerbs.forEach((list, i) => add(merge(list), mat(kc[i], 0.7, { side: THREE.DoubleSide, ...over(2) })));
  add(merge(runoff), mat("#7d8086", 0.9, { side: THREE.DoubleSide }));
  add(merge(paint), mat("#2f9e56", 0.85, { side: THREE.DoubleSide, ...over(1) }));
  add(merge(gravel), mat("#e08a3c", 1, { side: THREE.DoubleSide }));
  if (tyres.length) {
    const im = inst(tyreStackGeo(), mat("#ffffff", 0.9), tyres.length);
    const bw = [C("#1c1c1c"), C("#f2f2f2")];
    tyres.forEach(([x, z, c], i) => {
      im.setMatrixAt(i, m4.makeTranslation(x, 0, z));
      im.setColorAt(i, bw[c]);
    });
  }
  const bg = billboardGeos();
  const postsN = boards.reduce((a, b) => a + b.length, 0);
  if (postsN) {
    const pm = inst(bg.posts, mat("#59606a", 0.7), postsN);
    let k = 0;
    boards.forEach((list, bi) => {
      if (!list.length) return;
      const fm = inst(bg.face, mat("#ffffff", 0.6, { map: billboardTex(bi) }), list.length);
      list.forEach((m, i) => {
        fm.setMatrixAt(i, m);
        pm.setMatrixAt(k++, m);
      });
    });
  }
  // box: faixa de asfalto do pit lane
  const pitPts: [number, number][] = [];
  const ps = track.pitEntryS, pe = track.pitExitS + track.L;
  for (let s = ps; s <= pe; s += 3) {
    const p = track.pose(s % track.L, track.pitLateralAt(s % track.L));
    pitPts.push([p.x, p.y]);
  }
  add(ribbon(pitPts, pitW, 0.09), mat("#45474d", 0.85));
  // largada: faixa quadriculada
  const chk: THREE.BufferGeometry[] = [];
  for (let q = 0; q < 12; q++) chk.push(band(-W2 + (q * TRACK_WIDTH) / 12, -W2 + ((q + 1) * TRACK_WIDTH) / 12, 0.14, q % 2 ? 0 : 1.5, q % 2 ? 1.5 : 3, 1.5));
  add(merge(chk), mat("#f0f0f0", 0.6, { side: THREE.DoubleSide, ...over(3) }));

  for (const o of group.children) {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }
  let tris = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    tris += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
  });
  console.info(`pista 3D: ${stands.length} módulos de arquibancada, ${houses.length} casas, ${trees.length} árvores (${nNear} perto)`);
  return { group, tris: Math.round(tris), real: items.length > 0 };
}
