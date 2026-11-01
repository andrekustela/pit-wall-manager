// "VER EM 3D" do editor de pintura: o carro detalhado com a pintura e o piloto em pé com o uniforme (capacete
// e macacão com o desenho), girando devagar, em luz de estúdio (reflexo do ambiente, sombra macia). Arrastar
// gira, roda aproxima. Mostra inclusive o que ainda é prévia do Plus.
// Também a VISTA DE CIMA do carro 3D (renderTop) pro editor de adesivos (CRIAR MEU CARRO) e o PILOTO EM PÉ
// (renderPilot) pra prévia da aba PILOTO do editor de pintura.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Team } from "../sim/types";
import { defaultLivery } from "../sim/livery";
import { GLOVE_T0, HELMET_UPRIGHT, gloveByWheel, paintAxis, paintMaterial, paintUV, shoeMaterial, uniformMaterial, upBox } from "./cars3dReal";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
let carP: Promise<THREE.Object3D> | null = null, pilotP: Promise<THREE.Object3D> | null = null;
/** o carro detalhado (o mesmo da câmera piloto), já com as coordenadas da pintura e as luvas do piloto */
const loadCar = () =>
  (carP ??= loader.loadAsync("/car3d/carro_hd.glb").then((g) => {
    paintUV(g.scene, new THREE.Box3().setFromObject(g.scene));
    gloveByWheel(g.scene.getObjectByName("piloto"));
    return g.scene;
  }));

/** o capacete do arquivo vem inclinado pra trás, olhando pro céu: 22° pra frente, no centro dele (igual ao jogo) */
const HELMET_TILT = 0.384;
function tiltHelmet(car: THREE.Object3D) {
  const hn = car.getObjectByName("capacete");
  if (!hn?.parent) return car;
  car.updateMatrixWorld(true);
  const pv = new THREE.Object3D();
  car.add(pv);
  pv.position.copy(car.worldToLocal(new THREE.Box3().setFromObject(hn).getCenter(new THREE.Vector3())));
  pv.updateMatrixWorld(true);
  pv.attach(hn);
  pv.rotation.x = HELMET_TILT;
  return car;
}

/**
 * o capacete da corrida no lugar do capacete do personagem em pé. É a MESMA peça nos dois arquivos (as 5 partes
 * com os mesmos pontos: balaclava, casca, viseira, acabamento, detalhe), só que no carro vem menor e deitada
 * junto com o piloto: o encaixe sai do centro de cada parte nos dois (giro em volta do lado, tamanho e lugar
 * pelos mínimos quadrados; deu 47,1°, escala 1,307, erro 0,1 mm). Devolve o capacete no espaço da raiz do
 * personagem, parado na origem
 */
function fitHelmet(car: THREE.Object3D, pilot: THREE.Object3D) {
  const centers = (root: THREE.Object3D, pre: string) => {
    const out: THREE.Vector3[] = [];
    for (let i = 1; i <= 5; i++) {
      const m = root.getObjectByName(`${pre}_${i}`) as THREE.Mesh | undefined;
      if (!m?.isMesh) return null;
      const pos = m.geometry.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
      for (let k = 0; k < pos.count; k++) c.add(v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld));
      out.push(c.divideScalar(pos.count));
    }
    return out;
  };
  car.updateMatrixWorld(true);
  pilot.updateMatrixWorld(true);
  const hn = car.getObjectByName("capacete"), a = centers(car, "capacete"), b = centers(pilot, "helmet");
  if (!hn || !a || !b) return null;
  const ma = a.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(a.length);
  const mb = b.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(b.length);
  // giro e tamanho no plano frente/altura, como números complexos z + i·y: c = Σ b·conj(a) / Σ|a|²
  let re = 0, im = 0, na = 0;
  for (let i = 0; i < a.length; i++) {
    const az = a[i].z - ma.z, ay = a[i].y - ma.y, bz = b[i].z - mb.z, by = b[i].y - mb.y;
    re += bz * az + by * ay;
    im += by * az - bz * ay;
    na += az * az + ay * ay;
  }
  const ang = -Math.atan2(im, re), s = Math.hypot(re, im) / na;
  const X = new THREE.Vector3(1, 0, 0);
  const h = hn.clone(true);
  hn.matrixWorld.decompose(h.position, h.quaternion, h.scale);
  h.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).castShadow = true)));
  const wrap = new THREE.Group();
  wrap.add(h);
  wrap.scale.setScalar(s);
  wrap.rotation.x = ang;
  wrap.position.copy(mb).sub(ma.clone().multiplyScalar(s).applyAxisAngle(X, ang));
  // (erro do encaixe, pra conferir: em metros, no personagem)
  const rms = Math.sqrt(a.reduce((t, p, i) => t + p.clone().multiplyScalar(s).applyAxisAngle(X, ang).add(wrap.position).distanceToSquared(b[i]), 0) / a.length);
  return { wrap, helmet: h, fit: { s, ang, rms } };
}

/** pinta uma cópia do carro com a equipe; devolve o que precisa ser liberado depois */
function dressCar(car: THREE.Object3D, team: Team): THREE.Material[] {
  const lv = team.livery, made: THREE.Material[] = [];
  car.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const one = (m: THREE.Material) => {
      let c: THREE.Material = m;
      if (m.name === "pintura") c = paintMaterial(m, team);
      else if (m.name === "asa") {
        c = m.clone();
        (c as THREE.MeshStandardMaterial).color.set(lv?.wing ?? team.accent);
      } else if (lv && m.name === "capacete") return uniformMaterial(m, "h", lv, mesh.geometry);
      else if (lv && m.name === "macacao") return uniformMaterial(m, "s", lv, mesh.geometry);
      if (c !== m) made.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
  });
  return made;
}
const freeMats = (ms: THREE.Material[]) => {
  for (const m of ms) {
    (m as THREE.MeshStandardMaterial).map?.dispose();
    m.dispose();
  }
};

/** reflexo de estúdio (ambiente de sala) pra pintura e capacete brilharem como de verdade */
function studio(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.environment = env;
  return env;
}

// ---------------- piloto em pé ----------------

// o modelo traz DOIS capacetes no mesmo lugar (helmet_1-5 e Cube038 + shell/vizor/Cube049/057/058/060), com
// materiais diferentes dos da corrida: os dois saem e entra o capacete do carro, encaixado onde estava o helmet_1-5
const PILOT_HELMET = /^(helmet_[1-5]|Cube038|Cube049|Cube057|Cube058|Cube060|shell[0-9]|helmet_shell|vizor)/;
/**
 * é braço? (pelo osso que mais mexe no ponto). Uma marca só, 0 ou 1: com um número por parte (0 tronco, 1 braço,
 * 2 perna) a costura tronco/perna passava por 1 no meio do triângulo e virava "braço" (linha em escada no quadril)
 */
const armOf = (bone: string) => (/upper_arm|forearm|hand|f_|palm|thumb/.test(bone) ? 1 : 0);

/**
 * pra cada ponto do macacão do personagem (já de braços abaixados): onde ele fica no corpo (aBody), pra que lado
 * a superfície aponta (aBodyN) e se é braço (aPart), pelo esqueleto. O desenho do macacão vai por
 * isso e não pela caixa da malha: o macacão tem duas malhas (tecido e couro) e vem de braços abertos, e
 * "faixas laterais" pintava os braços inteiros, "pernas" e "cintura" caíam fora do lugar. E a luva (aGlove: luva
 * sim/não, do pulso à ponta do dedo do meio, dedo, costas/palma): a mão, os dedos e o antebraço pelos ossos; o
 * punho é cortado no material (GLOVE_T0), em cada pixel — ponto a ponto a borda saía em escada. Devolve a caixa
 * do corpo
 */
function bodySpace(pilot: THREE.Object3D, meshes: THREE.Mesh[]): THREE.Box3 {
  pilot.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), acc = new THREE.Vector3(), d = new THREE.Vector3();
  const si = new THREE.Vector4(), sw = new THREE.Vector4(), bm = new THREE.Matrix4();
  // mãos: o pulso (começo do osso da mão), a direção até a ponta do dedo do meio e a do antebraço (do cotovelo
  // ao pulso), de cada lado. No antebraço, o punho é medido pela direção dele: pela da mão (que fica dobrada) a
  // linha do punho cortava o antebraço na diagonal
  const hands: Record<string, { w: THREE.Vector3; dir: THREE.Vector3; fore: THREE.Vector3; len: number }> = {};
  for (const sd of ["L", "R"]) {
    const w = pilot.getObjectByName(`DEF-hand${sd}`)?.getWorldPosition(new THREE.Vector3());
    const tip = pilot.getObjectByName(`DEF-f_middle03${sd}`)?.getWorldPosition(new THREE.Vector3());
    const elbow = pilot.getObjectByName(`DEF-forearm${sd}`)?.getWorldPosition(new THREE.Vector3());
    if (!w || !tip || !elbow) continue;
    const dir = tip.sub(w);
    // (a última junta do dedo fica antes da ponta)
    const len = dir.length() * 1.3;
    hands[sd] = { w, dir: dir.normalize(), fore: w.clone().sub(elbow).normalize(), len };
  }
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    // (a malha é a mesma em todas as cópias do personagem, sempre na mesma pose: calcula uma vez)
    if (!geo.attributes.aBody) {
      const pos = geo.attributes.position, nor = geo.attributes.normal, cnt = pos.count;
      const body = new Float32Array(cnt * 3), bn = new Float32Array(cnt * 3), part = new Float32Array(cnt), glove = new Float32Array(cnt * 4), neck = new Float32Array(cnt);
      const sk = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
      const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < cnt; i++) {
        v.fromBufferAttribute(pos, i);
        n.fromBufferAttribute(nor, i);
        // (peça sem osso: a parte de cima do sapato)
        let pt = 0, bone = "";
        if (sk) {
          sk.applyBoneTransform(i, v);
          // a direção da superfície pelos mesmos ossos (só o giro), e o osso que mais pesa
          si.fromBufferAttribute(geo.attributes.skinIndex as THREE.BufferAttribute, i);
          sw.fromBufferAttribute(geo.attributes.skinWeight as THREE.BufferAttribute, i);
          t.copy(n).transformDirection(sk.bindMatrix);
          acc.set(0, 0, 0);
          let best = 0, bi = 0;
          for (let k = 0; k < 4; k++) {
            const w = sw.getComponent(k);
            if (!w) continue;
            const b = si.getComponent(k);
            bm.multiplyMatrices(sk.skeleton.bones[b].matrixWorld, sk.skeleton.boneInverses[b]);
            acc.addScaledVector(d.copy(t).transformDirection(bm), w);
            if (w > best) {
              best = w;
              bi = b;
            }
          }
          n.copy(acc).transformDirection(sk.bindMatrixInverse);
          bone = sk.skeleton.bones[bi].name;
          pt = armOf(bone);
        }
        v.applyMatrix4(mesh.matrixWorld);
        n.applyMatrix3(nm).normalize();
        body.set([v.x, v.y, v.z], i * 3);
        bn.set([n.x, n.y, n.z], i * 3);
        part[i] = pt;
        // pescoço (entre o capacete e a gola): liso, sem o desenho do macacão
        neck[i] = /spine00[56]/.test(bone) ? 1 : 0;
        // luva: mão, dedos e antebraço (o material corta o punho em GLOVE_T0)
        const hand = /hand|f_|palm|thumb/.test(bone), h = hands[/([LR])\d*$/.exec(bone)?.[1] ?? ""];
        if (h && (hand || /forearm/.test(bone))) glove.set([1, d.copy(v).sub(h.w).dot(hand ? h.dir : h.fore) / h.len, /f_|thumb/.test(bone) ? 1 : 0, n.x * Math.sign(v.x)], i * 4);
      }
      smoothDirs(geo, body, bn, 8);
      geo.setAttribute("aBody", new THREE.BufferAttribute(body, 3));
      geo.setAttribute("aBodyN", new THREE.BufferAttribute(bn, 3));
      geo.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
      geo.setAttribute("aNeck", new THREE.BufferAttribute(neck, 1));
      geo.setAttribute("aGlove", new THREE.BufferAttribute(glove, 4));
      geo.userData.bodyBox = new THREE.Box3().setFromBufferAttribute(geo.attributes.aBody as THREE.BufferAttribute);
    }
    box.union(geo.userData.bodyBox);
  }
  return box;
}

/**
 * suaviza as direções da superfície (média com os vizinhos, `it` vezes): as dobras modeladas no macacão (joelho,
 * cintura) deixavam a "faixa lateral" manchada. Pontos repetidos (costuras) contam como um só, pela posição
 */
function smoothDirs(geo: THREE.BufferGeometry, body: Float32Array, dirs: Float32Array, it: number) {
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
 * tênis: pra cada ponto, aShoe = (1, do calcanhar ao bico, da sola ao cano, lado: +1 o pé esquerdo), pela caixa
 * das três peças de cada pé (sola preta, cabedal, faixa) com o personagem parado na origem
 */
function shoeSpace(pilot: THREE.Object3D) {
  pilot.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const foot of ["l", "r"]) {
    const parts: THREE.Mesh[] = [];
    pilot.traverse((o) => (o as THREE.Mesh).isMesh && new RegExp(`^shoes${foot}_\\d$`).test(o.name) && parts.push(o as THREE.Mesh));
    if (!parts.length || parts.every((p) => p.geometry.attributes.aShoe)) continue;
    const box = new THREE.Box3();
    for (const p of parts) box.expandByObject(p);
    const sz = box.getSize(new THREE.Vector3());
    for (const p of parts) {
      const pos = p.geometry.attributes.position, out = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.matrixWorld);
        out.set([1, (v.z - box.min.z) / sz.z, (v.y - box.min.y) / sz.y, foot === "l" ? 1 : -1], i * 4);
      }
      p.geometry.setAttribute("aShoe", new THREE.BufferAttribute(out, 4));
    }
  }
}
/** a peça do tênis pelo material: 0 cabedal, 1 faixa, 2 sola (e o resto preto) */
const SHOE_PART: Record<string, number> = { macacao: 0, faixa: 1 };

/**
 * o personagem em pé pronto pra vestir (dressPilot): sem os capacetes do arquivo, braços abaixados, o corpo do
 * macacão calculado, o capacete da corrida na cabeça, 1,78 m. A origem do grupo fica nos pés
 */
async function buildPilot(): Promise<THREE.Group> {
  pilotP ??= loader.loadAsync("/piloto/piloto.glb").then((g) => g.scene);
  const { clone } = await import("three/addons/utils/SkeletonUtils.js");
  const pilot = clone(await pilotP);
  const suit: THREE.Mesh[] = [];
  pilot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (PILOT_HELMET.test(mesh.name)) {
      mesh.visible = false;
      return;
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // (a faixa do macacão também: as do pulso ficam por baixo da luva e pegam a cor dela)
    if (["macacao", "faixa"].includes((mesh.material as THREE.Material).name)) suit.push(mesh);
  });
  // braços pra baixo (o modelo vem de braços abertos): cada braço gira até apontar pro chão, um pouco pro lado
  pilot.updateMatrixWorld(true);
  for (const sd of ["L", "R"]) {
    const up = pilot.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`DEF-upper_arm.${sd}`));
    if (!up?.parent) continue;
    const wq = up.getWorldQuaternion(new THREE.Quaternion());
    const along = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
    const want = new THREE.Vector3(along.x > 0 ? 0.22 : -0.22, -1, 0.04).normalize();
    const nq = new THREE.Quaternion().setFromUnitVectors(along, want).multiply(wq);
    up.quaternion.copy(up.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(nq));
    pilot.updateMatrixWorld(true);
  }
  const bodyBox = bodySpace(pilot, suit);
  shoeSpace(pilot);
  // (com o personagem ainda parado na origem; filho dele, acompanha o tamanho, o giro e o lugar)
  const fitted = fitHelmet(await loadCar(), pilot);
  if (fitted) pilot.add(fitted.wrap);
  const pbox = new THREE.Box3().setFromObject(pilot);
  const k = 1.78 / Math.max(0.1, pbox.max.y - pbox.min.y);
  pilot.scale.multiplyScalar(k);
  pilot.position.y = -pbox.min.y * k;
  const g = new THREE.Group();
  g.add(pilot);
  g.userData = { bodyBox, helmet: fitted?.helmet, fit: fitted?.fit };
  return g;
}

/** veste o personagem (buildPilot) com o uniforme da equipe: dá pra chamar de novo a cada troca no editor */
function dressPilot(g: THREE.Object3D, team: Team): THREE.Material[] {
  const lv = team.livery, made: THREE.Material[] = [];
  const box = g.userData.bodyBox as THREE.Box3, helmet = g.userData.helmet as THREE.Object3D | undefined;
  const col: Record<string, string> = { macacao: lv?.suit ?? team.color, faixa: lv?.suitDetail ?? team.accent };
  const inHelmet = new Set<THREE.Object3D>();
  helmet?.traverse((o) => inHelmet.add(o));
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || inHelmet.has(mesh)) return;
    const one = (m: THREE.Material) => {
      // (tênis: as três peças de cada pé, com a cor e o desenho dele)
      if (lv && mesh.geometry.attributes.aShoe) return shoeMaterial(m, lv, SHOE_PART[m.name] ?? 2);
      if (lv && m.name === "macacao" && mesh.geometry.attributes.aBody) return uniformMaterial(m, "s", lv, mesh.geometry, box);
      // (faixa: a cor dela, sem desenho; onde passa por baixo da luva, a da luva)
      if (lv && m.name === "faixa" && mesh.geometry.attributes.aBody) return uniformMaterial(m, "s", { ...lv, suit: lv.suitDetail, suitStyle: 0 }, mesh.geometry, box);
      if (!col[m.name]) return m;
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.color.set(col[m.name]);
      made.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
  });
  if (helmet) {
    made.push(...dressCar(helmet, team));
    // (a balaclava de dentro do capacete fica lisa, na cor do macacão: com o desenho saíam manchas no queixo;
    // o clone não leva o desenho)
    helmet.traverse((o) => {
      const ms = o as THREE.Mesh;
      if (!ms.isMesh || (ms.material as THREE.Material).name !== "macacao") return;
      const c = (ms.material as THREE.MeshStandardMaterial).clone();
      c.color.set(lv?.suit ?? team.color);
      made.push(c);
      ms.material = c;
    });
  }
  return made;
}

/** monta a cena no `host` e devolve a função que desmonta */
export async function mountViewer(host: HTMLElement, team: Team): Promise<() => void> {
  const W = host.clientWidth || 760, H = host.clientHeight || 460;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#161a24");
  scene.fog = new THREE.Fog("#161a24", 12, 26);
  const env = studio(renderer, scene);
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight("#dfe8ff", "#30343c", 0.5));
  const sun = new THREE.DirectionalLight("#fff6ea", 2.2);
  sun.position.set(4, 9, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  scene.add(sun);
  // luz de recorte por trás (contorno do carro e do piloto)
  const rim = new THREE.DirectionalLight("#9fb8ff", 1.1);
  rim.position.set(-5, 4, -6);
  scene.add(rim);
  // chão de box: concreto escuro fosco (o reflexo da sala clareava e azulava demais)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 96), new THREE.MeshStandardMaterial({ color: "#23262e", roughness: 0.92, metalness: 0, envMapIntensity: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
  cam.position.set(5.5, 3, 6.5);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.target.set(0.6, 0.55, 0);
  ctl.enableDamping = true;
  ctl.autoRotate = true;
  ctl.autoRotateSpeed = 1.2;
  ctl.minDistance = 1.6;
  ctl.maxDistance = 14;
  ctl.maxPolarAngle = Math.PI * 0.49;
  // (quem mexe para o giro sozinho)
  ctl.addEventListener("start", () => (ctl.autoRotate = false));

  // ---- carro ----
  const car = (await loadCar()).clone(true);
  tiltHelmet(car);
  const made = dressCar(car, team);
  const cbox = new THREE.Box3().setFromObject(car);
  const fit = 4.8 / (cbox.max.z - cbox.min.z);
  car.scale.setScalar(fit);
  const cc = cbox.getCenter(new THREE.Vector3()).multiplyScalar(fit);
  car.position.set(-cc.x, -cbox.min.y * fit, -cc.z);
  scene.add(car);

  // (teste: window.__v3d mexe na câmera e mostra o piloto e o encaixe do capacete)
  const test: Record<string, unknown> = { cam, ctl, scene };
  (window as unknown as { __v3d?: unknown }).__v3d = test;

  // ---- piloto em pé, ao lado do carro ----
  try {
    const pilot = await buildPilot();
    made.push(...dressPilot(pilot, team));
    pilot.position.set(2.2, 0, 0.6);
    pilot.rotation.y = -0.5;
    scene.add(pilot);
    Object.assign(test, { pilot, helmet: pilot.userData.helmet, fit: pilot.userData.fit });
  } catch {
    /* sem o piloto: só o carro */
  }

  let alive = true;
  const loop = () => {
    if (!alive) return;
    ctl.update();
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
  return () => {
    alive = false;
    ctl.dispose();
    freeMats(made);
    env.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

// ---------------- imagens pros editores (vista de cima do carro, piloto em pé) ----------------

/** um WebGL só pras imagens dos editores (fundo transparente; a imagem é copiada logo depois de desenhar) */
let offR: THREE.WebGLRenderer | null = null;
const offscreen = () => {
  if (offR) return offR;
  offR = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  offR.outputColorSpace = THREE.SRGBColorSpace;
  offR.shadowMap.enabled = true;
  offR.shadowMap.type = THREE.PCFSoftShadowMap;
  // (sem reflexo forte nem tone mapping: as cores ficam as escolhidas, a pintura não desbota)
  offR.setClearColor(0x000000, 0);
  return offR;
};

let top: { scene: THREE.Scene; car: THREE.Object3D; made: THREE.Material[] } | null = null;

/** carrega o carro pra vista de cima (chamar antes de renderTop) */
export async function prepareTop() {
  if (top) return;
  const base = await loadCar();
  const scene = new THREE.Scene();
  studio(offscreen(), scene);
  scene.environmentIntensity = 0.25;
  scene.add(new THREE.HemisphereLight("#ffffff", "#30343c", 0.8));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(0.6, 10, 0.4);
  scene.add(sun);
  top = { scene, car: tiltHelmet(base.clone(true)), made: [] };
  scene.add(top.car);
}

/**
 * o carro 3D visto de cima, deitado com a frente pra direita, numa tela W x H (px de CSS).
 * Devolve a imagem e `k` (px por metro): o ponto (x, y) do desenho da pintura (metros, frente +x, direita +y)
 * fica em (W/2 + (0,25 + 1,02x)·k, H/2 + y·k) — o mesmo encaixe da textura (paintTexture)
 */
export function renderTop(team: Team, W: number, H: number, dpr: number): { canvas: HTMLCanvasElement; k: number } | null {
  if (!top) return null;
  const ax = paintAxis();
  if (!ax) return null;
  const renderer = offscreen(), { scene, car } = top;
  freeMats(top.made);
  top.made = dressCar(car, team);
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  const k = Math.min((W * 0.94) / 5.7, (H * 0.94) / 2.25);
  const cam = new THREE.OrthographicCamera(-W / 2 / k, W / 2 / k, H / 2 / k, -H / 2 / k, 0.1, 30);
  // (olhando reto pra baixo, com a direita da tela ao longo do eixo do carro; o lado direito do carro é -X)
  const n = Math.hypot(1, ax.slope);
  cam.up.set(1 / n, 0, -ax.slope / n);
  cam.position.set(ax.cx, 12, ax.cz);
  cam.lookAt(ax.cx, 0, ax.cz);
  renderer.render(scene, cam);
  return { canvas: renderer.domElement, k };
}

let pil: { scene: THREE.Scene; pilot: THREE.Group; ground: THREE.Mesh; made: THREE.Material[] } | null = null;

/** monta o piloto em pé pra prévia da aba PILOTO (chamar antes de renderPilot) */
export async function preparePilot() {
  if (pil) return;
  const scene = new THREE.Scene();
  studio(offscreen(), scene);
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight("#ffffff", "#30343c", 0.9));
  const sun = new THREE.DirectionalLight("#fff6ea", 1.9);
  sun.position.set(2.5, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 1, far: 15 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#9fb8ff", 0.9);
  rim.position.set(-3, 3, -4);
  scene.add(rim);
  // sombra no chão (só a sombra: o fundo é o do editor)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const pilot = await buildPilot();
  // (um pouco de lado, como a foto antiga: dá pra ver a frente e a lateral)
  pilot.rotation.y = 0.35;
  scene.add(pilot);
  pil = { scene, pilot, ground, made: [] };
}

/** câmera do piloto em pé: de frente, um pouco de cima, o corpo inteiro com o capacete (~1,95 m) em 92% da altura */
function pilotCam(W: number, H: number) {
  const fov = 24, dist = 1.95 / 0.92 / (2 * Math.tan((fov * Math.PI) / 360));
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 50);
  cam.position.set(0, 1.05, dist);
  cam.lookAt(0, 0.93, 0);
  return cam;
}

/** o piloto em pé com o uniforme da equipe (capacete, macacão e luvas com o desenho), numa tela W x H (px de CSS) */
export function renderPilot(team: Team, W: number, H: number, dpr: number): HTMLCanvasElement | null {
  if (!pil) return null;
  const renderer = offscreen();
  freeMats(pil.made);
  pil.made = dressPilot(pil.pilot, team);
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  renderer.render(pil.scene, pilotCam(W, H));
  return renderer.domElement;
}

/**
 * "assa" o piloto em pé pra prévia 2D da aba PILOTO (scripts/bake-pilot.ts grava em public/piloto/pe*.png; o
 * editor não precisa baixar o 3D). Devolve:
 * - shade: a foto com o uniforme cinza-claro (PE_GRAY) e sem desenho — o editor tinge cada pixel;
 * - q: o que o pixel é, em números (0..255): no macacão, onde fica no corpo (x, y, z de -1..1); no casco do
 *   capacete, onde fica nele endireitado; na luva, (do pulso à ponta +0,5)/2, dedo, (costas/palma +1)/2;
 * - m: R = região ·32 (0 nada, 1 macacão, 2 faixa, 3 casco, 4 na cor do macacão, 5 luva, 6 tênis), G = braço
 *   (macacão), lado esquerdo (luva) ou peça do tênis (0 cabedal, ½ faixa, 1 sola), B = lateral de fora (n.x pro
 *   lado de fora, +1)/2; no tênis, q = (calcanhar→bico, sola→cano, lado).
 * Os mapas saem sem antisserrilhado (o número de um pixel não mistura com o vizinho)
 */
export const PE_GRAY = "#d6d6d6";
export async function bakePilot(W = 480, H = 640) {
  await preparePilot();
  const r = offscreen(), { scene, pilot, ground } = pil!;
  const cam = pilotCam(W, H);
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  const lv = { ...defaultLivery(PE_GRAY, PE_GRAY), helmet: PE_GRAY, helmetDetail: PE_GRAY, suit: PE_GRAY, suitDetail: PE_GRAY, glove: PE_GRAY, gloveDetail: PE_GRAY, helmetStyle: 0, suitStyle: 0, gloveStyle: 0, shoe: PE_GRAY, shoeDetail: PE_GRAY, shoeStyle: 4 };
  freeMats(pil!.made);
  pil!.made = dressPilot(pilot, { id: "bake", name: "", color: PE_GRAY, accent: PE_GRAY, livery: lv } as unknown as Team);
  r.render(scene, cam);
  const shade = r.domElement.toDataURL("image/png");

  // os mapas: cada peça escreve os números na cor
  const box = pilot.userData.bodyBox as THREE.Box3, bc = box.getCenter(new THREE.Vector3()), bh = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const inHelmet = new Set<THREE.Object3D>();
  (pilot.userData.helmet as THREE.Object3D | undefined)?.traverse((o) => inHelmet.add(o));
  const v3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
  const mapMat = (key: string, vert: string, frag: string, out: string) => {
    const m = new THREE.MeshBasicMaterial({ fog: false });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${vert.split("\n")[0]}`).replace("#include <begin_vertex>", `#include <begin_vertex>\n${vert.split("\n").slice(1).join("\n")}`);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${frag}`).replace("#include <opaque_fragment>", `gl_FragColor = vec4(${out}, 1.0);`);
    };
    m.customProgramCacheKey = () => `asso-${key}`;
    return m;
  };
  const SUIT_V = "attribute vec3 aBody; attribute vec3 aBodyN; attribute float aPart; attribute float aNeck; attribute vec4 aGlove; varying vec3 vB; varying vec3 vN; varying float vP; varying float vK; varying vec4 vG;\nvB = aBody; vN = aBodyN; vP = aPart; vK = aNeck; vG = aGlove;";
  const SUIT_F = `varying vec3 vB; varying vec3 vN; varying float vP; varying float vK; varying vec4 vG;\nvec3 bq() { return (vB - ${v3(bc)}) / ${v3(bh)}; }`;
  const helmetBox = (geo: THREE.BufferGeometry) => upBox(geo, HELMET_UPRIGHT);
  // (a luva com o punho cortado em GLOVE_T0, como no material)
  const GLOVED = `(vG.x > 0.5 && vG.y > ${GLOVE_T0.toFixed(2)})`;
  const matsFor = (pass: "q" | "m") => {
    const made = new Map<THREE.Mesh, THREE.Material>();
    pilot.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const name = (mesh.material as THREE.Material).name;
      let mat: THREE.Material;
      if (!inHelmet.has(mesh) && mesh.geometry.attributes.aShoe) {
        // tênis = região 6; G = a peça (0 cabedal, 1 faixa, 2 sola)
        const part = SHOE_PART[name] ?? 2;
        mat = mapMat(`t${part}${pass}`, "attribute vec4 aShoe; varying vec4 vS;\nvS = aShoe;", "varying vec4 vS;", pass === "q" ? "vec3(vS.y, vS.z, (vS.w + 1.0) * 0.5)" : `vec3(6.0 * 32.0 / 255.0, ${(part / 2).toFixed(1)}, 0.0)`);
      } else if (inHelmet.has(mesh) && name === "capacete") {
        const hb = helmetBox(mesh.geometry), c = hb.getCenter(new THREE.Vector3()), h = hb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        const ca = Math.cos(HELMET_UPRIGHT), sa = Math.sin(HELMET_UPRIGHT);
        mat = mapMat(`h${pass}`, "varying vec3 vL;\nvL = vec3(position.x, position.y * " + ca.toFixed(6) + " - position.z * " + sa.toFixed(6) + ", position.y * " + sa.toFixed(6) + " + position.z * " + ca.toFixed(6) + ");", "varying vec3 vL;", pass === "q" ? `(vL - ${v3(c)}) / ${v3(h)} * 0.5 + 0.5` : "vec3(3.0 * 32.0 / 255.0, 0.0, 0.0)");
      } else if (inHelmet.has(mesh) && name === "macacao") mat = mapMat(`b${pass}`, "\n", "", pass === "q" ? "vec3(0.0)" : "vec3(4.0 * 32.0 / 255.0, 0.0, 0.0)");
      else if (!inHelmet.has(mesh) && mesh.geometry.attributes.aBody) {
        // (macacão = região 1, faixa = 2; as duas viram luva onde passam por baixo dela)
        const reg = name === "faixa" ? 2 : 1;
        mat = mapMat(
          `s${reg}${pass}`,
          SUIT_V,
          SUIT_F,
          pass === "q"
            ? `${GLOVED} ? vec3((vG.y + 0.5) * 0.5, vG.z, (vG.w + 1.0) * 0.5) : bq() * 0.5 + 0.5`
            : `${GLOVED} ? vec3(5.0 * 32.0 / 255.0, bq().x > 0.0 ? 1.0 : 0.0, 0.0) : vK > 0.5 ? vec3(4.0 * 32.0 / 255.0, 0.0, 0.0) : vec3(${reg}.0 * 32.0 / 255.0, vP > 0.5 ? 1.0 : 0.0, (normalize(vN).x * sign(bq().x) + 1.0) * 0.5)`,
        );
      } else if (!inHelmet.has(mesh) && name === "faixa") mat = mapMat(`f${pass}`, "\n", "", pass === "q" ? "vec3(0.0)" : "vec3(2.0 * 32.0 / 255.0, 0.0, 0.0)");
      else mat = mapMat(`z${pass}`, "\n", "", "vec3(0.0)");
      made.set(mesh, mat);
    });
    return made;
  };
  const rt = new THREE.WebGLRenderTarget(W, H);
  const buf = new Uint8Array(W * H * 4);
  const grab = (pass: "q" | "m") => {
    const mats = matsFor(pass), keep = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    for (const [mesh, mat] of mats) {
      keep.set(mesh, mesh.material);
      mesh.material = mat;
    }
    ground.visible = false;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    ground.visible = true;
    for (const [mesh, mat] of keep) mesh.material = mat;
    for (const mat of mats.values()) mat.dispose();
    // (o WebGL lê de baixo pra cima; opaco, pra o navegador não mexer nos números)
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d")!, img = g.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
        img.data[d] = buf[s];
        img.data[d + 1] = buf[s + 1];
        img.data[d + 2] = buf[s + 2];
        img.data[d + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  };
  const q = grab("q"), m = grab("m");
  rt.dispose();
  return { shade, q, m, w: W, h: H };
}
