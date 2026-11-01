// Partículas 3D das câmeras inclinadas: nuvens (fumaça, poeira) como quadradinhos sempre de frente pra câmera,
// com textura macia — ficam ATRÁS dos carros e das barreiras quando devem (desenhadas por cima da tela não ficavam)
// e crescem/somem com a idade. Uma malha só pra todas (instâncias), ordenadas de trás pra frente.
import * as THREE from "three";

/** nuvem macia em tons de branco (a cor de cada partícula multiplica) */
let puffTex: THREE.CanvasTexture | null = null;
function puff() {
  if (puffTex) return puffTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 9; i++) {
    const x = 64 + (i ? (Math.random() - 0.5) * 44 : 0), y = 64 + (i ? (Math.random() - 0.5) * 44 : 0), r = i ? 22 + Math.random() * 18 : 58;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${i ? 0.42 : 0.62})`);
    gr.addColorStop(0.55, `rgba(255,255,255,${i ? 0.2 : 0.3})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

export interface Billboard {
  x: number;
  /** altura (m) */
  y: number;
  z: number;
  /** tamanho (m) */
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  /** giro da textura (rad): nuvens iguais não ficam iguais */
  rot: number;
}

export class Billboards {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private off: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private sz: THREE.InstancedBufferAttribute;

  constructor(private max = 600) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    this.off = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.sz = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    for (const a of [this.off, this.col, this.sz]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aOff", this.off);
    this.geo.setAttribute("aCol", this.col);
    this.geo.setAttribute("aSz", this.sz);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: puff() } },
      vertexShader: `
        attribute vec3 aOff; attribute vec4 aCol; attribute vec2 aSz;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          // de frente pra câmera: os eixos de lado e pra cima da câmera, no mundo
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(aSz.y), s = sin(aSz.y);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aSz.x;
          vec3 w = aOff + right * q.x + up * q.y;
          vUv = uv; vCol = aCol;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uTex; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 t = texture2D(uTex, vUv);
          gl_FragColor = vec4(vCol.rgb * (0.82 + 0.18 * t.r), vCol.a * t.a);
          if (gl_FragColor.a < 0.004) discard;
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  /** as partículas deste quadro, já ordenadas de trás pra frente pela câmera `cam` */
  update(list: Billboard[], cam: THREE.Vector3) {
    const n = Math.min(list.length, this.max);
    list.sort((a, b) => (b.x - cam.x) ** 2 + (b.y - cam.y) ** 2 + (b.z - cam.z) ** 2 - ((a.x - cam.x) ** 2 + (a.y - cam.y) ** 2 + (a.z - cam.z) ** 2));
    const o = this.off.array as Float32Array, c = this.col.array as Float32Array, z = this.sz.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      o[i * 3] = p.x;
      o[i * 3 + 1] = p.y;
      o[i * 3 + 2] = p.z;
      c[i * 4] = p.r;
      c[i * 4 + 1] = p.g;
      c[i * 4 + 2] = p.b;
      c[i * 4 + 3] = p.a;
      z[i * 2] = p.size;
      z[i * 2 + 1] = p.rot;
    }
    this.geo.instanceCount = n;
    this.off.needsUpdate = this.col.needsUpdate = this.sz.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

/** "rgb(r,g,b)" ou "#rrggbb" em 0..1 */
export function rgbOf(c: string | undefined, fb: [number, number, number]): [number, number, number] {
  if (!c) return fb;
  if (c[0] === "#" && c.length >= 7) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : fb;
}
