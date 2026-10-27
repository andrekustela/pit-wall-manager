// Carros em 3D de verdade (Three.js) na vista de cima da corrida: o modelo do Blender
// (public/car3d/carro.glb, art/export_carro_glb.py) com as peças separadas (asas e rodas), pintado
// com as cores da equipe. A pista continua 2D: a camada 3D é desenhada por cima dela, na mesma escala
// e no mesmo enquadramento (câmera ortogonal olhando pra baixo). O Three.js só é baixado se o modo
// "3D" estiver ligado.
import { buildTrack3d } from "./track3d";
import type { Track } from "../sim/track";
import { COMPOUNDS, type Compound } from "../sim/types";
import * as THREE from "three";
import { updateLiveScreen } from "./liveScreen";
import type { Terrain } from "./terrain";
import type { Race } from "../sim/race";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Team } from "../sim/types";
import type { CarLook } from "./car3d";
import { gfx } from "./gfx";
import { patternShapes } from "./carArt";
import { liveryKey } from "../sim/livery";

/** comprimento do carro na pista (m): o mesmo porte dos outros modos */
const SHOW_LEN = 4.8;
const PARTS = ["corpo", "asa_d", "asa_t", "roda_fe", "roda_fd", "roda_te", "roda_td"] as const;
type Part = (typeof PARTS)[number];

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
}

interface CarObj { root: THREE.Group; parts: Record<Part, THREE.Object3D>; key: string; spin: number; seen: number; tyre: string; covers: THREE.Mesh[]; rings: THREE.Mesh[] }

let model: THREE.Group | null = null;
let loading = false;
let fit = 1;

function load() {
  if (loading) return;
  loading = true;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader
    .loadAsync("/car3d/carro.glb")
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
const PAD = 0.15, TEX_PX = 64;
let paintBox = { cx: 0, cz: 0, L: 1, W: 1 };
/** coordenadas de textura da carroceria pintada vindo de cima (frente = x da imagem, lado direito = y) */
function paintUV(root: THREE.Object3D, box: THREE.Box3) {
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  paintBox = { cx: c.x, cz: c.z, L: sz.z + 2 * PAD, W: sz.x + 2 * PAD };
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh.material as THREE.Material).name !== "pintura") return;
    const pos = mesh.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      // (o lado direito do carro é -X no modelo; a textura vira de cabeça pra baixo no WebGL)
      uv[i * 2] = (v.z - (paintBox.cz - paintBox.L / 2)) / paintBox.L;
      uv[i * 2 + 1] = 1 - (paintBox.cx + paintBox.W / 2 - v.x) / paintBox.W;
    }
    mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  });
}

/** a pintura da equipe vista de cima (cor de base + desenho), no tamanho da caixa do carro */
function paintTexture(team: Team): THREE.CanvasTexture {
  const lv = team.livery;
  const cv = document.createElement("canvas");
  cv.width = Math.round(paintBox.L * TEX_PX);
  cv.height = Math.round(paintBox.W * TEX_PX);
  const g = cv.getContext("2d")!;
  g.fillStyle = lv?.base ?? team.color;
  g.fillRect(0, 0, cv.width, cv.height);
  // as formas foram desenhadas pro carro 2D (bico em +2,4 m): mesmo encaixe do 2D estilizado
  g.setTransform(TEX_PX * 1.02, 0, 0, TEX_PX, cv.width / 2 + 0.25 * TEX_PX, cv.height / 2);
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
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

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
  return (blobM = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
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
      const colors: Record<string, string> = { pintura: lv?.base ?? team.color, asa: lv?.wing ?? lv?.accent ?? team.accent, capacete: lv?.helmet ?? team.accent };
      m = {};
      model!.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (m![mat.name]) continue;
          const c = (mat as THREE.MeshStandardMaterial).clone();
          if (c.name === "pintura") {
            // cor e desenho vêm da textura
            c.map = paintTexture(team);
            c.color.set("#ffffff");
          } else if (colors[c.name]) c.color.set(colors[c.name]);
          m![mat.name] = c;
        }
      });
      if (this.mats.size > 40) this.mats.clear();
      this.mats.set(key, m);
    }
    return { key, m };
  }

  private carFor(d: CarDraw): CarObj {
    let c = this.cars.get(d.id);
    const { key, m } = this.teamMats(d.team);
    if (!c) {
      const root = new THREE.Group();
      const inner = model!.clone(true);
      inner.scale.setScalar(fit);
      if (this.realShadow) inner.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
      // o modelo vem com o centro no meio do carro? centraliza pela caixa
      const box = new THREE.Box3().setFromObject(inner);
      inner.position.sub(box.getCenter(new THREE.Vector3()).setY(box.min.y));
      root.add(inner);
      // sombra de contato (só nas câmeras inclinadas: lá o mapa de sombra cobre muito chão e a do carro sumia)
      const blob = new THREE.Mesh(blobGeo(), blobMat());
      blob.name = "blob";
      blob.position.y = 0.03;
      blob.renderOrder = 1;
      blob.visible = false;
      root.add(blob);
      const parts = {} as Record<Part, THREE.Object3D>;
      for (const p of PARTS) parts[p] = inner.getObjectByName(p) ?? new THREE.Object3D();
      // rodas: giram e esterçam em volta do centro delas (a compressão do modelo tirou o ponto de giro
      // do eixo, e a roda "andava" pra frente e pra trás girando)
      inner.updateMatrixWorld(true);
      const rings: THREE.Mesh[] = [];
      for (const w of ["roda_fe", "roda_fd", "roda_te", "roda_td"] as const) {
        const part = parts[w];
        if (!part.parent) continue;
        // (o pivô fica direto no modelo: o nó da roda tem a escala da compressão e distorcia as contas)
        const wb = new THREE.Box3().setFromObject(part);
        const size = wb.getSize(new THREE.Vector3()).divideScalar(fit);
        const pivot = new THREE.Object3D();
        inner.add(pivot);
        pivot.position.copy(inner.worldToLocal(wb.getCenter(new THREE.Vector3())));
        pivot.updateMatrixWorld(true);
        pivot.attach(part);
        parts[w] = pivot;
        // faixa colorida do composto na borda de fora do pneu (de cima a lateral não aparece)
        const ring = new THREE.Mesh(new THREE.TorusGeometry((size.y / 2) * 0.78, 0.035, 6, 28));
        ring.rotation.y = Math.PI / 2;
        const out = w === "roda_fe" || w === "roda_te" ? 1 : -1; // (o lado esquerdo do carro é +X)
        ring.position.set(out * Math.min(size.x / 2 + 0.01, 0.23), 0, 0);
        pivot.add(ring);
        rings.push(ring);
      }
      // capas das rodas (pintadas com a cor do composto)
      const covers: THREE.Mesh[] = [];
      for (const w of ["roda_fe", "roda_fd", "roda_te", "roda_td"] as const)
        parts[w].traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && (mesh.material as THREE.Material).name.includes("wheel_cover")) covers.push(mesh);
        });
      c = { root, parts, key: "", spin: 0, seen: 0, tyre: "", covers, rings };
      this.scene.add(root);
      this.cars.set(d.id, c);
    }
    if (c.key !== key) {
      c.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((x) => m[x.name] ?? x) : (m[mesh.material.name] ?? mesh.material);
      });
      c.key = key;
      c.tyre = ""; // (a troca de materiais da equipe tira a cor do composto: refaz)
    }
    return c;
  }

  /**
   * Desenha os carros na camada 3D e cola por cima do canvas 2D. `viewX/viewY` = canto de cima-esquerda
   * da tela em metros, `m` = px por metro (o mesmo enquadramento do 2D).
   */
  private propObjs = new Map<string, { root: THREE.Object3D; seen: number; lights: THREE.Mesh[]; glow: THREE.PointLight | null }>();

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
        p = { root, seen: 0, lights, glow };
        this.scene.add(root);
        this.propObjs.set(d.id, p);
      }
      p.seen = this.frame;
      p.root.visible = true;
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
  tilt: { x: number; y: number; h: number; iso?: boolean; span?: number; yaw?: number; kind?: "iso" | "tv" | "cima" } | null = null;
  // troca de câmera: desliza da pose de antes até a nova (de cima vira uma câmera olhando reto pra baixo)
  private lastKind: string | null = null;
  /** câmera de trás: direção amortecida e o relógio de verdade */
  private tvH: number | null = null;
  private lastNow = 0;
  private curPose: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  private trans: { from: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }; t0: number } | null = null;
  /** ainda deslizando de uma câmera pra outra? (o renderer segura a cena 3D até acabar) */
  transitioning() {
    return !!this.trans;
  }
  /** altura do chão dos carros (inclinada: em cima do asfalto 3D, que fica uns centímetros acima do chão) */
  private groundY = 0;
  /** relevo do autódromo (null: plano) */
  private terrain: Terrain | null = null;
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
  private camPos: THREE.Vector3 | null = null;
  private trackGroup: THREE.Object3D | null = null;

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
        void buildTrack3d(track, this.realShadow).then((res) => {
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
    const cx = tf ? tf.x : viewX + hw, cz = tf ? tf.y : viewY + hh;
    cam.position.set(cx, 60, cz);
    cam.lookAt(cx, 0, cz);
    if (this.shadowFloor) {
      // sombra só na parte da pista que aparece (o mapa de sombra cobre a tela; inclinada: em volta do carro)
      const sh = tf ? (tf.iso ? Math.max(90, (tf.span ?? 100) * 0.95) : 90) : Math.max(hw, hh);
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
      this.hemi.intensity = tf ? 1.05 : 1.3;
      this.sun.intensity = tf ? 2.3 : 2.2;
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
      c.root.position.set(d.x, this.groundY + this.hAt(d.x, d.y) + (up > 0 ? up * 1.6 : (d.scale - 1) * 3), d.y);
      const blob = c.root.getObjectByName("blob");
      if (blob) {
        blob.visible = !!tf && up <= 0 && this.realShadow;
        // (o sol vem de -x/-z: a sombra cai ~0,9 m pra +x/+z no mundo; o carro gira, então desfaz o giro dele)
        const ry = Math.PI / 2 - d.h, wx = 0.54, wz = 0.72;
        blob.position.set(wx * Math.cos(ry) - wz * Math.sin(ry), 0.03, wx * Math.sin(ry) + wz * Math.cos(ry));
      }
      // nariz do modelo pra +Z; no 2D a direção h aponta pra (cos h, sen h) = (X, Z)
      c.root.rotation.y = Math.PI / 2 - d.h;
      c.root.scale.setScalar(up > 0 ? 1 : d.scale);
      const L = d.look;
      c.parts.asa_d.visible = L.fw.state !== "none";
      c.parts.asa_t.visible = L.rw.state !== "none";
      const wheels: Part[] = ["roda_fe", "roda_fd", "roda_te", "roda_td"];
      c.spin += (d.v * dt) / 0.33;
      wheels.forEach((w, i) => {
        const p = c.parts[w];
        p.visible = L.wheels[i] !== "off";
        p.rotation.order = "YXZ";
        // (no 3D, girar em +Y vira pra esquerda do carro)
        p.rotation.y = i < 2 ? -L.steer : 0;
        p.rotation.x = c.spin;
      });
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
      if (kind !== "tv") this.tvH = null;
      const ISO_FOV = 34, span = tf.span ?? 100;
      const pose = (k: string) => {
        if (k === "tv") {
          // atrás e acima do carro, olhando um pouco à frente dele. A direção é amortecida (a do carro balança
          // a cada correção de volante e a câmera ia e voltava pros lados), e no tempo real (não no do jogo)
          if (this.tvH == null) this.tvH = tf.h;
          let dh = tf.h - this.tvH;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          this.tvH += dh * Math.min(1, rdt * 2.2);
          const fx = Math.cos(this.tvH), fz = Math.sin(this.tvH);
          const want = new THREE.Vector3(tf.x - fx * 26, 11 + this.hAt(tf.x, tf.y), tf.y - fz * 26);
          this.camPos = this.camPos ? this.camPos.lerp(want, Math.min(1, rdt * 4)) : want;
          return { pos: this.camPos.clone(), look: new THREE.Vector3(tf.x + fx * 14, 1.2 + this.hAt(tf.x + fx * 14, tf.y + fz * 14), tf.y + fz * 14), fov: 42 };
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
      let cp = pose(kind);
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
      p.far = Math.max(3000, cp.pos.y * 4);
      p.updateProjectionMatrix();
      p.position.copy(cp.pos);
      p.lookAt(cp.look);
      // neblina só depois do ponto que a câmera olha (senão a de lado, mais longe, ficava mais clara que a de cima)
      const fog = this.scene.fog as THREE.Fog | null;
      if (fog) {
        const dist = cp.pos.distanceTo(cp.look);
        fog.near = Math.max(300, dist * 1.1);
        fog.far = Math.max(1800, dist * 6);
      }
      r.render(this.scene, p);
    } else {
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
