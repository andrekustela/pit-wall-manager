// Pódio em 3D (Three.js): os três pilotos do Blender (public/piloto/piloto.glb, com esqueleto) com o
// uniforme da equipe, em cima dos degraus, comemorando: o 1º com os braços em V, o 2º e o 3º batendo palmas. Câmera girando devagar, holofotes e confete.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export interface PodiumDriver {
  name: string;
  suit: string;
  detail: string;
  helmet: string;
  team: string;
  teamColor: string;
}

type Pose = "win" | "wave" | "clap";

let modelP: Promise<THREE.Object3D> | null = null;
function loadModel() {
  if (!modelP) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    modelP = loader.loadAsync("/piloto/piloto.glb").then((g) => g.scene);
  }
  return modelP;
}

/** placa com texto (número do degrau, nome do GP) */
function textTexture(text: string, w: number, h: number, font: string, color: string, bg = "rgba(0,0,0,0)") {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Monta o pódio no canvas. Devolve uma função que para tudo e libera a memória
 * (ou lança erro se não tiver WebGL: aí quem chamou usa o pódio 2D).
 */
export async function mountPodium3d(canvas: HTMLCanvasElement, drivers: (PodiumDriver | null)[], title: string): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#070a12");
  scene.fog = new THREE.Fog("#070a12", 14, 30);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);

  // ---- luzes ----
  scene.add(new THREE.HemisphereLight("#9fb4ff", "#1a1208", 0.55));
  const key = new THREE.DirectionalLight("#ffffff", 1.4);
  key.position.set(3, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.05;
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -2;
  scene.add(key);
  const spots: THREE.SpotLight[] = [];
  for (const [x, col] of [
    [-4, "#ffe2a8"],
    [0, "#ffffff"],
    [4, "#a8c8ff"],
  ] as const) {
    const s = new THREE.SpotLight(col, 40, 22, 0.32, 0.6, 1.4);
    s.position.set(x, 9, 3);
    scene.add(s, s.target);
    spots.push(s);
  }

  // ---- chão, fundo e degraus ----
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ color: "#151a26", roughness: 0.35, metalness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wallTex = textTexture(title, 2048, 256, "700 120px Oswald, sans-serif", "#f2f4f8", "#141b2c");
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.75), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8 }));
  wall.position.set(0, 3.95, -3.2);
  scene.add(wall);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 0.05), new THREE.MeshStandardMaterial({ color: "#e8202a", emissive: "#e8202a", emissiveIntensity: 0.6 }));
  stripe.position.set(0, 3.03, -3.18);
  scene.add(stripe);
  // torcida: fileiras de "cabeças" no escuro, lá atrás
  const crowdGeo = new THREE.SphereGeometry(0.13, 6, 4);
  const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ color: "#121725", roughness: 1 }), 600);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 600; i++) {
    const row = i % 6;
    m4.makeTranslation(-12 + Math.random() * 24, 0.3 + row * 0.38, -4.2 - row * 0.55);
    crowd.setMatrixAt(i, m4);
  }
  scene.add(crowd);

  const slots: { d: PodiumDriver | null; x: number; h: number; n: string; metal: string; pose: Pose }[] = [
    { d: drivers[1], x: -1.85, h: 0.75, n: "2", metal: "#c9d0db", pose: "wave" },
    { d: drivers[0], x: 0, h: 1.1, n: "1", metal: "#e2b94b", pose: "win" },
    { d: drivers[2], x: 1.85, h: 0.5, n: "3", metal: "#c48a52", pose: "clap" },
  ];
  for (const s of slots) {
    if (!s.d) continue;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, s.h, 1.5), new THREE.MeshStandardMaterial({ color: s.metal, metalness: 0.75, roughness: 0.3 }));
    box.position.set(s.x, s.h / 2, 0);
    box.castShadow = box.receiveShadow = true;
    scene.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.06, 1.52), new THREE.MeshStandardMaterial({ color: s.d.teamColor, emissive: s.d.teamColor, emissiveIntensity: 0.3 }));
    band.position.set(s.x, s.h - 0.026, 0); // (topo 4 mm acima do degrau: no mesmo plano as duas superfícies brigavam)
    scene.add(band);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9 * Math.min(1, s.h / 0.9)), new THREE.MeshBasicMaterial({ map: textTexture(s.n, 256, 256, "700 200px Oswald, sans-serif", "#10131a"), transparent: true }));
    num.position.set(s.x, s.h * 0.45, 0.76);
    scene.add(num);
  }

  // ---- pilotos ----
  const victoryP = fetch("/piloto/victory.json")
    .then((r) => r.json())
    .then((j) => THREE.AnimationClip.parse(j))
    .catch(() => null);
  const base = await loadModel();
  const victory = await victoryP;
  const people: {
    root: THREE.Object3D;
    pose: Pose;
    bones: Record<string, THREE.Bone>;
    rest: Map<THREE.Bone, THREE.Quaternion>;
    y: number;
    phase: number;
    mixer: THREE.AnimationMixer | null;
    arms: { sg: number; up: THREE.Bone; fo: THREE.Bone; hand: THREE.Bone; L1: number; L2: number; handBasisInv: THREE.Matrix4 }[];
    face: THREE.Vector3;
    headPos: THREE.Vector3;
  }[] = [];
  for (const s of slots) {
    if (!s.d) continue;
    const root = SkeletonUtils.clone(base);
    const col = { macacao: s.d.suit, faixa: s.d.detail, casco: s.d.helmet } as Record<string, string>;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        if (col[c.name]) c.color.set(col[c.name]);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    });
    root.position.set(s.x, s.h, 0);
    scene.add(root);
    const bones: Record<string, THREE.Bone> = {};
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    });
    const rest = new Map<THREE.Bone, THREE.Quaternion>();
    for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
    const mixer = s.pose === "win" && victory ? new THREE.AnimationMixer(root) : null;
    mixer?.clipAction(victory!).play();
    // braços pra IK: comprimentos e a palma (no espaço da mão) de cada lado
    root.updateMatrixWorld(true);
    const B = (n: string) => bones[THREE.PropertyBinding.sanitizeNodeName(n)];
    const arms = (["L", "R"] as const).map((sd) => {
      const sg = sd === "L" ? 1 : -1;
      const up = B(`DEF-upper_arm.${sd}`), fo = B(`DEF-forearm.${sd}`), hand = B(`DEF-hand.${sd}`);
      const wp = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
      const F = wp(B(`DEF-f_middle.01.${sd}`)).sub(wp(hand)).normalize();
      const A = wp(B(`DEF-f_pinky.01.${sd}`)).sub(wp(B(`DEF-f_index.01.${sd}`))).normalize();
      const N = F.clone().cross(A).multiplyScalar(-sg).normalize();
      const Nl = N.applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert());
      const Yl = new THREE.Vector3(0, 1, 0);
      const Nlp = Nl.addScaledVector(Yl, -Nl.dot(Yl)).normalize();
      const handBasisInv = new THREE.Matrix4().makeBasis(Nlp, Yl, new THREE.Vector3().crossVectors(Nlp, Yl)).invert();
      return { sg, up, fo, hand, L1: wp(fo).distanceTo(wp(up)), L2: wp(hand).distanceTo(wp(fo)), handBasisInv };
    });
    // pra onde o rosto aponta, no espaço da cabeça (no repouso o modelo olha uns 30° pra baixo)
    const faceW = new THREE.Vector3(0, -Math.sin(0.5), Math.cos(0.5));
    const face = faceW.applyQuaternion(B("DEF-spine.006").getWorldQuaternion(new THREE.Quaternion()).invert());
    people.push({ root, pose: s.pose, bones, rest, y: s.h, phase: Math.random() * 6, mixer, arms, face, headPos: B("DEF-spine.006").position.clone() });
  }

  const qb = new THREE.Quaternion(), vf = new THREE.Vector3(), m4b = new THREE.Matrix4(), rootQ = new THREE.Quaternion();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const setWorldQ = (b: THREE.Bone, q: THREE.Quaternion) => {
    b.parent!.getWorldQuaternion(qb);
    b.quaternion.copy(qb.invert().multiply(q));
    b.updateMatrixWorld(true);
  };
  const frameQ = (X: THREE.Vector3, Y: THREE.Vector3, Z: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(m4b.makeBasis(X, Y, Z));
  type Arm = (typeof people)[number]["arms"][number];
  /**
   * Braço por IK de dois ossos (tudo no mundo): o punho vai pro alvo W, o cotovelo pro lado do `pole`,
   * dobrando só na dobradiça (o X do osso, que no repouso do esqueleto é o eixo do cotovelo); a mão
   * com os dedos pra F e a palma pra N.
   */
  const armIK = (a: Arm, W: THREE.Vector3, pole: THREE.Vector3, F: THREE.Vector3, N: THREE.Vector3) => {
    const S = a.up.getWorldPosition(new THREE.Vector3());
    const D = W.clone().sub(S);
    const d = Math.min(D.length(), (a.L1 + a.L2) * 0.999);
    D.normalize();
    const cosA = Math.max(-1, Math.min(1, (a.L1 * a.L1 + d * d - a.L2 * a.L2) / (2 * a.L1 * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const P = pole.clone().addScaledVector(D, -pole.dot(D)).normalize();
    const E = S.clone().addScaledVector(D, a.L1 * cosA).addScaledVector(P, a.L1 * sinA);
    const u = E.clone().sub(S).normalize();
    const f = S.clone().addScaledVector(D, d).sub(E).normalize();
    const Z = f.clone().addScaledVector(u, -f.dot(u));
    if (Z.lengthSq() < 1e-6) Z.copy(P).negate();
    Z.normalize();
    const X = new THREE.Vector3().crossVectors(u, Z);
    setWorldQ(a.up, frameQ(X, u, Z));
    setWorldQ(a.fo, frameQ(X, f, new THREE.Vector3().crossVectors(X, f)));
    const Yw = F.clone().normalize();
    const Nw = N.clone().addScaledVector(Yw, -N.dot(Yw)).normalize();
    const Rw = new THREE.Matrix4().makeBasis(Nw, Yw, new THREE.Vector3().crossVectors(Nw, Yw)).multiply(a.handBasisInv);
    setWorldQ(a.hand, new THREE.Quaternion().setFromRotationMatrix(Rw));
  };
  // gira o osso no mundo em volta de um eixo (na base dele)
  const qt = new THREE.Quaternion(), qa = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0);

  /**
   * Deixa o rosto na horizontal (+ `up` rad pra cima). Gira a cabeça em volta de um ponto na altura das
   * orelhas, como numa pessoa (em volta da base do pescoço o capacete afundava pra trás, na gola).
   * O capacete fica num osso à parte: copia a cabeça no fim.
   */
  const hm = new THREE.Matrix4(), pv = new THREE.Vector3(), bp = new THREE.Vector3();
  const levelHead = (p: (typeof people)[number], up: number) => {
    const bone = (n: string) => p.bones[THREE.PropertyBinding.sanitizeNodeName(n)];
    const head = bone("DEF-spine.006"), helm = bone("ORG-spine.006");
    if (!head?.parent) return;
    head.getWorldQuaternion(qa);
    const f = p.face.clone().applyQuaternion(qa);
    const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    const axis = new THREE.Vector3().crossVectors(f, UPV);
    if (axis.lengthSq() < 1e-6) return;
    axis.normalize();
    const ang = up - pitch;
    head.position.copy(p.headPos);
    head.updateMatrixWorld(true);
    head.getWorldPosition(bp);
    pv.set(0, 0.09, 0).applyQuaternion(qa).add(bp);
    qt.setFromAxisAngle(axis, ang);
    bp.sub(pv).applyQuaternion(qt).add(pv);
    head.parent.getWorldQuaternion(qb);
    head.quaternion.copy(qb.invert().multiply(qt.clone().multiply(qa)));
    head.position.copy(head.parent.worldToLocal(bp.clone()));
    head.updateMatrixWorld(true);
    if (helm?.parent) {
      hm.copy(helm.parent.matrixWorld).invert().multiply(head.matrixWorld).decompose(helm.position, helm.quaternion, helm.scale);
      helm.updateMatrixWorld(true);
    }
  };



  // ---- confete ----
  const CONF = 420;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.035), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF);
  const palette = [...drivers.flatMap((d) => (d ? [d.teamColor, d.suit] : [])), "#ffd23b", "#ffffff", "#ffd23b"];
  const conf = Array.from({ length: CONF }, (_, i) => {
    confetti.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    return { p: V(-7 + Math.random() * 14, Math.random() * 9, -2 + Math.random() * 5), r: V(Math.random() * 6, Math.random() * 6, 0), v: 0.5 + Math.random() * 0.8 };
  });
  scene.add(confetti);

  // ---- laço ----
  const resize = () => {
    const w = canvas.clientWidth || 960, h = canvas.clientHeight || 540;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const t0 = performance.now();
  let last = t0;
  const dummy = new THREE.Object3D();
  renderer.setAnimationLoop((now) => {
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // câmera: chega de longe e fica girando devagar
    const intro = Math.min(1, t / 3), ease = 1 - Math.pow(1 - intro, 3);
    const ang = Math.sin(t * 0.18) * 0.35;
    const dist = 13 - 4.2 * ease;
    camera.position.set(Math.sin(ang) * dist, 2.4 + 1.2 * (1 - ease), Math.cos(ang) * dist);
    camera.lookAt(0, 1.75, 0);
    spots.forEach((s, i) => s.target.position.set(Math.sin(t * 0.7 + i * 2) * 3, 0, Math.cos(t * 0.5 + i) * 1.5));

    for (const p of people) {
      // olha um pouco pra câmera
      p.root.rotation.y = Math.sin(t * 0.18) * 0.2;
      p.root.position.y = p.y;
      const B = (n: string) => p.bones[THREE.PropertyBinding.sanitizeNodeName(n)];
      if (p.mixer) {
        // vencedor: a comemoração do Mixamo passada pro piloto (scripts/retarget.ts)
        p.mixer.update(dt);
        p.root.updateMatrixWorld(true);
      } else {
        for (const [b, q] of p.rest) b.quaternion.copy(q);
        p.root.updateMatrixWorld(true);
        p.root.getWorldQuaternion(rootQ);
        // batendo palmas: cotovelos junto do corpo, as mãos se encontram na frente do peito, palma com palma
        // (a palma para encostada na outra: nunca atravessa)
        const ph = (t * (p.pose === "wave" ? 2.1 : 2.5) + p.phase) % 1;
        const open = Math.pow(Math.sin(Math.PI * ph), 0.7);
        for (const a of p.arms) {
          const sg = a.sg;
          const toW = (v: THREE.Vector3) => p.root.localToWorld(v);
          const dirW = (v: THREE.Vector3) => v.normalize().applyQuaternion(rootQ);
          const F = dirW(V(-sg * 0.1, 0.6, 0.8));
          const N = dirW(V(-sg, 0.1, -0.3 * open));
          const C = toW(V(sg * (0.03 + 0.1 * open), 1.13 + 0.015 * open, 0.34 - 0.02 * open));
          armIK(a, C.addScaledVector(F, -0.065), dirW(V(sg * 0.5, -0.6, -0.6)), F, N);
        }
      }
      // olhando pra frente: mede pra onde o rosto aponta e acerta a inclinação (cabeça e capacete juntos)
      levelHead(p, p.mixer ? 0.22 : 0.14);
      // pé no degrau: mede onde ficaram os pés e acerta a altura do corpo (nunca atravessa)
      let low = Infinity;
      for (const n of ["DEF-toe.L", "DEF-toe.R", "DEF-foot.L", "DEF-foot.R"]) {
        const b = B(n);
        if (!b) continue;
        b.getWorldPosition(vf);
        low = Math.min(low, vf.y - (n.includes("toe") ? 0.02 : 0.13));
      }
      if (Number.isFinite(low)) p.root.position.y = p.y + (p.y - low);
    }
    for (let i = 0; i < CONF; i++) {
      const c = conf[i];
      c.p.y -= c.v * dt;
      c.p.x += Math.sin(t + i) * 0.2 * dt;
      c.r.x += dt * 3;
      c.r.y += dt * 2;
      if (c.p.y < 0) c.p.y = 9;
      dummy.position.copy(c.p);
      dummy.rotation.set(c.r.x, c.r.y, 0);
      dummy.updateMatrix();
      confetti.setMatrixAt(i, dummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const x of mats) {
        (x as THREE.MeshStandardMaterial).map?.dispose();
        x.dispose();
      }
    });
    renderer.dispose();
  };
}
