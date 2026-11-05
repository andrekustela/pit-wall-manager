// PROTÓTIPO DA SEDE (fora do jogo): galpão em corte visto de cima em ângulo, a partir do desenho do usuário
// (testes/imagem teste.jpg). Abrir com o dev ligado: http://localhost:5179/prototipos/sede.html (?equipe=aur ...).
// shortcut: tudo em blocos simples e dados de exemplo; quando aprovado, vira src/ui/hq3d.ts lendo a carreira de verdade.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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

const mat = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
const glow = (c: string, k = 1.4) => new THREE.MeshStandardMaterial({ color: "#000", emissive: c, emissiveIntensity: k });
function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
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
const WALL = mat("#8c7a6e"), CUT = mat("#221c19"), TRIM = mat("#5a4c44");
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
  const floor = box(x1 - x0, 0.06, z1 - z0, mat(floorCol, { emissive: cor, emissiveIntensity: 0 }), (x0 + x1) / 2, y0 + 0.03, (z0 + z1) / 2);
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
const SLAB = mat("#4a4f5c");
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
box(14, 0.3, 8, SLAB, 1, 4.35, -9);
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
function desk(x: number, y: number, z: number, rot: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;
  scene.add(g);
  box(2.2, 0.08, 1, DESK, 0, 0.78, 0, g);
  for (const sx of [-1, 1]) box(0.06, 0.78, 0.9, DESK, sx * 1.05, 0.39, 0, g);
  for (const sx of [-0.5, 0.5]) {
    box(0.8, 0.5, 0.05, DARK, sx, 1.15, -0.25, g);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.42), glow(sx < 0 ? "#39d0ff" : "#6fdc8c", 0.9));
    scr.position.set(sx, 1.15, -0.22);
    g.add(scr);
  }
  const off = new THREE.Vector3(0, 0, 0.85).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
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
box(5.2, 0.2, 2.2, LIFT, 15, 1.9, -6.5);
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
const WELD = new THREE.Vector3(17.4, 0.55, 6.6);

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

// plantas
const LEAF = mat("#3f8a3a"), POT = mat("#e8e2d8");
for (const [x, y, z] of [[6.6, 0, 12], [-6.6, 0, 1.6], [-5.2, 4.5, -12.2], [-20.8, 0, 12.2], [-20.8, 4.5, -12.2]]) {
  cyl(0.32, 0.55, POT, x, y + 0.28, z, 12);
  const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), LEAF);
  l.position.set(x, y + 1.05, z);
  l.castShadow = true;
  scene.add(l);
}

// lado de fora: árvores, postes da rua, mastros com a bandeira da equipe
const TRUNK = mat("#5a3d2b"), TREE = mat("#4f7d3a");
for (const [x, z, s] of [[-31, -18, 1.2], [-29, 6, 1], [-33, 16, 0.9], [31, -17, 1.1], [33, 2, 1.3], [30, 15, 0.9], [-12, -24, 1.1], [14, -24, 1]]) {
  cyl(0.25 * s, 2.2 * s, TRUNK, x, -0.8 + 1.1 * s, z, 8);
  const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9 * s, 0), TREE);
  c.position.set(x, -0.8 + 3.3 * s, z);
  c.castShadow = true;
  scene.add(c);
}
for (const x of [-30, -10, 10, 30]) {
  cyl(0.1, 6, STEEL, x, 2.2, 29.4, 8);
  box(1.4, 0.15, 0.4, STEEL, x, 5.2, 29.1);
  box(1.1, 0.04, 0.3, glow("#fff1d8", 2), x, 5.11, 29.1);
}
for (const [i, x] of [-28, -25.5, -23].entries()) {
  cyl(0.06, 7, RAIL, x, 2.7, 17, 8);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), mat(i === 1 ? team.accent : team.color, { side: THREE.DoubleSide }));
  f.position.set(x + 1.05, 5.4, 17);
  scene.add(f);
}

// ---------- pessoas (macacão da equipe) ----------
const people: { g: THREE.Group; ph: number; kind: "sit" | "work" | "walk" }[] = [];
const BODY = mat(team.color, { roughness: 0.6 }), LEGS = mat(new THREE.Color(team.color).multiplyScalar(0.45).getStyle()), SKIN = mat("#d9a982");
function person(x: number, y: number, z: number, rot: number, kind: "sit" | "work" | "walk") {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;
  g.scale.setScalar(1.3); // maquete: gente um pouco maior pra ler de longe
  const legs = box(0.42, kind === "sit" ? 0.5 : 0.85, 0.28, LEGS, 0, kind === "sit" ? 0.45 : 0.43, 0, g);
  if (kind === "sit") { legs.rotation.x = -1.2; box(0.55, 0.45, 0.55, DARK, 0, 0.22, 0.1, g); }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 10), BODY);
  torso.position.y = kind === "sit" ? 1.05 : 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), SKIN);
  head.position.y = torso.position.y + 0.55;
  torso.castShadow = head.castShadow = true;
  g.add(torso, head);
  scene.add(g);
  people.push({ g, ph: Math.random() * 6, kind });
}
for (const [x, y, z, r] of seats) person(x, y, z, r + Math.PI, "sit");
person(1.6, 0, 8.9, Math.PI * 0.9, "work");
person(-1.8, 0, 3.4, 0.4, "work");
person(4.5, 0, -3.6, Math.PI, "work");
person(14, 0, -4.8, 0.2, "work");
person(17.2, 0, 7.3, -2.2, "work");
person(12.5, 0, 4, 1.2, "walk");
person(-11, 0, 9.5, -0.9, "work");
person(1, 4.5, -6.2, 0.6, "work");

// ---------- carros (o modelo do jogo, pintado na cor da equipe) ----------
const cars: THREE.Object3D[] = [];
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.load("/car3d/carro.glb", (gl) => {
  const base = gl.scene;
  const size = new THREE.Box3().setFromObject(base).getSize(new THREE.Vector3());
  base.scale.setScalar(4.8 / Math.max(size.x, size.z));
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
  for (const [x, y, z, r] of [[-14.5, 0.46, 4.5, 0.6], [15, 2, -6.5, Math.PI / 2], [15, 0, 5.5, Math.PI / 2]] as const) {
    const c = base.clone();
    const g = new THREE.Group();
    g.add(c);
    const b = new THREE.Box3().setFromObject(g);
    c.position.y -= b.min.y; // apoia no chão
    g.position.set(x, y, z);
    g.rotation.y = r;
    scene.add(g);
    cars.push(g);
  }
});

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

function resize() {
  const a = innerWidth / innerHeight;
  const h = FRAME * Math.max(1, 1.45 / a); // tela estreita: mais longe pra caber a largura
  Object.assign(cam, { left: -h * a, right: h * a, top: h, bottom: -h });
  cam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
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
  for (const p of people) {
    const s = Math.sin(t * (p.kind === "work" ? 3 : 1.6) + p.ph);
    p.g.children[p.g.children.length - 1].position.x = p.kind === "sit" ? s * 0.03 : 0; // cabeça mexendo
    if (p.kind === "work") p.g.rotation.z = s * 0.04;
    if (p.kind === "walk") { p.g.position.x = 12.5 + Math.sin(t * 0.4 + p.ph) * 2.5; p.g.rotation.y = Math.cos(t * 0.4 + p.ph) > 0 ? Math.PI / 2 : -Math.PI / 2; }
  }
  for (let i = 0; i < SPARKS; i++) {
    sparkLife[i] -= dt;
    if (sparkLife[i] <= 0 && Math.sin(t * 7) > -0.2) {
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
  renderer.render(scene, cam);
});
