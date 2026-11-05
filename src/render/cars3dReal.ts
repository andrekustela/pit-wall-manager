// Carros em 3D de verdade (Three.js) na vista de cima da corrida: o modelo do Blender
// (public/car3d/carro.glb, art/export_carro_glb.py) com as peças separadas (asas e rodas), pintado
// com as cores da equipe. A pista continua 2D: a camada 3D é desenhada por cima dela, na mesma escala
// e no mesmo enquadramento (câmera ortogonal olhando pra baixo). O Three.js só é baixado se o modo
// "3D" estiver ligado.
import { gearOf } from "./gear";
import { buildSafetyCar } from "./safetyCar";
import { WET, takeTrack3d } from "./track3d";
import { WALL_PATHS, WALL_PIECES, wallPoints } from "../sim/walls";
import { GLOVE_RULES, HELMET_RULES, SHOE_RULES, SUIT_RULES } from "./uniformStyles";
import { SEE, type PieceLayer } from "./pieces";

/** linhas e peças que são barreira de verdade (a corrida bate nelas) */
import type { Track } from "../sim/track";
import { COMPOUNDS, type Compound } from "../sim/types";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { setScreenSource, updateLiveScreen } from "./liveScreen";
import type { Terrain } from "./terrain";
import type { Race } from "../sim/race";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Team } from "../sim/types";
import type { CarLook } from "./car3d";
import { SCENE_LOD_DIST, gfx } from "./gfx";
import { patternShapes, stickerShape } from "./carArt";
import { MAX_STICKERS, liveryKey, type Livery } from "../sim/livery";
import { SPOT_COLOR, type Part as FxPart, type Skid, type Spot } from "./carFx";
import { Billboards, rgbOf, type Billboard } from "./fx3d";
import type { GroundSrc } from "./ground";
import { orderOf, samplePath } from "./paths3d";

/** comprimento do carro na pista (m): o mesmo porte dos outros modos */
const SHOW_LEN = 4.8;
const PARTS = ["corpo", "asa_d", "asa_t", "roda_fe", "roda_fd", "roda_te", "roda_td"] as const;
type Part = (typeof PARTS)[number];

/**
 * câmera da TV (MultiCam): fixa = parada no mundo (x, y; h m de altura) olhando o carro; presa = anda com o carro
 * (back m atrás, side m pro lado, h m acima; olha look m à frente dele). fov = lente (menor = mais zoom)
 */
export interface CamSpec {
  fixa: boolean;
  x: number;
  y: number;
  h: number;
  back: number;
  side: number;
  fov: number;
  look: number;
  /** presa girando em volta do carro: rad/s (a distância é back) */
  orbit?: number;
}

export interface CarDraw {
  id: string;
  team: Team;
  /** posição (m, mundo da pista) e direção (rad, igual ao 2D) */
  x: number;
  y: number;
  h: number;
  /** 1 = no chão; > 1 = no ar (guindaste) */
  scale: number;
  look: CarLook;
  /** velocidade (m/s), pra girar as rodas */
  v: number;
  /** guindaste: 0 no chão, 1 lá em cima (acima da cabine do caminhão) */
  lift?: number;
  /** composto do pneu: a capa da roda leva a cor dele (como a faixa colorida do pneu de verdade) */
  compound: Compound;
  /** macaco do box: quanto o carro está levantado (m; negativo = o quique na saída) */
  jack?: number;
  /** DRS: 0 fechada, 1 aberta (a aba de cima da asa traseira gira: drsFlap) */
  drs?: number;
  /** parado no box: 0..1 da parada (mecânicos em volta); -1 fora */
  pit?: number;
}

/**
 * divide as malhas de uma asa em metade esquerda (+X) e direita pelo meio de cada triângulo: a asa quebrada pela
 * metade esconde só o lado que voou (antes a asa inteira ficava no carro e uma cópia inteira voava)
 */
function splitHalves(part: THREE.Object3D, wing: string): THREE.Mesh[] {
  part.updateMatrixWorld(true);
  const inv = part.matrixWorld.clone().invert(), M = new THREE.Matrix4(), v = new THREE.Vector3(), out: THREE.Mesh[] = [];
  const meshes: THREE.Mesh[] = [];
  part.traverse((o) => ((o as THREE.Mesh).isMesh ? meshes.push(o as THREE.Mesh) : null));
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry, pos = g.attributes.position;
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
    M.multiplyMatrices(inv, m.matrixWorld);
    const side: [number[], number[]] = [[], []];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      let x = 0;
      for (let k = 0; k < 3; k++) x += v.fromBufferAttribute(pos, idx[i + k]).applyMatrix4(M).x;
      side[x >= 0 ? 0 : 1].push(idx[i], idx[i + 1], idx[i + 2]);
    }
    m.userData.wing = wing;
    out.push(m);
    if (!side[0].length || !side[1].length) {
      m.userData.half = side[0].length ? "l" : "r";
      continue;
    }
    const r = m.clone();
    r.geometry = g.clone();
    r.geometry.setIndex(side[1]);
    r.userData = { wing, half: "r" };
    m.geometry = g.clone();
    m.geometry.setIndex(side[0]);
    m.userData.half = "l";
    m.parent!.add(r);
    out.push(r);
  }
  return out;
}

interface CarObj {
  root: THREE.Group;
  parts: Record<Part, THREE.Object3D>;
  /** as metades das asas (userData.wing = "asa_d"/"asa_t", userData.half = "l"/"r") */
  halves?: THREE.Mesh[];
  key: string;
  spin: number;
  seen: number;
  tyre: string;
  covers: THREE.Mesh[];
  /** tracinhos do pneu e recortes da tampa: somem em alta velocidade (girando rápido piscavam, como roda de
   * carroça em filme; câmera de verdade borra) */
  strobe?: THREE.Mesh[];
  /** o borrão (anel claro) que aparece no lugar deles */
  blurs?: THREE.Mesh[];
  /** onde o carro estava no quadro anterior (o giro das rodas sai do quanto ele andou na tela) */
  lastX?: number;
  lastZ?: number;
  /** velocidade do quadro anterior e aceleração filtrada (o bico afunda na freada) */
  lastV?: number;
  accSm?: number;
  rings: THREE.Mesh[];
  /** volante e braços do piloto (giram com o esterço, em volta do centro do volante) e capacete (inclina) */
  steer?: THREE.Object3D;
  arms?: THREE.Object3D;
  head?: THREE.Object3D;
  /** peças do freio da frente que só esterçam (não giram) */
  brakes?: THREE.Object3D[];
  /** piloto com as poses do volante virado (art/export_carro_glb.py: morph "giro_mais" e "giro_menos") */
  driver?: THREE.Mesh[];
  /** telinha do volante: marcha e velocidade (só no carro detalhado da câmera piloto) */
  screen?: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; t: number };
  /** DRS: a aba de cima da asa traseira, no pivô da dobradiça (drsFlap) */
  flap?: THREE.Object3D;
  /** freio: o calor (0..1, sobe nas freadas fortes) e os recortes da tampa da roda, que brilham vermelhos */
  heat?: number;
  glow?: THREE.Mesh[];
}

/**
 * MECÂNICOS DO BOX (só no 3D): 9 bonecos simples com o macacão da cor da equipe em volta do carro parado — os quatro
 * das pistolas ajoelhados nas rodas, o do macaco da frente e o de trás, dois segurando o carro e o do pirulito na
 * frente (placa vermelha; verde quando solta). Ficam onde o carro parou e somem 1,5 s depois de ele sair
 */
const crewGeo = {
  torso: new THREE.BoxGeometry(0.44, 0.62, 0.26),
  head: new THREE.SphereGeometry(0.14, 10, 8),
  leg: new THREE.BoxGeometry(0.16, 0.78, 0.18),
  arm: new THREE.BoxGeometry(0.11, 0.6, 0.12),
  gun: new THREE.BoxGeometry(0.1, 0.1, 0.32),
  pole: new THREE.CylinderGeometry(0.02, 0.02, 1.6, 5),
  sign: new THREE.CylinderGeometry(0.28, 0.28, 0.03, 16),
};
const crewMats = new Map<string, THREE.MeshLambertMaterial>();
const crewMat = (c: string) => {
  let m = crewMats.get(c);
  if (!m) crewMats.set(c, (m = new THREE.MeshLambertMaterial({ color: c })));
  return m;
};
/** um mecânico (frente pra +Z): tronco, cabeça (capacete), pernas e braços; "arms" pra animar */
function mechanic(suit: string, helmet: string) {
  const g = new THREE.Group(), sm = crewMat(suit), dk = crewMat(new THREE.Color(suit).multiplyScalar(0.55).getStyle());
  const torso = new THREE.Mesh(crewGeo.torso, sm);
  torso.position.y = 1.1;
  torso.castShadow = true;
  const head = new THREE.Mesh(crewGeo.head, crewMat(helmet));
  head.position.y = 1.56;
  const legs = [-0.11, 0.11].map((x) => {
    const l = new THREE.Mesh(crewGeo.leg, dk);
    l.position.set(x, 0.4, 0);
    return l;
  });
  const arms = [-0.29, 0.29].map((x) => {
    const pv = new THREE.Object3D();
    pv.position.set(x, 1.38, 0);
    const a = new THREE.Mesh(crewGeo.arm, sm);
    a.position.y = -0.28;
    pv.add(a);
    return pv;
  });
  g.add(torso, head, ...legs, ...arms);
  g.userData.arms = arms;
  return g;
}

/**
 * DRS: separa a aba de cima da asa traseira (os triângulos da malha "asa" atrás do plano principal, acima de y 0,30
 * e entre as placas laterais; medido no perfil da malha) e põe num pivô na dobradiça, na borda de trás:
 * girando, a frente da aba sobe e abre a fenda, como na F1. A divisão é feita uma vez por malha (fica no userData)
 */
export function drsFlap(wing: THREE.Object3D | undefined): THREE.Object3D | undefined {
  let pivot: THREE.Object3D | undefined;
  wing?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (pivot || !mesh.isMesh || (mesh.material as THREE.Material).name !== "asa") return;
    const geo = mesh.geometry;
    let sp = geo.userData.drs as { rest: THREE.BufferGeometry; flap: THREE.BufferGeometry; hinge: THREE.Vector3 } | undefined;
    if (!sp) {
      const src = geo.index ? geo.toNonIndexed() : geo, pos = src.attributes.position, n = pos.count;
      // (a aba é soldada na malha principal da asa; as aletas finas em pé por cima dela são pedaços soltos e ficam
      // paradas: pedaços pelos pontos em comum, só entra o maior)
      const ids = new Map<string, number>(), par: number[] = [], tv: number[] = [];
      const find = (x: number) => {
        while (par[x] !== x) x = par[x] = par[par[x]];
        return x;
      };
      for (let i = 0; i < n; i++) {
        const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
        let v = ids.get(k);
        if (v === undefined) ids.set(k, (v = par.push(par.length) - 1));
        tv.push(v);
      }
      for (let t = 0; t + 2 < n; t += 3) {
        par[find(tv[t + 1])] = find(tv[t]);
        par[find(tv[t + 2])] = find(tv[t]);
      }
      const size = new Map<number, number>();
      for (let t = 0; t < n; t += 3) size.set(find(tv[t]), (size.get(find(tv[t])) ?? 0) + 1);
      const main = [...size].sort((x, y) => y[1] - x[1])[0]?.[0];
      // aba: atrás do plano principal (z < -0,04), no alto (y > 0,30) e entre as placas laterais (|x| < 0,88)
      const inFlap = (i: number) => pos.getY(i) > 0.3 && Math.abs(pos.getX(i)) < 0.88 && pos.getZ(i) < -0.04;
      const keepA: number[] = [], flapA: number[] = [];
      for (let t = 0; t + 2 < n; t += 3) (find(tv[t]) === main && inFlap(t) && inFlap(t + 1) && inFlap(t + 2) ? flapA : keepA).push(t, t + 1, t + 2);
      if (flapA.length < 30) return;
      const pick = (ids: number[]) => {
        const g = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(src.attributes)) {
          const at = a as THREE.BufferAttribute, arr = new (at.array.constructor as Float32ArrayConstructor)(ids.length * at.itemSize);
          ids.forEach((i, j) => {
            for (let c = 0; c < at.itemSize; c++) arr[j * at.itemSize + c] = at.array[i * at.itemSize + c];
          });
          g.setAttribute(k, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
        }
        return g;
      };
      // dobradiça: na borda de trás da aba (o menor z), na altura média dela
      let zMin = Infinity;
      for (const i of flapA) zMin = Math.min(zMin, pos.getZ(i));
      let yS = 0, yN = 0;
      for (const i of flapA)
        if (pos.getZ(i) < zMin + 0.03) {
          yS += pos.getY(i);
          yN++;
        }
      sp = { rest: pick(keepA), flap: pick(flapA), hinge: new THREE.Vector3(0, yS / Math.max(1, yN), zMin) };
      geo.userData.drs = sp;
    }
    mesh.geometry = sp.rest;
    pivot = new THREE.Object3D();
    pivot.name = "drs";
    pivot.position.copy(sp.hinge);
    const fm = new THREE.Mesh(sp.flap, mesh.material);
    fm.name = mesh.name + "_drs";
    fm.position.copy(sp.hinge).negate();
    fm.castShadow = mesh.castShadow;
    pivot.add(fm);
    mesh.add(pivot);
  });
  return pivot;
}

let model: THREE.Group | null = null;
let loading = false;
let fit = 1;
// versão detalhada (public/car3d/carro_hd.glb, art/export_carro_glb.py com PWM_HD=1): só o carro seguido
// na câmera piloto, que fica a centímetros da câmera (o normal, simplificado pra 20 carros, ficava facetado)
let modelHd: THREE.Group | null = null;
let fitHd = 1;
let loadingHd = false;
function loadHd() {
  if (loadingHd) return;
  loadingHd = true;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader
    .loadAsync("/car3d/carro_hd.glb")
    .then((g) => {
      const box = new THREE.Box3().setFromObject(g.scene);
      fitHd = SHOW_LEN / (box.max.z - box.min.z);
      paintUV(g.scene, box);
      modelHd = g.scene;
    })
    .catch(() => {
      /* sem o arquivo: fica o normal */
    });
}
// versão leve (carro_lo.glb): carros longe da câmera nas câmeras 3D (de longe ninguém vê o detalhe, e os
// 20 carros completos pesavam tanto quanto o autódromo inteiro)
let modelLo: THREE.Group | null = null;
let fitLo = 1;
let loadingLo = false;
function loadLo() {
  if (loadingLo) return;
  loadingLo = true;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader
    .loadAsync("/car3d/carro_lo.glb")
    .then((g) => {
      const box = new THREE.Box3().setFromObject(g.scene);
      fitLo = SHOW_LEN / (box.max.z - box.min.z);
      paintUV(g.scene, box);
      modelLo = g.scene;
    })
    .catch(() => {
      /* sem o arquivo: todos com o normal */
    });
}
/** capacete no carro montado (m): à frente do meio (+), altura do topo dele e do topo do carro (tomada de ar) */
let helmet: { z: number; top: number; car: number } | null = null;

function load() {
  if (loading) return;
  loading = true;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader
    .loadAsync(`/car3d/${{ baixo: "carro_lo", medio: "carro", alto: "carro_hd" }[gfx().carQ]}.glb`)
    .then((g) => {
      const box = new THREE.Box3().setFromObject(g.scene);
      fit = SHOW_LEN / (box.max.z - box.min.z);
      paintUV(g.scene, box);
      model = g.scene;
    })
    .catch(() => {
      /* sem o arquivo: o renderer usa as imagens */
    });
}

// desenho da pintura (faixas, xadrez...): projetado de cima na carroceria, igual ao do 2D estilizado
// (128 px por metro: de perto, na câmera piloto, 64 ficava borrado)
const PAD = 0.15, TEX_PX = 128;
/** caixa da textura da pintura (a do primeiro modelo carregado; os outros mapeiam na proporção deles) */
let paintBox: { cx: number; cz: number; L: number; W: number; slope: number; yLo: number; H: number } | null = null;
/**
 * coordenadas de textura da carroceria pintada vindo de cima (frente = x da imagem, lado direito = y).
 * O meio de lado é o EIXO da carroceria pintada: o modelo vem levemente girado (o meio vai de x 0,07 na
 * traseira a 0,04 no bico), então o eixo é uma reta ajustada no meio de cada fatia de 25 cm, e não um
 * centro só (a faixa saía torta no bico). Cada modelo (leve, normal, detalhado) mapeia pela caixa dele,
 * em fração, e todos usam a mesma textura
 */
export function paintUV(root: THREE.Object3D, box: THREE.Box3) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const bodies: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).name === "pintura") bodies.push(mesh);
  });
  // fatias: menor e maior x de cada 25 cm de comprimento
  const bins = new Map<number, [number, number, number]>();
  let yMin = Infinity, yMax = -Infinity;
  for (const mesh of bodies) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
      const k = Math.floor(v.z * 4), b = bins.get(k);
      if (b) {
        b[0] = Math.min(b[0], v.x);
        b[1] = Math.max(b[1], v.x);
        b[2]++;
      } else bins.set(k, [v.x, v.x, 1]);
    }
  }
  // reta x = a + b*z pelos meios das fatias com pontos e largura de sobra
  let n = 0, sz = 0, sx = 0, szz = 0, szx = 0;
  for (const [k, [x0, x1, cnt]] of bins) {
    if (cnt < 30 || x1 - x0 < 0.1) continue;
    const z = (k + 0.5) / 4, x = (x0 + x1) / 2;
    n++;
    sz += z;
    sx += x;
    szz += z * z;
    szx += z * x;
  }
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const slope = n > 2 ? (n * szx - sz * sx) / (n * szz - sz * sz) : 0;
  const cx = n > 2 ? (sx - slope * sz) / n + slope * c.z : c.x;
  // (largura simétrica em volta do eixo)
  const half = Math.max(box.max.x - cx, cx - box.min.x);
  const mine = { cx, cz: c.z, L: size.z + 2 * PAD, W: 2 * half + 2 * PAD, slope, yLo: yMin - 0.08, H: yMax - yMin + 0.16 };
  paintBox ??= mine;
  const axisAt = (z: number) => mine.cx + slope * (z - mine.cz);
  const lats = wrapLateral(bodies, axisAt);
  const nw = new THREE.Vector3();
  const frame = { cx: mine.cx, cz: mine.cz, slope, y0: yMin };
  root.userData.carFrame = frame;
  bodies.forEach((mesh, bi) => {
    const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal;
    const uv = new Float32Array(pos.count * 2), car = new Float32Array(pos.count * 3), carN = new Float32Array(pos.count * 3);
    const lat = lats[bi], nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      // (o lado direito do carro é -X no modelo; a textura vira de cabeça pra baixo no WebGL)
      uv[i * 2] = (v.z - (mine.cz - mine.L / 2)) / mine.L;
      uv[i * 2 + 1] = 1 - (mine.W / 2 - lat[i]) / mine.W;
      // ponto e direção no espaço do carro (Decal): os adesivos 3D são projetados por eles
      carFrame(frame, v).toArray(car, i * 3);
      if (nor) nw.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      else nw.set(0, 1, 0);
      nw.toArray(carN, i * 3);
    }
    mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    mesh.geometry.setAttribute("aCar", new THREE.BufferAttribute(car, 3));
    mesh.geometry.setAttribute("aCarN", new THREE.BufferAttribute(carN, 3));
  });
}

/** ponto do modelo (sem escala) -> espaço do carro dos adesivos 3D (Decal: x de lado a partir do eixo, y acima do
 *  ponto mais baixo da carroceria, z a partir do meio). Muda `v` */
export function carFrame(f: { cx: number; cz: number; slope: number; y0: number }, v: THREE.Vector3) {
  return v.set(v.x - (f.cx + f.slope * (v.z - f.cz)), v.y - f.y0, v.z - f.cz);
}

/**
 * lateral de cada ponto da carroceria pra textura (m, com sinal: + = lado esquerdo, +X). Fatia por fatia
 * (25 cm), acha a BORDA mais larga de cada lado (largura e altura dela). Acima da borda vale a projeção de
 * cima de sempre (distância até o eixo); abaixo, o desenho continua descendo pela lateral na medida da
 * superfície (largura da borda + quanto desceu + quanto voltou pra dentro), sem virar listra esticada.
 * A volta pra dentro entra aos poucos nos primeiros 5 cm (sem degrau em peça de dentro na altura da borda)
 */
function wrapLateral(bodies: THREE.Mesh[], axisAt: (z: number) => number): Float32Array[] {
  const v = new THREE.Vector3();
  // borda por fatia e lado: [largura, altura]
  const edge = new Map<number, [number, number]>();
  for (const mesh of bodies) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const dx = v.x - axisAt(v.z), key = Math.floor(v.z * 4) * 2 + (dx >= 0 ? 1 : 0);
      const e = edge.get(key);
      if (!e || Math.abs(dx) > e[0]) edge.set(key, [Math.abs(dx), v.y]);
    }
  }
  // (entre os meios de duas fatias, mistura linear; fatia vazia usa a vizinha)
  const at = (k: number, s: number) => edge.get(k * 2 + s) ?? edge.get((k - 1) * 2 + s) ?? edge.get((k + 1) * 2 + s);
  const prof = (z: number, s: number): [number, number] | undefined => {
    const t = z * 4 - 0.5, k = Math.floor(t), f = t - k;
    const a = at(k, s), b = at(k + 1, s);
    if (!a || !b) return a ?? b;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  const n = new THREE.Vector3();
  return bodies.map((mesh) => {
    const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal, out = new Float32Array(pos.count);
    const fade = new Float32Array(pos.count), nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const dx = v.x - axisAt(v.z), s = dx >= 0 ? 1 : 0, d = Math.abs(dx), p = prof(v.z, s);
      if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      else n.set(0, 1, 0);
      let L = d;
      // (só desce pela lateral o que não olha pra cima: o topo do chassi entre os sidepods fica abaixo da borda
      // deles e é visto de cima — puxava desenho de longe, borrão na frente do cockpit)
      if (p && v.y < p[1]) {
        const down = p[1] - v.y, w = Math.min(1, down / 0.05) * (1 - Math.min(1, Math.max(0, (n.y - 0.3) / 0.3)));
        L = d + (down + Math.max(0, p[0] - d)) * w;
      }
      out[i] = (s ? 1 : -1) * L;
      // desbotar pra cor de base onde a projeção de cima estica: superfície quase em pé que não olha pro lado de
      // fora (lá o desenho desce pela lateral): a frente do cockpit, as paredes de dentro, a boca do sidepod
      const steep = Math.min(1, Math.max(0, (0.45 - Math.abs(n.y)) / 0.25)), outward = n.x * (s ? 1 : -1);
      fade[i] = steep * (1 - Math.min(1, Math.max(0, (outward - 0.5) / 0.3)));
    }
    mesh.geometry.setAttribute("aFade", new THREE.BufferAttribute(fade, 1));
    return out;
  });
}



/** tela da textura da pintura e o encaixe das formas (metros do carro 2D, bico em +2,4 m): o mesmo do 2D estilizado */
function paintCanvas() {
  const pb = paintBox ?? { L: 5.1, W: 2.3 };
  const cv = document.createElement("canvas");
  cv.width = Math.round(pb.L * TEX_PX);
  cv.height = Math.round(pb.W * TEX_PX);
  const g = cv.getContext("2d")!;
  return { cv, g, fit: () => g.setTransform(TEX_PX * 1.02, 0, 0, TEX_PX, cv.width / 2 + 0.25 * TEX_PX, cv.height / 2) };
}

function canvasTex(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** a pintura da equipe vista de cima (cor de base + desenho), no tamanho da caixa do carro */
export function paintTexture(team: Team): THREE.CanvasTexture {
  const lv = team.livery;
  const { cv, g, fit } = paintCanvas();
  g.fillStyle = lv?.base ?? team.color;
  g.fillRect(0, 0, cv.width, cv.height);
  fit();
  if (!lv || lv.pattern === "classica") {
    g.beginPath();
    g.moveTo(-2.3, -0.07);
    g.lineTo(0.3, -0.11);
    g.lineTo(2.4, -0.035);
    g.lineTo(2.4, 0.035);
    g.lineTo(0.3, 0.11);
    g.lineTo(-2.3, 0.07);
    g.closePath();
    g.fillStyle = lv?.patternColor ?? team.accent;
    g.fill();
  } else patternShapes(g, lv);
  return canvasTex(cv);
}

// ---- adesivos 3D (Decal): projetados na carroceria pela direção dela, como um adesivo de verdade ----
// Cada um vira 4 linhas numa textura de números (centro e alcance; eixo da direita do desenho e qual é; eixo de cima e
// quanto entra; direção da superfície e quanto sai) e o desenho dele numa casa de um atlas (DEC_TILE px).
// O shader da pintura testa cada ponto contra cada adesivo: sem malha nova e igual nos 3 modelos (leve/normal/HD)
/** linhas da textura de números: os espelhados (m) contam 2 */
const DEC_MAX = MAX_STICKERS * 2, DEC_TILE = 256, DEC_COLS = 8, DEC_ROWS = Math.ceil(MAX_STICKERS / DEC_COLS);
/** o desenho ocupa 90% da casa (a borda vazia evita puxar o vizinho no mipmap) */
const DEC_FILL = 0.9;

/**
 * cada adesivo 3D (e a cópia do outro lado) pronto pra projetar: centro c, U = direita do desenho e V = cima (de
 * quem olha de fora, unitários), direção n da superfície, tamanho s (m) e `i` = qual adesivo da lista.
 * O "cima" do desenho: na lateral, pro céu; em cima do carro, pro outro lado (lido de quem está do lado mais perto);
 * no bico e na traseira (de frente/de costas), pro céu.
 * A cópia do outro lado (m): texto e número refeitos lá (continuam legíveis); desenho = o reflexo de verdade (o
 * coração com a ponta pra direita do desenho, refeito, apontava pro lado contrário do original)
 */
export function decalFrames(lv: Livery | undefined) {
  const out: { i: number; c: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3; s: number }[] = [];
  const Y = new THREE.Vector3(0, 1, 0), Zf = new THREE.Vector3(0, 0, 1), Zb = new THREE.Vector3(0, 0, -1);
  const mx = (a: THREE.Vector3) => new THREE.Vector3(-a.x, a.y, a.z);
  (lv?.decals ?? []).forEach((d, i) => {
    if (d.h) return;
    const base = (n: THREE.Vector3, r: number) => {
      const v = new THREE.Vector3().crossVectors(n, n.x > 0 ? Zb : Zf);
      if (v.lengthSq() < 0.04) v.copy(Y).addScaledVector(n, -n.dot(Y));
      v.normalize().applyAxisAngle(n, r);
      const u = new THREE.Vector3().crossVectors(v, n);
      // (espelhado ↔ / invertido ↕: o desenho virado na casa dele)
      if (d.fx) u.negate();
      if (d.fy) v.negate();
      return { u, v };
    };
    const n = new THREE.Vector3(...d.n).normalize(), c = new THREE.Vector3(...d.p), f = base(n, d.r);
    out.push({ i, c, ...f, n, s: d.s });
    if (!d.m) return;
    // (no texto o giro também espelha)
    const nm = mx(n), text = d.k === "texto" || d.k === "numero";
    out.push({ i, c: mx(c), ...(text ? base(nm, -d.r) : { u: mx(f.u), v: mx(f.v) }), n: nm, s: d.s });
  });
  return out;
}
/** quanto o adesivo alcança pra DENTRO da superfície (m): pega a curva da carroceria sem vazar pra peça de dentro
 *  (a lateral da tampa do motor, ~30 cm pra dentro do sidepod) */
const decIn = (s: number) => Math.min(0.15, Math.max(0.04, s * 0.35));
/** e pra FORA (m): sobe num ressalto da carroceria (o sidepod estufado acima do ponto colado), sem cortar reto */
const decOut = (s: number) => Math.min(0.5, Math.max(0.06, s * 0.8));

/** o desenho dos adesivos 3D, cada um numa casa (cor, tipo e texto) */
function decalAtlas(lv: Livery) {
  const cv = document.createElement("canvas");
  cv.width = DEC_COLS * DEC_TILE;
  cv.height = DEC_ROWS * DEC_TILE;
  const g = cv.getContext("2d")!;
  (lv.decals ?? []).forEach((d, i) => {
    const k = DEC_TILE * DEC_FILL;
    g.setTransform(k, 0, 0, k, ((i % DEC_COLS) + 0.5) * DEC_TILE, (Math.floor(i / DEC_COLS) + 0.5) * DEC_TILE);
    g.fillStyle = d.c;
    stickerShape(g, d, lv);
  });
  const t = canvasTex(cv);
  // (com o alfa já multiplicado: na borda do desenho não aparece contorno escuro)
  t.premultiplyAlpha = true;
  return t;
}

type DecalUniforms = { data: { value: THREE.DataTexture }; atlas: { value: THREE.Texture }; n: { value: number }; sel: { value: number }; look: string };
const decalsOf = new WeakMap<THREE.Material, DecalUniforms>();
/**
 * põe (ou troca) os adesivos 3D de `lv` na pintura `mat` (feita por paintMaterial). sel = adesivo com contorno
 * (o escolhido no editor; -1 = nenhum). O desenho só é refeito quando muda o que aparece (não ao arrastar)
 */
export function setDecals(mat: THREE.Material, lv: Livery | undefined, sel = -1) {
  const u = decalsOf.get(mat);
  if (!u) return;
  const fr = decalFrames(lv), a = u.data.value.image.data as unknown as Float32Array;
  a.fill(0);
  fr.forEach((f, row) => {
    const o = row * 16;
    f.c.toArray(a, o);
    a[o + 3] = f.s * 0.75 + decOut(f.s);
    f.u.clone().divideScalar(f.s).toArray(a, o + 4);
    a[o + 7] = f.i;
    f.v.clone().divideScalar(f.s).toArray(a, o + 8);
    a[o + 11] = decIn(f.s);
    f.n.toArray(a, o + 12);
    a[o + 15] = decOut(f.s);
  });
  u.data.value.needsUpdate = true;
  u.n.value = fr.length;
  u.sel.value = sel;
  const look = JSON.stringify((lv?.decals ?? []).map((d) => [d.k, d.c, d.t])) + (lv?.number ?? "");
  if (lv?.decals?.length && look !== u.look) {
    u.atlas.value.dispose();
    u.atlas.value = decalAtlas(lv);
    u.look = look;
  }
}

/** material da carroceria com a pintura da equipe (cor e desenho na textura, adesivos 3D projetados por cima) */
export function paintMaterial(base: THREE.Material, team: Team): THREE.MeshStandardMaterial {
  const c = (base as THREE.MeshStandardMaterial).clone();
  c.name = base.name;
  c.map = paintTexture(team);
  c.color.set("#ffffff");
  const data = new THREE.DataTexture(new Float32Array(4 * 4 * DEC_MAX), 4, DEC_MAX, THREE.RGBAFormat, THREE.FloatType);
  const u: DecalUniforms = { data: { value: data }, atlas: { value: new THREE.Texture() }, n: { value: 0 }, sel: { value: -1 }, look: "" };
  decalsOf.set(c, u);
  setDecals(c, team.livery);
  c.addEventListener("dispose", () => {
    data.dispose();
    u.atlas.value.dispose();
  });
  // (onde a projeção de cima estica, aFade de paintUV: o desenho vira a cor de base)
  const bc = new THREE.Color(team.livery?.base ?? team.color);
  c.onBeforeCompile = (sh) => {
    sh.uniforms.uBase = { value: bc };
    sh.uniforms.uDecData = u.data;
    sh.uniforms.uDecAtlas = u.atlas;
    sh.uniforms.uDecN = u.n;
    sh.uniforms.uDecSel = u.sel;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFade;\nvarying float vFade;\nattribute vec3 aCar;\nattribute vec3 aCarN;\nvarying vec3 vCar;\nvarying vec3 vCarN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = aFade;\nvCar = aCar;\nvCarN = aCarN;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;\nuniform vec3 uBase;\nvarying vec3 vCar;\nvarying vec3 vCarN;\nuniform highp sampler2D uDecData;\nuniform sampler2D uDecAtlas;\nuniform int uDecN;\nuniform int uDecSel;")
      .replace("#include <map_fragment>", `#include <map_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uBase, vFade);
{
  // (a variação do ponto na tela, fora do laço: o mipmap do atlas sai certo mesmo com o "continue")
  vec3 dpx = dFdx(vCar), dpy = dFdy(vCar), cn = normalize(vCarN);
  const vec2 GRID = vec2(${DEC_COLS}.0, ${DEC_ROWS}.0);
  vec2 sc = ${DEC_FILL} / GRID;
  for (int i = 0; i < ${DEC_MAX}; i++) {
    if (i >= uDecN) break;
    vec4 c0 = texelFetch(uDecData, ivec2(0, i), 0);
    vec3 d = vCar - c0.xyz;
    if (dot(d, d) > c0.w * c0.w) continue;
    vec4 c1 = texelFetch(uDecData, ivec2(1, i), 0), c2 = texelFetch(uDecData, ivec2(2, i), 0), c3 = texelFetch(uDecData, ivec2(3, i), 0);
    float face = dot(cn, c3.xyz), h = dot(d, c3.xyz);
    if (face < -0.1 || h > c3.w || -h > c2.w) continue;
    vec2 st = vec2(dot(d, c1.xyz), dot(d, c2.xyz));
    // DOBRANDO A CURVA: onde a carroceria vira pra longe do adesivo, a projeção reta esticava o desenho. Conta o
    // comprimento pela superfície: num arco, virou θ e afastou h do plano -> andou h·(θ - sen θ)/(1 - cos θ) a
    // mais que a projeção, na direção pra onde ela virou
    vec3 tl = cn - c3.xyz * face;
    vec2 t2 = vec2(dot(tl, c1.xyz), dot(tl, c2.xyz));
    float tq = length(t2), th = acos(clamp(face, -1.0, 1.0)), oc = 1.0 - cos(th);
    if (tq > 1e-5) {
      t2 /= tq;
      float g = oc > 1e-4 ? (th - sin(th)) / oc : th / 3.0;
      st += t2 * sign(dot(st, t2)) * abs(h) * g * length(c1.xyz);
    }
    st += 0.5;
    if (st.x < 0.0 || st.y < 0.0 || st.x > 1.0 || st.y > 1.0) continue;
    vec2 cell = vec2(mod(c1.w, GRID.x), floor(c1.w / GRID.x));
    vec2 uv = vec2((cell.x + 0.5 + (st.x - 0.5) * ${DEC_FILL}) / GRID.x, 1.0 - (cell.y + 0.5 - (st.y - 0.5) * ${DEC_FILL}) / GRID.y);
    vec4 col = textureGrad(uDecAtlas, uv, vec2(dot(dpx, c1.xyz), dot(dpx, c2.xyz)) * sc, vec2(dot(dpy, c1.xyz), dot(dpy, c2.xyz)) * sc);
    // (some aos poucos onde a carroceria vira de lado em relação ao adesivo)
    float f = smoothstep(-0.1, 0.15, face);
    diffuseColor.rgb = diffuseColor.rgb * (1.0 - col.a * f) + col.rgb * f;
    // contorno tracejado do escolhido (editor)
    if (int(c1.w) == uDecSel) {
      vec2 e = min(st, 1.0 - st);
      if (min(e.x, e.y) < 0.015 && fract((st.x + st.y) * 10.0) < 0.5) diffuseColor.rgb = vec3(1.0, 0.82, 0.23);
    }
  }
}`);
  };
  c.customProgramCacheKey = () => "pintura-decal";
  return c;
}

// (as regras dos desenhos do capacete e do macacão ficam em uniformStyles.ts: a mesma da prévia do editor)
const HELMET_COND = HELMET_RULES.map((r) => r.glsl), SUIT_COND = SUIT_RULES.map((r) => r.glsl), GLOVE_COND = GLOVE_RULES.map((r) => r.glsl), SHOE_COND = SHOE_RULES.map((r) => r.glsl);

const styledCache = new Map<string, THREE.Material>();
/**
 * o capacete do arquivo do carro vem deitado junto com o piloto: 47,1° (medido no encaixe do piloto em pé,
 * viewer3dScene.fitHelmet, erro 0,1 mm). O desenho do capacete é calculado com ele endireitado: com o eixo do
 * carro, de cima as faixas pareciam certas e de lado saíam tortas
 */
export const HELMET_UPRIGHT = 0.822;
/**
 * onde a luva começa, em aGlove.y (pulso 0, ponta 1): -0,15 ≈ 3,5 cm acima do pulso. O corte é feito em cada pixel
 * (pela posição contínua), e não ponto a ponto: assim a borda do punho sai reta, não em escada
 */
export const GLOVE_T0 = -0.15;
/** caixa dos pontos da peça girados `ang` em volta do lado (guardada na peça) */
export function upBox(geo: THREE.BufferGeometry, ang: number): THREE.Box3 {
  if (!ang) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    return geo.boundingBox!;
  }
  const k = `upBox${ang}`;
  if (geo.userData[k]) return geo.userData[k];
  const pos = geo.attributes.position, v = new THREE.Vector3(), b = new THREE.Box3(), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < pos.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, i).applyAxisAngle(X, ang));
  return (geo.userData[k] = b);
}
/**
 * capacete/macacão do jogador (pintura dele): a cor e o desenho (SUIT_RULES/HELMET_RULES, uniformStyles.ts).
 * Sem mapa de textura confiável nessas peças: o desenho sai de onde cada ponto fica (q: -1..1 de lado, de
 * altura e de frente), pra que lado a superfície aponta (n) e de que parte do corpo ele é (part).
 * - capacete: pelos pontos da peça endireitados (HELMET_UPRIGHT), dentro da caixa dela;
 * - macacão do piloto em pé: pelos atributos aBody/aBodyN/aPart (o corpo de braços abaixados, calculado pelo
 *   esqueleto em viewer3dScene) e pela caixa do corpo inteiro (`box`);
 * - macacão do piloto sentado no carro: pelo mesmo corpo "em pé", calculado pela pose (seatBody);
 * - luvas: onde a peça do macacão tem aGlove (luva sim/não, do pulso à ponta, dedo, costas/palma), com a cor e o
 *   desenho delas (GLOVE_RULES)
 */
export function uniformMaterial(base: THREE.Material, kind: "h" | "s", lv: NonNullable<Team["livery"]>, geo: THREE.BufferGeometry, box?: THREE.Box3) {
  const style = kind === "h" ? (lv.helmetStyle ?? 1) : (lv.suitStyle ?? 1);
  const col = kind === "h" ? lv.helmet : lv.suit, det = kind === "h" ? lv.helmetDetail : lv.suitDetail;
  const body = kind === "s" && !!geo.attributes.aBody;
  const glove = kind === "s" && !!geo.attributes.aGlove;
  const gStyle = lv.gloveStyle ?? 0, gCol = lv.glove ?? lv.suit, gDet = lv.gloveDetail ?? lv.suitDetail;
  const ang = kind === "h" ? HELMET_UPRIGHT : 0;
  const b = box ?? (geo.userData.bodyBox as THREE.Box3 | undefined) ?? upBox(geo, ang);
  const key = `${kind}|${col}|${det}|${style}|${body ? "b" : ""}|${glove ? `${gCol}|${gDet}|${gStyle}` : ""}|${b.min.toArray().map((v) => v.toFixed(3))}|${b.max.toArray().map((v) => v.toFixed(3))}`;
  let m = styledCache.get(key);
  if (m) return m;
  const mm = base.clone() as THREE.MeshStandardMaterial;
  mm.name = base.name;
  mm.color.set(col);
  if (style > 0 || glove) {
    const cond = (kind === "h" ? HELMET_COND : SUIT_COND).at(style) || "false", gCond = GLOVE_COND.at(gStyle) || "false";
    const lo = b.min.clone(), hi = b.max.clone(), dc = new THREE.Color(det), gc = new THREE.Color(gCol), gd = new THREE.Color(gDet);
    mm.onBeforeCompile = (sh) => {
      sh.uniforms.uLo = { value: lo };
      sh.uniforms.uHi = { value: hi };
      sh.uniforms.uDet = { value: dc };
      sh.uniforms.uAng = { value: ang };
      sh.uniforms.uGCol = { value: gc };
      sh.uniforms.uGDet = { value: gd };
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vPL;\nvarying vec3 vNL;\nvarying float vPart;\nvarying float vNeck;\nvarying vec4 vGlove;${body ? "\nattribute vec3 aBody;\nattribute vec3 aBodyN;\nattribute float aPart;\nattribute float aNeck;" : ""}${glove ? "\nattribute vec4 aGlove;" : ""}`,
        )
        .replace("#include <skinnormal_vertex>", `#include <skinnormal_vertex>\n${body ? "vNL = aBodyN;" : "vNL = objectNormal;"}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${body ? "vPL = aBody;\nvPart = aPart;\nvNeck = aNeck;" : "vPL = position;\nvPart = -1.0;\nvNeck = 0.0;"}\n${glove ? "vGlove = aGlove;" : "vGlove = vec4(0.0);"}`);
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vPL;\nvarying vec3 vNL;\nvarying float vPart;\nvarying float vNeck;\nvarying vec4 vGlove;\nuniform vec3 uLo;\nuniform vec3 uHi;\nuniform vec3 uDet;\nuniform float uAng;\nuniform vec3 uGCol;\nuniform vec3 uGDet;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float ca = cos(uAng), sa = sin(uAng);
vec3 p = vec3(vPL.x, vPL.y * ca - vPL.z * sa, vPL.y * sa + vPL.z * ca);
vec3 n = normalize(vNL);
n = vec3(n.x, n.y * ca - n.z * sa, n.y * sa + n.z * ca);
float part = vPart;
vec3 q = (p - (uLo + uHi) * 0.5) / max((uHi - uLo) * 0.5, vec3(1e-4));
if (vGlove.x > 0.5 && vGlove.y > ${GLOVE_T0.toFixed(2)}) {
  float gt = vGlove.y, gf = vGlove.z, gb = vGlove.w, gs = sign(q.x);
  diffuseColor.rgb = (${gCond}) ? uGDet : uGCol;
} else if (vNeck < 0.5 && (${cond})) diffuseColor.rgb = uDet;`,
        );
    };
    mm.customProgramCacheKey = () => `uniforme-${kind}${style}${body ? "b" : ""}${glove ? `g${gStyle}` : ""}`;
  }
  if (styledCache.size > 60) styledCache.clear();
  styledCache.set(key, (m = mm));
  return m;
}

/**
 * tênis do piloto em pé (viewer3dScene.shoeSpace dá aShoe = (tênis, calcanhar→bico, sola→cano, lado)). Peças do
 * modelo: a faixa (part 1) leva o detalhe; o resto (cabedal 0 e a peça preta 2) leva a cor do tênis e o desenho
 * (SHOE_RULES) — só a peça preta abaixo de SHOE_SOLE da altura é sola (preta; o detalhe em "Sola colorida"). A
 * peça preta cobre a lateral inteira do tênis: com ela toda na sola, a cor escolhida quase não aparecia
 */
export const SHOE_SOLE = 0.2;
const SHOE_BLACK = "#151517";
const shoeCache = new Map<string, THREE.Material>();
export function shoeMaterial(base: THREE.Material, lv: NonNullable<Team["livery"]>, part: number) {
  const style = lv.shoeStyle ?? 0, col = lv.shoe ?? lv.suit, det = lv.shoeDetail ?? lv.suitDetail;
  const key = `${col}|${det}|${style}|${part}`;
  let m = shoeCache.get(key);
  if (m) return m;
  const mm = base.clone() as THREE.MeshStandardMaterial;
  mm.name = base.name;
  if (part === 1) mm.color.set(det);
  else {
    mm.color.set("#ffffff");
    // ("Sola colorida" só pinta a sola; no cabedal ela não desenha nada)
    const cond = style === 4 ? "false" : SHOE_COND.at(style) || "false";
    const uc = new THREE.Color(col), ud = new THREE.Color(det), us = new THREE.Color(style === 4 ? det : SHOE_BLACK);
    mm.onBeforeCompile = (sh) => {
      sh.uniforms.uCol = { value: uc };
      sh.uniforms.uDet = { value: ud };
      sh.uniforms.uSole = { value: us };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aShoe;\nvarying vec4 vShoe;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvShoe = aShoe;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec4 vShoe;\nuniform vec3 uCol;\nuniform vec3 uDet;\nuniform vec3 uSole;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>\nfloat ft = vShoe.y, fh = vShoe.z, fs = vShoe.w, fp = ${part}.0;\nif (fp > 1.5 && fh < ${SHOE_SOLE.toFixed(2)}) diffuseColor.rgb = uSole;\nelse diffuseColor.rgb = (${cond}) ? uDet : uCol;`,
        );
    };
    mm.customProgramCacheKey = () => `tenis-${part}-${style}`;
  }
  if (shoeCache.size > 40) shoeCache.clear();
  shoeCache.set(key, (m = mm));
  return m;
}

/**
 * luvas do piloto sentado no carro (sem esqueleto). As mãos estão no aro do volante, e o arquivo tem as poses
 * do volante virado (giro_p3/giro_m3, ±50°): quem mais anda nelas são as mãos. O centro de cada mão = a média
 * dos pontos que mais andam, de cada lado; a mão é o que fica a até GLOVE_REACH dele (e anda junto com o
 * volante, pra não pegar a perna que passa perto), e o punho é cortado em GLOVE_T0 (atrás do pulso já é o antebraço). aGlove = luva, do punho (0) ao meio da mão (1), dedo (a metade
 * de perto do meio), costas (pra fora) — o mesmo que o piloto em pé tem pelos ossos (viewer3dScene.bodySpace).
 * (Pela caixa do nó "volante" não dava: ele tem coluna e aletas, 50 cm de largura)
 */
const GLOVE_REACH = 0.12;
export function gloveByWheel(pilot: THREE.Object3D | undefined) {
  const n = new THREE.Vector3(), dv = new THREE.Vector3();
  pilot?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const dict = mesh.morphTargetDictionary, morphs = mesh.geometry?.morphAttributes.position;
    // (a peça é a mesma em todos os carros do mesmo modelo: calcula uma vez)
    if (!mesh.isMesh || !dict || !morphs || mesh.geometry.attributes.aGlove || (mesh.material as THREE.Material).name !== "macacao") return;
    const mp = morphs[dict.giro_p3], mm = morphs[dict.giro_m3];
    if (!mp || !mm) return;
    const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal, cnt = pos.count;
    const sc = mesh.matrixWorld.getMaxScaleOnAxis();
    // quanto cada ponto anda com o volante virado (no mundo), e onde fica
    const disp = new Float32Array(cnt), at: THREE.Vector3[] = [];
    let top = 0;
    for (let i = 0; i < cnt; i++) {
      disp[i] = Math.max(dv.fromBufferAttribute(mp, i).length(), dv.fromBufferAttribute(mm, i).length()) * sc;
      top = Math.max(top, disp[i]);
      at.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
    if (!top) return;
    // centro de cada mão: a média dos pontos que mais andam, de cada lado do meio deles; só a metade da frente
    // (o antebraço também anda muito e puxava o centro pro pulso)
    const most = [...disp.keys()].filter((i) => disp[i] > top * 0.7);
    const mid = most.reduce((s, i) => s + at[i].x, 0) / most.length;
    const hands = [true, false].map((left) => {
      const ids = most.filter((i) => at[i].x > mid === left).sort((a, b) => at[b].z - at[a].z);
      const front = ids.slice(0, Math.max(1, Math.ceil(ids.length / 2)));
      return front.reduce((s, i) => s.add(at[i]), new THREE.Vector3()).divideScalar(front.length);
    });
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const out = new Float32Array(cnt * 4);
    for (let i = 0; i < cnt; i++) {
      if (disp[i] < top * 0.2) continue;
      const left = at[i].x > mid, h = hands[left ? 0 : 1];
      if (at[i].distanceTo(h) >= GLOVE_REACH) continue;
      // (do pulso, atrás, à ponta dos dedos, na frente: a mão segura o aro com os dedos pra frente)
      const t = 0.5 + (at[i].z - h.z) / 0.12;
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      out.set([1, t, t > 0.6 ? 1 : 0, n.x * (left ? 1 : -1)], i * 4);
    }
    mesh.geometry.setAttribute("aGlove", new THREE.BufferAttribute(out, 4));
  });
}

/**
 * suaviza as direções da superfície (média com os vizinhos, `it` vezes): as dobras modeladas no macacão (joelho,
 * cintura) deixavam a "faixa lateral" manchada. Pontos repetidos (costuras) contam como um só, pela posição
 */
export function smoothDirs(geo: THREE.BufferGeometry, body: Float32Array, dirs: Float32Array, it: number) {
  const cnt = dirs.length / 3, ids = new Int32Array(cnt), key = new Map<string, number>();
  let m = 0;
  for (let i = 0; i < cnt; i++) {
    const k = `${Math.round(body[i * 3] * 5000)},${Math.round(body[i * 3 + 1] * 5000)},${Math.round(body[i * 3 + 2] * 5000)}`;
    let id = key.get(k);
    if (id === undefined) key.set(k, (id = m++));
    ids[i] = id;
  }
  const adj: number[][] = Array.from({ length: m }, () => []);
  const idx = geo.index, tri = idx ? idx.count : cnt;
  for (let t = 0; t + 2 < tri; t += 3) {
    const a = ids[idx ? idx.getX(t) : t], b = ids[idx ? idx.getX(t + 1) : t + 1], c = ids[idx ? idx.getX(t + 2) : t + 2];
    adj[a].push(b, c);
    adj[b].push(a, c);
    adj[c].push(a, b);
  }
  let cur = new Float32Array(m * 3);
  for (let i = 0; i < cnt; i++) for (let k = 0; k < 3; k++) cur[ids[i] * 3 + k] = dirs[i * 3 + k];
  for (let r = 0; r < it; r++) {
    const nx = new Float32Array(m * 3);
    for (let a = 0; a < m; a++) {
      let x = cur[a * 3], y = cur[a * 3 + 1], z = cur[a * 3 + 2];
      for (const b of adj[a]) {
        x += cur[b * 3];
        y += cur[b * 3 + 1];
        z += cur[b * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      nx[a * 3] = x / l;
      nx[a * 3 + 1] = y / l;
      nx[a * 3 + 2] = z / l;
    }
    cur = nx;
  }
  for (let i = 0; i < cnt; i++) for (let k = 0; k < 3; k++) dirs[i * 3 + k] = cur[ids[i] * 3 + k];
}

/**
 * piloto SENTADO no carro (sem esqueleto): onde cada ponto do macacão ficaria no piloto EM PÉ, pra os desenhos
 * (SUIT_RULES) caírem no mesmo lugar do corpo. Sem isso as regras iam pela altura da peça e, com as pernas
 * deitadas, a "cintura" pintava as pernas inteiras. aBody já sai na escala das regras (q, -1..1) com as medidas do
 * piloto em pé (viewer3dScene.bodySpace): quadril 0, ombro 0,58, alto do pescoço 0,85, joelho -0,40, tornozelo
 * -0,85, sola -1; cotovelo 0,24 e pulso 0,01 no braço. A pose é "desdobrada": tronco pelo eixo do quadril ao
 * pescoço, coxa e canela pela distância pra frente, pé (em pé no pedal: a sola olha pra frente) até a sola,
 * braços (os pontos que andam com o volante) do ombro até a mão. Os pontos de referência foram medidos na malha
 * (coordenadas da peça "piloto"; iguais no carro_lo, carro e carro_hd)
 */
const SEAT = {
  midX: 0.023, halfW: 0.22,
  hipY: 0.05, hipZ: -0.85, topY: 0.43, topZ: -0.95, shY: 0.28,
  kneeZ: -0.53, ankleZ: -0.16, soleZ: -0.065,
  // braço: perto do ombro, abaixo de armY é a lateral do tronco (que também anda um pouco com o volante)
  armY: 0.205, shZ: -0.97, elbowZ: -0.8, wristZ: -0.58, tipZ: -0.46,
};
export function seatBody(pilot: THREE.Object3D | undefined) {
  pilot?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const dict = mesh.morphTargetDictionary, morphs = mesh.geometry?.morphAttributes.position;
    if (!mesh.isMesh || !dict || !morphs || mesh.geometry.attributes.aBody || (mesh.material as THREE.Material).name !== "macacao") return;
    const mp = morphs[dict.giro_p3], mm = morphs[dict.giro_m3];
    if (!mp || !mm) return;
    const geo = mesh.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, cnt = pos.count;
    const S = SEAT, v = new THREE.Vector3(), d = new THREE.Vector3();
    const disp = new Float32Array(cnt);
    let top = 0;
    for (let i = 0; i < cnt; i++) {
      disp[i] = Math.max(d.fromBufferAttribute(mp, i).length(), d.fromBufferAttribute(mm, i).length());
      top = Math.max(top, disp[i]);
    }
    // eixo do tronco (no plano de lado: z pra frente, y pra cima) e a divisa tronco/coxa (o meio do ângulo)
    const tl = Math.hypot(S.topZ - S.hipZ, S.topY - S.hipY), tz = (S.topZ - S.hipZ) / tl, ty = (S.topY - S.hipY) / tl;
    const uSh = (S.shY - S.hipY) / ty;
    const nl = Math.hypot(tz - 1, ty), nz = (tz - 1) / nl, ny = ty / nl;
    // (de um ponto de referência ao outro, em linha reta)
    const lerp = (x: number, x0: number, x1: number, a: number, b: number) => a + (b - a) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
    const body = new Float32Array(cnt * 3), bn = new Float32Array(cnt * 3), part = new Float32Array(cnt), neck = new Float32Array(cnt), at = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(pos, i);
      at.set([v.x, v.y, v.z], i * 3);
      bn.set([nor.getX(i), nor.getY(i), nor.getZ(i)], i * 3);
      const qx = (v.x - S.midX) / S.halfW;
      let qy: number, qz: number;
      if (disp[i] > top * 0.03 && v.y > S.armY) {
        // braço: do ombro (com a ponta do ombro um pouco acima) à ponta dos dedos
        part[i] = 1;
        qy = v.z < S.shZ ? Math.min(0.75, 0.58 + (S.shZ - v.z) * 3.3) : v.z < S.elbowZ ? lerp(v.z, S.shZ, S.elbowZ, 0.58, 0.24) : v.z < S.wristZ ? lerp(v.z, S.elbowZ, S.wristZ, 0.24, 0.01) : lerp(v.z, S.wristZ, S.tipZ, 0.01, -0.12);
        qz = (v.y - 0.275) / 0.2;
      } else if ((v.z - S.hipZ) * nz + (v.y - S.hipY) * ny > 0) {
        // tronco e pescoço
        const u = (v.z - S.hipZ) * tz + (v.y - S.hipY) * ty;
        qy = u < uSh ? (0.58 * u) / uSh : lerp(u, uSh, tl, 0.58, 0.85);
        qz = ((v.z - S.hipZ) * ty - (v.y - S.hipY) * tz) / 0.2;
        if (qy > 0.7 && Math.abs(v.x - S.midX) < 0.075) neck[i] = 1;
      } else {
        // pernas: coxa, canela e o pé até a sola
        qy = v.z < S.kneeZ ? Math.min(0.02, lerp(v.z, S.hipZ, S.kneeZ, 0, -0.4) + (v.z < S.hipZ ? (S.hipZ - v.z) * 0.5 : 0)) : v.z < S.ankleZ ? lerp(v.z, S.kneeZ, S.ankleZ, -0.4, -0.85) : lerp(v.z, S.ankleZ, S.soleZ, -0.85, -1);
        qz = (v.y - S.hipY - 0.06) / 0.2;
      }
      body.set([qx, qy, Math.max(-1, Math.min(1, qz))], i * 3);
    }
    // (as direções ficam as da pose sentada: as regras só usam o lado, que não muda ao "desdobrar")
    smoothDirs(geo, at, bn, 8);
    geo.setAttribute("aBody", new THREE.BufferAttribute(body, 3));
    geo.setAttribute("aBodyN", new THREE.BufferAttribute(bn, 3));
    geo.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
    geo.setAttribute("aNeck", new THREE.BufferAttribute(neck, 1));
    geo.userData.bodyBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  });
}

/** materiais das peças soltas genéricas, por cor */
const debrisMats = new Map<string, THREE.MeshStandardMaterial>();
const debrisMat = (c: string) => {
  let m = debrisMats.get(c);
  if (!m) debrisMats.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.1 })));
  return m;
};
/** peça solta simples (m): bico, espelho, placa de fibra ou pneu da barreira */
function debrisPiece(node: string, color: string): THREE.Object3D | null {
  if (node === "bico") {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.26, 1.25, 10).rotateX(Math.PI / 2), debrisMat(color));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.32).translate(0, -0.1, 0.45), debrisMat("#1b1c20"));
    g.add(cone, tip);
    return g;
  }
  if (node === "espelho") return new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.13), debrisMat(color));
  if (node === "placa") return new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.42), debrisMat(color));
  if (node === "pneu") return new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.12, 8, 18).rotateY(Math.PI / 2), debrisMat(color));
  return null;
}
/** borracha e tinta na barreira (cor da equipe), por cor */
const scuffTexs = new Map<string, THREE.CanvasTexture>();
function scuffTex(color: string) {
  let t = scuffTexs.get(color);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  const rr = (a: number, b: number) => a + Math.random() * (b - a);
  // riscos escuros de borracha (mais fortes no meio, somem nas pontas)
  for (let i = 0; i < 26; i++) {
    const y = rr(14, 50), x0 = rr(0, 90), x1 = rr(160, 256);
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, "rgba(10,10,12,0)");
    gr.addColorStop(0.5, `rgba(10,10,12,${rr(0.25, 0.6).toFixed(2)})`);
    gr.addColorStop(1, "rgba(10,10,12,0)");
    g.strokeStyle = gr;
    g.lineWidth = rr(1, 4);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y + rr(-6, 6));
    g.stroke();
  }
  // tinta do carro que ficou na barreira
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = color;
    g.globalAlpha = rr(0.35, 0.8);
    g.lineWidth = rr(1.5, 3.5);
    g.beginPath();
    const y = rr(24, 42);
    g.moveTo(rr(40, 100), y);
    g.lineTo(rr(150, 220), y + rr(-3, 3));
    g.stroke();
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scuffTexs.set(color, t);
  return t;
}

/** linha de cada marca no atlas (markAtlas) */
const MARK_ROW: Record<Skid["k"], number> = { pneu: 0, brita: 1, lama: 2, areia: 3, risco: 4 };
/**
 * o desenho de cada marca no chão (linhas de 64 px; ao longo, 256 px = 1,2 m, repete): borracha com os frisos do
 * pneu; sulco na brita (fundo escuro e a pedra empurrada pras bordas); trilha de lama com tufos de grama
 * arrancada; sulco na areia; risco do assoalho (raspado claro com borda escura)
 */
let atlasT: THREE.CanvasTexture | null = null;
function markAtlas() {
  if (atlasT) return atlasT;
  const W = 256, R = 64, c = document.createElement("canvas");
  c.width = W;
  c.height = R * 5;
  const g = c.getContext("2d")!;
  const rr = (a: number, b: number) => a + Math.random() * (b - a);
  const dots = (row: number, n: number, v0: number, v1: number, rad: [number, number], cols: string[]) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      g.arc(rr(0, W), row * R + rr(v0, v1) * R, rr(rad[0], rad[1]), 0, Math.PI * 2);
      g.fill();
    }
  };
  // faixa ao longo com borda macia (de v0 a v1, em fração da linha)
  const band = (row: number, v0: number, v1: number, color: string, soft = 0.12) => {
    const y0 = row * R + v0 * R, y1 = row * R + v1 * R, gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(Math.min(0.49, soft / (v1 - v0)), color);
    gr.addColorStop(Math.max(0.51, 1 - soft / (v1 - v0)), color);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, y0, W, y1 - y0);
  };
  // 0) borracha: faixa escura com os frisos (sulcos do pneu) mais escuros e grãos
  // (bem preta: no asfalto escuro a de 55% sumia)
  band(0, 0.08, 0.92, "rgba(6,6,8,0.78)");
  for (const f of [0.26, 0.42, 0.58, 0.74]) band(0, f - 0.035, f + 0.035, "rgba(0,0,0,0.7)", 0.02);
  dots(0, 260, 0.12, 0.88, [0.6, 1.4], ["rgba(0,0,0,0.25)", "rgba(40,40,44,0.2)"]);
  // 1) brita: fundo do sulco escuro e assentado; a pedra empurrada forma uma borda clara de cada lado
  band(1, 0.22, 0.78, "rgba(92,62,38,0.62)", 0.06);
  dots(1, 220, 0.25, 0.75, [0.8, 1.8], ["rgba(60,40,25,0.55)", "rgba(150,104,64,0.5)"]);
  for (const [a, b] of [[0.0, 0.26], [0.74, 1.0]] as const) {
    dots(1, 520, a, b, [1, 2.6], ["rgba(236,176,112,0.95)", "rgba(206,140,80,0.95)", "rgba(246,206,150,0.95)", "rgba(170,110,66,0.9)"]);
    dots(1, 90, a, b, [0.8, 1.6], ["rgba(70,48,30,0.6)"]);
  }
  // 2) lama: terra escura com a borda irregular e tufos de grama arrancada
  for (let x = 0; x < W; x += 2) {
    const e = 0.16 + 0.06 * Math.sin(x * 0.11) + rr(-0.03, 0.03), f = 0.84 - 0.06 * Math.sin(x * 0.07 + 1) + rr(-0.03, 0.03);
    g.fillStyle = "rgba(62,42,24,0.82)";
    g.fillRect(x, 2 * R + e * R, 2, (f - e) * R);
  }
  dots(2, 200, 0.2, 0.8, [1, 2.4], ["rgba(38,24,12,0.7)", "rgba(96,68,40,0.6)"]);
  dots(2, 160, 0.02, 0.22, [1, 2.2], ["rgba(70,140,48,0.9)", "rgba(48,110,36,0.9)", "rgba(90,62,36,0.8)"]);
  dots(2, 160, 0.78, 0.98, [1, 2.2], ["rgba(70,140,48,0.9)", "rgba(48,110,36,0.9)", "rgba(90,62,36,0.8)"]);
  // 3) areia: sulco médio e a areia clara nas bordas
  band(3, 0.2, 0.8, "rgba(150,120,82,0.55)", 0.08);
  dots(3, 300, 0.0, 0.22, [0.8, 2], ["rgba(232,208,162,0.9)", "rgba(214,186,140,0.9)"]);
  dots(3, 300, 0.78, 1.0, [0.8, 2], ["rgba(232,208,162,0.9)", "rgba(214,186,140,0.9)"]);
  // 4) risco: o asfalto raspado fica claro, com a borda queimada escura e falhas
  band(4, 0.2, 0.8, "rgba(24,24,26,0.6)", 0.06);
  band(4, 0.36, 0.64, "rgba(214,214,218,0.85)", 0.05);
  for (let i = 0; i < 18; i++) g.clearRect(rr(0, W), 4 * R + 0.36 * R, rr(2, 10), 0.28 * R);
  atlasT = new THREE.CanvasTexture(c);
  atlasT.wrapS = THREE.RepeatWrapping;
  atlasT.colorSpace = THREE.SRGBColorSpace;
  atlasT.anisotropy = 4;
  return atlasT;
}

/** mancha de óleo: várias manchas macias juntas, borda irregular (branca: a cor vem da marca) */
let stainT: THREE.CanvasTexture | null = null;
function stainTex() {
  if (stainT) return stainT;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 12 + Math.random() * 24;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(255,255,255,0.55)");
    gr.addColorStop(0.7, "rgba(255,255,255,0.35)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return (stainT = new THREE.CanvasTexture(c));
}
/** pedrisco/terra espalhado: pontinhos de tamanhos diferentes, mais juntos no meio */
let dotT: THREE.CanvasTexture | null = null;
function dotTex() {
  if (dotT) return dotT;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.8) * 58, r = 1 + Math.random() * 3.2;
    g.fillStyle = `rgba(255,255,255,${(0.55 + Math.random() * 0.45).toFixed(2)})`;
    g.beginPath();
    g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  return (dotT = new THREE.CanvasTexture(c));
}

/** tracinhos brancos da lateral do pneu (um material só pra todos) */
let markM: THREE.MeshLambertMaterial | null = null;
const markMat = () => (markM ??= new THREE.MeshLambertMaterial({ color: "#f2f2f2" }));
/** recortes da tampa da roda */
let slotM: THREE.MeshLambertMaterial | null = null;
const slotMat = () => (slotM ??= new THREE.MeshLambertMaterial({ color: "#16181c" }));

/** safety car e guindaste (public/props/*.glb, art/export_props_glb.py): frente pra +Z, centro no meio */
export interface PropDraw {
  kind: "sc" | "crane";
  id: string;
  x: number;
  y: number;
  h: number;
  /** safety car: qual lado do giroflex está aceso */
  blink?: boolean;
}
const propModels = new Map<string, THREE.Group>();
const propAsked = new Set<string>();
/** começa a baixar o objeto; true quando pronto */
export function propReady(kind: PropDraw["kind"]): boolean {
  if (propModels.has(kind)) return true;
  // safety car: o do jogo, montado aqui (src/render/safetyCar.ts); o .glb antigo não é mais usado
  if (kind === "sc") {
    propModels.set(kind, buildSafetyCar());
    return true;
  }
  if (!propAsked.has(kind)) {
    propAsked.add(kind);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader
      .loadAsync(`/props/${kind}.glb`)
      .then((g) => propModels.set(kind, g.scene))
      .catch(() => {});
  }
  return false;
}

/** começa a baixar o modelo; true quando pronto */
export function realCarsReady(): boolean {
  if (!model) load();
  return !!model;
}

/** sombra de contato embaixo do carro: mancha macia (textura feita uma vez) */
let blobG: THREE.BufferGeometry | null = null, blobM: THREE.Material | null = null;
const blobGeo = () => (blobG ??= new THREE.PlaneGeometry(2.7, 5.9).rotateX(-Math.PI / 2));
function blobMat() {
  if (blobM) return blobM;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  // contorno do carro visto de cima (placa 2,7 × 5,9 m: ~23 px/m; o bico fica embaixo da imagem), desfocado.
  // (desenhado longe das bordas da placa: senão a sombra ficava quadrada)
  g.filter = "blur(2.5px)";
  g.fillStyle = "rgba(0,0,0,0.8)";
  g.beginPath();
  g.ellipse(32, 66, 8.5, 44, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(12, 104, 40, 7); // asa dianteira
  g.fillRect(15, 16, 34, 8); // asa traseira
  for (const x of [9, 45]) {
    g.fillRect(x, 26, 10, 17); // rodas de trás
    g.fillRect(x, 88, 10, 15); // rodas da frente
  }
  g.fillRect(18, 36, 28, 34); // laterais
  const t = new THREE.CanvasTexture(c);
  // (empurrão de profundidade pequeno: forte, visto de lado a mancha passava na frente da base do pneu)
  return (blobM = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
}
let contactM: THREE.Material | null = null;
/** a mesma mancha, mais fraca, pra sombra de contato (logo embaixo do carro) */
function contactMat() {
  const b = blobMat() as THREE.MeshBasicMaterial;
  return (contactM ??= new THREE.MeshBasicMaterial({ map: b.map, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
}

export class RealCars {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private cars = new Map<string, CarObj>();
  private mats = new Map<string, Record<string, THREE.Material>>();
  private frame = 0;
  /** qualidade: antisserrilhado, resolução da tela e sombra de verdade (num chão invisível que só recebe sombra) */
  readonly hq = gfx().aa;
  /** sombra de verdade (médio: mapa menor; alto: maior e suave); baixo/desligado: o 2D desenha (ou não) a mancha */
  readonly realShadow = gfx().shadows === "medio" || gfx().shadows === "alto";
  private sun: THREE.DirectionalLight;
  private shadowFloor: THREE.Mesh | null = null;

  constructor() {
    const cv = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: this.hq, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // luz parecida com a das imagens: sol alto um pouco inclinado + céu
    this.scene.add((this.hemi = new THREE.HemisphereLight("#dfe8ff", "#3a3a32", 1.3)));
    const sun = (this.sun = new THREE.DirectionalLight("#ffffff", 2.2));
    sun.position.set(-6, 20, -8);
    this.scene.add(sun, sun.target);
    if (this.realShadow) {
      const hi = gfx().shadows === "alto";
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = hi ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.02;
      sun.shadow.radius = 3;
      this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.55 }));
      this.shadowFloor.rotation.x = -Math.PI / 2;
      this.shadowFloor.receiveShadow = true;
      this.scene.add(this.shadowFloor);
    }
    this.camera.up.set(0, 0, -1);
    // ambiente pros reflexos (pintura e partes metálicas têm o que refletir)
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  private tyreMats = new Map<string, THREE.Material>();
  private rubber: THREE.Material | null = null;
  /** borracha dos pneus (uma pra todos os carros) */
  private rubberMat(from: THREE.Material) {
    if (this.rubber) return this.rubber;
    const m = from.clone() as THREE.MeshStandardMaterial;
    if (m.color) m.color.set("#34343a");
    m.roughness = 0.92;
    m.metalness = 0;
    return (this.rubber = m);
  }
  /** a capa da roda na cor do composto (uma por composto, pra todos os carros) */
  private tyreMat(cmp: Compound, from: THREE.MeshStandardMaterial | undefined) {
    let m = this.tyreMats.get(cmp);
    if (!m) {
      const c = from ? from.clone() : new THREE.MeshStandardMaterial();
      c.color.set(COMPOUNDS[cmp].color);
      c.roughness = 0.45;
      this.tyreMats.set(cmp, (m = c));
    }
    return m;
  }

  /** materiais da equipe (pintura, asa e capacete com as cores dela; o resto igual ao do modelo) */
  private teamMats(team: Team) {
    const lv = team.livery;
    const key = `${team.id}|${liveryKey(lv)}|${team.color}|${team.accent}`;
    let m = this.mats.get(key);
    if (!m) {
      const colors: Record<string, string> = { pintura: lv?.base ?? team.color, asa: lv?.wing ?? lv?.accent ?? team.accent, capacete: lv?.helmet ?? team.accent, macacao: lv?.suit ?? team.color };
      m = {};
      model!.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (m![mat.name]) continue;
          // (pintura: cor, desenho e adesivos vêm da textura)
          const c = mat.name === "pintura" ? paintMaterial(mat, team) : (mat as THREE.MeshStandardMaterial).clone();
          // (de perto, superfície muito lisa fazia o brilho do sol piscar: um pouco mais fosco)
          if (c.roughness != null) c.roughness = Math.max(c.roughness, 0.5);
          if (c.name !== "pintura" && colors[c.name]) c.color.set(colors[c.name]);
          m![mat.name] = c;
        }
      });
      if (this.mats.size > 40) this.mats.clear();
      this.mats.set(key, m);
    }
    return { key, m };
  }

  /** cópia do material que desenha os dois lados, e o de dentro (de trás) preto */
  private backMats = new Map<THREE.Material, THREE.Material>();
  private backBlack(m: THREE.Material): THREE.Material {
    if (m.userData.backBlack) return m;
    let b = this.backMats.get(m);
    if (b) return b;
    b = m.clone();
    b.userData.backBlack = true;
    b.side = THREE.DoubleSide;
    // (soma ao shader que o material já tinha: adesivos da pintura)
    const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey();
    b.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor = vec4(0.015, 0.015, 0.02, 1.0);");
    };
    b.customProgramCacheKey = () => "costas-pretas" + prevKey;
    this.backMats.set(m, b);
    return b;
  }

  /** capacete de cada piloto: uma cor tirada do nome dele (fixa, sempre a mesma), longe da cor do carro */
  private helmets = new Map<string, THREE.Material>();
  private helmetMat(id: string, team: Team): THREE.Material {
    let mt = this.helmets.get(id);
    if (mt) return mt;
    const base = this.teamMats(team).m.capacete as THREE.MeshStandardMaterial | undefined;
    mt = base ? base.clone() : new THREE.MeshStandardMaterial({ roughness: 0.5 });
    mt.name = "capacete";
    // (paleta de capacete; pula as parecidas com a pintura do carro)
    // (sem branco/prata: pareciam o capacete cinza de antes)
    const pal = ["#f6d21a", "#e32222", "#1f5fbf", "#18b04f", "#f07a1a", "#8a2be2", "#ff6fa8", "#2ec4c4", "#111111", "#7fd0ff", "#c0392b", "#ffb300"];
    let h = 2166136261;
    for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const carCol = new THREE.Color(team.livery?.base ?? team.color);
    let i = (h >>> 0) % pal.length;
    for (let k = 0; k < pal.length; k++, i = (i + 1) % pal.length) {
      const c = new THREE.Color(pal[i]);
      if (Math.abs(c.r - carCol.r) + Math.abs(c.g - carCol.g) + Math.abs(c.b - carCol.b) > 0.6) break;
    }
    (mt as THREE.MeshStandardMaterial).color.set(pal[i]);
    this.helmets.set(id, mt);
    return mt;
  }

  private styledMat(base: THREE.Material, kind: "h" | "s", lv: NonNullable<Team["livery"]>, geo: THREE.BufferGeometry) {
    return uniformMaterial(base, kind, lv, geo);
  }


  /** carro seguido (a câmera piloto usa o modelo detalhado nele) */
  followId = "";
  /** câmeras 3D: carros que estão com o modelo leve (longe da câmera) */
  private farCars = new Set<string>();
  /** safety car na pista (marchas no modo SC na telinha do volante) */
  scMode = false;

  private carFor(d: CarDraw): CarObj {
    // (câmera piloto: o carro seguido vira o detalhado, guardado com outra chave; o normal some sozinho)
    const hd = this.tilt?.kind === "piloto" && d.id === this.followId;
    if (hd && !modelHd) loadHd();
    const useHd = hd && !!modelHd;
    // (câmeras 3D: longe da câmera vira o leve; vira leve passando de 110 m e volta ao normal abaixo de 90 m,
    // pra não ficar trocando na divisa)
    let useLo = false;
    if (this.tilt && !hd && d.id !== this.followId && gfx().carQ !== "baixo") {
      const cp = this.persp.position, d2 = (d.x - cp.x) ** 2 + (d.y - cp.z) ** 2;
      const was = this.farCars.has(d.id), far = d2 > (was ? 90 : 110) ** 2;
      if (far) this.farCars.add(d.id);
      else this.farCars.delete(d.id);
      if (far && !modelLo) loadLo();
      useLo = far && !!modelLo;
    }
    const cid = useHd ? `${d.id}#hd` : useLo ? `${d.id}#lo` : d.id;
    let c = this.cars.get(cid);
    const { key, m } = this.teamMats(d.team);
    if (!c) {
      const root = new THREE.Group();
      const inner = (useHd ? modelHd! : useLo ? modelLo! : model!).clone(true);
      inner.scale.setScalar(useHd ? fitHd : useLo ? fitLo : fit);
      if (this.realShadow) inner.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
      // o modelo vem com o centro no meio do carro? centraliza pela caixa
      const box = new THREE.Box3().setFromObject(inner);
      inner.position.sub(box.getCenter(new THREE.Vector3()).setY(box.min.y));
      root.add(inner);
      if (!helmet) {
        root.updateMatrixWorld(true);
        // (pelo nó do capacete, igual nos três modelos; pelo material pegava malhas que só têm um pedaço dele)
        const hn = inner.getObjectByName("capacete");
        const hb = hn ? new THREE.Box3().setFromObject(hn) : new THREE.Box3();
        const cb = new THREE.Box3().setFromObject(inner);
        helmet = hb.isEmpty() ? { z: -0.3, top: 0.95, car: 1.1 } : { z: hb.getCenter(new THREE.Vector3()).z, top: hb.max.y, car: cb.max.y };
      }
      // sombra de contato (só nas câmeras inclinadas: lá o mapa de sombra cobre muito chão e a do carro sumia)
      const blob = new THREE.Mesh(blobGeo(), blobMat());
      blob.name = "blob";
      // (8 mm acima do asfalto: a 3 cm cortava a base dos pneus)
      blob.position.y = 0.008;
      blob.renderOrder = 1;
      blob.visible = false;
      root.add(blob);
      // sombra de contato: escura e logo embaixo do carro (a do sol cai ~0,9 m pro lado e, sem nada embaixo, o carro
      // parecia flutuar — pior na chuva, com o céu fechado)
      const contact = new THREE.Mesh(blobGeo(), contactMat());
      contact.name = "contato";
      contact.scale.set(0.9, 1, 0.94);
      contact.position.y = 0.006;
      contact.renderOrder = 1;
      contact.visible = false;
      root.add(contact);
      const parts = {} as Record<Part, THREE.Object3D>;
      for (const p of PARTS) parts[p] = inner.getObjectByName(p) ?? new THREE.Object3D();
      // rodas: giram e esterçam em volta do centro delas (a compressão do modelo tirou o ponto de giro
      // do eixo, e a roda "andava" pra frente e pra trás girando)
      inner.updateMatrixWorld(true);
      const rings: THREE.Mesh[] = [], strobe: THREE.Mesh[] = [], blurs: THREE.Mesh[] = [], glow: THREE.Mesh[] = [];
      for (const w of ["roda_fe", "roda_fd", "roda_te", "roda_td"] as const) {
        const part = parts[w];
        if (!part.parent) continue;
        // (o pivô fica direto no modelo: o nó da roda tem a escala da compressão e distorcia as contas)
        // (pelo pneu só: a roda leva junto o duto de freio, que tiraria o centro do eixo)
        const wb = new THREE.Box3();
        part.traverse((o) => {
          const ms = o as THREE.Mesh;
          if (ms.isMesh && (Array.isArray(ms.material) ? ms.material : [ms.material]).some((mt) => mt.name.includes("Tyre"))) wb.expandByObject(ms);
        });
        if (wb.isEmpty()) wb.setFromObject(part);
        const size = wb.getSize(new THREE.Vector3()).divideScalar(useHd ? fitHd : useLo ? fitLo : fit);
        const pivot = new THREE.Object3D();
        inner.add(pivot);
        pivot.position.copy(inner.worldToLocal(wb.getCenter(new THREE.Vector3())));
        pivot.updateMatrixWorld(true);
        pivot.attach(part);
        parts[w] = pivot;
        // faixa colorida do composto na borda de fora do pneu (de cima a lateral não aparece)
        const ringR = (size.y / 2) * 0.78;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.024, 6, 28));
        ring.rotation.y = Math.PI / 2;
        const out = w === "roda_fe" || w === "roda_te" ? 1 : -1; // (o lado esquerdo do carro é +X)
        // (rente à lateral do pneu, um tiquinho pra dentro: saindo pra fora parecia um aro solto)
        ring.position.set(out * Math.min(size.x / 2 - 0.012, 0.21), 0, 0);
        pivot.add(ring);
        rings.push(ring);
        // três tracinhos brancos na lateral (giram com a roda: liso, o pneu parecia parado; sem marca nenhuma)
        // (material próprio de cada carro: some aos poucos em alta velocidade, ver `strobe`)
        const marks = new THREE.Mesh(mergeGeometries([0, 1, 2].map((k) => new THREE.BoxGeometry(0.008, 0.04, 0.15).translate(0, ringR * 0.86, 0).rotateX((k * 2 * Math.PI) / 3))), markMat().clone());
        marks.position.copy(ring.position);
        pivot.add(marks);
        // recortes escuros na tampa da roda (o disco liso girando parecia parado): 5 furos alongados, giram junto
        const slots = new THREE.Mesh(mergeGeometries([0, 1, 2, 3, 4].map((k) => new THREE.BoxGeometry(0.006, 0.05, 0.022).translate(0, ringR * 0.5, 0).rotateX((k * 2 * Math.PI) / 5))), slotMat().clone());
        slots.position.set(out * Math.min(size.x / 2 - 0.004, 0.215), 0, 0);
        pivot.add(slots);
        strobe.push(marks, slots);
        glow.push(slots);
        // borrão dos tracinhos girando rápido: anel claro translúcido no mesmo raio (aparece quando eles somem)
        const blur = new THREE.Mesh(new THREE.TorusGeometry(ringR * 0.86, 0.02, 4, 32), new THREE.MeshLambertMaterial({ color: "#cfcfcf", transparent: true, opacity: 0, depthWrite: false }));
        blur.rotation.y = Math.PI / 2;
        blur.position.copy(ring.position);
        blur.visible = false;
        pivot.add(blur);
        blurs.push(blur);
      }
      // (a tampa preta da entrada de ar vem no modelo: peça "tampa", art/export_carro_glb.py)
      // volante, braços e capacete: cada um num pivô (o nó do arquivo tem a escala da compressão);
      // os braços giram em volta do centro do volante, junto com ele
      const pivotOf = (o: THREE.Object3D | undefined, at?: THREE.Vector3) => {
        if (!o) return undefined;
        const pv = new THREE.Object3D();
        inner.add(pv);
        pv.position.copy(inner.worldToLocal((at ?? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())).clone()));
        pv.updateMatrixWorld(true);
        pv.attach(o);
        return pv;
      };
      root.updateMatrixWorld(true);
      const vol = inner.getObjectByName("volante");
      const volC = vol ? new THREE.Box3().setFromObject(vol).getCenter(new THREE.Vector3()) : undefined;
      gloveByWheel(inner.getObjectByName("piloto"));
      seatBody(inner.getObjectByName("piloto"));
      const steer = pivotOf(vol), arms = pivotOf(inner.getObjectByName("bracos"), volC), head = pivotOf(inner.getObjectByName("capacete"));
      // a tela do volante é peça própria: vai junto com o volante
      const tel = inner.getObjectByName("telinha");
      if (tel && steer) steer.attach(tel);
      // piloto: as malhas com as poses do volante (os braços acompanham o volante misturando as poses)
      const driver: THREE.Mesh[] = [];
      // (piloto, volante e telinha têm as mesmas poses: misturadas juntas, a mão não atravessa o volante)
      for (const n of ["piloto", "volante", "telinha"])
        inner.getObjectByName(n)?.traverse((o) => {
          const ms = o as THREE.Mesh;
          if (ms.isMesh && ms.morphTargetDictionary && "giro_p3" in ms.morphTargetDictionary) driver.push(ms);
        });
      // telinha: no carro detalhado, um desenho que o jogo atualiza (coordenadas de textura pela caixa dela)
      let screen: CarObj["screen"];
      if (useHd && tel)
        tel.traverse((o) => {
          const ms = o as THREE.Mesh;
          if (screen || !ms.isMesh || (ms.material as THREE.Material).name !== "telinha") return;
          const g2 = ms.geometry, pos = g2.attributes.position;
          // (a tela é um retângulo inclinado: o desenho vai pelo plano dela — horizontal pra direita do piloto,
          // que no modelo é -X, e vertical pra cima —, cobrindo de canto a canto; pela caixa em volta distorcia)
          const P = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
          const n = new THREE.Vector3().subVectors(P(1), P(0)).cross(new THREE.Vector3().subVectors(P(2), P(0))).normalize();
          const right = new THREE.Vector3(-1, 0, 0);
          const h = right.clone().addScaledVector(n, -n.dot(right)).normalize();
          const w = new THREE.Vector3().crossVectors(n, h);
          if (w.y < 0) w.negate();
          const us: number[] = [], vs: number[] = [];
          for (let i = 0; i < pos.count; i++) {
            const q = P(i);
            us.push(q.dot(h));
            vs.push(q.dot(w));
          }
          const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
          const uv = new Float32Array(pos.count * 2);
          for (let i = 0; i < pos.count; i++) {
            uv[i * 2] = (us[i] - u0) / Math.max(1e-6, u1 - u0);
            uv[i * 2 + 1] = (vs[i] - v0) / Math.max(1e-6, v1 - v0);
          }
          g2.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          const cv = document.createElement("canvas");
          cv.width = 160;
          cv.height = 80;
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          ms.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
          screen = { g: cv.getContext("2d")!, tex, t: 0 };
        });
      // freio da frente (proteção, aletas, dutos): pivô no centro da roda, só esterça junto com ela
      const brakes: THREE.Object3D[] = [];
      for (const [fn, rn] of [["freio_fe", "roda_fe"], ["freio_fd", "roda_fd"]] as const) {
        const node = inner.getObjectByName(fn);
        if (!node) continue;
        const pv = new THREE.Object3D();
        inner.add(pv);
        pv.position.copy(parts[rn].position);
        pv.updateMatrixWorld(true);
        pv.attach(node);
        brakes.push(pv);
      }
      // capas das rodas (pintadas com a cor do composto)
      const covers: THREE.Mesh[] = [];
      for (const w of ["roda_fe", "roda_fd", "roda_te", "roda_td"] as const)
        parts[w].traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && (mesh.material as THREE.Material).name.includes("wheel_cover")) covers.push(mesh);
        });
      const flap = drsFlap(parts.asa_t);
      const halves = [...splitHalves(parts.asa_d, "asa_d"), ...splitHalves(parts.asa_t, "asa_t")];
      c = { root, parts, key: "", spin: 0, seen: 0, tyre: "", covers, rings, steer, arms, head, screen, driver, brakes, strobe, blurs, flap, glow, halves };
      this.scene.add(root);
      this.cars.set(cid, c);
    }
    if (c.key !== key) {
      c.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((x) => m[x.name] ?? x) : (m[mesh.material.name] ?? mesh.material);
      });
      c.key = key;
      c.tyre = ""; // (a troca de materiais da equipe tira a cor do composto: refaz)
      // capacete: cor de cada piloto (dois da mesma equipe não ficam iguais)
      const hm = this.helmetMat(d.id, d.team);
      // câmera piloto (carro detalhado): o lado de dentro das peças é desenhado preto (a câmera fica dentro
      // da entrada de ar e enxergava através da parede)
      // (carroceria desenhada dos dois lados, o de dentro escuro: a entrada de ar e os dutos mostram o interior
      // em vez de ficarem vazados; no carro da câmera piloto, todas as peças)
      const hd = cid.endsWith("#hd");
      const shell = (n: string) => n === "pintura" || n === "asa" || n.startsWith("m_Carbon");
      const swap = (x: THREE.Material) => {
        // (borracha do pneu: cinza-grafite fosco, um pouco diferente do preto brilhante do carbono)
        if (x.name.includes("Tyre")) return this.rubberMat(x);
        const y = x.name === "capacete" ? hm : x;
        return hd || shell(y.name) ? this.backBlack(y) : y;
      };
      // (carro de jogador: capacete e macacão com a cor e o desenho da pintura dele)
      const lvP = d.team.livery;
      c.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const sw = (x: THREE.Material) => {
          if (lvP && x.name === "capacete") return this.styledMat(x, "h", lvP, mesh.geometry);
          if (lvP && x.name === "macacao") return this.styledMat(x, "s", lvP, mesh.geometry);
          return swap(x);
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(sw) : sw(mesh.material);
      });
    }
    return c;
  }

  /**
   * Desenha os carros na camada 3D e cola por cima do canvas 2D. `viewX/viewY` = canto de cima-esquerda
   * da tela em metros, `m` = px por metro (o mesmo enquadramento do 2D).
   */
  private propObjs = new Map<string, { root: THREE.Object3D; seen: number; lights: THREE.Mesh[]; glow: THREE.PointLight | null; wheels?: THREE.Object3D[]; spin?: number; lx?: number; ly?: number }>();

  /** safety car e guindaste na mesma cena dos carros (sombra e luz de verdade) */
  private drawProps(list: PropDraw[]) {
    for (const d of list) {
      const model = propModels.get(d.kind);
      if (!model) continue;
      let p = this.propObjs.get(d.id);
      if (!p) {
        const root = model.clone(true);
        const lights: THREE.Mesh[] = [];
        root.traverse((x) => {
          const mesh = x as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (this.realShadow) mesh.castShadow = true;
          // pintura do modelo vinha como metal quase puro (sem nada pra refletir, fica preta)
          const mm = mesh.material as THREE.MeshStandardMaterial;
          if (mm.metalness > 0.4) {
            mesh.material = mm.clone();
            (mesh.material as THREE.MeshStandardMaterial).metalness = 0.35;
            (mesh.material as THREE.MeshStandardMaterial).roughness = Math.min(mm.roughness, 0.35);
          }
          // giroflex: material próprio (acende e apaga)
          if (mesh.name.startsWith("giroflex")) {
            mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
            lights.push(mesh);
          }
        });
        let glow: THREE.PointLight | null = null;
        if (d.kind === "sc") {
          // a luz laranja do giroflex ilumina o carro e a pista em volta
          glow = new THREE.PointLight("#ffa020", 0, 9, 2);
          glow.position.set(0, 1.7, 0.25);
          root.add(glow);
        }
        // rodas que giram (safety car): grupos roda_*
        const wheels: THREE.Object3D[] = [];
        root.traverse((x) => x.name.startsWith("roda_") && wheels.push(x));
        p = { root, seen: 0, lights, glow, wheels, spin: 0, lx: d.x, ly: d.y };
        this.scene.add(root);
        this.propObjs.set(d.id, p);
      }
      p.seen = this.frame;
      p.root.visible = true;
      // rodas: giram pelo quanto andou desde o quadro anterior (raio 0,34 m)
      if (p.wheels?.length) {
        const dist = Math.hypot(d.x - (p.lx ?? d.x), d.y - (p.ly ?? d.y));
        if (dist < 20) p.spin = (p.spin ?? 0) + dist / 0.34;
        p.lx = d.x;
        p.ly = d.y;
        for (const w of p.wheels) w.rotation.x = p.spin ?? 0;
      }
      p.root.position.set(d.x, this.groundY + this.hAt(d.x, d.y), d.y);
      p.root.rotation.y = Math.PI / 2 - d.h;
      if (d.kind === "sc") {
        for (const l of p.lights) {
          const on = l.name.endsWith("_e") === !!d.blink;
          const mat = l.material as THREE.MeshStandardMaterial;
          mat.emissive.set(on ? "#ffa020" : "#000000");
          mat.emissiveIntensity = on ? 3 : 0;
        }
        if (p.glow) {
          p.glow.intensity = 14;
          p.glow.position.x = d.blink ? 0.4 : -0.4;
        }
      }
    }
    for (const p of this.propObjs.values()) if (p.seen !== this.frame) p.root.visible = false;
  }

  // ---- autódromo 3D (passo separado, antes das marcas de pneu e dos carros) ----
  private trackScene: THREE.Scene | null = null;
  private trackSun: THREE.DirectionalLight | null = null;
  private trackFor = "";
  private trackLoading = "";

  /** câmera inclinada (protótipo, `?camera=tv`): atrás e acima deste ponto, olhando pra frente dele */
  /** câmera inclinada; `cover` = px de baixo cobertos pelo painel dos pilotos (a de trás sobe a imagem) */
  tilt: { x: number; y: number; h: number; iso?: boolean; span?: number; yaw?: number; kind?: "iso" | "tv" | "cima" | "piloto"; cover?: number } | null = null;
  // troca de câmera: desliza da pose de antes até a nova (de cima vira uma câmera olhando reto pra baixo)
  private lastKind: string | null = null;
  /** câmera de trás: direção amortecida e o relógio de verdade */
  private tvH: number | null = null;
  private lastNow = 0;
  private curPose: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  /** pista molhada (track3d.WET): o quanto está molhada e se está secando (sem chuva) */
  setWet(wet: number, rain: number) {
    WET.uWet.value = wet;
    WET.uDry.value += ((rain > 0.02 ? 0 : 1) - WET.uDry.value) * 0.02;
  }
  private crews = new Map<string, { g: THREE.Group; figs: THREE.Group[]; sign: THREE.Mesh; at: { x: number; y: number; h: number }; out: number }>();
  /** mecânicos em volta do carro parado no box (d.pit 0..1); ficam 1,5 s depois de ele sair */
  private crew(d: CarDraw, now: number) {
    let cr = this.crews.get(d.id);
    const stopped = (d.pit ?? -1) >= 0;
    if (!stopped && !cr) return;
    if (!cr) {
      const suit = d.team.livery?.base ?? d.team.color, helm = d.team.livery?.helmet ?? "#f2f2f2";
      const g = new THREE.Group(), figs: THREE.Group[] = [];
      // [à frente (m), pro lado (m), virado pra (rad, 0 = pro bico), ajoelhado]
      const spots: [number, number, number, boolean][] = [
        [1.55, 1.3, -Math.PI / 2, true], [1.55, -1.3, Math.PI / 2, true], [-1.6, 1.3, -Math.PI / 2, true], [-1.6, -1.3, Math.PI / 2, true],
        [3.5, 0, Math.PI, false], [-3.2, 0, 0, false], [0.2, 1.45, -Math.PI / 2, false], [0.2, -1.45, Math.PI / 2, false], [4.7, 1.2, Math.PI, false],
      ];
      for (const [fwd, side, face, kneel] of spots) {
        const f = mechanic(suit, helm);
        f.position.set(side, kneel ? -0.42 : 0, fwd);
        f.rotation.set(kneel ? 0.35 : 0, face, 0, "YXZ");
        if (kneel) {
          const gun = new THREE.Mesh(crewGeo.gun, crewMat("#1b1d22"));
          gun.position.set(0, 0.9, 0.36);
          f.add(gun);
        }
        f.userData.kneel = kneel;
        g.add(f);
        figs.push(f);
      }
      // pirulito: placa redonda num cabo, na mão do último
      const pole = new THREE.Mesh(crewGeo.pole, crewMat("#cfcfcf"));
      pole.position.set(0.3, 1.9, 0.25);
      const sign = new THREE.Mesh(crewGeo.sign, crewMat("#e01e1e"));
      sign.rotation.x = Math.PI / 2;
      sign.position.set(0.3, 2.7, 0.25);
      figs[8].add(pole, sign);
      this.scene.add(g);
      cr = { g, figs, sign, at: { x: d.x, y: d.y, h: d.h }, out: 0 };
      this.crews.set(d.id, cr);
    }
    if (stopped) {
      cr.out = 0;
      cr.at = { x: d.x, y: d.y, h: d.h };
    } else if (!cr.out) cr.out = now;
    if (cr.out && now - cr.out > 1500) {
      this.scene.remove(cr.g);
      this.crews.delete(d.id);
      return;
    }
    const { x, y, h } = cr.at;
    cr.g.position.set(x, this.groundY + this.hAt(x, y), y);
    cr.g.rotation.y = Math.PI / 2 - h;
    // pistolas (as rodas): o braço tremendo enquanto apertam; no fim, mãos pra cima; pirulito verde e erguido ao soltar
    const p = d.pit ?? 1, done = !stopped || p > 0.92;
    cr.figs.forEach((f, i) => {
      const [l, r] = f.userData.arms as THREE.Object3D[];
      const shake = f.userData.kneel && !done ? Math.sin(now / 22 + i) * 0.12 : 0;
      const up = done && i < 4 ? -2.6 : f.userData.kneel ? -1.2 : -0.25;
      l.rotation.x = up + shake;
      r.rotation.x = up - shake;
    });
    (cr.sign.material as THREE.Material) = crewMat(done ? "#1fb84a" : "#e01e1e");
    cr.figs[8].rotation.x = done ? -0.25 : 0;
  }

  /** céu fechando antes da chuva (0 = limpo, 1 = carregado): luz mais fraca, céu e neblina cinza */
  cloud = 0;
  /** telões: câmera ao vivo do carro seguido (alterna com a classificação; no replay fica nela) */
  private screenRT: THREE.WebGLRenderTarget | null = null;
  private screenCam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 900);
  private screenN = 0;
  screenLive = false;

  /** câmera parada na beira da pista (x, y do mundo), olhando o carro: replay, largada, bandeirada e Modo TV */
  replayCam: { x: number; y: number } | null = null;
  /** a próxima troca de câmera é corte seco (Modo TV), sem a transição de 0,9 s */
  cutNow = false;
  /** tomada da TV (MultiCam) valendo agora (null = a câmera escolhida) */
  camSpec: CamSpec | null = null;
  /** câmera drone (tecla 8): solta no mundo (x, z do chão, y altura; yaw/pitch em rad). Manda em cima de todas */
  freeCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;
  /** onde a câmera está agora (pro drone sair dali) */
  camNow() {
    const c = this.curPose;
    return c ? { pos: c.pos.clone(), look: c.look.clone() } : null;
  }
  /** tomada presa no carro: puxa a câmera (x, z do mundo) pra antes do muro; null = já está no lugar (renderer) */
  camFit: ((x: number, z: number) => { x: number; y: number } | null) | null = null;
  private specRef: CamSpec | null = null;
  private specH: number | null = null;
  private specT = 0;
  private specT0 = 0;
  /** onde fica a câmera de uma tomada da TV: fixa olhando o carro; presa, pela direção dele suavizada (curva longa não
   *  balança a câmera) — a posição é a exata do carro, sem atraso */
  private specPose(tf: { x: number; y: number; h: number }, sp: CamSpec) {
    const now = performance.now(), dt = Math.min(0.1, (now - (this.specT || now)) / 1000), snap = sp !== this.specRef;
    this.specT = now;
    if (snap) this.specT0 = now;
    this.specRef = sp;
    if (sp.fixa) return { pos: new THREE.Vector3(sp.x, this.hAt(sp.x, sp.y) + sp.h, sp.y), look: new THREE.Vector3(tf.x, this.hAt(tf.x, tf.y) + 0.8, tf.y), fov: sp.fov };
    if (snap || this.specH == null) this.specH = tf.h;
    else {
      const dh = Math.atan2(Math.sin(tf.h - this.specH), Math.cos(tf.h - this.specH));
      this.specH += dh * (1 - Math.exp(-dt * 4));
    }
    const fx = Math.cos(this.specH), fz = Math.sin(this.specH);
    // (girando: a câmera dá a volta no carro na distância back, começando de onde side manda)
    let back = sp.back, side = sp.side;
    if (sp.orbit) {
      const a = Math.atan2(sp.side, sp.back) + sp.orbit * ((now - this.specT0) / 1000), rr = Math.hypot(sp.back, sp.side);
      [back, side] = [rr * Math.cos(a), rr * Math.sin(a)];
    }
    let px = tf.x - fx * back - fz * side, pz = tf.y - fz * back + fx * side;
    const fit = this.camFit?.(px, pz), lx = tf.x + fx * sp.look, lz = tf.y + fz * sp.look;
    if (fit) [px, pz] = [fit.x, fit.y];
    return { pos: new THREE.Vector3(px, this.hAt(px, pz) + sp.h, pz), look: new THREE.Vector3(lx, this.hAt(lx, lz) + 0.8, lz), fov: sp.fov };
  }
  private hadReplay = false;
  private trans: { from: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }; t0: number } | null = null;
  /** ainda deslizando de uma câmera pra outra? (o renderer segura a cena 3D até acabar) */
  transitioning() {
    return !!this.trans;
  }
  /** altura do chão dos carros (inclinada: em cima do asfalto 3D, que fica uns centímetros acima do chão) */
  private groundY = 0;
  /** relevo do autódromo (null: plano) */
  private terrain: Terrain | null = null;
  // ---- câmera onboard 3D: a cena vista do olho do piloto, numa imagem pequena (lida da placa de vídeo) ----
  private obTarget: THREE.WebGLRenderTarget | null = null;
  private obCam = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 1600);
  private obCache = new Map<string, { cv: HTMLCanvasElement; t: number }>();
  private obBuf: Uint8Array | null = null;

  /** desenha a vista de dentro do carro `id` (em x, y olhando pra h) em g; false se o autódromo não está pronto */
  drawOnboard(g: CanvasRenderingContext2D, W: number, H: number, id: string, x: number, y: number, h: number): boolean {
    if (!this.trackGroup || !this.trackScene) return false;
    const now = performance.now();
    let c = this.obCache.get(id);
    if (!c) this.obCache.set(id, (c = { cv: document.createElement("canvas"), t: 0 }));
    // (umas 20 vezes por segundo: no meio, repete a última imagem)
    if (now - c.t > 48) {
      c.t = now;
      // (tela cheia: imagem maior; nos cards, pequena e leve)
      const w = Math.min(W > 700 ? 1100 : 480, Math.round(W)), hh = Math.max(1, Math.round((w * H) / W));
      if (!this.obTarget || this.obTarget.width !== w || this.obTarget.height !== hh) {
        this.obTarget?.dispose();
        this.obTarget = new THREE.WebGLRenderTarget(w, hh, { samples: 0 });
        this.obTarget.texture.colorSpace = THREE.SRGBColorSpace;
        this.obBuf = new Uint8Array(w * hh * 4);
      }
      const cam = this.obCam, fx = Math.cos(h), fz = Math.sin(h), gh = this.hAt(x, y);
      cam.aspect = w / hh;
      cam.updateProjectionMatrix();
      cam.position.set(x + fx * 0.3, gh + 1.0, y + fz * 0.3);
      cam.lookAt(x + fx * 30, this.hAt(x + fx * 30, y + fz * 30) + 0.7, y + fz * 30);
      // o próprio carro some (a câmera está dentro dele); céu e neblina só nesta foto
      const me = this.cars.get(id)?.root ?? this.cars.get(`${id}#hd`)?.root, wasVis = me?.visible ?? false;
      if (me) me.visible = false;
      const r = this.renderer, tilt = this.trackGroup.parent === this.scene;
      const first = tilt ? this.scene : this.trackScene;
      const bg = first.background, fog = first.fog, sky = new THREE.Color("#74c6f2");
      first.background = sky;
      first.fog = new THREE.Fog(sky, 250, 1400);
      r.setRenderTarget(this.obTarget);
      r.clear();
      r.render(first, cam);
      if (!tilt) {
        const ac = r.autoClear;
        r.autoClear = false;
        r.render(this.scene, cam);
        r.autoClear = ac;
      }
      r.readRenderTargetPixels(this.obTarget, 0, 0, w, hh, this.obBuf!);
      r.setRenderTarget(null);
      first.background = bg;
      first.fog = fog;
      if (me) me.visible = wasVis;
      // (a placa de vídeo entrega de baixo pra cima: vira)
      if (c.cv.width !== w || c.cv.height !== hh) {
        c.cv.width = w;
        c.cv.height = hh;
      }
      const img = new ImageData(w, hh), row = w * 4;
      for (let j = 0; j < hh; j++) img.data.set(this.obBuf!.subarray((hh - 1 - j) * row, (hh - j) * row), j * row);
      c.cv.getContext("2d")!.putImageData(img, 0, 0);
    }
    g.drawImage(c.cv, 0, 0, W, H);
    return true;
  }

  /** barreiras do autódromo montado (pontos a cada ~1 m), pra corrida bater nelas (Race.setWalls) */
  wallPts: [number, number][] | null = null;
  /** peças do autódromo (troca a torcida de perto/de longe pela câmera) */
  private trackLayer: PieceLayer | null = null;
  private hAt = (x: number, z: number) => (this.terrain ? this.terrain.heightAt(x, z) : 0);
  private projW = 0;
  private projH = 0;
  private tmpV = new THREE.Vector3();

  /** câmera inclinada: ponto do mundo (no chão, ou a hgt metros) -> pixel da tela (do último quadro) */
  project(x: number, y: number, hgt = 0) {
    const v = this.tmpV.set(x, this.groundY + this.hAt(x, y) + hgt, y).project(this.persp);
    if (v.z > 1) return { x: -1e5, y: -1e5 };
    return { x: ((v.x + 1) / 2) * this.projW, y: ((1 - v.y) / 2) * this.projH };
  }
  /** pixels por metro em volta de um ponto (média das duas direções do chão) */
  scaleAt(x: number, y: number) {
    const a = this.project(x, y), b = this.project(x + 1, y), c = this.project(x, y + 1);
    return (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 2;
  }
  private hemi!: THREE.HemisphereLight;
  private persp = new THREE.PerspectiveCamera(42, 16 / 9, 1.5, 3000);
  /** câmera piloto: direção (a mesma do carro seguido) e a hora do último quadro */
  private pilotH: number | null = null;
  private pilotNow = 0;
  /** câmera de trás: altura do chão embaixo dela, suavizada */
  private camGh: number | null = null;
  private trackGroup: THREE.Object3D | null = null;
  private skidMesh: THREE.Mesh | null = null;
  private stainMesh: THREE.Mesh | null = null;
  private dotMesh: THREE.Mesh | null = null;
  private chips: THREE.InstancedMesh | null = null;

  /**
   * câmeras 3D: o que fica no chão (desenhado por cima da imagem pronta passava por cima dos carros):
   * - as marcas (carFx.Skid): borracha, sulco na brita, trilha de lama/areia, raspão — cada uma com a cor e a
   *   largura dela, mais clara conforme a idade;
   * - as manchas (carFx.Spot): óleo (mancha irregular), pedrisco e terra que o carro trouxe pra pista (pontinhos);
   * - os pedaços do carro: lascas de fibra e da carenagem (cor da equipe) deitadas no chão.
   * null = esconde
   */
  /** teste (&muros): onde a CORRIDA acha que o muro está (linha vermelha, vista através de tudo), pra comparar com o desenhado */
  private wallLine: THREE.Group | null = null;
  showWallLine(sides: [number, number][][]) {
    if (this.wallLine) this.scene.remove(this.wallLine);
    const g = new THREE.Group(), mat = new THREE.LineBasicMaterial({ color: 0xff2020, depthTest: false, transparent: true });
    for (const pts of sides) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.5, z))), mat);
      line.renderOrder = 999;
      g.add(line);
    }
    this.scene.add(g);
    this.wallLine = g;
  }
  skidMarks(list: readonly Skid[] | null, spots: readonly Spot[] | null = null) {
    const ground = (x: number, y: number, up: number) => this.groundY + this.hAt(x, y) + up;
    // (iluminado como o chão: na sombra dos carros e das arquibancadas a marca escurece junto)
    const flat = (mesh: THREE.Mesh | null, order: number, map?: THREE.Texture) => {
      if (mesh) return mesh;
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 - order, ...(map ? { map } : {}) });
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.frustumCulled = false;
      m.receiveShadow = this.realShadow;
      m.renderOrder = 4 + order;
      this.scene.add(m);
      return m;
    };
    // ---- marcas: cada tipo com o desenho dele (markAtlas), a cor vem da textura e a idade apaga ----
    if (!list?.length) {
      if (this.skidMesh) this.skidMesh.visible = false;
    } else {
      this.skidMesh = flat(this.skidMesh, 1, markAtlas());
      const n = list.length, pos = new Float32Array(n * 18), col = new Float32Array(n * 24), uv = new Float32Array(n * 12), nor = new Float32Array(n * 18);
      list.forEach((s, i) => {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * (s.w / 2), ny = (dx / l) * (s.w / 2);
        const ya = ground(s.x1, s.y1, 0.008), yb = ground(s.x2, s.y2, 0.008);
        pos.set([s.x1 - nx, ya, s.y1 - ny, s.x1 + nx, ya, s.y1 + ny, s.x2 + nx, yb, s.y2 + ny, s.x1 - nx, ya, s.y1 - ny, s.x2 + nx, yb, s.y2 + ny, s.x2 - nx, yb, s.y2 - ny], i * 18);
        // (linha do tipo no atlas; ao longo, o desenho repete a cada 1,2 m — começa num ponto qualquer, sem emenda)
        const row = MARK_ROW[s.k], v0 = 1 - (row * 64 + 61) / 320, v1 = 1 - (row * 64 + 3) / 320;
        const u0 = (((s.x1 * 7.3 + s.y1 * 3.1) % 1) + 1) % 1, u1 = u0 + l / 1.2;
        uv.set([u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0], i * 12);
        // (apaga no último terço da vida)
        const life = s.k === "pneu" ? 45 : 135, a = Math.min(1, Math.max(0, (life - s.t) / (life * 0.35)));
        for (let k = 0; k < 6; k++) {
          col.set([1, 1, 1, a], i * 24 + k * 4);
          nor.set([0, 1, 0], i * 18 + k * 3);
        }
      });
      const g = this.skidMesh.geometry;
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 4));
      this.skidMesh.visible = true;
    }
    // ---- manchas: óleo (mancha) e pedrisco/terra (pontinhos), cada uma um quadrado deitado e girado ----
    const quads = (mesh: THREE.Mesh, items: Spot[], up: number) => {
      const n = items.length, pos = new Float32Array(n * 18), uv = new Float32Array(n * 12), col = new Float32Array(n * 24), nor = new Float32Array(n * 18);
      for (let k = 0; k < n * 6; k++) nor.set([0, 1, 0], k * 3);
      items.forEach((s, i) => {
        const c = Math.cos(s.rot) * s.r, sn = Math.sin(s.rot) * s.r, y = ground(s.x, s.y, up);
        const P = [
          [s.x - c + sn, s.y - sn - c],
          [s.x + c + sn, s.y + sn - c],
          [s.x + c - sn, s.y + sn + c],
          [s.x - c - sn, s.y - sn + c],
        ];
        [0, 1, 2, 0, 2, 3].forEach((k, j) => {
          pos.set([P[k][0], y, P[k][1]], i * 18 + j * 3);
          uv.set([k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0], i * 12 + j * 2);
        });
        const [r, g, b, al] = SPOT_COLOR[s.k as Exclude<Spot["k"], "detrito">];
        for (let k = 0; k < 6; k++) col.set([r / 255, g / 255, b / 255, al * Math.max(0, 1 - s.t / 600)], i * 24 + k * 4);
      });
      const g = mesh.geometry;
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 4));
      mesh.visible = n > 0;
    };
    const stains = spots?.filter((s) => s.k === "oleo") ?? [], dots = spots?.filter((s) => s.k === "pedrisco" || s.k === "terra") ?? [];
    if (stains.length || this.stainMesh) quads((this.stainMesh = flat(this.stainMesh, 0, stainTex())), stains, 0.006);
    if (dots.length || this.dotMesh) quads((this.dotMesh = flat(this.dotMesh, 2, dotTex())), dots, 0.012);
    // ---- pedaços do carro no chão: lascas finas, giradas ----
    const chips = spots?.filter((s) => s.k === "detrito") ?? [];
    if (chips.length && !this.chips) {
      this.chips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25 }), 600);
      this.chips.frustumCulled = false;
      this.scene.add(this.chips);
    }
    if (this.chips) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
      const n = Math.min(chips.length, 600);
      for (let i = 0; i < n; i++) {
        const s = chips[i];
        // (um pouco torta: lasca caída não fica reta)
        e.set(((i * 37) % 7) * 0.05 - 0.15, -s.rot, ((i * 53) % 5) * 0.06 - 0.12);
        m4.compose(new THREE.Vector3(s.x, ground(s.x, s.y, 0.02), s.y), q.setFromEuler(e), new THREE.Vector3(s.r * 2, 0.03, s.r * 0.8));
        this.chips.setMatrixAt(i, m4);
        this.chips.setColorAt(i, col.set(s.c));
      }
      this.chips.count = n;
      this.chips.instanceMatrix.needsUpdate = true;
      if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
      this.chips.visible = n > 0;
    }
  }

  /** pedaços grandes que soltaram (asa, roda — as peças 3D do próprio carro —, bico, espelho, placa, pneu da barreira) */
  private flying = new Map<object, { wrap: THREE.Group; tumble: THREE.Group; roll: THREE.Group; hx: number; hy: number; hz: number }>();
  /**
   * câmeras 3D: os pedaços soltos (renderer.debris, com a física de lá: altura, capotada, a roda rolando em pé).
   * Asa e roda são cópias da peça do carro (com a pintura dele); bico, espelhos, placas de fibra e pneus da barreira
   * são peças simples. null = tira todos
   */
  debris3d(list: readonly { x: number; y: number; h: number; z: number; tx: number; tz: number; roll: number; node: string; carId: string; c?: string; half?: "l" | "r" }[] | null) {
    const alive = new Set<object>();
    for (const d of list ?? []) {
      let f = this.flying.get(d);
      if (!f) {
        let piece: THREE.Object3D | null = null;
        const scale = new THREE.Vector3(1, 1, 1);
        if (d.node.startsWith("asa") || d.node.startsWith("roda")) {
          const car = this.cars.get(d.carId) ?? this.cars.get(`${d.carId}#lo`) ?? this.cars.get(`${d.carId}#hd`);
          const src = car?.parts[d.node as Part];
          if (!src?.parent) continue;
          piece = src.clone(true);
          piece.visible = true;
          // (meia asa: só a metade que voou; a outra continua no carro)
          // (tira a outra metade da cópia: escondida, ela ainda entraria na caixa e a peça giraria em volta do meio da asa)
          const drop: THREE.Object3D[] = [];
          piece.traverse((o) => {
            if (o.userData.half) (d.half && o.userData.half !== d.half ? drop : []).push(o);
            if (o.userData.half) o.visible = true;
          });
          for (const o of drop) o.removeFromParent();
          piece.position.set(0, 0, 0);
          piece.rotation.set(0, 0, 0);
          scale.copy(src.parent.getWorldScale(new THREE.Vector3()));
        } else piece = debrisPiece(d.node, d.c ?? "#22242a");
        if (!piece) continue;
        const roll = new THREE.Group(), tumble = new THREE.Group(), wrap = new THREE.Group();
        roll.add(piece);
        tumble.add(roll);
        wrap.add(tumble);
        wrap.scale.copy(scale);
        wrap.updateMatrixWorld(true);
        // (o centro da peça no meio do pedaço; o tamanho dela pra pousar no chão sem afundar)
        const bx = new THREE.Box3().setFromObject(piece), ctr = bx.getCenter(new THREE.Vector3()).applyMatrix4(wrap.matrixWorld.clone().invert());
        piece.position.sub(ctr);
        const sz = bx.getSize(new THREE.Vector3());
        piece.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = this.realShadow) : null));
        this.scene.add(wrap);
        this.flying.set(d, (f = { wrap, tumble, roll, hx: sz.x / 2, hy: sz.y / 2, hz: sz.z / 2 }));
      }
      alive.add(d);
      // (quanto o pedaço ocupa pra baixo, virado como está: pousa encostando no chão)
      const half = Math.abs(Math.cos(d.tx)) * (f.hy * Math.abs(Math.cos(d.tz)) + f.hx * Math.abs(Math.sin(d.tz))) + Math.abs(Math.sin(d.tx)) * f.hz;
      f.wrap.position.set(d.x, this.groundY + this.hAt(d.x, d.y) + half + d.z, d.y);
      f.wrap.rotation.y = Math.PI / 2 - d.h;
      f.tumble.rotation.set(d.tx, 0, d.tz);
      f.roll.rotation.x = d.roll;
    }
    for (const [d, f] of this.flying)
      if (!alive.has(d)) {
        this.scene.remove(f.wrap);
        this.flying.delete(d);
      }
  }

  /** nuvens (fumaça, poeira) e lascas voando, na cena das câmeras 3D */
  private puffs: Billboards | null = null;
  private flyMesh: THREE.InstancedMesh | null = null;
  /**
   * câmeras 3D: fumaça e poeira do carFx como nuvens na cena (sobem, crescem, somem; ficam atrás de carro e barreira
   * quando devem) e as lascas/pedrinhas que voam como pedacinhos com altura. null = esconde
   */
  airFx(list: readonly FxPart[] | null) {
    const bb: Billboard[] = [], fly: FxPart[] = [];
    for (const q of list ?? []) {
      if (q.z != null) {
        fly.push(q);
        continue;
      }
      if (q.kind !== "fumaca" && q.kind !== "poeira") continue;
      const k = q.t / q.life, smoke = q.kind === "fumaca";
      const [r, g, bl] = rgbOf(q.c, smoke ? [0.84, 0.84, 0.86] : [0.63, 0.52, 0.36]);
      // (fumaça sobe e abre; poeira fica baixa e espalha)
      const size = (q.size + k * (smoke ? 1.5 : 2.3)) * 2.2;
      bb.push({ x: q.x, y: this.groundY + this.hAt(q.x, q.y) + (smoke ? 0.5 + k * 2.6 : 0.25 + k * 0.9) + size * 0.25, z: q.y, size, r, g, b: bl, a: (smoke ? 0.38 : 0.55) * Math.pow(1 - k, 1.3), rot: (q.x * 13.7 + q.y * 7.1) % 6.28 });
    }
    if (bb.length || this.puffs) {
      if (!this.puffs) {
        this.puffs = new Billboards(700);
        this.scene.add(this.puffs.mesh);
      }
      this.puffs.update(bb, this.persp.position);
    }
    if (fly.length || this.flyMesh) {
      if (!this.flyMesh) {
        this.flyMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 }), 500);
        this.flyMesh.frustumCulled = false;
        this.flyMesh.castShadow = this.realShadow;
        this.scene.add(this.flyMesh);
      }
      const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), n = Math.min(fly.length, 500);
      for (let i = 0; i < n; i++) {
        const q = fly[i], r = q.rot ?? 0;
        // (fibra: lasca fina; pedra: pedrinha; grama/lama: torrão achatado)
        const sc = q.kind === "fibra" ? new THREE.Vector3(q.size * 2, 0.03, q.size) : q.kind === "pedra" ? new THREE.Vector3(q.size, q.size, q.size) : new THREE.Vector3(q.size * 1.4, q.size * 0.5, q.size);
        e.set(r * 0.7, -r, r * 0.45);
        m4.compose(new THREE.Vector3(q.x, this.groundY + this.hAt(q.x, q.y) + (q.z ?? 0) + sc.y / 2, q.y), qt.setFromEuler(e), sc);
        this.flyMesh.setMatrixAt(i, m4);
        this.flyMesh.setColorAt(i, col.set(q.c ?? "#555"));
      }
      this.flyMesh.count = n;
      this.flyMesh.instanceMatrix.needsUpdate = true;
      if (this.flyMesh.instanceColor) this.flyMesh.instanceColor.needsUpdate = true;
      this.flyMesh.visible = n > 0;
    }
  }

  /** que barreira tem perto de cada ponto (pneu, guardrail, muro, alambrado), numa grade de 4 m */
  private wallKinds = new Map<number, [number, number, string][]>();
  /** a barreira mais perto de (x, y) até 4 m: "pneu", "guardrail", "muro" (concreto), "alambrado" ou "" */
  barrierKindAt(x: number, y: number): string {
    const ci = Math.floor(x / 4), cj = Math.floor(y / 4);
    let best = 16, kind = "";
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const [px, py, k] of this.wallKinds.get(i * 100003 + j) ?? []) {
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d < best) {
            best = d;
            kind = k;
          }
        }
    return kind === "pneu" || kind === "pneus" || kind === "blocopneus" ? "pneu" : kind === "guardrail" ? "guardrail" : kind === "alambrado" ? "alambrado" : kind ? "muro" : "";
  }

  /** marcas da batida na barreira (borracha e tinta do carro), as mais novas */
  private scuffs: THREE.Mesh[] = [];
  /** marca de borracha e de tinta (cor da equipe) na barreira, onde o carro raspou; de frente pra pista */
  scuff(x: number, y: number, h: number, side: number, len: number, color: string) {
    const nx = -Math.sin(h) * side, nz = Math.cos(h) * side;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.42), new THREE.MeshLambertMaterial({ map: scuffTex(color), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(x - nx * 0.05, this.groundY + this.hAt(x, y) + 0.32, y - nz * 0.05);
    m.rotation.y = Math.atan2(-nx, -nz);
    this.scene.add(m);
    this.scuffs.push(m);
    while (this.scuffs.length > 24) {
      const o = this.scuffs.shift()!;
      this.scene.remove(o);
      o.geometry.dispose();
    }
  }

  /** o chão do autódromo 3D desta pista (pro carFx saber se é brita, grama, asfalto...) */
  groundSrc: GroundSrc | null = null;

  /** começa a montar o autódromo 3D desta pista; true quando pronto */
  ensureTrack(track: Track): boolean {
    if (this.trackFor !== track.name) {
      this.drawTrack(null, 0, 0, 1, 0, 0, track);
      return false;
    }
    return true;
  }

  /** desenha o autódromo 3D (false = ainda montando ou sem: o renderer usa a pista 2D) */
  drawTrack(o: CanvasRenderingContext2D | null, W: number, H: number, m: number, viewX: number, viewY: number, track: Track): boolean {
    if (this.trackFor !== track.name) {
      if (this.trackLoading !== track.name) {
        this.trackLoading = track.name;
        void takeTrack3d(track, this.realShadow).then((res) => {
          this.terrain = res.relief ? res.terrain : null;
          if (!res) return;
          const { group, tris, real } = res;
          const sc = new THREE.Scene();
          // (mesma luz das câmeras inclinadas: trocar de câmera não muda a cor do autódromo)
          sc.add(new THREE.HemisphereLight("#dfe8ff", "#3a3a32", 1.05));
          const sun = new THREE.DirectionalLight("#ffffff", 2.3);
          if (this.realShadow) {
            sun.castShadow = true;
            sun.shadow.mapSize.set(2048, 2048);
            sun.shadow.bias = -0.0005;
            sun.shadow.normalBias = 0.05;
            sun.shadow.radius = 3;
          }
          sc.add(sun, sun.target, group);
          this.trackGroup = group;
          this.trackScene = sc;
          this.trackSun = sun;
          this.trackFor = track.name;
          // barreiras: as linhas (amostradas a cada 1 m) e as peças (o meio e as pontas, ~4 m)
          this.wallPts = wallPoints(res.paths.items, res.layer.pieces);
          // (que barreira tem em cada lugar: pro som da batida, a marca nela e os pneus voando)
          this.wallKinds = new Map();
          const addK = (x: number, y: number, k: string) => {
            const key = Math.floor(x / 4) * 100003 + Math.floor(y / 4);
            let l = this.wallKinds.get(key);
            if (!l) this.wallKinds.set(key, (l = []));
            l.push([x, y, k]);
          };
          for (const it of res.paths.items) if (WALL_PATHS.has(it.t)) for (const [x, y] of samplePath(it, 1)) addK(x, y, it.t);
          for (const pc of res.layer.pieces) if (WALL_PIECES.has(pc.k)) addK(pc.x, pc.z, pc.k);
          // (o chão do autódromo: pros efeitos de acidente saberem se é brita, grama, asfalto)
          this.groundSrc = { items: res.paths.items, orderOf, samplePath };
          this.trackLayer = res.layer;
          console.info(`pista 3D: ${track.name}, ${tris.toLocaleString("pt-BR")} triângulos${real ? ", com o entorno real" : ""}`);
          (window as unknown as { __pista3d: unknown }).__pista3d = { tris, real };
        });
      }
      return false;
    }
    if (!o) return true;
    const cam = this.setView(W, H, m, viewX, viewY);
    const sun = this.trackSun!;
    const hw = W / m / 2, hh = H / m / 2, cx = viewX + hw, cz = viewY + hh;
    // sol alto e longe (arquibancadas e árvores passam de 12 m: com o sol baixo a sombra quebrava e cortava);
    // o centro anda de texel em texel pra sombra não tremer quando a câmera anda
    const ext = Math.max(hw, hh) * 1.25;
    const tx = ((2 * ext) / sun.shadow.mapSize.x) * 2;
    const sx = Math.round(cx / tx) * tx, sz = Math.round(cz / tx) * tx;
    sun.position.set(sx - 60, 150, sz - 80);
    sun.target.position.set(sx, 0, sz);
    sun.target.updateMatrixWorld();
    if (sun.castShadow) {
      const sc = sun.shadow.camera;
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.near = 1;
      sc.far = 400;
      sc.updateProjectionMatrix();
    }
    this.renderer.toneMappingExposure = 0.85;
    // (de cima a câmera fica alta: na média e na baixa, tudo é de longe)
    this.trackLayer?.lod(cam.position, SCENE_LOD_DIST[gfx().sceneQ]);
    this.renderer.render(this.trackScene!, cam);
    o.drawImage(this.renderer.domElement, 0, 0, W, H);
    return true;
  }

  /** tamanho e câmera de cima, no mesmo enquadramento do 2D */
  private setView(W: number, H: number, m: number, viewX: number, viewY: number) {
    const dpr = this.hq ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const r = this.renderer;
    if (r.getPixelRatio() !== dpr) r.setPixelRatio(dpr);
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H) r.setSize(W, H, false);
    const hw = W / m / 2, hh = H / m / 2, cam = this.camera;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.updateProjectionMatrix();
    cam.position.set(viewX + hw, 60, viewY + hh);
    cam.lookAt(viewX + hw, 0, viewY + hh);
    return cam;
  }

  draw(o: CanvasRenderingContext2D, W: number, H: number, m: number, viewX: number, viewY: number, list: CarDraw[], dt: number, props: PropDraw[] = []) {
    if (!model) return;
    this.frame++;
    // desempenho: sem antisserrilhado e em 1x (na vista de cima o carro é pequeno e isso pesa muito)
    const dpr = this.hq ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const r = this.renderer;
    if (r.getPixelRatio() !== dpr) r.setPixelRatio(dpr);
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H) r.setSize(W, H, false);
    const hw = W / m / 2, hh = H / m / 2;
    const cam = this.camera;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.updateProjectionMatrix();
    const tf = this.tilt;
    this.groundY = tf ? 0.1 : 0;
    // câmera piloto: a direção dela é calculada antes dos carros, e o carro seguido usa a MESMA (presa nele,
    // como uma onboard de verdade). Com direções diferentes o cockpit girava embaixo da câmera e o carro
    // parecia escorregar/tremer
    if (tf?.kind === "piloto") {
      const now = performance.now(), rdt = Math.min(0.1, (now - (this.pilotNow || now)) / 1000);
      this.pilotNow = now;
      if (this.pilotH == null) this.pilotH = tf.h;
      let dh = tf.h - this.pilotH;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.pilotH += dh * (1 - Math.exp(-rdt * 10));
    } else this.pilotH = null;
    const cx = tf ? tf.x : viewX + hw, cz = tf ? tf.y : viewY + hh;
    cam.position.set(cx, 60, cz);
    cam.lookAt(cx, 0, cz);
    if (this.shadowFloor) {
      // sombra só na parte da pista que aparece (o mapa de sombra cobre a tela; inclinada: em volta do carro)
      // (câmera piloto: o carro fica a centímetros; sombra em 40 m em volta, 2x mais nítida que os 90 da de trás)
      const pil = tf?.kind === "piloto";
      const sh = tf ? (tf.iso ? Math.max(90, (tf.span ?? 100) * 0.95) : pil ? 40 : 90) : Math.max(hw, hh);
      // (de perto a sombra se desenhava na própria carroceria em listras: afasta mais da superfície)
      // (o bias é fração da profundidade da sombra: inclinada ela vai de 1 a 400 m e -0,0005 virava ~20 cm — a sombra
      // do pneu começava longe do chão e, de cima, aparecia asfalto entre os dois: o pneu parecia no ar. ~3 cm agora;
      // as listras na carroceria ficam com o normalBias, que anda pela superfície)
      this.sun.shadow.normalBias = pil ? 0.045 : tf ? 0.03 : 0.02;
      this.sun.shadow.bias = pil ? -0.0012 : tf ? -0.00008 : -0.0005;
      // (inclinada: o chão do autódromo já recebe a sombra; o chão de sombra por cima escurecia um quadrado)
      this.shadowFloor.visible = !tf;
      this.shadowFloor.position.set(cx, 0.01, cz);
      this.shadowFloor.scale.set(tf ? sh * 2.4 : hw * 2.4, tf ? sh * 2.4 : hh * 2.4, 1);
      const sc = this.sun.shadow.camera;
      const ext = sh * 1.2;
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.near = 1;
      sc.far = tf ? 400 : 80;
      sc.updateProjectionMatrix();
      // sol mais baixo: com ele quase em cima a sombra ficava escondida embaixo do carro
      // (inclinada: sol mais alto e longe, pras árvores e arquibancadas; o centro anda de texel em texel pra sombra não tremer)
      const tx = tf ? ((2 * ext) / this.sun.shadow.mapSize.x) * 2 : 0;
      const sx = tf ? Math.round(cx / tx) * tx : cx, sz = tf ? Math.round(cz / tx) * tx : cz;
      // (inclinada: menos luz ambiente e mais sol, pra sombra marcar e as cores não lavarem)
      this.hemi.intensity = (tf ? 1.05 : 1.3) * (1 - 0.28 * this.cloud);
      this.sun.intensity = (tf ? 2.3 : 2.2) * (1 - 0.6 * this.cloud);
      // (céu fechado: a mancha do sol enfraquece e a de contato fica mais forte; no asfalto molhado escuro ela sumia)
      if (blobM) blobM.opacity = 1 - 0.5 * this.cloud;
      contactMat().opacity = 0.7 + 0.25 * this.cloud;
      this.renderer.toneMappingExposure = tf ? 0.85 : 1;
      if (tf) this.sun.position.set(sx - 60, 150, sz - 80);
      else this.sun.position.set(cx - 14, 12, cz - 18);
      this.sun.target.position.set(sx, 0, sz);
      this.sun.target.updateMatrixWorld();
    }
    for (const d of list) {
      const c = this.carFor(d);
      c.seen = this.frame;
      if (c.tyre !== d.compound) {
        c.tyre = d.compound;
        const mat = this.tyreMat(d.compound, c.covers[0]?.material as THREE.MeshStandardMaterial | undefined);
        if (mat) for (const cv of [...c.covers, ...c.rings]) cv.material = mat;
      }
      c.root.visible = true;
      // pendurado no guindaste: sobe de verdade (1,6 m, no gancho da lança estendida; mais alto a sombra caía longe); no 3D não aumenta de tamanho
      const up = d.lift ?? 0;
      c.root.position.set(d.x, this.groundY + this.hAt(d.x, d.y) + (up > 0 ? up * 1.6 : (d.scale - 1) * 3) + (d.jack ?? 0), d.y);
      const blob = c.root.getObjectByName("blob");
      if (blob) {
        blob.visible = !!tf && up <= 0 && this.realShadow;
        // (o sol vem de -x/-z: a sombra cai ~0,9 m pra +x/+z no mundo; o carro gira, então desfaz o giro dele)
        // (céu fechado/chuva: sem sol a sombra vem pra baixo do carro — deslocada, de cima, parecia o carro no ar)
        const sun = 1 - 0.85 * this.cloud, ry = Math.PI / 2 - d.h, wx = 0.54 * sun, wz = 0.72 * sun;
        blob.position.set(wx * Math.cos(ry) - wz * Math.sin(ry), 0.008, wx * Math.sin(ry) + wz * Math.cos(ry));
      }
      const contact = c.root.getObjectByName("contato");
      if (contact) contact.visible = !!tf && up <= 0;
      // nariz do modelo pra +Z; no 2D a direção h aponta pra (cos h, sen h) = (X, Z)
      // (câmera piloto: o carro seguido gira junto com a câmera)
      const onboardMe = tf?.kind === "piloto" && d.id === this.followId && this.pilotH != null;
      c.root.rotation.y = Math.PI / 2 - (onboardMe ? this.pilotH! : d.h);
      // carroceria reage: freando o bico afunda, acelerando a traseira agacha (F1 é duro: no máximo ~1°).
      // Aceleração pela velocidade, filtrada (ela chega aos degraus, a cada estado da corrida)
      if (dt > 0) {
        const a = c.lastV === undefined ? 0 : (d.v - c.lastV) / dt;
        c.accSm = (c.accSm ?? 0) + (Math.max(-60, Math.min(60, a)) - (c.accSm ?? 0)) * (1 - Math.exp(-dt * 5));
      }
      c.lastV = d.v;
      // freio: esquenta nas freadas fortes e esfria devagar; quente, os recortes da tampa da roda brilham vermelhos
      // (o disco em brasa aparecendo por eles)
      if (dt > 0) c.heat = Math.max(0, Math.min(1, (c.heat ?? 0) + Math.max(0, -(c.accSm ?? 0) - 18) * dt * 0.08 - dt * 0.3));
      const hot = Math.pow(c.heat ?? 0, 1.4);
      for (const g of c.glow ?? []) (g.material as THREE.MeshLambertMaterial).emissive.setRGB(1.6 * hot, 0.32 * hot, 0.04 * hot);
      this.crew(d, performance.now());
      c.root.rotation.order = "YXZ";
      // (câmera piloto no próprio carro: sem, a câmera não acompanha o mergulho e o cockpit balançava)
      c.root.rotation.x = up > 0 || onboardMe ? 0 : Math.max(-0.012, Math.min(0.018, -(c.accSm ?? 0) * 0.0006));
      c.root.scale.setScalar(up > 0 ? 1 : d.scale);
      const L = d.look;
      // destruído: apoiado onde falta a roda (aquele canto desce; a roda 0 é a da frente do lado esquerdo, +X)
      const lostI = up > 0 ? -1 : L.wheels.indexOf("off");
      c.root.rotation.z = lostI >= 0 ? (lostI % 2 === 0 ? -0.07 : 0.07) : 0;
      if (lostI >= 0 && !onboardMe) c.root.rotation.x += lostI < 2 ? 0.05 : -0.04;
      c.parts.asa_d.visible = L.fw.state !== "none";
      c.parts.asa_t.visible = L.rw.state !== "none";
      // asa quebrada pela metade: some só o lado que voou (o do lado da pancada)
      for (const m of c.halves ?? []) {
        const w = m.userData.wing === "asa_d" ? L.fw : L.rw;
        m.visible = w.state !== "half" || m.userData.half !== w.side;
      }
      const wheels: Part[] = ["roda_fe", "roda_fd", "roda_te", "roda_td"];
      // giro pelo quanto o carro andou neste quadro na tela (a velocidade da simulação vezes o tempo real
      // oscilava e a roda acelerava e freava sozinha)
      const moved = c.lastX === undefined ? 0 : Math.hypot(d.x - c.lastX, d.y - (c.lastZ ?? d.y));
      c.lastX = d.x;
      c.lastZ = d.y;
      const step = moved < 20 ? moved / 0.33 : 0;
      c.spin += step;
      // tracinhos e recortes: somem entre ~0,2 e ~0,55 rad por quadro (acima disso pulavam pra trás e pra frente)
      const sharp = Math.max(0, Math.min(1, 1 - (step - 0.2) / 0.35));
      for (const m of c.strobe ?? []) {
        const mat = m.material as THREE.MeshLambertMaterial;
        mat.transparent = sharp < 1;
        mat.opacity = sharp;
        m.visible = sharp > 0.02;
      }
      for (const m of c.blurs ?? []) {
        (m.material as THREE.MeshLambertMaterial).opacity = (1 - sharp) * 0.45;
        m.visible = sharp < 0.98;
      }
      void dt;
      wheels.forEach((w, i) => {
        const p = c.parts[w];
        p.visible = L.wheels[i] !== "off";
        p.rotation.order = "YXZ";
        // (no 3D, girar em +Y vira pra esquerda do carro)
        p.rotation.y = i < 2 ? -L.steer : 0;
        p.rotation.x = c.spin;
      });
      for (const b of c.brakes ?? []) b.rotation.y = -L.steer;
      // volante: umas 4x o ângulo das rodas (direção de F1, ~1 volta de batente a batente); braços junto;
      // capacete inclina um tiquinho pra dentro da curva
      // (2,5x o ângulo das rodas: mais que isso as mãos descolavam no punho)
      // (teste: window.__volante força o esterço, pra conferir volante e braços parados numa foto)
      const stv = (window as unknown as { __volante?: number }).__volante ?? L.steer;
      // (com as poses, o volante gira pelas poses; sem elas — modelo antigo — gira o pivô)
      if (c.steer && !c.driver?.length) c.steer.rotation.z = stv * 2.5;
      // DRS: a frente da aba sobe (gira na dobradiça de trás)
      if (c.flap) c.flap.rotation.x = -(d.drs ?? 0) * 0.5;
      if (c.arms && !c.driver?.length) c.arms.rotation.z = stv * 2.5;
      // (o capacete do arquivo vem inclinado pra trás, olhando pro céu: 22° pra frente deixa a viseira reta)
      if (c.head) {
        c.head.rotation.order = "ZXY";
        c.head.rotation.x = 0.384;
        c.head.rotation.z = L.steer * 0.35;
      }
      // braços: a pose do volante virado pro lado certo, na medida do giro (as poses são de 50°)
      if (c.driver?.length) {
        const sw = stv * 2.5, GIRO = (50 * Math.PI) / 180;
        for (const ms of c.driver) {
          const d2 = ms.morphTargetDictionary!, inf = ms.morphTargetInfluences!;
          // (no Blender o volante gira em +Y; no jogo isso é -Z: "giro_mais" = volante virado pro lado negativo)
          // (poses a cada 1/3 do giro, pra cada lado: mistura só as duas vizinhas; "p" = volante pro lado negativo)
          const f = Math.min(3, (Math.abs(sw) / GIRO) * 3), lado = sw < 0 ? "p" : "m";
          for (const sd of ["p", "m"]) for (let i = 1; i <= 3; i++) inf[d2[`giro_${sd}${i}`]] = sd !== lado ? 0 : Math.max(0, 1 - Math.abs(f - i));
        }
      }
      // telinha: marcha e velocidade (10 vezes por segundo)
      if (c.screen && performance.now() - c.screen.t > 100) {
        const sc2 = c.screen, g = sc2.g, kmh = Math.round(d.v * 3.6);
        sc2.t = performance.now();
        const { gear } = gearOf(d.id, kmh, this.scMode);
        g.fillStyle = "#06090f";
        g.fillRect(0, 0, 160, 80);
        g.textAlign = "center";
        g.fillStyle = "#ffffff";
        g.font = "800 54px 'Titillium Web', sans-serif";
        g.fillText(gear, 44, 62);
        g.fillStyle = "#7fd0ff";
        g.font = "700 34px 'Titillium Web', sans-serif";
        g.fillText(String(kmh), 116, 50);
        g.font = "600 13px sans-serif";
        g.fillStyle = "#9aa3ab";
        g.fillText("KM/H", 116, 68);
        sc2.tex.needsUpdate = true;
      }
    }
    // quem não apareceu neste quadro some (fora da tela, na garagem)
    for (const [id, c] of this.cars) {
      if (c.seen !== this.frame) c.root.visible = false;
      if (this.frame - c.seen > 600) {
        this.scene.remove(c.root);
        this.cars.delete(id);
      }
    }
    this.drawProps(props);
    if (tf) {
      // câmera de transmissão: atrás e acima do carro, olhando um pouco à frente dele (com o autódromo na mesma cena)
      if (this.trackGroup && this.trackGroup.parent !== this.scene) {
        this.scene.add(this.trackGroup);
        const sky = new THREE.Color("#74c6f2");
        this.scene.background = sky;
        this.scene.fog = new THREE.Fog(sky, 500, 2400);
      }
      const kind = tf.kind ?? (tf.iso ? "iso" : "tv");
      const now = performance.now();
      const rdt = Math.min(0.1, (now - (this.lastNow || now)) / 1000);
      this.lastNow = now;
      if (kind !== "tv" && kind !== "piloto") this.tvH = null;
      const ISO_FOV = 34, span = tf.span ?? 100;
      const pose = (k: string) => {
        if (k === "piloto") {
          // em cima e um pouco atrás da cabeça do piloto, presa no carro (vê o halo, o bico e as rodas da
          // frente); a direção é a pilotH, a mesma do carro seguido
          // (botão direito vira a câmera em volta do carro)
          const a = (this.pilotH ?? tf.h) + (tf.yaw ?? 0);
          const fx = Math.cos(a), fz = Math.sin(a), gh = this.hAt(tf.x, tf.y);
          // (como a câmera de verdade: em cima da tomada de ar, logo atrás e acima do capacete, que aparece
          // embaixo no meio; o halo, o bico e as rodas da frente na frente)
          const hz = helmet?.z ?? -0.3;
          // (colada atrás e acima do capacete, pela altura dele; o corte de perto da câmera é 0,15 m)
          const back = hz - 0.15;
          return { pos: new THREE.Vector3(tf.x + fx * back, gh + (helmet?.top ?? 0.95) + 0.35, tf.y + fz * back), look: new THREE.Vector3(tf.x + fx * 6, gh - 1.2, tf.y + fz * 6), fov: 70 };
        }
        if (k === "tv") {
          // atrás e acima do carro, olhando um pouco à frente dele. A direção é amortecida (a do carro balança
          // a cada correção de volante e a câmera ia e voltava pros lados), e no tempo real (não no do jogo)
          // Só a DIREÇÃO é suavizada; a posição fica presa no carro. (Antes a posição também corria atrás
          // com atraso: a 300 km/h ficava ~20 m pra trás e a distância mudava a cada quadro, o carro tremia)
          if (this.tvH == null) this.tvH = tf.h;
          let dh = tf.h - this.tvH;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          // (firme atrás do carro: com 2,6/s ela atrasava nas curvas longas e o carro aparecia de lado; o
          // pouquinho de amortecimento que sobra só tira as correções de volante e a traseira escapando)
          this.tvH += dh * (1 - Math.exp(-rdt * 9));
          const fx = Math.cos(this.tvH), fz = Math.sin(this.tvH);
          // (altura do chão suavizada: no relevo a câmera não pula a cada ponto da grade)
          const gh = this.hAt(tf.x - fx * 26, tf.y - fz * 26);
          this.camGh = this.camGh == null ? gh : this.camGh + (gh - this.camGh) * (1 - Math.exp(-rdt * 3));
          const pos = new THREE.Vector3(tf.x - fx * 26, 11 + this.camGh, tf.y - fz * 26);
          return { pos, look: new THREE.Vector3(tf.x + fx * 14, 1.2 + this.hAt(tf.x + fx * 14, tf.y + fz * 14), tf.y + fz * 14), fov: 42 };
        }
        // de lado: ângulo fixo de ~41° (gira pelo yaw); de cima: quase reto pra baixo, cobrindo o mesmo que o 2D
        // (o centro já vem suavizado pela câmera do 2D; amortecer de novo fazia o carro ir e voltar na tela)
        const top = k === "cima";
        const EL = top ? 1.5695 : 0.72, yaw = top ? 0 : (tf.yaw ?? 0);
        const D = (span / 2 / Math.tan(((ISO_FOV / 2) * Math.PI) / 180)) * (top ? 1 : 1.1);
        const gh = this.hAt(tf.x, tf.y);
        return { pos: new THREE.Vector3(tf.x + Math.sin(yaw) * Math.cos(EL) * D, gh + Math.sin(EL) * D, tf.y + Math.cos(yaw) * Math.cos(EL) * D), look: new THREE.Vector3(tf.x, gh, tf.y), fov: ISO_FOV };
      };
      if (kind !== this.lastKind) {
        // começou a trocar: parte de onde estava (ou da vista de cima, vindo do 2D/de cima normal)
        this.trans = { from: this.curPose ?? pose("cima"), t0: now };
        this.lastKind = kind;
      }
      // (câmera da beira da pista e cortes do Modo TV: corte seco, sem a transição de câmera)
      const rc = this.replayCam;
      const free = this.freeCam;
      if (rc || this.hadReplay || this.cutNow || this.camSpec || free) this.trans = null;
      this.cutNow = false;
      this.hadReplay = !!rc;
      let cp = pose(kind);
      if (free) {
        // (drone: não entra no chão)
        free.y = Math.max(free.y, this.hAt(free.x, free.z) + 0.4);
        const cpit = Math.cos(free.pitch);
        cp = { pos: new THREE.Vector3(free.x, free.y, free.z), look: new THREE.Vector3(free.x + Math.cos(free.yaw) * cpit, free.y + Math.sin(free.pitch), free.z + Math.sin(free.yaw) * cpit), fov: 60 };
      } else if (rc) cp = { pos: new THREE.Vector3(rc.x, this.hAt(rc.x, rc.y) + 7, rc.y), look: new THREE.Vector3(tf.x, this.hAt(tf.x, tf.y) + 0.8, tf.y), fov: 30 };
      else if (this.camSpec) cp = this.specPose(tf, this.camSpec);
      if (this.trans) {
        const k = Math.min(1, (now - this.trans.t0) / 900);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const f = this.trans.from;
        cp = { pos: f.pos.clone().lerp(cp.pos, e), look: f.look.clone().lerp(cp.look, e), fov: f.fov + (cp.fov - f.fov) * e };
        if (k >= 1) this.trans = null;
      }
      this.curPose = cp;
      const p = this.persp;
      p.aspect = W / H;
      this.projW = W;
      this.projH = H;
      p.fov = cp.fov;
      // (câmera piloto: o carro está a centímetros; nas outras, corte em 1,5 m pra a pintura do asfalto não serrilhar)
      // (perto demais com a distância longe dá briga de profundidade no carro: 0,3 a 1600 m na piloto)
      const pil = kind === "piloto" && !this.trans;
      // (tomada da TV baixa ou colada no carro — roda, chão, asa, T-cam: com o corte em 1,5 m sumiam o carro e o
      // asfalto da frente da lente; o corte fica a metade da altura e 1/5 da distância até o carro)
      const close = free ? 0.3 : this.camSpec && !pil ? Math.min(0.5 * (cp.pos.y - this.hAt(cp.pos.x, cp.pos.z)), 0.2 * Math.hypot(cp.pos.x - tf.x, cp.pos.z - tf.y)) : 1.5;
      p.near = pil ? 0.15 : Math.max(0.15, Math.min(1.5, close));
      p.far = p.near < 1 ? 1600 : Math.max(3000, cp.pos.y * 4);
      // câmera de trás: o painel dos pilotos cobre a parte de baixo e escondia o carro seguido; a imagem
      // sobe metade do que ele cobre (o carro fica no meio do que sobra, como no 2D)
      const cover = kind === "tv" ? (tf.cover ?? 0) * 0.5 : 0;
      if (cover > 1) p.setViewOffset(W, H, 0, cover, W, H);
      else p.clearViewOffset();
      p.updateProjectionMatrix();
      p.position.copy(cp.pos);
      p.lookAt(cp.look);
      // neblina só depois do ponto que a câmera olha (senão a de lado, mais longe, ficava mais clara que a de cima)
      const fog = this.scene.fog as THREE.Fog | null;
      if (fog) {
        const dist = cp.pos.distanceTo(cp.look);
        fog.near = Math.max(300, dist * 1.1);
        // (a borda do mapa, a ~480 m da pista, some no céu em vez de aparecer cortada)
        fog.far = Math.max(1100, dist * 5);
      }
      this.trackLayer?.lod(p.position, SCENE_LOD_DIST[gfx().sceneQ]);
      // céu e neblina fechando com a chuva chegando
      const skyC = new THREE.Color("#74c6f2").lerp(new THREE.Color("#79838f"), this.cloud);
      if (this.scene.background instanceof THREE.Color) this.scene.background.copy(skyC);
      if (fog) fog.color.copy(skyC);
      // telões: a cada 3 quadros, a câmera de TV atrás do carro seguido numa imagem pequena (sem sombra nova; os
      // telões mostram a classificação enquanto isso, senão a imagem entrava nela mesma)
      const fc = this.cars.get(this.followId)?.root;
      if (this.screenLive && fc && gfx().shadows !== "baixo") {
        if (++this.screenN % 3 === 0) {
          this.screenRT ??= new THREE.WebGLRenderTarget(384, 216, { colorSpace: THREE.SRGBColorSpace });
          const yaw = fc.rotation.y, bx = Math.sin(yaw), bz = Math.cos(yaw);
          this.screenCam.position.set(fc.position.x - bx * 13, fc.position.y + 4.2, fc.position.z - bz * 13);
          this.screenCam.lookAt(fc.position.x + bx * 8, fc.position.y + 0.8, fc.position.z + bz * 8);
          setScreenSource(null);
          const au = r.shadowMap.autoUpdate;
          r.shadowMap.autoUpdate = false;
          r.setRenderTarget(this.screenRT);
          r.render(this.scene, this.screenCam);
          r.setRenderTarget(null);
          r.shadowMap.autoUpdate = au;
        }
        if (this.screenRT) setScreenSource(this.screenRT.texture);
      } else setScreenSource(null);
      // telhado entre a câmera e o carro seguido ganha um furo (pieces.SEE); na câmera piloto não
      SEE.uOn.value = pil ? 0 : 1;
      SEE.uCam.value.copy(cp.pos);
      SEE.uCar.value.set(tf.x, this.hAt(tf.x, tf.y) + 1, tf.y);
      SEE.uR.value = Math.min(22, Math.max(7, cp.pos.distanceTo(SEE.uCar.value) * 0.11));
      r.render(this.scene, p);
      // (pra medir: triângulos desenhados neste quadro, sem a sombra)
      (window as unknown as { __tris: number }).__tris = r.info.render.triangles;    } else {
      this.lastKind = null;
      this.curPose = null;
      this.trans = null;
      // voltou pra câmera de cima: o autódromo volta pra cena dele (desenhada antes, por baixo das marcas)
      if (this.trackGroup && this.trackGroup.parent === this.scene) {
        this.trackScene?.add(this.trackGroup);
        this.scene.background = null;
        this.scene.fog = null;
      }
      r.render(this.scene, cam);
    }
    o.drawImage(r.domElement, 0, 0, W, H);
  }

  /** telões do autódromo: a classificação ao vivo */
  liveScreen(race: Race) {
    updateLiveScreen(race);
  }

  dispose() {
    this.renderer.dispose();
  }
}
