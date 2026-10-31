// Linhas e áreas desenhadas no editor do autódromo 3D: guard-rail, muro, zebra, pneus, alambrado e faixa
// seguem uma linha (com curva suave pelos pontos clicados); asfalto, concreto, brita, grama, areia e pintura
// pintam o chão dentro de um contorno (pit stop, estacionamento, escape...). Só desenho: não muda a corrida.
// Mundo da pista (x, y) -> Three (X = x, Z = y), Y pra cima.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { buildingMat } from "./pieces";
import { asphaltTexture, fenceTex, tyreBlockGeo, tyreStackGeo } from "./trackParts";

export type PathKind = "jersey" | "blocopneus" | "guardrail" | "muro" | "zebra" | "pneus" | "alambrado" | "faixa" | "asfalto" | "concreto" | "brita" | "grama" | "areia" | "pintura" | "agua" | "cais" | "construcao" | "rua" | "caminho";

export interface PathItem {
  t: PathKind;
  /** pontos clicados (x, z) */
  p: [number, number][];
  /** largura (zebra, faixa) ou altura (muro) */
  w?: number;
  c?: string;
  c2?: string;
  /** cantos retos (sem curva entre os pontos) */
  reto?: boolean;
  /** ordem do chão (maior fica por cima; sem: pela ordem padrão do tipo) */
  o?: number;
  /** veio do mapa real (OpenStreetMap) ou da beira da pista automática (zebras, escapes, brita) */
  src?: "mapa" | "pista";
  /** prédio: 0 janelas, 1 vidro espelhado, 2 parede lisa */
  v?: number;
}

interface PathDef {
  label: string;
  /** área que sobe (prédio pelo contorno): não entra na ordem do chão */
  solid?: boolean;
  /** área fechada (pinta o chão dentro) */
  area?: boolean;
  cores?: string[];
  /** largura/altura padrão, limites e o nome do ajuste */
  w?: [number, number, number, string];
}
export const PATHS: Record<PathKind, PathDef> = {
  guardrail: { label: "Guard-rail" },
  muro: { label: "Muro", cores: ["#d8d6cf"], w: [1.3, 0.5, 6, "Altura"] },
  zebra: { label: "Zebra", cores: ["#d8262b", "#f2f2f2"], w: [1.5, 0.5, 4, "Largura"] },
  jersey: { label: "Barreira de concreto", cores: ["#c9c7c0"] },
  pneus: { label: "Barreira de pneus", cores: ["#1c1c1c", "#f2f2f2"] },
  blocopneus: { label: "Blocos de pneus", cores: ["#1c1c1c", "#f2f2f2"] },
  alambrado: { label: "Alambrado" },
  faixa: { label: "Faixa pintada", cores: ["#f2f2f2"], w: [0.3, 0.1, 2, "Largura"] },
  asfalto: { label: "Chão: asfalto", area: true },
  concreto: { label: "Chão: concreto", area: true, cores: ["#a9aaa4"] },
  brita: { label: "Chão: brita", area: true, cores: ["#e08a3c"] },
  grama: { label: "Chão: grama", area: true, cores: ["#3f6a23"] },
  areia: { label: "Chão: areia", area: true, cores: ["#d9c48a"] },
  pintura: { label: "Chão: pintura (cor livre)", area: true, cores: ["#2f9e56"] },
  construcao: { label: "Prédio pelo contorno", area: true, solid: true, cores: ["#f1e2c6", "#c9c2b4"], w: [4, 1, 40, "Andares"] },
  rua: { label: "Rua", cores: ["#7b7d78"], w: [6, 2, 20, "Largura"] },
  caminho: { label: "Caminho / calçada", cores: ["#bba77e"], w: [2, 0.5, 8, "Largura"] },
  agua: { label: "Chão: água (mar, lago)", area: true, cores: ["#2f7fb5"] },
  cais: { label: "Cais (borda do porto)", cores: ["#b9b4a8"], w: [3, 1, 10, "Largura"] },
};
/** altura de cada chão (o asfalto da pista fica em 0,1: todos abaixo dele, menos a pintura) */
const AREA_Y: Partial<Record<PathKind, number>> = { agua: 0.01, grama: 0.03, areia: 0.06, brita: 0.065, concreto: 0.07, asfalto: 0.08, pintura: 0.115 };

/** ordem de um chão (o padrão: grama embaixo, depois areia, brita, concreto, asfalto) */
export const orderOf = (it: PathItem) => it.o ?? (AREA_Y[it.t] ?? 0.05) * 1000;

/** os pontos ao longo da linha, um a cada ~1 m (com curva suave, ou reto entre os cliques) */
export function samplePath(it: PathItem, step = 1): [number, number][] {
  const area = !!PATHS[it.t].area, p = it.p;
  if (p.length < 2) return p.slice();
  if (it.reto || p.length < 3) {
    const out: [number, number][] = [];
    const pts = area ? [...p, p[0]] : p;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    if (!area) out.push(pts[pts.length - 1]);
    return out;
  }
  const curve = new THREE.CatmullRomCurve3(
    p.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    area,
    "centripetal",
  );
  const n = Math.max(8, Math.ceil(curve.getLength() / step));
  return curve.getSpacedPoints(n).slice(0, area ? n : n + 1).map((v) => [v.x, v.z]);
}

const lam = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
/** material compartilhado (mesma cor e opções = o mesmo material) */
const matCache = new Map<string, THREE.Material>();
const M = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
  const key = color + "|" + JSON.stringify(extra, (_k, v) => (v && (v as THREE.Texture).isTexture ? (v as THREE.Texture).uuid : v));
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = lam(color, extra)));
  return m;
};
// (fator pequeno: ele cresce com o ângulo rasante e a pintura passava na frente da base dos pneus)
const over = (k: number) => ({ polygonOffset: true, polygonOffsetFactor: -Math.min(1, k), polygonOffsetUnits: -k * 3 });

/** parede em pé ao longo da linha */
function wall(pts: [number, number][], y0: number, y1: number, uvm = 2.5) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let d = 0;
  pts.forEach(([x, z], i) => {
    if (i) d += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    pos.push(x, y0, z, x, y1, z);
    uv.push(d / uvm, 0, d / uvm, (y1 - y0) / uvm);
    if (i) idx.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** faixa no chão ao longo da linha; com `cols`, um bloco de cor a cada `seg` m */
function band(pts: [number, number][], w: number, y: number, cols?: THREE.Color[], seg = 1) {
  const pos: number[] = [], col: number[] = [];
  let d = 0;
  const nrm = (i: number) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [(-dz / l) * (w / 2), (dx / l) * (w / 2)];
  };
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [nax, naz] = nrm(i - 1), [nbx, nbz] = nrm(i);
    const q = [ax + nax, y, az + naz, ax - nax, y, az - naz, bx + nbx, y, bz + nbz, bx - nbx, y, bz - nbz];
    pos.push(...q.slice(0, 3), ...q.slice(3, 6), ...q.slice(6, 9), ...q.slice(3, 6), ...q.slice(9, 12), ...q.slice(6, 9));
    if (cols) {
      const c = cols[Math.floor(d / seg) % cols.length];
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
    d += Math.hypot(bx - ax, bz - az);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (cols) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** caixinhas (postes) em cada ponto: uma malha só */
function posts(pts: [number, number][], every: number, w: number, h: number) {
  const gs: THREE.BufferGeometry[] = [];
  let d = every;
  for (let i = 0; i < pts.length; i++) {
    if (i) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d < every) continue;
    d = 0;
    gs.push(new THREE.BoxGeometry(w, h, w).translate(pts[i][0], h / 2, pts[i][1]));
  }
  return gs.length ? mergeGeometries(gs) : null;
}

let fenceT: THREE.Texture | null = null;
let asphT: THREE.Texture | null = null;

/** monta o objeto 3D de uma linha ou área (com `userData.path` = índice, pro clique do editor) */
export function buildPath(it: PathItem, index: number, shadows: boolean, areaY?: number, rank = 0): THREE.Object3D {
  const g = new THREE.Group();
  g.userData.path = index;
  const def = PATHS[it.t];
  const c1 = it.c ?? def.cores?.[0] ?? "#ffffff", c2 = it.c2 ?? def.cores?.[1] ?? "#ffffff";
  const w = it.w ?? def.w?.[0] ?? 1;
  const add = (geo: THREE.BufferGeometry | null, m: THREE.Material, cast = false) => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadows && cast;
    mesh.receiveShadow = shadows;
    mesh.userData.path = index;
    g.add(mesh);
  };
  if (def.solid) {
    // prédio com a forma desenhada (curva suave ou cantos retos), andares de 3 m, janelas ou vidro nas paredes
    if (it.p.length < 3) return g;
    const pts = samplePath(it, 1.5);
    const h = Math.max(1, Math.round(it.w ?? def.w![0])) * 3;
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: h, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    // (centro na origem: no relevo o prédio sobe inteiro pela altura do meio dele)
    geo.computeBoundingBox();
    const ctr = geo.boundingBox!.getCenter(new THREE.Vector3()).setY(0);
    geo.translate(-ctr.x, 0, -ctr.z);
    const mesh = new THREE.Mesh(geo, [M(c2), buildingMat(it.v ?? 0, c1)]);
    mesh.position.copy(ctr);
    mesh.userData.liftPoint = true;
    mesh.castShadow = mesh.receiveShadow = shadows;
    mesh.userData.path = index;
    g.add(mesh);
    return g;
  }
  if (def.area) {
    if (it.p.length < 3) return g;
    const pts = samplePath(it, 2);
    let geo: THREE.BufferGeometry = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
    // (o contorno sozinho dá triângulos enormes, que não dobram com o relevo: quebra em pedaços de até ~10 m;
    // a água fica plana)
    if (it.t !== "agua") geo = new TessellateModifier(10, 10).modify(geo);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, areaY ?? AREA_Y[it.t] ?? 0.05, 0);
    if (it.t === "asfalto") {
      // (o UV da forma já é em metros: a textura repete a cada 8 m)
      asphT ??= Object.assign(asphaltTexture(), {});
      asphT.repeat.set(1 / 8, 1 / 8);
      // (a ordem também vai no deslocamento de profundidade: só a altura de milímetros brigava de longe)
      add(geo, M("#ffffff", { map: asphT, side: THREE.DoubleSide, depthWrite: false, name: `chao${rank}` }));
    } else add(geo, M(c1, { side: THREE.DoubleSide, depthWrite: false, name: `chao${rank}` }));
    // (o chão não briga na profundidade: cada camada é pintada por cima da de baixo, e a pista e o resto depois)
    for (const o of g.children) o.renderOrder = -1000 + rank;
    return g;
  }
  if (it.p.length < 2) return g;
  const pts = samplePath(it, 1);
  const ds = { side: THREE.DoubleSide };
  switch (it.t) {
    case "jersey":
      // concreto de 0,9 m (os dois lados e o topo) com uma faixa vermelha
      add(wall(pts, 0, 0.9), M(c1, ds), true);
      add(band(pts, 0.3, 0.9), M(c1, ds));
      add(wall(pts, 0.55, 0.7), M("#e32222", { ...ds, ...over(1) }));
      break;
    case "guardrail":
      add(posts(pts, 2, 0.14, 0.85), M("#7d848b"), true);
      add(mergeGeometries([wall(pts, 0.42, 0.62), wall(pts, 0.66, 0.8)]), M("#b9c0c7", ds), true);
      break;
    case "muro":
      add(wall(pts, 0, w), M(c1, ds), true);
      add(band(pts, 0.35, w + 0.001), M(c1));
      break;
    case "alambrado":
      fenceT ??= fenceTex();
      add(wall(pts, 0, 1.0), M("#e2e4e6", ds), true);
      add(wall(pts, 1.0, 4.2), M("#ffffff", { map: fenceT, alphaTest: 0.35, ...ds }));
      add(posts(pts, 6, 0.16, 4.4), M("#6d737a"));
      break;
    case "zebra":
      add(band(pts, w, 0.13, [new THREE.Color(c1), new THREE.Color(c2)]), M("#ffffff", { vertexColors: true, ...ds, ...over(2) }));
      break;
    case "cais":
      // calçada do porto: borda de concreto com 0,6 m de altura
      add(band(pts, w, 0.6), M(c1, ds));
      add(wall(pts, 0, 0.6), M("#8f8a7f", ds), true);
      break;
    case "rua":
      // (ruas e caminhos também só pintados por cima do chão, antes da pista)
      add(band(pts, w, 0.097), M(c1, { ...ds, depthWrite: false }));
      for (const o of g.children) o.renderOrder = -500;
      break;
    case "caminho":
      add(band(pts, w, 0.098), M(c1, { ...ds, depthWrite: false }));
      for (const o of g.children) o.renderOrder = -499;
      break;
    case "faixa":
      add(band(pts, w, 0.125), M(c1, { ...ds, ...over(3) }));
      break;
    case "blocopneus": {
      // blocos de 2 m virados ao longo da linha, cinta preta e branca alternando
      // (pontos a cada 25 cm: um bloco a cada 2 m certinho, um encostado no outro)
      const fine = samplePath(it, 0.25);
      const spots: [number, number, number][] = [];
      let d = 1;
      for (let i = 1; i < fine.length; i++) {
        d += Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]);
        if (d < 2) continue;
        d -= 2;
        const a = fine[Math.max(0, i - 4)], b2 = fine[Math.min(fine.length - 1, i + 4)];
        spots.push([fine[i][0], fine[i][1], Math.atan2(b2[1] - a[1], b2[0] - a[0])]);
      }
      const im = new THREE.InstancedMesh(tyreBlockGeo(), M("#ffffff", { vertexColors: true }), Math.max(1, spots.length));
      im.count = spots.length;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      const ca = new THREE.Color(c1), cb = new THREE.Color(c2);
      spots.forEach(([x, z, h], i) => {
        im.setMatrixAt(i, m4.compose(v.set(x, 0, z), q.setFromAxisAngle(up, -h), one));
        im.setColorAt(i, i % 2 ? cb : ca);
      });
      im.castShadow = shadows;
      im.receiveShadow = shadows;
      im.userData.path = index;
      im.computeBoundingSphere();
      g.add(im);
      break;
    }
    case "pneus": {
      const tyre = tyreStackGeo();
      const spots: [number, number][] = [];
      let d = 0.7;
      for (let i = 0; i < pts.length; i++) {
        if (i) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (d < 0.7) continue;
        d = 0;
        spots.push(pts[i]);
      }
      const im = new THREE.InstancedMesh(tyre, M("#ffffff"), Math.max(1, spots.length));
      im.count = spots.length;
      const m4 = new THREE.Matrix4(), ca = new THREE.Color(c1), cb = new THREE.Color(c2);
      spots.forEach(([x, z], i) => {
        im.setMatrixAt(i, m4.makeTranslation(x, 0, z));
        im.setColorAt(i, Math.floor(i / 3) % 2 ? cb : ca);
      });
      im.castShadow = shadows;
      im.userData.path = index;
      im.computeBoundingSphere();
      g.add(im);
      break;
    }
  }
  return g;
}

/** todas as linhas e áreas de uma pista. As iguais (mesmo material) viram uma malha só, senão as milhares de
 *  ruas e parques do mapa real pesavam demais; o clique acha de qual linha é cada triângulo. */
export class PathLayer {
  group = new THREE.Group();
  private built: THREE.Object3D[] = [];
  private ys = new Map<number, [number, number]>();
  private merged: THREE.Mesh[] = [];
  private loose = new THREE.Group();
  constructor(
    public items: PathItem[],
    private shadows: boolean,
  ) {
    this.group.add(this.loose);
    this.rebuild();
  }
  /** altura de cada chão pela ordem (um pouco acima do outro; todos abaixo do asfalto da pista, em 0,1) */
  private areaYs() {
    // (camadas: uma por ordem diferente; chãos com a mesma ordem ficam na mesma camada)
    const ids = this.items.map((_, i) => i).filter((i) => PATHS[this.items[i].t].area && !PATHS[this.items[i].t].solid);
    const levels = [...new Set(ids.map((i) => orderOf(this.items[i])))].sort((a, b) => a - b);
    const ys = new Map<number, [number, number]>();
    for (const i of ids) {
      const lv = levels.indexOf(orderOf(this.items[i]));
      ys.set(i, [0.02 + Math.min(lv, 30) * 0.002, lv]);
    }
    return ys;
  }
  private build(i: number) {
    const it = this.items[i], y = this.ys.get(i);
    return buildPath(it, i, this.shadows, y?.[0], y?.[1]);
  }
  rebuild() {
    this.ys = this.areaYs();
    this.built = this.items.map((_, i) => this.build(i));
    this.remerge();
  }
  /** só a linha i mudou (chão novo: refaz a ordem de todos) */
  update(i: number) {
    const d = PATHS[this.items[i]?.t];
    if (i >= this.built.length || (d?.area && !d.solid && !this.ys.has(i))) return this.rebuild();
    this.built[i] = this.build(i);
    this.remerge();
  }
  private remerge() {
    for (const m of this.merged) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.merged = [];
    this.loose.clear();
    const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; owners: number[]; tris: number[]; cast: boolean; order: number }>();
    this.built.forEach((g, i) => {
      let inst = false;
      g.traverse((o) => ((o as THREE.InstancedMesh).isInstancedMesh ? (inst = true) : null));
      // (prédio e pneus ficam soltos: material próprio e instâncias)
      if (inst || PATHS[this.items[i].t].solid) return void this.loose.add(g);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.Material;
        let e = byMat.get(mat);
        if (!e) byMat.set(mat, (e = { geos: [], owners: [], tris: [], cast: false, order: m.renderOrder }));
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        e.geos.push(geo);
        e.owners.push(i);
        e.tris.push(geo.attributes.position.count / 3);
        e.cast ||= m.castShadow;
      });
    });
    for (const [mat, e] of byMat) {
      // (só os atributos que todos têm)
      const names = Object.keys(e.geos[0].attributes).filter((n) => e.geos.every((g) => g.attributes[n]));
      for (const g of e.geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      const geo = mergeGeometries(e.geos);
      for (const g of e.geos) g.dispose();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = e.order;
      mesh.castShadow = e.cast;
      mesh.receiveShadow = this.shadows;
      const starts: number[] = [];
      let acc = 0;
      for (const t of e.tris) {
        starts.push(acc);
        acc += t;
      }
      mesh.userData.ranges = { starts, owners: e.owners };
      this.merged.push(mesh);
      this.group.add(mesh);
    }
  }
  /** de qual linha é o que o clique acertou (-1: nenhuma) */
  pathAt(obj: THREE.Object3D, faceIndex?: number | null): number {
    if (obj.userData.path != null) return obj.userData.path as number;
    const r = obj.userData.ranges as { starts: number[]; owners: number[] } | undefined;
    if (!r || faceIndex == null) return -1;
    let lo = 0, hi = r.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (r.starts[mid] <= faceIndex) lo = mid;
      else hi = mid - 1;
    }
    return r.owners[lo];
  }
  /** põe o chão i por cima (+1) ou por baixo (-1) de todos */
  reorder(i: number, dir: 1 | -1) {
    const keys = this.items.filter((it) => PATHS[it.t].area && !PATHS[it.t].solid).map(orderOf);
    this.items[i].o = dir > 0 ? Math.max(...keys) + 1 : Math.min(...keys) - 1;
    this.rebuild();
  }
  objOf(i: number) {
    return this.built[i];
  }
}
