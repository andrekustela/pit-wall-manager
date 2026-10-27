// Relevo do autódromo 3D (Editor > Autódromo 3D > RELEVO): uma grade de alturas (um ponto a cada 8 m) que o
// pincel sobe, desce, suaviza ou nivela. Tudo do autódromo (chão, pista, zebras, prédios, peças) é levantado
// na placa de vídeo pela altura do lugar onde está, e os carros pela mesma conta; a corrida (física, tempos)
// continua a mesma. Mundo da pista (x, y) -> Three (X = x, Z = y), Y pra cima.
import * as THREE from "three";

export type BrushMode = "subir" | "descer" | "suavizar" | "nivelar";

export class Terrain {
  h: Float32Array;
  private half: Uint16Array<ArrayBuffer>;
  tex: THREE.DataTexture;
  uniforms: { tHeight: { value: THREE.DataTexture }; tOrigin: { value: THREE.Vector2 }; tSize: { value: THREE.Vector2 } };

  constructor(
    public x0: number,
    public z0: number,
    public cell: number,
    public nx: number,
    public nz: number,
    h?: Float32Array,
  ) {
    this.h = h ?? new Float32Array(nx * nz);
    this.half = new Uint16Array(nx * nz);
    this.tex = new THREE.DataTexture(this.half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms = {
      tHeight: { value: this.tex },
      // (o centro do primeiro ponto cai no centro do primeiro pixel)
      tOrigin: { value: new THREE.Vector2(x0 - cell / 2, z0 - cell / 2) },
      tSize: { value: new THREE.Vector2(nx * cell, nz * cell) },
    };
    this.upload();
  }

  /** a grade em volta da pista (com folga), tudo plano */
  static around(x0: number, z0: number, x1: number, z1: number, margin = 600, cell = 8) {
    const ax = Math.floor((x0 - margin) / cell) * cell, az = Math.floor((z0 - margin) / cell) * cell;
    return new Terrain(ax, az, cell, Math.ceil((x1 - x0 + 2 * margin) / cell) + 1, Math.ceil((z1 - z0 + 2 * margin) / cell) + 1);
  }

  /** tem algum morro? (sem: nem liga o relevo, não pesa nada) */
  get flat() {
    for (let i = 0; i < this.h.length; i++) if (Math.abs(this.h[i]) > 0.01) return false;
    return true;
  }

  upload() {
    for (let i = 0; i < this.h.length; i++) this.half[i] = THREE.DataUtils.toHalfFloat(this.h[i]);
    this.tex.needsUpdate = true;
  }

  /** altura num ponto do mundo (mesma conta da placa de vídeo) */
  heightAt(x: number, z: number) {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.max(0, Math.min(this.nx - 1.001, fx)), j = Math.max(0, Math.min(this.nz - 1.001, fz));
    const i0 = Math.floor(i), j0 = Math.floor(j), tx = i - i0, tz = j - j0;
    const at = (a: number, b: number) => this.h[b * this.nx + a];
    return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - tz) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * tz;
  }

  /** passa o pincel (r em metros; força em metros por passada no centro) */
  brush(x: number, z: number, r: number, force: number, mode: BrushMode, level = 0) {
    const c = this.cell, i0 = Math.max(0, Math.floor((x - r - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x + r - this.x0) / c));
    const j0 = Math.max(0, Math.floor((z - r - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z + r - this.z0) / c));
    const old = mode === "suavizar" ? this.h.slice() : null;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(this.x0 + i * c - x, this.z0 + j * c - z) / r;
        if (d >= 1) continue;
        // (borda macia: cosseno)
        const w = 0.5 + 0.5 * Math.cos(d * Math.PI);
        const k = j * this.nx + i;
        if (mode === "subir") this.h[k] += force * w;
        else if (mode === "descer") this.h[k] -= force * w;
        else if (mode === "nivelar") this.h[k] += (level - this.h[k]) * Math.min(1, w * 0.5);
        else {
          let s = 0, n = 0;
          for (let b = -1; b <= 1; b++)
            for (let a = -1; a <= 1; a++) {
              const ii = i + a, jj = j + b;
              if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
              s += old![jj * this.nx + ii];
              n++;
            }
          this.h[k] += (s / n - this.h[k]) * Math.min(1, w * 0.6);
        }
      }
    this.upload();
  }

  // ---- guardar (base64 de décimos de metro) ----
  toJson() {
    const q = new Int16Array(this.h.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.max(-32000, Math.min(32000, Math.round(this.h[i] * 10)));
    const bytes = new Uint8Array(q.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { x0: this.x0, z0: this.z0, cell: this.cell, nx: this.nx, nz: this.nz, h: btoa(bin) };
  }
  static fromJson(d: { x0: number; z0: number; cell: number; nx: number; nz: number; h: string }) {
    const bin = atob(d.h), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const q = new Int16Array(bytes.buffer), h = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) h[i] = q[i] / 10;
    return new Terrain(d.x0, d.z0, d.cell, d.nx, d.nz, h);
  }
}

// ---- levantar tudo pela altura (no vertex shader de cada material) ----
const HEADER = `uniform sampler2D tHeight;
uniform vec2 tOrigin;
uniform vec2 tSize;`;
const LIFT_POINT = `{
  mat4 tM = modelMatrix;
  #ifdef USE_INSTANCING
    tM = modelMatrix * instanceMatrix;
  #endif
  vec4 tO = tM * vec4(0.0, 0.0, 0.0, 1.0);
  float tH = texture2D(tHeight, (tO.xz - tOrigin) / tSize).r;
  transformed.y += tH / max(0.0001, length(tM[1].xyz));
}`;
const LIFT = `{
  mat4 tM = modelMatrix;
  #ifdef USE_INSTANCING
    tM = modelMatrix * instanceMatrix;
  #endif
  vec4 tW = tM * vec4(transformed, 1.0);
  float tH = texture2D(tHeight, (tW.xz - tOrigin) / tSize).r;
  transformed.y += tH / max(0.0001, length(tM[1].xyz));
}`;
/** point: a peça inteira sobe pela altura do lugar dela (não entorta); senão cada ponto pela sua (chão, pista) */
function patch(m: THREE.Material, t: Terrain, point = false) {
  if (m.userData.terrain === t) return;
  m.userData.terrain = t;
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, t.uniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${HEADER}`).replace("#include <begin_vertex>", `#include <begin_vertex>\n${point ? LIFT_POINT : LIFT}`);
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + (point ? "|relevo-p" : "|relevo");
  m.needsUpdate = true;
}
let depthMat: THREE.MeshDepthMaterial | null = null, depthP: THREE.MeshDepthMaterial | null = null;
let distMat: THREE.MeshDistanceMaterial | null = null, distP: THREE.MeshDistanceMaterial | null = null;
/** põe o relevo em tudo dentro de `root` (dá pra chamar de novo depois de refazer peças: só mexe no que falta) */
export function applyTerrain(root: THREE.Object3D, t: Terrain) {
  if (!depthMat || depthMat.userData.terrain !== t) {
    depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    distMat = new THREE.MeshDistanceMaterial();
    depthP = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    distP = new THREE.MeshDistanceMaterial();
    patch(depthMat, t);
    patch(distMat, t);
    patch(depthP, t, true);
    patch(distP, t, true);
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // (peças e prédios sobem inteiros; chão, pista e linhas acompanham ponto a ponto)
    const point = !!(m as THREE.InstancedMesh).isInstancedMesh || !!m.userData.liftPoint;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) patch(mat, t, point);
    // (a sombra também sai do lugar levantado)
    m.customDepthMaterial = point ? depthP! : depthMat!;
    m.customDistanceMaterial = point ? distP! : distMat!;
  });
}

/** o chão de base: além de subir, a luz segue a inclinação (senão o morro some, tudo com a mesma cor) */
export function shadeGround(m: THREE.Material, t: Terrain) {
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, t.uniforms, { tCell: { value: t.cell } });
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float tCell;").replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
      {
        vec4 gW = modelMatrix * vec4(position, 1.0);
        vec2 gU = (gW.xz - tOrigin) / tSize, gD = vec2(tCell) / tSize;
        float hx = texture2D(tHeight, gU + vec2(gD.x, 0.0)).r - texture2D(tHeight, gU - vec2(gD.x, 0.0)).r;
        float hz = texture2D(tHeight, gU + vec2(0.0, gD.y)).r - texture2D(tHeight, gU - vec2(0.0, gD.y)).r;
        vec3 n = normalize(vec3(-hx / (2.0 * tCell), 1.0, -hz / (2.0 * tCell)));
        // (o chão é um plano deitado: volta pro espaço dele)
        objectNormal = vec3(n.x, -n.z, n.y);
      }`,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + "|chao-relevo";
  m.needsUpdate = true;
}
