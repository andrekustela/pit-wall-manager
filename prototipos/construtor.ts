// PROTÓTIPO DO CONSTRUTOR DA SEDE (fora do jogo): terreno em grade de 1 m com 3 andares (o mezanino é o 2º),
// piso por retângulo, parede por linha, porta/janela/vidro na parede, objetos do catálogo (girar com R), escada
// entre andares, apagar, desfazer, salvar. Abrir com o dev ligado: http://localhost:5179/prototipos/construtor.html
// shortcut: tudo no navegador (localStorage + arquivo .json); regras de custo/limite e loja ficam pra depois.
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { TEAMS } from "../src/sim/data";

const team = TEAMS[0];
const PW = 36, PD = 24, H = 3.2, LEVELS = 3, X0 = -PW / 2, Z0 = -PD / 2;
const KEY = "pwm.construtor";

// ---------- dados (o que é salvo) ----------
interface Item { id: number; k: string; l: number; i: number; j: number; r: number }
interface Build { v: 1; floors: Record<string, string>; walls: Record<string, string>; items: Item[] }
// piso "l:i:j" = material; parede "l:i:j:o" = tipo|cor (o 0 = aresta em x na linha z=j; o 1 = aresta em z na coluna x=i)
let B: Build = { v: 1, floors: {}, walls: {}, items: [] };
let nextId = 1;
const history: string[] = [];
const snap = () => { history.push(JSON.stringify(B)); if (history.length > 60) history.shift(); };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(B)); } catch { /* sem espaço */ } };

// ---------- cena ----------
const host = document.getElementById("cena")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c0e14");
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a3a48, 1.5));
const sun = new THREE.DirectionalLight(0xffd9a8, 2.2);
sun.position.set(-16, 40, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const cam = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
cam.position.set(22, 30, 32);
const controls = new MapControls(cam, renderer.domElement);
controls.target.set(0, 0, 0);
controls.mouseButtons = { LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }; // esquerdo = ferramenta
controls.maxPolarAngle = 1.35;
controls.enableDamping = true; // movimento suave, mas responde na hora
controls.dampingFactor = 0.18;
controls.zoomSpeed = 1.6;
controls.zoomToCursor = true; // a roda aproxima onde está a setinha
controls.rotateSpeed = 0.9;
controls.minDistance = 4;
controls.maxDistance = 120;
controls.update();
// teclado: WASD/setas andam (contínuo enquanto segura, na direção da câmera), Q/E giram, Shift = rápido,
// Espaço + botão esquerdo = arrastar a vista
const held = new Set<string>();
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", "q", "e", "c", " ", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "control"].includes(k)) { held.add(k); if (k.startsWith("arrow") || k === " ") e.preventDefault(); }
  if (k === " " || k === "shift") leftButton();
  if (k === "f" && !e.ctrlKey) toggleDrone();
});
addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  held.delete(k);
  if (k === " " || k === "shift") leftButton();
});
/**
 * botão esquerdo: ferramenta, ou arrastar o mapa com Shift/Espaço (girar fica no botão direito).
 * Pegadinha do three: com Shift apertado o controle TROCA arrastar↔girar sozinho; por isso, com Shift,
 * o esquerdo vira "girar" — que o Shift transforma em arrastar
 */
function leftButton() {
  controls.mouseButtons.LEFT = drone ? (-1 as THREE.MOUSE) : held.has("shift") ? THREE.MOUSE.ROTATE : held.has(" ") ? THREE.MOUSE.PAN : (-1 as THREE.MOUSE);
}
addEventListener("blur", () => { held.clear(); leftButton(); });
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
/** velocidade: normal, Shift = rápido, Ctrl = lento (o usuário pediu os três) */
const speedMul = () => (held.has("shift") ? 2.5 : held.has("control") ? 0.3 : 1);
// DRONE: voa por dentro da construção (olhar com o mouse preso na tela, WASD/setas, Espaço sobe, C desce)
let yaw = 0, pitch = -0.15;
const camBefore = { p: new THREE.Vector3(), t: new THREE.Vector3() };
function toggleDrone() {
  drone = !drone;
  if (drone) {
    camBefore.p.copy(cam.position);
    camBefore.t.copy(controls.target);
    controls.enabled = false;
    cam.position.set(0, 1.7, PD / 2 + 3); // na porta da frente, altura de gente
    yaw = 0;
    pitch = -0.08;
    cam.rotation.set(pitch, yaw, 0, "YXZ");
    held.clear();
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    cam.position.copy(camBefore.p);
    controls.target.copy(camBefore.t);
    controls.enabled = true;
    cam.lookAt(controls.target);
  }
  document.getElementById("drone")?.classList.toggle("on", drone);
  dica.textContent = drone ? "DRONE: clique na tela pra olhar com o mouse · WASD/setas andam · Espaço sobe · C desce · Shift rápido · Ctrl lento · Esc solta o mouse · F volta pro editor" : DICAS[tool];
  if (ghost) ghost.visible = !drone;
  clearPreview();
  rebuild();
}
document.addEventListener("mousemove", (e) => {
  if (!drone || document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.0022;
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.0022));
  cam.rotation.set(pitch, yaw, 0, "YXZ");
});
function droneMove(dt: number) {
  const sp = 4.5 * speedMul() * dt;
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  mv.set(0, 0, 0);
  if (held.has("w") || held.has("arrowup")) mv.add(f);
  if (held.has("s") || held.has("arrowdown")) mv.sub(f);
  if (held.has("d") || held.has("arrowright")) mv.add(r);
  if (held.has("a") || held.has("arrowleft")) mv.sub(r);
  if (held.has(" ") || held.has("e")) mv.y += 1;
  if (held.has("c") || held.has("q")) mv.y -= 1;
  if (mv.lengthSq()) cam.position.addScaledVector(mv.normalize(), sp);
  cam.position.y = Math.max(0.4, Math.min(40, cam.position.y));
}
function keyMove(dt: number) {
  if (drone) { droneMove(dt); return; }
  if (!held.size) return;
  const dist = cam.position.distanceTo(controls.target), sp = dist * 0.9 * speedMul() * dt;
  cam.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  right.crossVectors(fwd, cam.up).normalize();
  mv.set(0, 0, 0);
  if (held.has("w") || held.has("arrowup")) mv.add(fwd);
  if (held.has("s") || held.has("arrowdown")) mv.sub(fwd);
  if (held.has("d") || held.has("arrowright")) mv.add(right);
  if (held.has("a") || held.has("arrowleft")) mv.sub(right);
  if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); cam.position.add(mv); controls.target.add(mv); }
  const turn = (held.has("q") ? 1 : 0) - (held.has("e") ? 1 : 0);
  if (turn) { const off = cam.position.clone().sub(controls.target).applyAxisAngle(cam.up, turn * 1.8 * dt); cam.position.copy(controls.target).add(off); }
}

const mat = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
function box(w: number, h: number, d: number, m: THREE.Material) {
  const r = Math.min(0.04, Math.min(w, h, d) * 0.22);
  const b = new THREE.Mesh(r > 0.012 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), m);
  b.castShadow = b.receiveShadow = true;
  return b;
}
// grama, rua e o terreno
const grass = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat("#3f6a33"));
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.31;
grass.receiveShadow = true;
scene.add(grass);
const lot = box(PW + 2, 0.3, PD + 2, mat("#2a2d35"));
lot.position.y = -0.15;
scene.add(lot);
const road = box(160, 0.05, 8, mat("#2b2e35"));
road.position.set(0, -0.28, PD / 2 + 7);
scene.add(road);

// grade do andar ativo
const gridLines = (() => {
  const pts: number[] = [];
  for (let i = 0; i <= PW; i++) pts.push(X0 + i, 0, Z0, X0 + i, 0, Z0 + PD);
  for (let j = 0; j <= PD; j++) pts.push(X0, 0, Z0 + j, X0 + PW, 0, Z0 + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.12, depthWrite: false }));
})();
scene.add(gridLines);
// a grade só aparece na ferramenta Piso (pedido do usuário: fora dela, nenhum quadriculado, nem em cima do chão)
function updateGrid() {
  gridLines.visible = tool === "piso" && !drone;
  gridLines.position.y = cur * H + 0.04;
}

// ---------- materiais de piso e parede ----------
const FLOORS: Record<string, [string, string]> = {
  concreto: ["Concreto", "#9ea3aa"], epoxi: ["Epóxi claro", "#cfd2d8"], escritorio: ["Carpete azul", "#2e3a52"], vermelho: ["Carpete vermelho", "#7c3424"],
  madeira: ["Madeira", "#a8774a"], escuro: ["Porcelanato escuro", "#3b4150"], equipe: ["Cor da equipe", team.color],
};
const WALLS: Record<string, [string, string]> = {
  bege: ["Reboco bege", "#8c7a6e"], branco: ["Branco", "#e4e0d8"], tijolo: ["Tijolo", "#8a4a3a"], concreto: ["Concreto", "#7d8189"], equipe: ["Cor da equipe", team.color],
};
const floorMats = Object.fromEntries(Object.entries(FLOORS).map(([k, [, c]]) => [k, mat(c)]));
const wallMats = Object.fromEntries(Object.entries(WALLS).map(([k, [, c]]) => [k, mat(c)]));
const GLASS = new THREE.MeshStandardMaterial({ color: "#a9dcff", transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
const FRAME = mat("#3a3f4b", { metalness: 0.4, roughness: 0.4 }), DOOR = mat("#5a4c44"), CUT = mat("#221c19");

// ---------- catálogo de objetos ----------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Object3D>>();
function glb(url: string, prep?: (o: THREE.Object3D) => void) {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = true;
        for (const mm of [m.material].flat() as THREE.MeshStandardMaterial[]) if (url.startsWith("/sede/")) { mm.metalness = 0; mm.roughness = Math.max(mm.roughness, 0.7); }
      });
      prep?.(g.scene);
      // centro no chão (os do Kenney vêm com a origem num canto)
      const bb = new THREE.Box3().setFromObject(g.scene), c = bb.getCenter(new THREE.Vector3());
      g.scene.position.set(-c.x, -bb.min.y, -c.z);
      const w = new THREE.Group();
      w.add(g.scene);
      return w;
    });
    cache.set(url, p);
  }
  return p;
}
/** um modelo pronto dentro de um grupo (aparece quando o arquivo chega) */
function kit(name: string, s: number, x = 0, y = 0, z = 0, rot = 0) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.rotation.y = rot;
  h.scale.setScalar(s);
  void glb(`/sede/${name}.glb`).then((m) => h.add(m.clone()));
  return h;
}
const F = 2.1, GOLD = mat("#e6b53c", { metalness: 0.85, roughness: 0.28 }), RED = mat("#c42b2b", { roughness: 0.5 }), TM = mat("#16171a", { roughness: 0.95 });
const group = (...o: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...o); return g; };
const at = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); return o; };
interface Def { nome: string; cat: string; w: number; d: number; chao?: boolean; escada?: boolean; build: () => THREE.Object3D }
const CAT: Record<string, Def> = {
  mesa: { nome: "Mesa com computador", cat: "Escritório", w: 2, d: 2, build: () => group(kit("desk", F, 0, 0, -0.4), kit("computerScreen", F, -0.36, 0.8, -0.7), kit("computerScreen", F, 0.36, 0.8, -0.7), kit("computerKeyboard", F, 0, 0.8, -0.28), kit("chairDesk", F, 0, 0, 0.55, Math.PI)) },
  sofa: { nome: "Sofá", cat: "Escritório", w: 2, d: 1, build: () => kit("loungeSofa", F) },
  mesinha: { nome: "Mesinha de centro", cat: "Escritório", w: 2, d: 1, build: () => kit("tableCoffee", F) },
  tapete: { nome: "Tapete", cat: "Decoração", w: 3, d: 2, chao: true, build: () => kit("rugRectangle", F * 1.2, 0, 0.02) },
  luminaria: { nome: "Luminária de chão", cat: "Decoração", w: 1, d: 1, build: () => kit("lampRoundFloor", F * 1.2) },
  estante: { nome: "Estante", cat: "Escritório", w: 1, d: 1, build: () => kit("bookcaseOpen", F) },
  planta: { nome: "Planta", cat: "Decoração", w: 1, d: 1, build: () => kit("pottedPlant", F * 1.1) },
  lixeira: { nome: "Lixeira", cat: "Decoração", w: 1, d: 1, build: () => kit("trashcan", F * 0.75) },
  cafe: { nome: "Cantinho do café", cat: "Escritório", w: 1, d: 1, build: () => group(kit("sideTable", F), kit("kitchenCoffeeMachine", F, 0, 0.95, 0)) },
  tv: { nome: "TV", cat: "Decoração", w: 1, d: 1, build: () => group(at(box(0.9, 0.7, 0.5, mat("#2a2d35")), 0, 0.35, 0), kit("televisionModern", F * 1.2, 0, 0.7, 0)) },
  caixas: { nome: "Caixas", cat: "Oficina", w: 1, d: 1, build: () => group(kit("cardboardBoxClosed", F * 1.5, -0.15, 0, -0.1), kit("cardboardBoxClosed", F * 1.3, 0.2, 0, 0.2, 0.6), kit("cardboardBoxOpen", F * 1.2, 0, 0.58, -0.05, 1.2)) },
  cones: { nome: "Cones", cat: "Oficina", w: 1, d: 1, build: () => group(kit("pylon", 4, -0.2, 0, -0.2), kit("pylon", 4, 0.25, 0, 0.15)) },
  telemetria: { nome: "Telemetria", cat: "Oficina", w: 1, d: 1, build: () => kit("radarEquipment", 2.4) },
  pneus: {
    nome: "Pilha de pneus", cat: "Oficina", w: 1, d: 1,
    build: () => { const g = new THREE.Group(); const T = new THREE.TorusGeometry(0.36, 0.17, 10, 20); for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(T, TM); t.rotation.x = Math.PI / 2; t.position.y = 0.17 + k * 0.34; t.castShadow = true; g.add(t); } return g; },
  },
  armario: { nome: "Armário de ferramentas", cat: "Oficina", w: 2, d: 1, build: () => at(box(1.7, 1.3, 0.8, RED), 0, 0.65, 0) },
  trofeu: { nome: "Troféu no pedestal", cat: "Decoração", w: 1, d: 1, build: () => {
    const cup = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.22, 0], [0.22, 0.06], [0.06, 0.12], [0.06, 0.38], [0.3, 0.5], [0.34, 0.85], [0.3, 0.86]].map(([x, y]) => new THREE.Vector2(x, y)), 20), GOLD);
    cup.position.y = 1;
    cup.scale.setScalar(1.3);
    cup.castShadow = true;
    return group(at(box(0.8, 1, 0.8, mat("#eeeae4")), 0, 0.5, 0), cup);
  } },
  carro: { nome: "Carro de F1", cat: "Oficina", w: 2, d: 5, build: () => {
    const h = new THREE.Group();
    void glb("/car3d/carro.glb", (s) => {
      const size = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3());
      s.scale.setScalar(4.8 / Math.max(size.x, size.z));
      if (size.x > size.z) s.rotation.y = Math.PI / 2; // comprido em z
      s.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && ["pintura", "asa"].includes((m.material as THREE.Material).name)) { const c = (m.material as THREE.MeshStandardMaterial).clone(); c.map = null; c.color.set(c.name === "pintura" ? team.color : team.accent); m.material = c; } if (["piloto", "capacete", "volante", "telinha"].includes(o.name)) o.visible = false; });
    }).then((m) => h.add(m.clone()));
    return h;
  } },
  pilar: { nome: "Pilar", cat: "Estrutura", w: 1, d: 1, build: () => at(box(0.4, H, 0.4, mat("#4a4f5c")), 0, H / 2, 0) },
  escada: { nome: "Escada (sobe 1 andar)", cat: "Estrutura", w: 2, d: 6, escada: true, build: () => {
    const g = new THREE.Group(), n = 10, m = mat("#6b7180");
    // degraus maciços (cada um vai até o chão), subindo pra −z: o topo encosta na borda do andar de cima
    for (let k = 0; k < n; k++) { const hk = (H / n) * (k + 1), s = box(2, hk, 6 / n + 0.01, m); s.position.set(0, hk / 2, 3 - (6 / n) * (k + 0.5)); g.add(s); }
    return g;
  } },
};

// ---------- montagem do que está salvo ----------
const world = new THREE.Group();
scene.add(world);
const itemObjs = new Map<number, THREE.Object3D>();
const fp = (it: { k: string; r: number }) => { const d = CAT[it.k]; return it.r % 2 ? [d.d, d.w] : [d.w, d.d]; };
let cur = 0, low = false, drone = false;
function placeObj(o: THREE.Object3D, it: Item) {
  const [w, d] = fp(it);
  o.position.set(X0 + it.i + w / 2, it.l * H, Z0 + it.j + d / 2);
  o.rotation.y = (-it.r * Math.PI) / 2;
}
/** andares de baixo do que está sendo editado: translúcidos (fantasma), pra se localizar sem atrapalhar */
const ghosts = new WeakMap<THREE.Material, THREE.Material>();
function ghostOf(m: THREE.Material) {
  let g = ghosts.get(m);
  if (!g) { g = m.clone(); Object.assign(g, { transparent: true, opacity: 0.12, depthWrite: false }); ghosts.set(m, g); }
  return g;
}
function setGhost(o: THREE.Object3D, on: boolean) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const sol = (m.userData.solid ??= m.material) as THREE.Material | THREE.Material[];
    m.material = !on ? sol : Array.isArray(sol) ? sol.map(ghostOf) : ghostOf(sol);
    m.castShadow = !on;
  });
}
let staticGroup = new THREE.Group();
function rebuild() {
  world.remove(staticGroup);
  staticGroup = new THREE.Group();
  world.add(staticGroup);
  // no drone tudo aparece de verdade (sem fantasma, sem esconder andar)
  const vc = drone ? LEVELS - 1 : cur, ghostLvl = (l: number) => !drone && l < cur;
  // pisos: um InstancedMesh por andar e material
  const byMat = new Map<string, THREE.Matrix4[]>();
  const m4 = new THREE.Matrix4();
  for (const [key, m] of Object.entries(B.floors)) {
    const [l, i, j] = key.split(":").map(Number);
    if (l > vc) continue;
    const id = `${l}|${m}`;
    if (!byMat.has(id)) byMat.set(id, []);
    // (andar de baixo = só a folha de cima do piso: com o bloco inteiro, as laterais encostadas somavam a transparência)
    byMat.get(id)!.push(m4.clone().makeTranslation(X0 + i + 0.5, ghostLvl(l) ? l * H + 0.06 : l === 0 ? 0.03 : l * H - 0.12, Z0 + j + 0.5));
  }
  for (const [id, ms] of byMat) {
    const [l, m] = id.split("|");
    const below = ghostLvl(Number(l));
    const geo = below ? new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) : Number(l) === 0 ? new THREE.BoxGeometry(1, 0.06, 1) : new THREE.BoxGeometry(1, 0.24, 1);
    const fm = floorMats[m] ?? floorMats.concreto;
    const im = new THREE.InstancedMesh(geo, below ? ghostOf(fm) : fm, ms.length);
    ms.forEach((mm, k) => im.setMatrixAt(k, mm));
    im.castShadow = !below;
    im.receiveShadow = !below;
    staticGroup.add(im);
  }
  // paredes
  for (const [key, val] of Object.entries(B.walls)) {
    const [l, i, j, o] = key.split(":").map(Number);
    if (l > vc) continue;
    const [tipo, cor] = val.split("|");
    const wh = !drone && l === cur && low ? 0.6 : H;
    const g = new THREE.Group();
    g.userData.wall = key;
    const wm = wallMats[cor] ?? wallMats.bege, T = 0.18;
    const seg = (y0: number, y1: number, m: THREE.Material, t = T) => { if (y1 - y0 < 0.02) return; const b = new THREE.Mesh(new THREE.BoxGeometry(1.001, y1 - y0, t), m); b.castShadow = b.receiveShadow = true; /* parede sem quina arredondada: senão aparece emenda a cada metro */ b.position.y = (y0 + y1) / 2; b.userData.wall = key; g.add(b); };
    if (tipo === "porta") { if (wh > 2.3) seg(2.3, wh, wm); const fr = (x: number) => { const p = box(0.08, Math.min(wh, 2.3), T + 0.04, FRAME); p.position.set(x, Math.min(wh, 2.3) / 2, 0); p.userData.wall = key; g.add(p); }; fr(-0.46); fr(0.46); }
    else if (tipo === "janela") { seg(0, Math.min(wh, 1), wm); if (wh > 1) seg(1, Math.min(wh, 2.4), GLASS, 0.04); if (wh > 2.4) seg(2.4, wh, wm); }
    else if (tipo === "vidro") { seg(0, wh, GLASS, 0.05); const top = box(1, 0.08, 0.1, FRAME); top.position.y = wh; g.add(top); }
    else seg(0, wh, wm);
    if (tipo !== "vidro" && tipo !== "porta" && wh === H) { const cap = box(1.02, 0.06, T + 0.03, CUT); cap.position.y = H; g.add(cap); }
    g.position.set(o === 0 ? X0 + i + 0.5 : X0 + i, l * H + (l ? 0 : 0), o === 0 ? Z0 + j : Z0 + j + 0.5);
    if (o === 1) g.rotation.y = Math.PI / 2;
    if (ghostLvl(l)) setGhost(g, true);
    staticGroup.add(g);
  }
  for (const [id, o] of itemObjs) {
    const l = B.items.find((it) => it.id === id)!.l;
    // de baixo só o piso e a parede aparecem (fantasma); objeto de baixo some (só a escada que chega aqui fica)
    o.visible = drone || l === cur || (l < cur && CAT[B.items.find((it) => it.id === id)!.k].escada === true);
    setGhost(o, ghostLvl(l));
  }
  updateGrid();
}
function addItemObj(it: Item) {
  const o = CAT[it.k].build();
  o.traverse((c) => (c.userData.item = it.id));
  o.userData.item = it.id;
  placeObj(o, it);
  world.add(o);
  itemObjs.set(it.id, o);
}
function loadAll(b: Build) {
  for (const o of itemObjs.values()) world.remove(o);
  itemObjs.clear();
  B = b;
  nextId = Math.max(0, ...B.items.map((i) => i.id)) + 1;
  for (const it of B.items) addItemObj(it);
  rebuild();
}

// ---------- regras de lugar ----------
const inLot = (i: number, j: number) => i >= 0 && j >= 0 && i < PW && j < PD;
function cellsOf(it: { k: string; i: number; j: number; r: number }) { const [w, d] = fp(it); const out: [number, number][] = []; for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) out.push([it.i + a, it.j + b]); return out; }
function canPlace(it: Item, ignore = -1) {
  const def = CAT[it.k], cells = cellsOf(it);
  if (!cells.every(([i, j]) => inLot(i, j))) return false;
  if (def.escada && it.l >= LEVELS - 1) return false;
  if (it.l > 0 && !cells.every(([i, j]) => B.floors[`${it.l}:${i}:${j}`])) return false; // lá em cima precisa de piso embaixo
  if (def.chao) return true;
  const taken = new Set<string>();
  for (const o of B.items) if (o.id !== ignore && o.l === it.l && !CAT[o.k].chao) for (const [i, j] of cellsOf(o)) taken.add(`${i}:${j}`);
  for (const o of B.items) if (CAT[o.k].escada && o.l === it.l - 1) for (const [i, j] of cellsOf(o)) taken.add(`${i}:${j}`); // escada que chega aqui
  return cells.every(([i, j]) => !taken.has(`${i}:${j}`));
}

// ---------- ferramentas ----------
type Tool = "mao" | "piso" | "parede" | "porta" | "janela" | "vidro" | "objeto" | "apagar";
const TOOLS: [Tool, string][] = [["mao", "✋ Selecionar"], ["piso", "Piso"], ["parede", "Parede"], ["porta", "Porta"], ["janela", "Janela"], ["vidro", "Vidro"], ["objeto", "Objeto"], ["apagar", "Apagar"]];
let tool: Tool = "piso", floorSel = "concreto", wallSel = "bege", itemSel = "mesa", rot = 0;
const DICAS: Record<Tool, string> = {
  mao: "Clique num objeto pra selecionar. Arraste pra mover. R gira, Delete apaga, Esc solta.",
  piso: "Arraste um retângulo pra pôr piso. No 1º e 2º andar, o piso é a laje (mezanino).",
  parede: "Arraste uma linha na grade pra levantar parede.",
  porta: "Clique numa parede pra virar porta.",
  janela: "Clique numa parede pra virar janela.",
  vidro: "Clique numa parede pra virar vidro.",
  objeto: "Clique pra pôr. R gira. Vermelho = não cabe ali.",
  apagar: "Clique num objeto, parede ou piso pra apagar. Arraste pra apagar uma área.",
};
const toolsEl = document.getElementById("tools")!, optsEl = document.getElementById("opts")!, dica = document.getElementById("dica")!;
function renderUI() {
  toolsEl.innerHTML = TOOLS.map(([t, n], k) => `<button data-t="${t}" class="${t === tool ? "on" : ""}" title="tecla ${k + 1}">${n}</button>`).join("");
  let h = "";
  if (tool === "piso") h = `<h4>Material do piso</h4><div class="grid">${Object.entries(FLOORS).map(([k, [n, c]]) => `<button class="sw ${k === floorSel ? "on" : ""}" data-f="${k}"><i style="background:${c}"></i>${n}</button>`).join("")}</div>`;
  else if (tool === "parede") h = `<h4>Cor da parede</h4><div class="grid">${Object.entries(WALLS).map(([k, [n, c]]) => `<button class="sw ${k === wallSel ? "on" : ""}" data-w="${k}"><i style="background:${c}"></i>${n}</button>`).join("")}</div>`;
  else if (tool === "objeto") {
    const cats = [...new Set(Object.values(CAT).map((d) => d.cat))];
    h = cats.map((c) => `<h4>${c}</h4><div class="grid">${Object.entries(CAT).filter(([, d]) => d.cat === c).map(([k, d]) => `<button class="${k === itemSel ? "on" : ""}" data-i="${k}" title="${d.w}×${d.d} m">${d.nome}</button>`).join("")}</div>`).join("");
  }
  if (tool === "mao") {
    const it = B.items.find((x) => x.id === selId);
    h = it ? `<h4>Selecionado</h4><p style="margin:0 0 10px">${CAT[it.k].nome} · ${["Térreo", "1º andar", "2º andar"][it.l]}</p><div class="grid"><button data-act="girar">Girar (R)</button><button data-act="duplicar">Duplicar</button><button data-act="apagar">Apagar (Delete)</button></div>` : `<h4>Selecionar</h4><p style="color:var(--dim)">Clique num objeto do andar escolhido. Arraste pra mover pra outro lugar.</p>`;
  }
  optsEl.innerHTML = h || `<h4>Atalhos</h4><p style="color:var(--dim)">WASD ou setas: andar (Shift = rápido) · Q/E: girar · botão direito: girar com o mouse · Shift (ou Espaço ou botão do meio) + arrastar: andar no mapa · roda: zoom onde está a setinha · Ctrl+Z: desfazer · Page Up/Down: andar de cima/baixo · T: paredes baixas</p>`;
  dica.textContent = DICAS[tool];
  document.getElementById("andar")!.innerHTML = ["Térreo", "1º andar", "2º andar"].map((n, l) => `<button data-l="${l}" class="${l === cur ? "on" : ""}">${n}</button>`).join("");
  document.getElementById("baixas")!.classList.toggle("on", low);
  for (const b of toolsEl.querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => setTool(b.dataset.t as Tool);
  for (const b of optsEl.querySelectorAll<HTMLButtonElement>("button[data-f]")) b.onclick = () => { floorSel = b.dataset.f!; renderUI(); };
  for (const b of optsEl.querySelectorAll<HTMLButtonElement>("button[data-w]")) b.onclick = () => { wallSel = b.dataset.w!; renderUI(); };
  for (const b of optsEl.querySelectorAll<HTMLButtonElement>("button[data-i]")) b.onclick = () => { itemSel = b.dataset.i!; rot = 0; makeGhost(); renderUI(); };
  for (const b of document.querySelectorAll<HTMLButtonElement>("#andar button")) b.onclick = () => setLevel(Number(b.dataset.l));
  for (const b of optsEl.querySelectorAll<HTMLButtonElement>("button[data-act]")) b.onclick = () => (b.dataset.act === "girar" ? rotateSel() : b.dataset.act === "apagar" ? deleteSel() : duplicateSel());
}
function setTool(t: Tool) { if (t !== "mao") { selId = null; selBox.visible = false; } tool = t; clearPreview(); makeGhost(); renderUI(); updateGrid(); }
function setLevel(l: number) { selId = null; selBox.visible = false; cur = Math.max(0, Math.min(LEVELS - 1, l)); rebuild(); makeGhost(); renderUI(); }

// ---------- mouse ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundHit(e: PointerEvent) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  plane.constant = -cur * H;
  return ray.ray.intersectPlane(plane, new THREE.Vector3());
}
const cellAt = (p: THREE.Vector3) => [Math.floor(p.x - X0), Math.floor(p.z - Z0)] as const;
const vertAt = (p: THREE.Vector3) => [Math.round(p.x - X0), Math.round(p.z - Z0)] as const;
function edgeAt(p: THREE.Vector3) {
  const [i, j] = cellAt(p), fx = p.x - X0 - i, fz = p.z - Z0 - j;
  const c = [[fz, `${cur}:${i}:${j}:0`], [1 - fz, `${cur}:${i}:${j + 1}:0`], [fx, `${cur}:${i}:${j}:1`], [1 - fx, `${cur}:${i + 1}:${j}:1`]] as [number, string][];
  c.sort((a, b) => a[0] - b[0]);
  return c[0];
}
const preview = new THREE.Group();
scene.add(preview);
const PREV_OK = new THREE.MeshBasicMaterial({ color: "#39d0ff", transparent: true, opacity: 0.35, depthWrite: false });
const PREV_BAD = new THREE.MeshBasicMaterial({ color: "#ff3b3b", transparent: true, opacity: 0.35, depthWrite: false });
function clearPreview() { preview.clear(); }
let drag: { a: readonly [number, number]; b: readonly [number, number] } | null = null;
let ghost: THREE.Object3D | null = null, ghostCell: [number, number] = [0, 0];
function makeGhost() {
  if (ghost) scene.remove(ghost);
  ghost = null;
  if (tool !== "objeto") return;
  ghost = CAT[itemSel].build();
  scene.add(ghost);
}
function ghostItem(): Item { const [w, d] = fp({ k: itemSel, r: rot }); return { id: 0, k: itemSel, l: cur, i: ghostCell[0] - Math.floor((w - 1) / 2), j: ghostCell[1] - Math.floor((d - 1) / 2), r: rot }; }
function tintGhost(ok: boolean) {
  if (!ghost) return;
  ghost.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.userData.orig) m.userData.orig = m.material;
    m.material = ok ? m.userData.orig : PREV_BAD;
    m.castShadow = false;
  });
}
function rectCells(a: readonly [number, number], b: readonly [number, number]) {
  const out: [number, number][] = [];
  for (let i = Math.min(a[0], b[0]); i <= Math.max(a[0], b[0]); i++) for (let j = Math.min(a[1], b[1]); j <= Math.max(a[1], b[1]); j++) if (inLot(i, j)) out.push([i, j]);
  return out;
}
function wallEdges(a: readonly [number, number], b: readonly [number, number]) {
  const out: string[] = [];
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) { for (let i = Math.min(a[0], b[0]); i < Math.max(a[0], b[0]); i++) if (i >= 0 && i < PW && a[1] >= 0 && a[1] <= PD) out.push(`${cur}:${i}:${a[1]}:0`); }
  else for (let j = Math.min(a[1], b[1]); j < Math.max(a[1], b[1]); j++) if (j >= 0 && j < PD && a[0] >= 0 && a[0] <= PW) out.push(`${cur}:${a[0]}:${j}:1`);
  return out;
}
function showPreview() {
  clearPreview();
  if (!drag) return;
  if (tool === "piso" || tool === "apagar") {
    const cs = rectCells(drag.a, drag.b);
    const i0 = Math.min(drag.a[0], drag.b[0]), i1 = Math.max(drag.a[0], drag.b[0]), j0 = Math.min(drag.a[1], drag.b[1]), j1 = Math.max(drag.a[1], drag.b[1]);
    if (!cs.length) return;
    const b = new THREE.Mesh(new THREE.BoxGeometry(i1 - i0 + 1, 0.1, j1 - j0 + 1), tool === "apagar" ? PREV_BAD : PREV_OK);
    b.position.set(X0 + (i0 + i1 + 1) / 2, cur * H + 0.1, Z0 + (j0 + j1 + 1) / 2);
    preview.add(b);
  } else if (tool === "parede") {
    for (const k of wallEdges(drag.a, drag.b)) {
      const [, i, j, o] = k.split(":").map(Number);
      const b = new THREE.Mesh(new THREE.BoxGeometry(o === 0 ? 1 : 0.2, H, o === 0 ? 0.2 : 1), PREV_OK);
      b.position.set(o === 0 ? X0 + i + 0.5 : X0 + i, cur * H + H / 2, o === 0 ? Z0 + j : Z0 + j + 0.5);
      preview.add(b);
    }
  }
}
let selId: number | null = null, moving: { id: number; di: number; dj: number; moved: boolean } | null = null;
const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x39d0ff);
selBox.visible = false;
scene.add(selBox);
function select(id: number | null) {
  selId = id;
  const o = id == null ? null : itemObjs.get(id);
  selBox.visible = !!o;
  if (o) selBox.setFromObject(o);
  renderUI();
}
function removeItem(it: Item) {
  B.items = B.items.filter((x) => x !== it);
  world.remove(itemObjs.get(it.id)!);
  itemObjs.delete(it.id);
}
function rotateSel() {
  const it = B.items.find((x) => x.id === selId);
  if (!it) return;
  const t = { ...it, r: (it.r + 1) % 4 };
  if (!canPlace(t, it.id)) return;
  snap();
  it.r = t.r;
  placeObj(itemObjs.get(it.id)!, it);
  select(it.id);
  save();
}
function deleteSel() {
  const it = B.items.find((x) => x.id === selId);
  if (!it) return;
  snap();
  removeItem(it);
  select(null);
  save();
}
function duplicateSel() {
  const it = B.items.find((x) => x.id === selId);
  if (!it) return;
  // a cópia vai pro primeiro lugar livre perto (direita, frente, esquerda, trás)
  for (let k = 1; k < 8; k++) for (const [di, dj] of [[k, 0], [0, k], [-k, 0], [0, -k]]) {
    const c: Item = { ...it, id: nextId, i: it.i + di, j: it.j + dj };
    if (!canPlace(c)) continue;
    snap();
    nextId++;
    B.items.push(c);
    addItemObj(c);
    rebuild();
    select(c.id);
    save();
    return;
  }
}
function pickItem(e: PointerEvent) {
  groundHit(e);
  const hits = ray.intersectObjects([...itemObjs.values()].filter((o) => o.visible), true);
  for (const h of hits) {
    // (as peças do modelo chegam depois de montar: sobe até achar o grupo que sabe qual objeto é)
    let o: THREE.Object3D | null = h.object;
    while (o && o.userData.item === undefined) o = o.parent;
    const it = o && B.items.find((x) => x.id === o!.userData.item);
    if (it && it.l === cur) return it;
  }
  return null;
}
const el = renderer.domElement;
el.addEventListener("pointerdown", (e) => {
  if (drone) { if (document.pointerLockElement !== el) void el.requestPointerLock(); return; } // no drone o clique prende o mouse pra olhar
  if (e.button !== 0 || e.shiftKey || held.has(" ")) return; // com Shift (ou Espaço) o clique só arrasta o mapa: não põe nada
  const p = groundHit(e);
  if (!p) return;
  if (tool === "mao") {
    const it = pickItem(e);
    select(it ? it.id : null);
    if (it) { const [ci, cj] = cellAt(p); moving = { id: it.id, di: it.i - ci, dj: it.j - cj, moved: false }; controls.enabled = false; }
    return;
  }
  if (tool === "piso" || tool === "apagar") {
    if (tool === "apagar") {
      const it = pickItem(e);
      if (it) { snap(); B.items = B.items.filter((x) => x !== it); world.remove(itemObjs.get(it.id)!); itemObjs.delete(it.id); save(); return; }
      const [dist, key] = edgeAt(p);
      if (dist < 0.22 && B.walls[key]) { snap(); delete B.walls[key]; rebuild(); save(); return; }
    }
    drag = { a: cellAt(p), b: cellAt(p) };
  } else if (tool === "parede") drag = { a: vertAt(p), b: vertAt(p) };
  else if (tool === "porta" || tool === "janela" || tool === "vidro") {
    const [, key] = edgeAt(p);
    snap();
    const cor = B.walls[key]?.split("|")[1] ?? wallSel;
    B.walls[key] = `${tool}|${cor}`;
    rebuild();
    save();
  } else if (tool === "objeto") {
    const it = ghostItem();
    if (!canPlace(it)) return;
    snap();
    it.id = nextId++;
    if (CAT[it.k].escada) for (const [i, j] of cellsOf(it)) delete B.floors[`${it.l + 1}:${i}:${j}`]; // abre o buraco da escada lá em cima
    B.items.push(it);
    addItemObj(it);
    rebuild();
    save();
  }
  showPreview();
});
el.addEventListener("pointermove", (e) => {
  if (drone) return;
  const p = groundHit(e);
  if (!p) return;
  if (drag) { drag.b = tool === "parede" ? vertAt(p) : cellAt(p); showPreview(); }
  if (moving) {
    const it = B.items.find((x) => x.id === moving!.id)!;
    const [ci, cj] = cellAt(p), t = { ...it, i: ci + moving.di, j: cj + moving.dj };
    if ((t.i !== it.i || t.j !== it.j) && canPlace(t, it.id)) {
      if (!moving.moved) { snap(); moving.moved = true; }
      it.i = t.i;
      it.j = t.j;
      placeObj(itemObjs.get(it.id)!, it);
      selBox.setFromObject(itemObjs.get(it.id)!);
    }
  }
  el.style.cursor = tool === "mao" ? (moving ? "grabbing" : "grab") : "default";
  if (ghost && tool === "objeto") {
    ghostCell = [cellAt(p)[0], cellAt(p)[1]];
    const it = ghostItem();
    placeObj(ghost, it);
    tintGhost(canPlace(it));
  }
});
addEventListener("pointerup", () => {
  if (moving) { if (moving.moved) save(); moving = null; controls.enabled = !drone; }
  if (!drag) return;
  snap();
  if (tool === "piso") for (const [i, j] of rectCells(drag.a, drag.b)) B.floors[`${cur}:${i}:${j}`] = floorSel;
  else if (tool === "parede") for (const k of wallEdges(drag.a, drag.b)) B.walls[k] = `parede|${wallSel}`;
  else if (tool === "apagar") {
    const cs = new Set(rectCells(drag.a, drag.b).map(([i, j]) => `${i}:${j}`));
    for (const k of Object.keys(B.floors)) { const [l, i, j] = k.split(":").map(Number); if (l === cur && cs.has(`${i}:${j}`)) delete B.floors[k]; }
    for (const k of Object.keys(B.walls)) { const [l, i, j, o] = k.split(":").map(Number); if (l === cur && (cs.has(`${i}:${j}`) || cs.has(o === 0 ? `${i}:${j - 1}` : `${i - 1}:${j}`))) delete B.walls[k]; }
    for (const it of B.items.filter((x) => x.l === cur && cellsOf(x).some(([i, j]) => cs.has(`${i}:${j}`)))) { B.items = B.items.filter((x) => x !== it); world.remove(itemObjs.get(it.id)!); itemObjs.delete(it.id); }
  }
  drag = null;
  clearPreview();
  rebuild();
  save();
});
addEventListener("keydown", (e) => {
  if (tool === "mao" && selId != null && (e.key === "r" || e.key === "R")) rotateSel();
  else if (tool === "mao" && selId != null && (e.key === "Delete" || e.key === "Backspace")) deleteSel();
  else if (e.key === "r" || e.key === "R") { rot = (rot + 1) % 4; if (ghost) { const it = ghostItem(); placeObj(ghost, it); tintGhost(canPlace(it)); } }
  else if (e.key === "t" || e.key === "T") { low = !low; rebuild(); renderUI(); }
  else if (e.key === "PageUp") setLevel(cur + 1);
  else if (e.key === "PageDown") setLevel(cur - 1);
  else if (e.key === "Escape") { drag = null; clearPreview(); select(null); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { const h = history.pop(); if (h) { loadAll(JSON.parse(h)); select(null); save(); } }
  else if (/^[1-8]$/.test(e.key)) setTool(TOOLS[Number(e.key) - 1][0]);
});

// ---------- modelo pronto (a sede do protótipo, em peças) ----------
function template(): Build {
  const b: Build = { v: 1, floors: {}, walls: {}, items: [] };
  const fill = (l: number, i0: number, i1: number, j0: number, j1: number, m: string) => { for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) b.floors[`${l}:${i}:${j}`] = m; };
  const wallX = (l: number, i0: number, i1: number, j: number, t = "parede", c = "bege") => { for (let i = i0; i < i1; i++) b.walls[`${l}:${i}:${j}:0`] = `${t}|${c}`; };
  const wallZ = (l: number, j0: number, j1: number, i: number, t = "parede", c = "bege") => { for (let j = j0; j < j1; j++) b.walls[`${l}:${i}:${j}:1`] = `${t}|${c}`; };
  fill(0, 0, 11, 0, 24, "vermelho"); fill(0, 11, 23, 0, 24, "escritorio"); fill(0, 23, 36, 0, 24, "epoxi");
  wallX(0, 0, 36, 0); wallZ(0, 0, 24, 0); wallX(0, 0, 36, 24); wallZ(0, 0, 24, 36);
  for (const i of [5, 16, 17, 18, 29, 30]) b.walls[`0:${i}:24:0`] = `${i < 10 ? "janela" : i < 20 ? "porta" : "janela"}|bege`;
  for (let j = 8; j < 14; j++) b.walls[`0:36:${j}:1`] = "porta|bege"; // portão da oficina
  for (const i of [24, 26, 28, 30, 32, 34]) b.walls[`0:${i}:0:0`] = "janela|bege";
  wallZ(0, 7, 24, 23, "vidro"); // vidro entre o QG e a oficina
  // mezanino (1º andar) no fundo, dos troféus até o QG
  fill(1, 0, 23, 0, 6, "escuro");
  wallX(1, 0, 23, 0); wallZ(1, 0, 6, 0);
  wallX(1, 0, 23, 6, "vidro");
  let id = 1;
  const it = (k: string, l: number, i: number, j: number, r = 0) => b.items.push({ id: id++, k, l, i, j, r });
  it("escada", 0, 9, 6); // sobe pro mezanino pela borda dele (z = 6): sem vidro nesse pedaço
  delete b.walls["1:9:6:0"];
  delete b.walls["1:10:6:0"];
  it("carro", 0, 4, 11); it("tapete", 0, 3, 18); for (let i = 1; i < 9; i += 2) it("trofeu", 1, i, 1);
  it("mesa", 0, 13, 18); it("mesa", 0, 19, 18); it("mesa", 1, 13, 2); it("mesa", 1, 17, 2); it("sofa", 0, 13, 9); it("mesinha", 0, 13, 11); it("cafe", 0, 21, 8); it("planta", 0, 11, 23); it("planta", 0, 22, 23);
  it("carro", 0, 28, 14); it("carro", 0, 32, 3); it("pneus", 0, 34, 20); it("pneus", 0, 34, 21); it("armario", 0, 24, 1); it("armario", 0, 33, 1); it("telemetria", 0, 26, 21); it("cones", 0, 30, 20); it("caixas", 0, 35, 1);
  return b;
}

// ---------- botões de cima ----------
document.getElementById("baixas")!.onclick = () => { low = !low; rebuild(); renderUI(); };
document.getElementById("modelo")!.onclick = () => { snap(); loadAll(template()); save(); };
document.getElementById("limpar")!.onclick = () => { if (!confirm("Apagar tudo o que está construído?")) return; snap(); loadAll({ v: 1, floors: {}, walls: {}, items: [] }); save(); };
document.getElementById("salvar")!.onclick = async () => {
  save();
  const text = JSON.stringify(B);
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  try {
    if (picker) { const h = await picker({ suggestedName: "minha-sede.sede.json", types: [{ description: "Sede", accept: { "application/json": [".json"] } }] }); const w = await h.createWritable(); await w.write(text); await w.close(); return; }
  } catch { return; } // cancelou
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = "minha-sede.sede.json";
  a.click();
};
document.getElementById("abrir")!.onclick = () => {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json";
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try { const b = JSON.parse(await f.text()) as Build; if (!b.floors || !b.walls || !Array.isArray(b.items)) throw new Error(); snap(); loadAll(b); save(); }
    catch { alert("Esse arquivo não é uma sede salva por aqui."); }
  };
  inp.click();
};

// ---------- começo e laço ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, cam));
const ao = new GTAOPass(scene, cam, innerWidth, innerHeight);
ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1.2 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
composer.addPass(new OutputPass());
function resize() {
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize);
resize();
let saved: Build | null = null;
try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { saved = null; }
loadAll(saved && saved.floors ? saved : template());
renderUI();
(window as unknown as { __t: object }).__t = { b: () => B, cam, X0, Z0, H, itemObjs }; // teste
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  keyMove(Math.min(0.05, clock.getDelta()));
  if (!drone) controls.update();
  composer.render();
});
document.getElementById("drone")!.onclick = () => toggleDrone();
