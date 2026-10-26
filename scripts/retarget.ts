// Passa uma animação do Mixamo (FBX) pro piloto do jogo (public/piloto/piloto.glb, esqueleto rigify)
// e grava um clipe do Three.js em JSON (o pódio toca com AnimationMixer).
// uso: npx tsx scripts/retarget.ts <animação.fbx> <saída.json> [nome]
//
// Cada osso do piloto aponta pra onde aponta o osso do Mixamo e gira em volta de si do mesmo jeito.
// As poses de repouso são diferentes (Mixamo em T com as palmas pra baixo; o piloto em A, braços girados),
// então o giro é alinhado por referências do corpo: o eixo do cotovelo nos braços, a palma na mão e nos
// dedos, a frente no tronco e nas pernas, o alto no pé.
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { readFileSync, writeFileSync } from "node:fs";

(globalThis as unknown as { self: unknown }).self = globalThis;
const [src, out, clipName = "victory"] = process.argv.slice(2);
const FPS = 30;
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const fbx = new FBXLoader().parse(ab(readFileSync(src)), "") as THREE.Group & { animations: THREE.AnimationClip[] };
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await new Promise<{ scene: THREE.Group }>((ok, no) => loader.parse(ab(readFileSync("public/piloto/piloto.glb")), "", ok as never, no));
const tgt = gltf.scene;
const clip = fbx.animations.find((c) => c.duration > 0)!;
fbx.updateMatrixWorld(true);
tgt.updateMatrixWorld(true);

const sBone = (n: string) => THREE.PropertyBinding.findNode(fbx, `mixamorig${n}`) as THREE.Bone;
const tBone = (n: string) => tgt.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)) as THREE.Bone;
const wpos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const wquat = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
const FWD = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

// palma (normal saindo da palma) no repouso: dedos x (indicador → mindinho); sinal trocado em cada lado
function palm(hand: THREE.Object3D, index: THREE.Object3D, pinky: THREE.Object3D, mid: THREE.Object3D, side: number) {
  const F = wpos(mid).sub(wpos(hand)).normalize();
  const A = wpos(pinky).sub(wpos(index)).normalize();
  return F.cross(A).multiplyScalar(-side).normalize();
}

// base a partir de (eixo Y, referência): colunas (ref⊥, Y, ref⊥ × Y)
function basis(y: THREE.Vector3, ref: THREE.Vector3) {
  const Y = y.clone().normalize();
  const X = ref.clone().addScaledVector(Y, -ref.dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Matrix4().makeBasis(X, Y, Z);
}

interface Map1 { t: string; s: string; child: string; ref: "fwd" | "up" | "hinge" | "palm"; side: number }
const M: Map1[] = [];
const add = (t: string, s: string, child: string, ref: Map1["ref"], side = 0) => M.push({ t, s, child, ref, side });
add("DEF-spine", "Hips", "Spine", "fwd");
add("DEF-spine.001", "Spine", "Spine1", "fwd");
add("DEF-spine.002", "Spine1", "Spine2", "fwd");
add("DEF-spine.003", "Spine2", "Neck", "fwd");
add("DEF-spine.004", "Neck", "Head", "fwd");
add("DEF-spine.006", "Head", "HeadTop_End", "fwd");
for (const [s, S, sg] of [["L", "Left", 1], ["R", "Right", -1]] as const) {
  add(`DEF-shoulder.${s}`, `${S}Shoulder`, `${S}Arm`, "fwd", sg);
  add(`DEF-upper_arm.${s}`, `${S}Arm`, `${S}ForeArm`, "hinge", sg);
  add(`DEF-forearm.${s}`, `${S}ForeArm`, `${S}Hand`, "hinge", sg);
  add(`DEF-hand.${s}`, `${S}Hand`, `${S}HandMiddle1`, "palm", sg);
  for (const [d, D] of [["f_index", "Index"], ["f_middle", "Middle"], ["f_ring", "Ring"], ["f_pinky", "Pinky"], ["thumb", "Thumb"]] as const)
    for (let k = 1; k <= 3; k++) add(`DEF-${d}.0${k}.${s}`, `${S}Hand${D}${k}`, `${S}Hand${D}${k + 1}`, "palm", sg);
  add(`DEF-thigh.${s}`, `${S}UpLeg`, `${S}Leg`, "fwd", sg);
  add(`DEF-shin.${s}`, `${S}Leg`, `${S}Foot`, "fwd", sg);
  add(`DEF-foot.${s}`, `${S}Foot`, `${S}ToeBase`, "up", sg);
  add(`DEF-toe.${s}`, `${S}ToeBase`, `${S}Toe_End`, "up", sg);
}

// referências no repouso de cada lado
const tPalm = { 1: palm(tBone("DEF-hand.L"), tBone("DEF-f_index.01.L"), tBone("DEF-f_pinky.01.L"), tBone("DEF-f_middle.01.L"), 1), [-1]: palm(tBone("DEF-hand.R"), tBone("DEF-f_index.01.R"), tBone("DEF-f_pinky.01.R"), tBone("DEF-f_middle.01.R"), -1) } as Record<number, THREE.Vector3>;
const sPalm = { 1: palm(sBone("LeftHand"), sBone("LeftHandIndex1"), sBone("LeftHandPinky1"), sBone("LeftHandMiddle1"), 1), [-1]: palm(sBone("RightHand"), sBone("RightHandIndex1"), sBone("RightHandPinky1"), sBone("RightHandMiddle1"), -1) } as Record<number, THREE.Vector3>;
console.log("palma em repouso (piloto L/R, mixamo L/R):", [tPalm[1], tPalm[-1], sPalm[1], sPalm[-1]].map((v) => v.toArray().map((x) => x.toFixed(2)).join(",")).join("  "));

// pra cada par: R_s = o osso do piloto "vestido" na pose de repouso do Mixamo; a cada quadro,
// mundo do piloto = (giro do osso do Mixamo desde o repouso) × R_s
const pairs = M.map((m) => {
  const tb = tBone(m.t), sb = sBone(m.s), sc = sBone(m.child);
  if (!tb || !sb || !sc) throw new Error(`osso faltando: ${m.t} / ${m.s} / ${m.child}`);
  const tq = wquat(tb);
  const tY = UP.clone().applyQuaternion(tq);
  const sY = wpos(sc).sub(wpos(sb)).normalize();
  let tRef: THREE.Vector3, sRef: THREE.Vector3;
  if (m.ref === "hinge") {
    // eixo do cotovelo: no piloto é o X do osso; no Mixamo (em T, palma pra baixo) o cotovelo dobra pra frente
    tRef = new THREE.Vector3(1, 0, 0).applyQuaternion(tq);
    sRef = new THREE.Vector3().crossVectors(sY, FWD).normalize();
  } else if (m.ref === "palm") {
    tRef = tPalm[m.side];
    sRef = sPalm[m.side];
  } else {
    tRef = m.ref === "up" ? UP : FWD;
    sRef = tRef;
  }
  // a referência no espaço do osso do piloto (o mesmo vetor "preso" ao osso)
  const local = tRef.clone().applyQuaternion(tq.clone().invert());
  const Bl = basis(UP, local);
  const Bw = basis(sY, sRef);
  const Rs = new THREE.Quaternion().setFromRotationMatrix(Bw.multiply(Bl.invert()));
  return { ...m, tb, sb, Rs, sRest: wquat(sb) };
});

// quadril: deslocamento do Mixamo, na escala do piloto
const tHips = tBone("DEF-spine"), sHips = sBone("Hips");
const tHip0 = wpos(tHips), sHip0 = wpos(sHips);
const k = tHip0.y / sHip0.y;
// peças presas em ossos que a animação não mexe: o capacete (ORG-spine.006, segue a cabeça) e os
// sapatos (MCH-thigh_ik_target, seguem o pé); guardam a distância do repouso pro osso que seguem
const followers = [
  ["ORG-spine.006", "DEF-spine.006"],
  ["MCH-thigh_ik_target.L", "DEF-foot.L"],
  ["MCH-thigh_ik_target.R", "DEF-foot.R"],
].map(([a, b]) => {
  const o = tBone(a), lead = tBone(b);
  return { o, lead, off: lead.matrixWorld.clone().invert().multiply(o.matrixWorld) };
});

const mixer = new THREE.AnimationMixer(fbx);
mixer.clipAction(clip).play();
const n = Math.round(clip.duration * FPS) + 1;
const times: number[] = [];
const qv = new Map<string, number[]>(), pv = new Map<string, number[]>();
const push = (m: Map<string, number[]>, key: string, arr: number[]) => (m.get(key) ?? m.set(key, []).get(key)!).push(...arr.map((x) => Math.round(x * 1e4) / 1e4));
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
let minY = Infinity, rangeX = [Infinity, -Infinity], rangeZ = [Infinity, -Infinity];
for (let i = 0; i < n; i++) {
  const t = Math.min(clip.duration, i / FPS);
  times.push(Math.round(t * 1e4) / 1e4);
  mixer.setTime(t);
  fbx.updateMatrixWorld(true);
  for (const p of pairs) {
    const delta = wquat(p.sb).multiply(p.sRest.clone().invert());
    const world = delta.multiply(p.Rs);
    const parentQ = wquat(p.tb.parent!);
    p.tb.quaternion.copy(parentQ.invert().multiply(world));
    if (p.tb === tHips) {
      const d = wpos(sHips).sub(sHip0).multiplyScalar(k);
      rangeX = [Math.min(rangeX[0], d.x), Math.max(rangeX[1], d.x)];
      rangeZ = [Math.min(rangeZ[0], d.z), Math.max(rangeZ[1], d.z)];
      p.tb.position.copy(p.tb.parent!.worldToLocal(tHip0.clone().add(d)));
      push(pv, p.tb.name, p.tb.position.toArray());
    }
    p.tb.updateMatrixWorld(true);
    push(qv, p.tb.name, p.tb.quaternion.toArray());
  }
  // capacete e sapatos acompanham
  for (const f of followers) {
    tmpM.copy(f.o.parent!.matrixWorld).invert().multiply(f.lead.matrixWorld).multiply(f.off).decompose(tmpP, tmpQ, tmpS);
    push(qv, f.o.name, tmpQ.toArray());
    push(pv, f.o.name, tmpP.toArray());
  }
  for (const s of ["L", "R"]) minY = Math.min(minY, wpos(tBone(`DEF-toe.${s}`)).y);
}
const tracks: THREE.KeyframeTrack[] = [];
for (const [name, v] of qv) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, v));
for (const [name, v] of pv) tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, v));
const res = new THREE.AnimationClip(clipName, clip.duration, tracks);
writeFileSync(out, JSON.stringify(THREE.AnimationClip.toJSON(res)));
console.log(`ok: ${tracks.length} trilhas, ${n} quadros, ${clip.duration.toFixed(2)} s; quadril x ${rangeX.map((x) => x.toFixed(2))} z ${rangeZ.map((x) => x.toFixed(2))}; dedo do pé mais baixo ${minY.toFixed(3)} m`);
