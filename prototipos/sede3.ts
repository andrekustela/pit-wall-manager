// PROTÓTIPO DA SEDE (fora do jogo): galpão em corte visto de cima em ângulo, a partir do desenho do usuário
// (testes/imagem teste.jpg). Abrir com o dev ligado: http://localhost:5179/prototipos/sede.html (?equipe=aur ...).
// shortcut: tudo em blocos simples e dados de exemplo; quando aprovado, vira src/ui/hq3d.ts lendo a carreira de verdade.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { TEAMS } from "../src/sim/data";
import { CIRCUITS, getTrack, isOfficial } from "../src/sim/track";

const team = TEAMS.find((t) => t.id === new URLSearchParams(location.search).get("equipe")) ?? TEAMS[0];
const trackIdx = CIRCUITS.findIndex((_, i) => isOfficial(i));
const track = getTrack(trackIdx);

// ---------- topo ----------
document.documentElement.style.setProperty("--team", team.color);
document.documentElement.style.setProperty("--acc", team.accent);
document.getElementById("nome")!.textContent = team.name;
document.getElementById("etapa")!.textContent = `ETAPA 5: ${track.name}`;
const sel = document.getElementById("equipe") as HTMLSelectElement;
for (const t of TEAMS) sel.add(new Option(t.name, t.id, false, t === team));
sel.onchange = () => (location.search = `?equipe=${sel.value}`);

// ---------- cena ----------
const host = document.getElementById("cena")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c0e14");
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; // reflexo nos troféus e no carro
scene.environmentIntensity = 0.5;

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
const DIR = new THREE.Vector3(1, 0.95, 1.05).normalize();
const view = { tx: new THREE.Vector3(0, 2, 0), tz: 1, x: new THREE.Vector3(0, 2, 0), z: 1 };
const FRAME = 23; // meia altura da vista geral (m)

scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a3a48, 1.7));
const sun = new THREE.DirectionalLight(0xffd9a8, 2.2);
sun.position.set(-14, 40, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
scene.add(sun);

/** o que é sólido pra quem anda: caixas no chão (x0 x1 z0 z1, no andar y) */
const BLOCKS: [number, number, number, number, number][] = [];
const solid = (x: number, z: number, w: number, d: number, y = 0) => BLOCKS.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2, y]);
/** textura cinza de concreto/reboco (manchas + grão): multiplica a cor, tira a cara de plástico liso */
function grainTex(rep: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f2f2f2"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) { // manchas grandes e suaves
    const x = Math.random() * 256, y = Math.random() * 256, r = 20 + Math.random() * 60, v = 215 + Math.random() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},0.35)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GRAIN = grainTex(1);
const mat = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
const glow = (c: string, k = 1.4) => new THREE.MeshStandardMaterial({ color: "#000", emissive: c, emissiveIntensity: k });
function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) {
  const r = Math.min(0.05, Math.min(w, h, d) * 0.22);
  const b = new THREE.Mesh(r > 0.012 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = b.receiveShadow = true;
  parent.add(b);
  return b;
}
const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 24) => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  c.position.set(x, y, z);
  c.castShadow = c.receiveShadow = true;
  scene.add(c);
  return c;
};

// chão de fora, rua e a base do galpão (x -22..22, z -13..13; piso em y 0)
box(160, 0.1, 160, mat("#3c5a2c"), 0, -0.85, 0);
const road = box(160, 0.12, 9, mat("#2b2e35"), 0, -0.8, 24);
road.rotation.y = 0;
box(160, 0.13, 0.4, mat("#d9d9d9"), 0, -0.79, 21);
box(52, 0.1, 34, mat("#8d8f93"), 0, -0.75, 0); // calçada
box(46, 0.8, 28, mat("#23262e"), 0, -0.4, 0);
// PAREDES GROSSAS com o corte escuro em cima (cara de maquete cortada)
const WALL = mat("#8c7a6e", { map: grainTex(5) }), CUT = mat("#221c19"), TRIM = mat("#5a4c44");
box(46, 9, 0.8, WALL, 0, 4.5, -13.4);
box(0.8, 9, 28, WALL, -22.6, 4.5, 0);
box(46.1, 0.12, 0.9, CUT, 0, 9.06, -13.4);
box(0.9, 0.12, 28.1, CUT, -22.6, 9.06, 0);
box(44, 0.35, 0.12, TRIM, 0, 0.17, -12.95); // rodapé
box(0.12, 0.35, 26, TRIM, -21.95, 0.17, 0);
for (const x of [-8, 8]) box(0.5, 9, 0.3, TRIM, x, 4.5, -12.85); // pilares da parede
// mureta da frente e da direita (a parede cortada baixa), com vão de entrada e do portão da oficina
const lowWall = (w: number, d: number, x: number, z: number) => { box(w, 1.3, d, WALL, x, 0.65, z); box(w + 0.05, 0.1, d + 0.05, CUT, x, 1.35, z); };
lowWall(19.5, 0.8, -12.8, 13.6);
lowWall(19.5, 0.8, 12.8, 13.6);
lowWall(0.8, 10, 22.6, -8.6);
lowWall(0.8, 6.5, 22.6, 10.4);
// TELHADO inclinado atrás das paredes, com claraboias
const ROOF = mat("#4a3f39"), SKY = glow("#ffe2b0", 2.4), slope = Math.atan2(2.5, 3.5), rl = Math.hypot(2.5, 3.5);
const roofB = box(47, 0.3, rl, ROOF, 0, 10.35, -15.55);
roofB.rotation.x = slope;
for (const x of [-16, -6, 4, 14]) box(5, 0.1, 2.2, SKY, x, 0.2, 0, roofB);
const roofL = box(rl, 0.3, 28, ROOF, -24.55, 10.35, 0);
roofL.rotation.z = -slope;
for (const z of [-7, 5]) box(2.2, 0.1, 5, SKY, 0, 0.2, z, roofL);
// janelas com caixilho (oficina e parede da esquerda)
function windowAt(x: number, y: number, z: number, w: number, side: boolean) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (side) g.rotation.y = Math.PI / 2;
  scene.add(g);
  box(w, 1.6, 0.06, SKY, 0, 0, 0, g);
  for (const yy of [-0.85, 0.85]) box(w + 0.3, 0.14, 0.2, TRIM, 0, yy, 0.05, g);
  for (let i = 0; i <= 3; i++) box(0.12, 1.7, 0.2, TRIM, -w / 2 + (w * i) / 3, 0, 0.05, g);
}
windowAt(11.5, 7.6, -12.95, 5, false);
windowAt(18.5, 7.6, -12.95, 5, false);
windowAt(-21.95, 7.6, -6, 5, true);
windowAt(-21.95, 7.6, 6, 5, true);
// VIGAS aparentes saindo da parede do fundo, com luminárias penduradas
const STEEL = mat("#2e3138", { metalness: 0.5, roughness: 0.5 });
for (const x of [-15, -4, 6, 15]) {
  box(0.35, 0.55, 15, STEEL, x, 8.75, -5.5);
  box(0.4, 0.6, 0.06, CUT, x, 8.75, 2); // ponta cortada
  for (const z of [-7, 0.5]) {
    box(0.03, 1.4, 0.03, STEEL, x, 7.8, z);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 16, 1, true), mat("#1d2026", { side: THREE.DoubleSide }));
    shade.position.set(x, 6.95, z);
    scene.add(shade);
    box(0.7, 0.04, 0.7, glow("#ffe7c2", 3), x, 6.73, z);
  }
}
for (const [x, z] of [[-15, 0.5], [6, 0.5], [15, -7]]) {
  const p = new THREE.PointLight(0xffd7a0, 40, 20, 1.6);
  p.position.set(x, 6.5, z);
  scene.add(p);
}

// ---------- salas ----------
type RoomId = "trofeus" | "qg" | "oficina" | "engenharia";
interface Room { name: string; cor: string; floor: THREE.Mesh; pick: THREE.Mesh; anchor: THREE.Vector3; focus: THREE.Vector3; zoom: number; label?: HTMLDivElement }
const rooms = {} as Record<RoomId, Room>;
function room(id: RoomId, name: string, cor: string, floorCol: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, anchor: [number, number, number], zoom: number) {
  const floor = box(x1 - x0, 0.06, z1 - z0, mat(floorCol, { emissive: cor, emissiveIntensity: 0, map: grainTex(4) }), (x0 + x1) / 2, y0 + 0.03, (z0 + z1) / 2);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  pick.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  pick.userData.room = id;
  scene.add(pick);
  rooms[id] = { name, cor, floor, pick, anchor: new THREE.Vector3(...anchor), focus: new THREE.Vector3((x0 + x1) / 2, y0 + 1.5, (z0 + z1) / 2), zoom };
}
room("trofeus", "SALA DE TROFÉUS", "#ff9a3c", "#7c3424", -22, -8, -13, 13, 0, 9, [-15, -0.8, 14], 1.9);
room("qg", "QG DA EQUIPE", "#39d0ff", "#2e3a52", -8, 8, -5, 13, 0, 4.4, [1, -0.8, 14], 2.1);
room("oficina", "OFICINA E GARAGEM", "#39d0ff", "#9ea3aa", 8, 22, -13, 13, 0, 9, [15, 7, -13], 1.9);
room("engenharia", "ENGENHARIA", "#b48cff", "#3b4150", -6, 8, -13, -5, 4.5, 9, [1, 9, -9], 2.4);

// mezaninos (troféus em cima à esquerda, engenharia em cima no meio) + guarda-corpo + pilares
const SLAB = mat("#4a4f5c", { map: GRAIN });
const RAIL = mat("#c9ccd2", { metalness: 0.4, roughness: 0.4 });
const GLASS = new THREE.MeshStandardMaterial({ color: "#a9dcff", transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
// guarda-corpo de vidro: postes + corrimão + vidro (ao longo de x)
function glassRail(x0: number, x1: number, z: number, y: number) {
  box(x1 - x0, 0.9, 0.04, GLASS, (x0 + x1) / 2, y + 0.45, z).castShadow = false;
  box(x1 - x0, 0.06, 0.1, RAIL, (x0 + x1) / 2, y + 0.95, z);
  for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.round((x1 - x0) / 1.8)) box(0.07, 0.95, 0.07, RAIL, x, y + 0.47, z);
}
box(14, 0.3, 4.5, SLAB, -15, 4.35, -10.75);
glassRail(-22, -8, -8.5, 4.5);
box(16, 0.3, 8, SLAB, 0, 4.35, -9);
glassRail(-6, 8, -5, 4.5);
// borda dos mezaninos com faixa de luz na cor da equipe e luz embaixo
for (const [x, w, z] of [[-15, 14, -8.5], [1, 14, -5]] as const) {
  box(w, 0.08, 0.05, glow(team.color, 1.6), x, 4.35, z + 0.03);
  box(w - 1, 0.04, 0.25, glow("#fff1d8", 1.6), x, 4.19, z - 0.6);
}
box(14, 0.06, 8, mat("#3a3f4a"), 1, 0.03, -9); // piso embaixo da engenharia
for (const x of [-21, -9]) box(0.4, 4.3, 0.4, SLAB, x, 2.15, -8.8);
for (const x of [-5.6, 7.6]) box(0.4, 4.3, 0.4, SLAB, x, 2.15, -5.3);
for (let i = 0; i < 12; i++) box(2, 0.375, 0.6, SLAB, -7, 0.19 + i * 0.375, 1.3 - i * 0.55); // escada
box(0.08, 0.9, 6.8, RAIL, -8, 2.9, -2).rotation.x = 0.68;

// ---------- objetos ----------
const GOLD = mat("#e6b53c", { metalness: 0.85, roughness: 0.28 });
const SILVER = mat("#cfd3da", { metalness: 0.85, roughness: 0.25 });
const cup = new THREE.LatheGeometry([[0, 0], [0.22, 0], [0.22, 0.06], [0.06, 0.12], [0.06, 0.38], [0.3, 0.5], [0.34, 0.85], [0.3, 0.86]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
for (let i = 0; i < 6; i++) {
  const x = -20 + i * 2.2;
  box(0.9, 1, 0.9, mat("#eeeae4"), x, 5, -11.6);
  const c = new THREE.Mesh(cup, i % 3 === 1 ? SILVER : GOLD);
  c.position.set(x, 5.5, -11.6);
  c.scale.setScalar(1.4 + (i % 2) * 0.4);
  c.castShadow = true;
  scene.add(c);
}
// bandeiras (cor da equipe e destaque) nas paredes
for (let i = 0; i < 6; i++) {
  const m = mat(i % 2 ? team.accent : team.color, { side: THREE.DoubleSide });
  const b = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6), m);
  b.position.set(-20 + i * 2.2, 7.4, -12.95);
  scene.add(b);
  if (i > 2) continue; // na parede da esquerda só 3 (o telão quadriculado fica do lado)
  const s = b.clone();
  s.rotation.y = Math.PI / 2;
  s.position.set(-21.95, 3, -7 + i * 2.4);
  scene.add(s);
}
// palco do carro em exposição + telão quadriculado
const podium = cyl(3.8, 0.45, mat("#f1ede6"), -14.5, 0.23, 4.5, 40);
cyl(4.1, 0.08, glow("#ff9a3c", 0.9), -14.5, 0.05, 4.5, 40);
const chk = document.createElement("canvas");
chk.width = 256; chk.height = 128;
const cg = chk.getContext("2d")!;
for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) { cg.fillStyle = (x + y) % 2 ? "#111" : "#eee"; cg.fillRect(x * 16, y * 16, 16, 16); }
const flag = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(chk), emissive: "#fff", emissiveIntensity: 0.08 }));
flag.position.set(-21.95, 3.2, 5);
flag.rotation.y = Math.PI / 2;
scene.add(flag);
for (const [x, z] of [[-10, 9], [-10, 0]]) {
  const sp = new THREE.SpotLight(0xfff0d0, 120, 30, 0.45, 0.5);
  sp.position.set(x, 7, z);
  sp.target.position.set(-14.5, 0.5, 4.5);
  scene.add(sp, sp.target);
}

// mesa do QG com o traçado da próxima pista brilhando
box(7.4, 1, 4.6, mat("#3b404c"), 0, 0.5, 6);
box(6.8, 0.04, 4, glow("#0b3550", 1.2), 0, 1.02, 6);
{
  const xs = track.pts.map((p) => p.x), ys = track.pts.map((p) => p.y);
  const mx = Math.min(...xs), Mx = Math.max(...xs), my = Math.min(...ys), My = Math.max(...ys);
  const k = Math.min(6 / (Mx - mx), 3.4 / (My - my));
  const pts = track.pts.filter((_, i) => i % 4 === 0).map((p) => new THREE.Vector3((p.x - (mx + Mx) / 2) * k, 1.06, 6 + (p.y - (my + My) / 2) * k));
  pts.push(pts[0].clone());
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#5fe3ff" })));
}
// telas com gráfico (engenharia)
function screenTex(seed: number) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#06121c"; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = "#1d3b52"; for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 160); g.stroke(); }
  for (const [col, ph] of [["#39d0ff", 0], ["#ff9a3c", 2], ["#6fdc8c", 4]] as const) {
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, 80 + Math.sin(x / 30 + seed + ph) * 30 + Math.sin(x / 11 + seed * 2) * 10);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
for (let i = 0; i < 3; i++) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.1), new THREE.MeshStandardMaterial({ color: "#000", emissive: "#fff", emissiveMap: screenTex(i * 1.7), emissiveIntensity: 1.1 }));
  s.position.set(-3 + i * 4, 7.4, -12.95);
  scene.add(s);
}
// mesas com monitor (cadeira + pessoa sentada são postas depois)
const DESK = mat("#e7e8ea"), DARK = mat("#1b1e25");
const seats: [number, number, number, number][] = [];
// MODELOS 3D PRONTOS (Kenney, CC0: public/sede/*.glb). kit(nome, escala, x, y, z, giro, pai) põe uma cópia
// quando o arquivo chegar. Os do Kenney são pequenos: móveis ×2,1 (uma mesa tem 0,73 m no arquivo)
const kitLoader = new GLTFLoader();
const kitCache = new Map<string, Promise<THREE.Object3D>>();
function kit(name: string, s: number, x: number, y: number, z: number, rot = 0, parent: THREE.Object3D = scene) {
  let p = kitCache.get(name);
  if (!p) {
    p = kitLoader.loadAsync(`/sede/${name}.glb`).then((g) => {
      // (os arquivos do Kenney não dizem o metal e o padrão do glTF é metal total: a cor sumia no reflexo)
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = m.receiveShadow = true; for (const mm of [m.material].flat() as THREE.MeshStandardMaterial[]) { mm.metalness = 0; mm.roughness = Math.max(mm.roughness, 0.7); } });
      // a origem dos modelos do Kenney fica num canto: centraliza no chão (meio em x e z, base em y 0)
      const bb = new THREE.Box3().setFromObject(g.scene), c = bb.getCenter(new THREE.Vector3());
      g.scene.position.set(-c.x, -bb.min.y, -c.z);
      const w = new THREE.Group();
      w.add(g.scene);
      return w;
    });
    kitCache.set(name, p);
  }
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  holder.rotation.y = rot;
  holder.scale.setScalar(s);
  parent.add(holder);
  void p.then((m) => holder.add(m.clone()));
  return holder;
}
const F = 2.1; // escala dos móveis
function desk(x: number, y: number, z: number, rot: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;
  scene.add(g);
  kit("desk", F, 0, 0, 0, 0, g);
  solid(x, z, Math.abs(Math.cos(rot)) > 0.5 ? 1.7 : 1.3, Math.abs(Math.cos(rot)) > 0.5 ? 1.3 : 1.7, y);
  for (const sx of [-0.36, 0.36]) kit("computerScreen", F, sx, 0.8, -0.3, 0, g);
  kit("computerKeyboard", F, 0, 0.8, 0.12, 0, g);
  kit("chairDesk", F, 0, 0, 0.95, Math.PI, g);
  const off = new THREE.Vector3(0, 0, 0.95).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  seats.push([x + off.x, y, z + off.z, rot]);
}
desk(-4, 0, 10.5, Math.PI);
desk(4, 0, 10.5, Math.PI);
desk(-3.5, 0, -1, 0);
desk(-2, 4.5, -10.5, 0);
desk(3, 4.5, -10.5, 0);
desk(-2, 4.5, -7, Math.PI);
// quadro de estratégia
box(3.2, 2, 0.08, mat("#f4f4f2"), 4.5, 1.9, -4.9);

// oficina: elevador, bancadas, pilhas de pneu, faixa na parede
box(14, 0.5, 0.08, mat("#c0262d"), 15, 1.6, -12.95);
box(14, 0.5, 0.08, mat("#24408f"), 15, 1.1, -12.95);
const LIFT = mat("#2c5fb3", { metalness: 0.3 });
for (const x of [12.2, 17.8]) box(0.5, 3.6, 0.5, LIFT, x, 1.8, -6.5);
const liftPlat = box(5.2, 0.2, 2.2, LIFT, 15, 1.9, -6.5); // sobe e desce (quadro a quadro)
for (const [x, z] of [[9.5, -12], [20.5, -12], [20.5, -3]]) box(1.6, 1.4, 0.8, mat("#c42b2b", { roughness: 0.5 }), x, 0.7, z);
const TIRE = new THREE.TorusGeometry(0.42, 0.2, 10, 20), TM = mat("#16171a", { roughness: 0.95 });
for (const [x, z, n] of [[20.6, 2, 4], [20.6, 3.4, 3], [10, 10.5, 4], [11.3, 11.2, 2]]) for (let k = 0; k < n; k++) {
  const t = new THREE.Mesh(TIRE, TM);
  t.rotation.x = Math.PI / 2;
  t.position.set(x, 0.2 + k * 0.4, z);
  t.castShadow = true;
  scene.add(t);
}
for (const [x, z, w, d] of [[15, -6.5, 6, 3.2], [15, 5.5, 6, 3.2]]) {
  const Y = mat("#f2c230");
  box(w, 0.07, 0.12, Y, x, 0.04, z - d / 2); box(w, 0.07, 0.12, Y, x, 0.04, z + d / 2);
  box(0.12, 0.07, d, Y, x - w / 2, 0.04, z); box(0.12, 0.07, d, Y, x + w / 2, 0.04, z);
}
// faíscas da solda
const SPARKS = 60, sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
scene.add(new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: "#ffb347", size: 0.12, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
const WELD = new THREE.Vector3(14.6, 1.75, -6.2); // embaixo do carro no elevador
let welding = false;

// ---------- acabamento e objetos ----------
// letreiro luminoso (texto em textura)
function sign(text: string, color: string, w: number, h: number, x: number, y: number, z: number, side = false) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = Math.round((512 * h) / w);
  const g = c.getContext("2d")!;
  g.fillStyle = "#14161c"; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.font = `800 ${Math.round(c.height * 0.5)}px Segoe UI, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: "#000", emissive: "#fff", emissiveMap: new THREE.CanvasTexture(c), emissiveIntensity: 1.3 }));
  m.position.set(x, y, z);
  if (side) m.rotation.y = Math.PI / 2;
  scene.add(m);
}
sign("OFICINA", "#39d0ff", 5, 1.1, 15, 5.6, -12.94);
sign(team.name.toUpperCase(), team.color, 6, 1, -21.94, 6.2, 5, true);
sign("P&D", "#b48cff", 2.4, 0.6, 1, 5.9, -12.94);

// divisória de vidro entre o QG e a oficina + mureta entre o QG e os troféus
for (let z = -5; z <= 13.01; z += 3) box(0.12, 3.2, 0.12, RAIL, 8, 1.6, z);
box(0.12, 0.12, 18, RAIL, 8, 3.2, 4);
box(0.04, 3.1, 18, GLASS, 8, 1.55, 4).castShadow = false;
box(0.4, 1.1, 9, WALL, -8, 0.55, 8.5);
box(0.45, 0.08, 9.05, CUT, -8, 1.12, 8.5);
box(0.05, 0.05, 9, glow("#ff9a3c", 2), -7.78, 0.12, 8.5);

// piso: grade de placas na oficina, tapete com borda laranja no QG, passadeira vermelha até o palco
const SEAM = mat("#868b93");
for (let x = 10; x < 22; x += 2) box(0.03, 0.02, 26, SEAM, x, 0.065, 0);
for (let z = -12; z < 13; z += 2) box(14, 0.02, 0.03, SEAM, 15, 0.065, z);
box(11, 0.03, 8.4, mat("#25324a"), 0, 0.075, 6);
const ORANGE = glow("#ff7a1a", 0.9);
box(11.2, 0.04, 0.12, ORANGE, 0, 0.09, 1.8); box(11.2, 0.04, 0.12, ORANGE, 0, 0.09, 10.2);
box(0.12, 0.04, 8.4, ORANGE, -5.6, 0.09, 6); box(0.12, 0.04, 8.4, ORANGE, 5.6, 0.09, 6);
box(2.4, 0.03, 4.8, mat("#a3161c"), -14.5, 0.075, 10.6);
for (const x of [-15.75, -13.25]) {
  box(0.08, 0.035, 4.8, GOLD, x, 0.08, 10.6);
  for (const z of [8.8, 10.6, 12.4]) {
    cyl(0.05, 1, GOLD, x + Math.sign(x + 14.5) * 0.4, 0.5, z, 8);
    cyl(0.1, 0.1, GOLD, x + Math.sign(x + 14.5) * 0.4, 1.02, z, 10);
  }
  box(0.04, 0.04, 3.6, mat("#8c1218"), x + Math.sign(x + 14.5) * 0.4, 0.9, 10.6);
}

// porta do elevador embaixo da engenharia
box(2.4, 3, 0.1, mat("#9ea4ad", { metalness: 0.7, roughness: 0.3 }), 0, 1.5, -12.95);
box(2.8, 0.25, 0.15, TRIM, 0, 3.1, -12.92);
box(0.03, 2.9, 0.12, CUT, 0, 1.45, -12.9);

// oficina: painel de ferramentas, estante de pneus, bancada, motor no cavalete, compressor
box(5.5, 2.4, 0.08, mat("#d5d0c6"), 15, 3.4, -12.94);
for (let i = 0; i < 14; i++) box(0.09, 0.35 + (i % 3) * 0.15, 0.05, i % 4 === 0 ? mat("#c42b2b") : DARK, 12.7 + (i % 7) * 0.75, 3.9 - Math.floor(i / 7) * 1.05, -12.88);
for (const y of [0.15, 1.35, 2.55]) box(0.9, 0.08, 4.6, STEEL, 21.4, y, -7.6);
for (const z of [-9.6, -5.6]) box(0.08, 2.7, 0.08, STEEL, 21.4, 1.35, z);
for (const y of [0.65, 1.85]) for (let k = 0; k < 4; k++) {
  const t = new THREE.Mesh(TIRE, TM);
  t.position.set(21.4, y, -9.1 + k * 1.05);
  t.rotation.y = Math.PI / 2;
  t.castShadow = true;
  scene.add(t);
}
box(0.9, 0.9, 3.6, mat("#6b5444"), 9.1, 0.45, 0);
box(0.3, 0.25, 0.4, STEEL, 9.1, 1.02, -1.1);
box(1.1, 0.8, 0.75, mat("#7d8590", { metalness: 0.6, roughness: 0.4 }), 11.6, 1.15, -0.5);
for (const dx of [-0.3, 0, 0.3]) cyl(0.12, 0.35, STEEL, 11.6 + dx, 1.7, -0.5, 10);
box(0.08, 0.75, 0.6, mat("#c42b2b"), 11.6, 0.38, -0.5);
const tank = cyl(0.42, 1.6, mat("#c42b2b", { roughness: 0.5 }), 21, 0.5, 9.2, 16);
tank.rotation.x = Math.PI / 2;

// engenharia: racks de servidor com luzinhas
const led = document.createElement("canvas");
led.width = 64; led.height = 128;
const lg = led.getContext("2d")!;
lg.fillStyle = "#0b0d12"; lg.fillRect(0, 0, 64, 128);
for (let y = 6; y < 128; y += 10) { lg.fillStyle = "#1b2030"; lg.fillRect(4, y, 56, 7); for (let x = 8; x < 56; x += 9) { lg.fillStyle = (x * 7 + y) % 3 ? "#39d0ff" : "#6fdc8c"; lg.fillRect(x, y + 2, 3, 3); } }
const RACK = new THREE.MeshStandardMaterial({ color: "#111", emissive: "#fff", emissiveMap: new THREE.CanvasTexture(led), emissiveIntensity: 0.9 });
for (const z of [-12.3, -11.3]) box(0.95, 2.3, 0.95, [DARK, DARK, DARK, DARK, RACK, DARK] as unknown as THREE.Material, 7, 4.5 + 1.15, z).rotation.y = Math.PI / 2;

// plantas, canto de descanso do QG, café, estantes, lixeiras (modelos prontos)
for (const [x, y, z] of [[6.6, 0, 12.2], [-5.6, 0, 4.4], [-5.2, 4.5, -12.2], [-20.8, 0, 12.2], [-20.8, 4.5, -12.2], [21, 0, 12.2]]) kit("pottedPlant", F * 1.1, x, y, z);
kit("rugRectangle", F * 1.2, 6.2, 0.08, 0.6, Math.PI / 2);
kit("loungeSofa", F, 7.3, 0, 0.6, -Math.PI / 2);
kit("tableCoffee", F, 6, 0, 0.6, Math.PI / 2);
kit("lampRoundFloor", F * 1.2, 7.3, 0, -1.9);
kit("sideTable", F, 4.2, 0, -12.5);
kit("kitchenCoffeeMachine", F, 4.2, 0.95, -12.5);
for (const x of [-4.5, -3.2]) kit("bookcaseOpen", F, x, 0, -12.6);
kit("televisionModern", F * 2.2, -21.5, 6.6, -1.5, Math.PI / 2);
for (const [x, z] of [[7.3, -3.6], [-6.8, 12.4], [21.2, -1.6]]) kit("trashcan", F * 0.75, x, 0, z);
// oficina: cones, caixas, equipamento de telemetria perto do carro do pit stop
for (const [x, z] of [[11.8, 3.6], [11.8, 7.4], [18.2, 3.6], [18.2, 7.4], [12, -8.4], [18, -8.4]]) kit("pylon", 4, x, 0, z);
for (const [x, z, s] of [[20.8, -11.6, 1], [20.2, -11.9, 0.9], [20.6, -11.2, 1.1]]) kit("cardboardBoxClosed", F * 1.5 * s, x, 0, z, s);
kit("cardboardBoxOpen", F * 1.4, 9.6, 0, -11.8);
kit("radarEquipment", 2.4, 18.8, 0, 8.6, -2.4);

// lado de fora: árvores, postes, bandeira quadriculada e torres com faixa (modelos prontos)
for (const [x, z, s] of [[-31, -18, 1.2], [-29, 6, 1], [-33, 16, 0.9], [31, -17, 1.1], [33, 2, 1.3], [30, 15, 0.9], [-12, -24, 1.1], [14, -24, 1]]) kit(s > 1.05 ? "treeLarge" : "treeSmall", 4.2 * s, x, -0.8, z, s * 3);
for (const x of [-30, -10, 10, 30]) kit("lightPostModern", 7, x, -0.8, 29.4, Math.PI);
for (const x of [-32, 32]) kit("bannerTowerRed", 4, x, -0.8, 19.5);
for (const [i, x] of [-28, -25.5, -23].entries()) {
  cyl(0.06, 7, RAIL, x, 2.7, 17, 8);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), mat(i === 1 ? team.accent : team.color, { side: THREE.DoubleSide }));
  f.position.set(x + 1.05, 5.4, 17);
  scene.add(f);
}

// ---------- pessoas: o piloto 3D do jogo (com esqueleto), mexido osso a osso ----------
// Pose = ângulos simples; cada quadro a pose atual corre atrás da pose alvo (as trocas saem suaves sozinhas).
// Ângulos: perna/braço 0 = pra baixo, + = pra frente; joelho/cotovelo = quanto dobra.
interface Pose { tl: number; tr: number; kl: number; kr: number; al: number; ar: number; el: number; er: number; dy: number; out: number }
const P = (o: Partial<Pose>): Pose => ({ tl: 0, tr: 0, kl: 0, kr: 0, al: 0.05, ar: 0.05, el: 0.25, er: 0.25, dy: 0, out: 0.18, ...o });
const STAND = P({});
const SIT = P({ tl: 1.45, tr: 1.45, kl: 1.45, kr: 1.45, al: 0.75, ar: 0.75, el: 0.75, er: 0.75, dy: -0.43 });
const KNEEL = P({ tl: 1.25, kl: 1.25, tr: -0.15, kr: 1.7, al: 0.95, ar: 0.95, el: 0.45, er: 0.45, dy: -0.47 });
const READY = P({ tl: 0.35, tr: 0.35, kl: 0.7, kr: 0.7, al: 0.5, ar: 0.5, el: 0.6, er: 0.6, dy: -0.07 });
const CHEER = P({ al: 2.9, ar: 2.9, el: 0.15, er: 0.15, out: 0.5 });
const ARMS_UP = P({ al: 2.5, ar: 2.6, el: 0.35, er: 0.25, out: 0.25 });
const WORK = P({ al: 0.85, ar: 0.85, el: 0.7, er: 0.7, tl: 0.1, tr: -0.05, kl: 0.15, kr: 0.1 });
const POINT = P({ ar: 1.5, er: 0.05, al: 0.05 });
const DRAW = P({ ar: 1.95, er: 0.4 });
const CARRY = P({ al: 0.95, ar: 0.95, el: 0.75, er: 0.75 });
const walkPose = (ph: number, arms?: Pose): Pose => {
  const s = Math.sin(ph), c = Math.cos(ph);
  return P({ tl: 0.45 * s, tr: -0.45 * s, kl: 0.15 + 0.75 * Math.max(0, c), kr: 0.15 + 0.75 * Math.max(0, -c), al: arms?.al ?? -0.35 * s, ar: arms?.ar ?? 0.35 * s, el: arms?.el ?? 0.35, er: arms?.er ?? 0.35, dy: -0.04 + 0.04 * Math.abs(c) });
};
/** subindo/descendo escada: a perna que vai na frente levanta coxa e joelho (o pé passa por cima do degrau) */
const stairPose = (ph: number, arms?: Pose): Pose => {
  const s = Math.sin(ph);
  return P({ tl: 0.2 + 0.75 * Math.max(0, s), tr: 0.2 + 0.75 * Math.max(0, -s), kl: 0.25 + 1.25 * Math.max(0, s), kr: 0.25 + 1.25 * Math.max(0, -s), al: arms?.al ?? -0.3 * s, ar: arms?.ar ?? 0.3 * s, el: arms?.el ?? 0.4, er: arms?.er ?? 0.4, dy: -0.02 });
};
const lerpPose = (a: Pose, b: Pose, k: number) => { for (const key of Object.keys(a) as (keyof Pose)[]) a[key] += (b[key] - a[key]) * k; };

const S = 1.15; // gente um pouco maior que o real, pra ler na maquete
type Stop = { x: number; y: number; z: number; wait?: number; pose?: Pose; carry?: boolean };
interface Person {
  root: THREE.Group; bones: Record<string, THREE.Bone>; rest: Map<THREE.Bone, { q: THREE.Quaternion; along: THREE.Vector3 }>; side: Record<"L" | "R", number>;
  cur: Pose; target: (t: number, p: Person) => Pose; head?: THREE.Group; hand?: THREE.Object3D; prop?: THREE.Object3D;
  route?: Stop[]; leg: number; next: number; block: number; best: number; stuck: number; path: { x: number; z: number; l: number }[] | null; pi: number; loose: boolean; look: number; wait: number; ph: number; carry: boolean; heading: number;
}
const people: Person[] = [];
const SUIT = mat(team.color, { roughness: 0.55 }), STRIPE = mat(team.accent, { roughness: 0.55 }), SHELL = mat(team.color, { roughness: 0.3, metalness: 0.2 }), VISOR = mat("#15181e", { roughness: 0.15, metalness: 0.5 });
const SKIN = mat("#d9a982"), HAIR = mat("#2b2119");
const sane = (n: string) => THREE.PropertyBinding.sanitizeNodeName(n);
const LIMBS = ["thigh", "shin", "upper_arm", "forearm"].flatMap((b) => ["L", "R"].map((s) => `DEF-${b}.${s}`));
let pilotBase: THREE.Object3D | null = null;
const pending: (() => void)[] = [];

function person(x: number, y: number, z: number, heading: number, target: Person["target"], opts: { helmet?: boolean; route?: Stop[]; hand?: THREE.Object3D; loose?: boolean } = {}) {
  const make = () => {
    const model = cloneSkinned(pilotBase!);
    // o arquivo traz 2 capacetes presos na cabeça: um simples e o "GT3" (casco + viseira + entradas de ar).
    // Mecânico usa só o simples (pedido do usuário); escritório fica sem capacete
    const under = (o: THREE.Object3D, test: (n: string) => boolean) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (test(p.name)) return true; return false; };
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const inHelmet = under(m, (n) => n === "helmet"), inGT3 = under(m, (n) => n.startsWith("GT3"));
      if (inHelmet && (!opts.helmet || inGT3)) { m.visible = false; return; }
      m.castShadow = true;
      m.frustumCulled = false;
      const n = (m.material as THREE.Material).name;
      m.material = n === "macacao" ? SUIT : n === "faixa" ? STRIPE : n === "casco" ? SHELL : n === "viseira" ? VISOR : m.material;
    });
    const root = new THREE.Group();
    root.add(model);
    root.userData.y0 = model.position.y;
    scene.add(root);
    // de frente pro +z do grupo: o pé aponta pra frente
    root.updateMatrixWorld(true);
    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
    // os sapatos vêm presos num osso de controle da perna (que a gente não mexe): passam pro osso do pé
    for (const s of ["l", "r"]) { const shoe = model.getObjectByName(`shoes${s}`); if (shoe) bones[sane(`DEF-foot.${s.toUpperCase()}`)].attach(shoe); }
    const wp = (n: string) => bones[sane(n)].getWorldPosition(new THREE.Vector3());
    const f = wp("DEF-toe.L").sub(wp("DEF-foot.L"));
    model.rotation.y = -Math.atan2(f.x, f.z);
    // braços pra baixo (o arquivo vem de braços abertos), como no VER EM 3D
    root.updateMatrixWorld(true);
    const rest = new Map<THREE.Bone, { q: THREE.Quaternion; along: THREE.Vector3 }>();
    for (const n of LIMBS) {
      const b = bones[sane(n)];
      const q = b.getWorldQuaternion(new THREE.Quaternion());
      rest.set(b, { q, along: new THREE.Vector3(0, 1, 0).applyQuaternion(q) });
    }
    const side = { L: Math.sign(wp("DEF-upper_arm.L").x) || 1, R: Math.sign(wp("DEF-upper_arm.R").x) || -1 };
    root.scale.setScalar(S);
    root.position.set(x, y, z);
    root.rotation.y = heading;
    root.updateMatrixWorld(true);
    root.userData.feet = (["L", "R"] as const).flatMap((s) => [`DEF-foot.${s}`, `DEF-toe.${s}`]).map((n) => ({ b: bones[sane(n)], h: bones[sane(n)].getWorldPosition(new THREE.Vector3()).y - y }));
    const p: Person = { root, bones, rest, side, cur: { ...STAND }, target, route: opts.route, leg: 0, next: 1, block: 0, best: Infinity, stuck: 0, path: null, pi: 0, loose: !!opts.loose, look: 0, wait: 0, ph: Math.random() * 6, carry: false, heading, prop: opts.hand };
    if (!opts.helmet) {
      const h = new THREE.Group();
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), SKIN);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), HAIR);
      hair.position.set(0, 0.012, -0.012);
      face.castShadow = true;
      h.add(face, hair);
      h.scale.setScalar(S);
      scene.add(h);
      p.head = h;
    }
    if (opts.hand) scene.add(opts.hand);
    people.push(p);
  };
  if (pilotBase) make(); else pending.push(make);
}

const qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), va = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, 1);
/** gira o osso pra apontar pra `dir` (no espaço do personagem, antes do giro dele) */
function aim(p: Person, name: string, dir: THREE.Vector3) {
  const b = p.bones[sane(name)], r = p.rest.get(b)!;
  qa.setFromUnitVectors(r.along, dir.normalize()).multiply(r.q); // no espaço do personagem
  qp.setFromEuler(new THREE.Euler(0, p.root.rotation.y, 0)).multiply(qa); // + o giro do personagem
  b.parent!.getWorldQuaternion(qa);
  b.quaternion.copy(qa.invert().multiply(qp));
  b.updateMatrixWorld(true);
}
const dirOf = (ang: number, side: number) => va.set(side, 0, 0).add(DOWN.clone().multiplyScalar(Math.cos(ang))).add(FWD.clone().multiplyScalar(Math.sin(ang))).clone();
function applyPose(p: Person) {
  const c = p.cur;
  p.root.children[0].position.y = p.root.userData.y0 + c.dy / S;
  p.root.updateMatrixWorld(true);
  for (const s of ["L", "R"] as const) {
    const t = s === "L" ? c.tl : c.tr, k = s === "L" ? c.kl : c.kr, a = s === "L" ? c.al : c.ar, e = s === "L" ? c.el : c.er;
    aim(p, `DEF-thigh.${s}`, dirOf(t, p.side[s] * 0.04));
    aim(p, `DEF-shin.${s}`, dirOf(t - k, p.side[s] * 0.02));
    aim(p, `DEF-upper_arm.${s}`, dirOf(a, p.side[s] * c.out));
    aim(p, `DEF-forearm.${s}`, dirOf(a + e, p.side[s] * c.out * 0.5));
  }
  // pé no chão: se a pose enfiou o tornozelo ou a ponta do pé no chão, sobe o boneco o que entrou
  let low = Infinity;
  for (const f of p.root.userData.feet as { b: THREE.Bone; h: number }[]) low = Math.min(low, f.b.getWorldPosition(va).y - f.h);
  const sink = p.root.position.y - low;
  if (sink > 0) { p.root.children[0].position.y += sink / S; p.root.updateMatrixWorld(true); }
  if (p.head) {
    p.bones[sane("DEF-spine.006")].getWorldPosition(p.head.position);
    p.head.position.y += 0.1 * S;
    p.head.rotation.y = p.root.rotation.y;
  }
  if (p.prop) {
    p.bones[sane(p.carry || !p.route ? "DEF-hand.R" : "DEF-hand.R")].getWorldPosition(p.prop.position);
    p.prop.visible = !p.route || p.carry;
    p.prop.rotation.y = p.root.rotation.y;
  }
}
/** altura do chão onde a pessoa está: degrau da escada, mezanino (se já está lá em cima) ou piso */
const onStairs = (x: number, z: number) => x > -8.2 && x < -5.8 && z < 1.6 && z > -5.3;
function groundAt(x: number, z: number, y: number) {
  if (onStairs(x, z)) return Math.min(4.5, 0.375 * (Math.floor((1.6 - z) / 0.55) + 1));
  return y > 2.2 ? 4.5 : 0;
}
// ---------- caminho calculado: A* numa grade de 0,4 m, dois andares ligados pela escada ----------
// (cada pessoa calcula a rota em volta dos móveis e de quem está parado ANTES de sair andando; antes só
// virava quando já estava em cima do obstáculo e ficava se arrastando)
type WP = { x: number; z: number; l: number };
const CELL = 0.4, GX0 = -22, GZ0 = -13.2, GW = Math.ceil(44 / CELL), GH = Math.ceil(26.4 / CELL), LV = GW * GH;
const cellX = (i: number) => GX0 + (i + 0.5) * CELL, cellZ = (j: number) => GZ0 + (j + 0.5) * CELL;
const isStair = (x: number, z: number) => x > -7.9 && x < -6.1 && z < 1.55 && z > -5.25;
let navBase: Uint8Array | null = null; // 0 livre, 1 parede/móvel
function buildNav() {
  const g = new Uint8Array(2 * LV).fill(1);
  for (let l = 0; l < 2; l++) for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = cellX(i), z = cellZ(j);
    let ok = l === 0 ? x > -21.7 && x < 21.7 && z > -12.7 && z < 13.1 : (x > -21.7 && x < -8 && z > -12.7 && z < -8.7) || (x >= -8 && x < 7.8 && z > -12.7 && z < -5.2);
    if (ok) for (const [x0, x1, z0, z1, y] of BLOCKS) if ((y > 2) === (l === 1) && x > x0 - 0.35 && x < x1 + 0.35 && z > z0 - 0.35 && z < z1 + 0.35) { ok = false; break; }
    if (ok) g[l * LV + j * GW + i] = 0;
  }
  return g;
}
/** pode ir da célula a pra b? (escada: só entra/sai pela ponta de baixo, e liga no andar de cima pela ponta de cima) */
function link(ax: number, az: number, al: number, bx: number, bz: number, bl: number) {
  const sa = al === 0 && isStair(ax, az), sb = bl === 0 && isStair(bx, bz);
  if (al !== bl) return (sa && az < -4.6 && bz < -5.1) || (sb && bz < -4.6 && az < -5.1);
  if (sa !== sb) return Math.min(az, bz) > 1.0; // degrau de baixo e o chão
  return true;
}
function findPath(me: Person, tx: number, tz: number, tl: number): WP[] | null {
  navBase ??= buildNav();
  const g = navBase.slice();
  // quem está parado também é obstáculo (as células em volta dele)
  for (const q of people) {
    if (q === me || (q.route && q.wait <= 0)) continue;
    const ql = q.root.position.y > 2.2 ? 1 : 0, qi = Math.floor((q.root.position.x - GX0) / CELL), qj = Math.floor((q.root.position.z - GZ0) / CELL);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = qi + di, j = qj + dj;
      if (i >= 0 && j >= 0 && i < GW && j < GH) g[ql * LV + j * GW + i] = 1;
    }
  }
  const pos = me.root.position;
  const cellOf = (x: number, z: number, l: number) => {
    const i0 = Math.floor((x - GX0) / CELL), j0 = Math.floor((z - GZ0) / CELL);
    for (let r = 0; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i >= 0 && j >= 0 && i < GW && j < GH && !g[l * LV + j * GW + i]) return l * LV + j * GW + i;
    }
    return -1;
  };
  const sl = isStair(pos.x, pos.z) ? 0 : pos.y > 2.2 ? 1 : 0;
  const s = cellOf(pos.x, pos.z, sl), e = cellOf(tx, tz, tl);
  if (s < 0 || e < 0) return null;
  const ex = cellX(e % GW), ez = cellZ(Math.floor((e % LV) / GW));
  const gs = new Float32Array(2 * LV).fill(Infinity), from = new Int32Array(2 * LV).fill(-1);
  const heap: [number, number][] = [];
  const push = (n: number, f: number) => {
    heap.push([f, n]);
    for (let k = heap.length - 1; k > 0; ) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const a = 2 * k + 1, b = a + 1;
        let m = k;
        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  gs[s] = 0;
  push(s, 0);
  let found = false;
  for (let it = 0; heap.length && it < 40000; it++) {
    const n = pop();
    if (n === e) { found = true; break; }
    const l = Math.floor(n / LV), j = Math.floor((n % LV) / GW), i = n % GW, x = cellX(i), z = cellZ(j);
    for (const nl of [l, 1 - l]) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (nl === l && !di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const m = nl * LV + nj * GW + ni;
      if (g[m] || !link(x, z, l, cellX(ni), cellZ(nj), nl)) continue;
      if (nl === l && di && dj && (g[l * LV + j * GW + ni] || g[l * LV + nj * GW + i])) continue; // não corta quina
      const c = gs[n] + (di && dj ? 1.414 : 1) + (nl !== l ? 1 : 0);
      if (c < gs[m]) { gs[m] = c; from[m] = n; push(m, c + Math.hypot(cellX(ni) - ex, cellZ(nj) - ez) / CELL); }
    }
  }
  if (!found) return null;
  const cells: WP[] = [];
  for (let n = e; n >= 0; n = from[n]) cells.push({ x: cellX(n % GW), z: cellZ(Math.floor((n % LV) / GW)), l: Math.floor(n / LV) });
  cells.reverse();
  // alisa: pula pontos quando dá pra ir reto (mesmo andar, fora da escada, sem célula bloqueada no meio)
  const straight = (a: WP, b: WP) => {
    if (a.l !== b.l || isStair(a.x, a.z) || isStair(b.x, b.z)) return false;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15);
    for (let k = 1; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
      if (isStair(x, z) || g[a.l * LV + Math.floor((z - GZ0) / CELL) * GW + Math.floor((x - GX0) / CELL)]) return false;
    }
    return true;
  };
  const out: WP[] = [cells[0]];
  let k = 0;
  while (k < cells.length - 1) {
    let far = k + 1;
    for (let m = cells.length - 1; m > k + 1; m--) if (straight(cells[k], cells[m])) { far = m; break; }
    out.push(cells[far]);
    k = far;
  }
  out.push({ x: tx, z: tz, l: tl });
  return out.slice(1);
}

/** anda pela rota: parado nas paradas (com a pose da parada), seguindo o caminho calculado até a próxima.
 *  Rota "solta" (`loose`): o próximo destino é sorteado; esperas sempre sorteadas */
function walkStep(p: Person, dt: number): Pose {
  const r = p.route!, to = r[p.next];
  if (p.wait > 0) {
    p.wait -= dt;
    return r[p.leg].pose ?? STAND;
  }
  if (p.block > 0) {
    p.block -= dt;
    if (p.block <= 0) p.path = null; // depois de esperar, recalcula (o outro pode ter parado no caminho)
    return STAND;
  }
  const me = p.root.position;
  if (!p.path) {
    p.path = findPath(p, to.x, to.z, to.y > 2.2 ? 1 : 0) ?? [{ x: to.x, z: to.z, l: to.y > 2.2 ? 1 : 0 }];
    p.pi = 0;
  }
  let wp = p.path[p.pi];
  let dx = wp.x - me.x, dz = wp.z - me.z, d = Math.hypot(dx, dz);
  while (d < 0.3 && p.pi < p.path.length - 1) { wp = p.path[++p.pi]; dx = wp.x - me.x; dz = wp.z - me.z; d = Math.hypot(dx, dz); }
  if (p.pi >= p.path.length - 1 && d < 0.12) {
    p.path = null;
    p.best = Infinity;
    p.stuck = 0;
    p.leg = p.next;
    p.next = (p.leg + 1) % r.length;
    if (p.loose) while (p.next === p.leg) p.next = Math.floor(Math.random() * r.length);
    p.wait = (to.wait ?? 0) * (0.5 + Math.random());
    if (to.carry !== undefined) p.carry = to.carry;
    return to.pose ?? STAND;
  }
  // alguém bem na frente (andando ou não): espera um pouco e recalcula o caminho
  for (const q of people) {
    if (q === p || Math.abs(q.root.position.y - me.y) > 1) continue;
    const ox = q.root.position.x - me.x, oz = q.root.position.z - me.z, od = Math.hypot(ox, oz);
    if (od < 0.8 && od > 1e-3 && (ox * Math.sin(p.heading) + oz * Math.cos(p.heading)) / od > 0.6) { p.block = rnd(0.4, 1); return STAND; }
  }
  // travou mesmo assim: recalcula; travou de novo: desiste desse destino
  const dist = Math.hypot(to.x - me.x, to.z - me.z);
  if (dist < p.best - 0.2) { p.best = dist; p.stuck = 0; }
  else if ((p.stuck += dt) > 3) {
    p.path = null;
    if (p.stuck > 6) { p.leg = p.next; p.next = (p.leg + 1) % r.length; p.stuck = 0; p.best = Infinity; }
  }
  let dh = Math.atan2(dx, dz) - p.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  p.heading += dh * Math.min(1, dt * 7);
  p.root.rotation.y = p.heading;
  const v = Math.min(d, 1.3 * dt * (Math.abs(dh) > 1.2 ? 0.2 : 1));
  me.x += Math.sin(p.heading) * v;
  me.z += Math.cos(p.heading) * v;
  if (isStair(me.x, me.z)) me.x += (-7 - me.x) * Math.min(1, dt * 4); // no meio do degrau
  else avoid(p);
  const onSt = isStair(me.x, me.z);
  me.y += (groundAt(me.x, me.z, me.y) + (onSt ? 0.12 : 0) - me.y) * Math.min(1, dt * 12); // sobe/desce degrau por degrau
  // passada do tamanho da perna (~0,9 m por passo, 1,8 m por ciclo): o pé não escorrega no chão; na escada, 1 degrau por passo
  p.ph += (v / (onSt ? 1.1 : 1.8)) * Math.PI * 2;
  return onSt ? stairPose(p.ph, p.carry ? CARRY : undefined) : walkPose(p.ph, p.carry ? CARRY : undefined);
}

// ---------- ninguém atravessa ninguém ----------
// obstáculos fixos (caixas no chão, x0 x1 z0 z1, no andar y) — quem anda escorrega em volta
BLOCKS.push(
  [-3.7, 3.7, 3.7, 8.3, 0], // mesa do QG
  [12.4, 17.6, 4.6, 6.4, 0], // carro do pit stop
  [12.3, 17.7, -7.7, -5.3, 0], // elevador
  [8.6, 9.6, -1.9, 1.9, 0], // bancada
  [10.9, 12.3, -1, 0, 0], // motor
  [-17.3, -11.7, 1.7, 7.3, 0], [-16.25, -16.05, 8.2, 13, 0], [-12.95, -12.75, 8.2, 13, 0], // palco (o miolo dele) e os cordões
  [5.2, 8, -1.6, 2.8, 0], // sofá e mesinha
);
// o resto do que está no chão: bancadas, caixas, pneus, plantas, lixeiras, estantes, racks, troféus, divisórias
for (const [x, z, w, d, y] of [
  [9.5, -12, 1.8, 1, 0], [20.5, -12, 1.8, 1, 0], [20.5, -3, 1.8, 1, 0], // armários vermelhos
  [21.4, -7.6, 1.1, 4.8, 0], // estante de pneus
  [20.6, 2.7, 1.1, 2.6, 0], [10.6, 10.8, 2.4, 1.6, 0], // pilhas de pneus
  [21, 9.2, 1, 1.8, 0], [18.8, 8.6, 1.4, 1.2, 0], [20.5, -11.6, 1.6, 1.4, 0], [9.6, -11.8, 0.8, 0.8, 0], // compressor, telemetria, caixas
  [4.2, -12.5, 1.2, 1, 0], [-3.85, -12.6, 2.4, 0.8, 0], [4.5, -4.85, 3.4, 0.3, 0], // café, estantes, quadro
  [8, 4, 0.25, 18, 0], [-8, 8.5, 0.5, 9, 0], // vidro e mureta
  [6.6, 12.2, 0.7, 0.7, 0], [-5.6, 4.4, 0.7, 0.7, 0], [-20.8, 12.2, 0.7, 0.7, 0], [21, 12.2, 0.7, 0.7, 0], // plantas
  [7.3, -3.6, 0.6, 0.6, 0], [-6.8, 12.4, 0.6, 0.6, 0], [21.2, -1.6, 0.6, 0.6, 0], // lixeiras
  [7.3, -1.9, 0.6, 0.6, 0], [11.8, 3.6, 0.5, 0.5, 0], [11.8, 7.4, 0.5, 0.5, 0], [18.2, 3.6, 0.5, 0.5, 0], [18.2, 7.4, 0.5, 0.5, 0], [12, -8.4, 0.5, 0.5, 0], [18, -8.4, 0.5, 0.5, 0], // luminária e cones
  [7, -11.8, 1.1, 2.1, 4.5], [-14.5, -11.6, 12, 1.1, 4.5], [-5.2, -12.2, 0.7, 0.7, 4.5], // racks, troféus e planta lá em cima
] as const) solid(x, z, w, d, y);
/** empurra quem anda pra fora dos outros (0,65 m entre pessoas) e das caixas */
function avoid(p: Person) {
  const me = p.root.position;
  for (const q of people) {
    if (q === p || Math.abs(q.root.position.y - me.y) > 1) continue;
    const ox = me.x - q.root.position.x, oz = me.z - q.root.position.z, d = Math.hypot(ox, oz);
    if (d < 0.4 && d > 1e-4) { const k = (0.4 - d) / d * (q.route ? 0.5 : 1); me.x += ox * k; me.z += oz * k; }
  }
  me.x = Math.max(-21.7, Math.min(21.7, me.x));
  me.z = Math.max(-12.7, Math.min(13.1, me.z));
  for (const [x0, x1, z0, z1, y] of BLOCKS) {
    if (Math.abs(me.y - y) > 1) continue;
    const cx = Math.max(x0, Math.min(x1, me.x)), cz = Math.max(z0, Math.min(z1, me.z));
    const ox = me.x - cx, oz = me.z - cz, d = Math.hypot(ox, oz);
    if (d < 0.3) {
      if (d > 1e-4) { me.x += (ox / d) * (0.3 - d); me.z += (oz / d) * (0.3 - d); }
      else {
        // dentro da caixa: sai pela borda mais perto (de uma vez)
        const out = [[me.x - x0, -1, 0], [x1 - me.x, 1, 0], [me.z - z0, 0, -1], [z1 - me.z, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        me.x += out[1] * (out[0] + 0.3);
        me.z += out[2] * (out[0] + 0.3);
      }
    }
  }
}

// ---------- quem está onde (com ações sorteadas: ninguém repete igual) ----------
const osc = (t: number, p: Person, base: Pose, amp: number, sp = 4) => ({ ...base, el: base.el + Math.sin(t * sp + p.ph) * amp, er: base.er + Math.cos(t * sp * 1.1 + p.ph) * amp });
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const STRETCH = P({ al: 2.8, ar: 2.8, el: 0.1, er: 0.1, out: 0.3 });
const WATCH = P({ al: 1.15, el: 1.7, out: 0.05 });
const CROSS = P({ al: 0.55, ar: 0.55, el: 1.95, er: 1.95, out: -0.15 });
const SCRATCH = P({ ar: 2.3, er: 2.4, out: 0.3 });
const HANDS_HIP = P({ al: 0.25, ar: 0.25, el: 1.2, er: 1.2, out: 0.55 });
/**
 * comportamento base + de vez em quando uma ação sorteada (espreguiçar, olhar o relógio, cruzar os braços,
 * coçar a cabeça...) e olhar pro lado. `extras` recebe a pose base pra montar a ação em cima dela (sentado etc.)
 */
function vary(base: (t: number, p: Person) => Pose, extras: ((b: Pose) => Pose)[], gap: [number, number] = [3, 9]) {
  let until = rnd(...gap), act: ((b: Pose) => Pose) | null = null;
  return (t: number, p: Person): Pose => {
    if (t > until) {
      if (act || Math.random() < 0.35) { act = null; p.look = 0; until = t + rnd(...gap); }
      else { act = pick(extras); p.look = Math.random() < 0.5 ? rnd(-0.8, 0.8) : 0; until = t + rnd(1.4, 3.2); }
    }
    const b = base(t, p);
    return act ? act(b) : b;
  };
}
const sitActs = [(b: Pose) => ({ ...b, al: 2.7, ar: 2.7, el: 0.2, er: 0.2, out: 0.3 }), (b: Pose) => ({ ...b, ar: 2.3, er: 2.4 }), (b: Pose) => ({ ...b, al: 0.2, ar: 0.2, el: 0.3, er: 0.3 })];
const standActs = [() => STRETCH, () => WATCH, () => CROSS, () => SCRATCH, () => HANDS_HIP, () => POINT];
for (const [x, y, z, r] of seats) {
  person(x, y, z, r + Math.PI, vary((t, p) => osc(t, p, SIT, 0.08, 9), sitActs, [4, 12]));
}
person(4.5, 0, -3.95, Math.PI, vary((t, p) => ({ ...DRAW, ar: DRAW.ar + Math.sin(t * 2.2 + p.ph) * 0.18, er: DRAW.er + Math.sin(t * 3.1) * 0.25 }), [() => HANDS_HIP, () => SCRATCH, () => CROSS]));
person(-1.6, 0, 9.2, Math.PI * 0.85, vary(() => STAND, standActs, [2, 6]));
person(1.8, 0, 9.1, Math.PI * 1.1, vary(() => STAND, standActs, [2, 6]));
person(7.9, 4.5, -11.8, -Math.PI / 2, vary((t, p) => osc(t, p, WORK, 0.25, 5), [() => SCRATCH, () => HANDS_HIP, () => STRETCH]));
person(-17, 4.5, -10.1, Math.PI, vary((t, p) => osc(t, p, WORK, 0.3, 6), [() => HANDS_HIP, () => STRETCH]));
person(-10.4, 0, 7.4, -2.2, vary(() => POINT, [() => STAND, () => CROSS, () => WATCH], [2, 5]));
person(9.9, 0, 0, -Math.PI / 2, vary((t, p) => osc(t, p, WORK, 0.3, 7), [() => STRETCH, () => HANDS_HIP, () => SCRATCH]), { helmet: true });
person(12.9, 0, -0.5, -Math.PI / 2, vary((t, p) => osc(t, p, WORK, 0.2, 5), [() => HANDS_HIP, () => WATCH]), { helmet: true });
// soldador embaixo do carro do elevador (só quando o carro está em cima)
person(14.6, 0, -5, Math.PI, vary(() => (welding ? ARMS_UP : STAND), [() => HANDS_HIP, () => CROSS], [5, 10]), { helmet: true });
// visitante pelos troféus: passeia por pontos sorteados em volta do palco e pelo mezanino de baixo
const ring: Stop[] = Array.from({ length: 9 }, (_, i) => ({ x: -14.5 + Math.sin((i / 9) * Math.PI * 2) * 5.2, y: 0, z: 4.5 + Math.cos((i / 9) * Math.PI * 2) * 5.2, wait: i % 2 ? 0 : 2.5, pose: pick([POINT, CROSS, STAND]) })).filter((s) => s.z < 8); // (sem o ponto da passadeira, entre os cordões)
person(ring[0].x, 0, ring[0].z, 0, (t, p) => walkStep(p, dtNow), { route: ring, loose: true });
// engenheiro: QG → escada → engenharia → volta (esperas sorteadas)
person(-2, 0, 3, 0, (t, p) => walkStep(p, dtNow), {
  route: [
    { x: -2, y: 0, z: 3, wait: 4, pose: POINT },
    { x: -7, y: 0, z: 2.6 },
    { x: -7, y: 0, z: 1.6 },
    { x: -7, y: 4.5, z: -5.4 },
    { x: -2.5, y: 4.5, z: -6.3, wait: 5, pose: POINT },
    { x: -7, y: 4.5, z: -5.4 },
    { x: -7, y: 0, z: 1.6 },
    { x: -7, y: 0, z: 2.6 },
  ],
});
// carregador de pneu: estante → pilha → estante
const tireProp = new THREE.Mesh(TIRE, TM);
person(20.2, 0, -7.6, 0, (t, p) => walkStep(p, dtNow), {
  helmet: true,
  hand: tireProp,
  route: [
    { x: 20.2, y: 0, z: -7.6, wait: 1.6, pose: WORK, carry: true },
    { x: 19, y: 0, z: -2 },
    { x: 19.4, y: 0, z: 1.4, wait: 1.4, pose: WORK, carry: false },
    { x: 19, y: 0, z: -2 },
  ],
});
// mecânicos andando pela oficina por destinos sorteados
const shop: Stop[] = [
  { x: 13.5, y: 0, z: -11.4, wait: 4, pose: WORK },
  { x: 12, y: 0, z: 9.5, wait: 3, pose: HANDS_HIP },
  { x: 10.4, y: 0, z: 2.6, wait: 3, pose: WORK },
  { x: 18.5, y: 0, z: 9.6, wait: 2.5, pose: CROSS },
  { x: 16.5, y: 0, z: -3.8, wait: 3, pose: POINT },
  { x: 20.4, y: 0, z: 6.5, wait: 2, pose: WATCH },
];
person(12, 0, 9.5, 0, (t, p) => walkStep(p, dtNow), { helmet: true, route: shop.map((s) => ({ ...s })), loose: true });
person(18.5, 0, 9.6, 0, (t, p) => walkStep(p, dtNow), { helmet: true, route: shop.map((s) => ({ ...s })).reverse(), loose: true });
// no QG, alguém vai da mesa até o quadro e volta, em horas sorteadas
person(2.5, 0, 9.4, 0, (t, p) => walkStep(p, dtNow), {
  route: [
    { x: 2.5, y: 0, z: 9.4, wait: 6, pose: POINT },
    { x: 4.4, y: 0, z: 2.6 },
    { x: 3.2, y: 0, z: -3.6, wait: 4, pose: CROSS },
    { x: -4.6, y: 0, z: 2.4, wait: 3, pose: HANDS_HIP },
  ],
  loose: true,
});

let dtNow = 0;
(window as unknown as { __people: Person[]; __blocks: typeof BLOCKS }).__people = people; // teste
(window as unknown as { __blocks: typeof BLOCKS }).__blocks = BLOCKS;

// ---------- carros (o modelo do jogo, pintado na cor da equipe) ----------
const cars: THREE.Object3D[] = [];
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.load("/piloto/piloto.glb", (gl) => {
  pilotBase = gl.scene;
  const b = new THREE.Box3().setFromObject(pilotBase);
  pilotBase.scale.setScalar(1.78 / (b.max.y - b.min.y));
  pilotBase.position.y = -b.min.y * pilotBase.scale.y;
  for (const f of pending.splice(0)) f();
});
// treino de pit stop no carro do chão: rodas saem e voltam, macaco, pirulito, tempo na tela
const pit = { car: null as THREE.Object3D | null, wheels: [] as { w: THREE.Object3D; o: THREE.Vector3; d: THREE.Vector3 }[], start: 4, shown: false, time: 0 };
let pitC = -4; // segundos desde o começo do pit stop (negativo = esperando o próximo, em hora sorteada)
const lift = { phase: 0, until: 2, y: 0 }; // 0 embaixo, 1 subindo, 2 em cima, 3 descendo (tempos sorteados)
loader.load("/car3d/carro.glb", (gl) => {
  const base = gl.scene;
  const size = new THREE.Box3().setFromObject(base).getSize(new THREE.Vector3());
  const sc = 4.8 / Math.max(size.x, size.z), lat = size.x > size.z ? "z" : "x";
  base.scale.setScalar(sc);
  base.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    const mm = m.material as THREE.MeshStandardMaterial;
    if (mm.name === "pintura" || mm.name === "asa") {
      m.material = mm.clone();
      (m.material as THREE.MeshStandardMaterial).map = null;
      (m.material as THREE.MeshStandardMaterial).color.set(mm.name === "pintura" ? team.color : team.accent);
    }
  });
  for (const [i, [x, y, z, r]] of ([[-14.5, 0.46, 4.5, 0.6], [15, 2, -6.5, Math.PI / 2], [15, 0, 5.5, Math.PI / 2]] as const).entries()) {
    const c = base.clone();
    if (i < 2) for (const n of ["piloto", "capacete", "volante", "telinha"]) { const o = c.getObjectByName(n); if (o) o.visible = false; } // vazio na exposição e no elevador
    const g = new THREE.Group();
    g.add(c);
    const bb = new THREE.Box3().setFromObject(g);
    c.position.y -= bb.min.y; // apoia no chão
    c.position.x -= (bb.min.x + bb.max.x) / 2; // a origem do modelo não fica no meio do carro
    c.position.z -= (bb.min.z + bb.max.z) / 2;
    g.position.set(x, y, z);
    g.rotation.y = r;
    scene.add(g);
    cars.push(g);
  }
  // equipe do pit stop em volta do carro do chão
  const car = cars[2];
  pit.car = car;
  car.updateMatrixWorld(true);
  const ctr = new THREE.Box3().setFromObject(car).getCenter(new THREE.Vector3());
  const wpos: Record<string, THREE.Vector3> = {};
  for (const n of ["roda_fd", "roda_fe", "roda_td", "roda_te"]) {
    const w = car.getObjectByName(n)!;
    wpos[n] = w.getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3();
    d[lat] = Math.sign(w.position[lat]) * (0.55 / sc);
    pit.wheels.push({ w, o: w.position.clone(), d });
  }
  const front = wpos.roda_fd.clone().add(wpos.roda_fe).multiplyScalar(0.5).sub(wpos.roda_td.clone().add(wpos.roda_te).multiplyScalar(0.5)).setY(0).normalize();
  const crewPose = (idle: (t: number, p: Person) => Pose) => (t: number, p: Person): Pose => {
    const c = pitC;
    if (c < 0 || c > 5.6) return idle(t, p);
    if (c < 1.5) return READY;
    if (c < 3.4) return osc(t, p, KNEEL, c > 2 ? 0.35 : 0, 14);
    if (c < 3.9) return READY;
    return { ...CHEER, al: CHEER.al + Math.sin(t * 9 + p.ph) * 0.2 };
  };
  const crewIdle = () => vary(() => STAND, [() => HANDS_HIP, () => CROSS, () => WATCH, () => STRETCH, () => SCRATCH], [2, 7]);
  for (const w of Object.values(wpos)) {
    const out = w.clone().sub(ctr).setY(0);
    const lateral = out.clone().sub(front.clone().multiplyScalar(out.dot(front))).normalize();
    const at = w.clone().addScaledVector(lateral, 0.85);
    person(at.x, 0, at.z, Math.atan2(-lateral.x, -lateral.z), crewPose(crewIdle()), { helmet: true });
  }
  const nose = ctr.clone().addScaledVector(front, 3.1);
  person(nose.x, 0, nose.z, Math.atan2(-front.x, -front.z), crewPose(crewIdle()), { helmet: true });
  // homem do pirulito: placa vermelha (pare) → verde (vai)
  const lolly = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), RAIL);
  stick.position.y = 0.55;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20), glow("#ff3030", 1.2));
  disc.rotation.x = Math.PI / 2;
  disc.position.y = 1.3;
  lolly.add(stick, disc);
  lolly.userData.disc = disc;
  const lp = ctr.clone().addScaledVector(front, 4.6);
  person(lp.x, 0, lp.z, Math.atan2(-front.x, -front.z), (t) => ({ ...POINT, ar: pitC > 3.6 && pitC < 5 ? 2.2 : pitC > 0 ? 1.1 : 0.05 }), { helmet: true, hand: lolly });
});

// tempo do pit stop flutuando em cima do carro
const pitTag = document.createElement("div");
pitTag.className = "rot";
pitTag.style.setProperty("--cor", "#6fdc8c");
pitTag.style.opacity = "0";
pitTag.style.transition = "opacity .3s";
document.getElementById("rotulos")!.appendChild(pitTag);

/** tudo o que mexe na oficina e nas pessoas, a cada quadro */
function tickWorld(t: number, dt: number) {
  dtNow = dt;
  // elevador: sobe, fica lá em cima (solda), desce
  if (t > lift.until) { lift.phase = (lift.phase + 1) % 4; lift.until = t + (lift.phase % 2 ? 3 : lift.phase === 2 ? rnd(8, 18) : rnd(3, 9)); }
  const lk = lift.phase === 0 ? 0 : lift.phase === 2 ? 1 : lift.phase === 1 ? 1 - (lift.until - t) / 3 : (lift.until - t) / 3;
  const ly = 0.3 + 1.6 * (0.5 - 0.5 * Math.cos(lk * Math.PI));
  liftPlat.position.y = ly;
  if (cars[1]) cars[1].position.y = ly + 0.1;
  welding = lift.phase === 2 && lift.until - t > 1;
  // pit stop
  if (pit.car) {
    pitC = t - pit.start;
    if (pitC > 9) { pit.start = t + rnd(3, 14); pitC = t - pit.start; pit.shown = false; }
    const c = pitC;
    const jack = c > 1.8 && c < 3.6 ? 1 : 0;
    pit.car.position.y += (jack * 0.09 - pit.car.position.y) * Math.min(1, dt * 14);
    const pop = c < 2.1 ? 0 : c < 2.5 ? (c - 2.1) / 0.4 : c < 2.8 ? 1 : c < 3.2 ? 1 - (c - 2.8) / 0.4 : 0;
    for (const w of pit.wheels) w.w.position.copy(w.o).addScaledVector(w.d, pop);
    if (c > 3.7 && !pit.shown) {
      pit.shown = true;
      pit.time = rnd(1.9, 3.1);
      pitTag.textContent = `TREINO DE PIT STOP · ${pit.time.toFixed(1).replace(".", ",")} s`;
      pitTag.style.opacity = "1";
    }
    if (c > 6.5 || c < 0) pitTag.style.opacity = "0";
    v.set(pit.car.position.x, 2.6, pit.car.position.z).project(cam);
    pitTag.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    pitTag.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
  for (const p of people) {
    lerpPose(p.cur, p.target(t, p), Math.min(1, dt * (p.route ? 18 : 9)));
    if (!p.route) p.root.rotation.y += (p.heading + p.look - p.root.rotation.y) * Math.min(1, dt * 3); // olhar pro lado
    applyPose(p);
    if (p.prop?.userData.disc) {
      const go = pitC > 3.6 && pitC < 5.6;
      ((p.prop.userData.disc as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.set(go ? "#2bdc4c" : "#ff3030");
      p.prop.position.y -= 0.55;
    } else if (p.prop) {
      p.prop.position.addScaledVector(new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading)), 0.18);
      p.prop.rotation.set(0, p.heading, 0);
    }
  }
}

// ---------- rótulos, mouse, foco ----------
const labels = document.getElementById("rotulos")!;
for (const [id, r] of Object.entries(rooms) as [RoomId, Room][]) {
  const d = document.createElement("div");
  d.className = r.anchor.y < 0 ? "rot baixo" : "rot";
  d.style.setProperty("--cor", r.cor);
  d.textContent = r.name;
  d.onclick = () => focus(id);
  d.onmouseenter = () => (hover = id);
  d.onmouseleave = () => (hover = null);
  labels.appendChild(d);
  r.label = d;
}
let hover: RoomId | null = null, focused: RoomId | null = null;
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
const picks = Object.values(rooms).map((r) => r.pick);
function pickAt(e: PointerEvent): RoomId | null {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, cam);
  return (ray.intersectObjects(picks)[0]?.object.userData.room as RoomId) ?? null;
}
renderer.domElement.addEventListener("pointermove", (e) => {
  hover = pickAt(e);
  renderer.domElement.style.cursor = hover ? "pointer" : "default";
});
renderer.domElement.addEventListener("click", (e) => {
  const id = pickAt(e);
  if (id) focus(id);
  else if (focused) focus(null);
});
addEventListener("keydown", (e) => e.key === "Escape" && focus(null));
document.getElementById("fechar")!.onclick = () => focus(null);
for (const b of document.querySelectorAll<HTMLButtonElement>(".tab")) b.onclick = () => focus(b.dataset.tab === "geral" ? null : (b.dataset.tab as RoomId));

const luz = (n: number, of = 6) => `<span class="luzes">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
const CONTENT: Record<RoomId, () => string> = {
  trofeus: () => `<h2>SALA DE TROFÉUS</h2><p>O que a equipe já ganhou. O carro do palco usa a sua pintura.</p>
    <div class="lin">🏆 Vitórias<b>3</b></div><div class="lin">🥈 Pódios<b>11</b></div><div class="lin">Títulos de construtores<b>0</b></div><div class="lin">Melhor temporada<b>P4 (2026)</b></div>`,
  qg: () => `<h2>QG DA EQUIPE</h2><p>Próxima corrida e estratégias salvas.</p>
    <div class="lin">Próxima etapa<b>${track.name}</b></div><div class="lin">Estratégia ativa<b>Ataque final + chuva</b></div><div class="lin">Pilotos<b>${team.short} 1 · ${team.short} 2</b></div><div class="lin">Humor da equipe<b>bom</b></div>`,
  oficina: () => `<h2>OFICINA E GARAGEM</h2><p>Fábrica e mecânicos (níveis de exemplo).</p>
    <div class="lin">Aerodinâmica${luz(4)}</div><div class="lin">Motor${luz(3)}</div><div class="lin">Chassi${luz(5)}</div>
    <div class="lin">Troca de pneus${luz(3, 5)}</div><div class="lin">Confiabilidade${luz(2, 5)}</div>`,
  engenharia: () => `<h2>ENGENHARIA</h2><p>Pesquisa (P&amp;D) com os pontos de pesquisa.</p>
    <div class="lin">Asa traseira nova<b>60%</b></div><div class="lin">Arrefecimento<b>25%</b></div><div class="lin">Pontos de pesquisa<b>750 PP</b></div>`,
};
const painel = document.getElementById("painel")!;
function focus(id: RoomId | null) {
  focused = id;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tab")) b.classList.toggle("on", (b.dataset.tab === "geral" && !id) || b.dataset.tab === id);
  if (!id) {
    view.tx.set(0, 2, 0);
    view.tz = 1;
    painel.classList.remove("on");
    return;
  }
  const r = rooms[id];
  view.tx.copy(r.focus).addScaledVector(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), 9 / r.zoom); // o painel da direita cobre a tela
  view.tz = r.zoom;
  painel.style.setProperty("--cor", r.cor);
  document.getElementById("conteudo")!.innerHTML = CONTENT[id]();
  painel.classList.add("on");
}

// teste: ?perto=x,z,zoom aproxima a câmera nesse ponto
const perto = new URLSearchParams(location.search).get("perto")?.split(",").map(Number);
if (perto) { view.tx.set(perto[0], 1, perto[1]); view.x.copy(view.tx); view.tz = view.z = perto[2] ?? 5; }

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, cam));
const ao = new GTAOPass(scene, cam, innerWidth, innerHeight);
ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 1.5, scale: 1.2 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
composer.addPass(new OutputPass());

function resize() {
  const a = innerWidth / innerHeight;
  const h = FRAME * Math.max(1, 1.45 / a); // tela estreita: mais longe pra caber a largura
  Object.assign(cam, { left: -h * a, right: h * a, top: h, bottom: -h });
  cam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize);
resize();

// ---------- quadro a quadro ----------
const clock = new THREE.Clock();
const v = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  const k = 1 - Math.exp(-dt * 5);
  view.x.lerp(view.tx, k);
  view.z += (view.tz - view.z) * k;
  cam.position.copy(view.x).addScaledVector(DIR, 90);
  cam.lookAt(view.x);
  if (cam.zoom !== view.z) { cam.zoom = view.z; cam.updateProjectionMatrix(); }

  if (cars[0]) cars[0].rotation.y = 0.6 + t * 0.25; // carro girando no palco
  podium.rotation.y = t * 0.25;
  tickWorld(t, dt);
  for (let i = 0; i < SPARKS; i++) {
    sparkLife[i] -= dt;
    if (welding && sparkLife[i] <= 0 && Math.sin(t * 7) > -0.2) {
      sparkLife[i] = 0.3 + Math.random() * 0.4;
      sparkPos.set([WELD.x, WELD.y, WELD.z], i * 3);
      sparkVel.set([(Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4], i * 3);
    }
    sparkVel[i * 3 + 1] -= 9 * dt;
    for (let a = 0; a < 3; a++) sparkPos[i * 3 + a] += sparkVel[i * 3 + a] * dt;
    if (sparkPos[i * 3 + 1] < 0.05) sparkLife[i] = 0;
  }
  sparkGeo.attributes.position.needsUpdate = true;

  for (const [id, r] of Object.entries(rooms) as [RoomId, Room][]) {
    const on = hover === id || focused === id;
    const fm = r.floor.material as THREE.MeshStandardMaterial;
    fm.emissiveIntensity += ((on ? 0.35 : 0) - fm.emissiveIntensity) * k * 2;
    v.copy(r.anchor).project(cam);
    r.label!.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    r.label!.style.top = `${((1 - v.y) / 2) * innerHeight + (r.anchor.y < 0 ? 18 : -18)}px`;
    r.label!.classList.toggle("on", on);
    r.label!.style.display = focused && focused !== id ? "none" : "";
  }
  composer.render();
});
