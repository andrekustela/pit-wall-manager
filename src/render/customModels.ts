// Modelos 3D importados no editor do autódromo (.glb): ficam guardados neste navegador (IndexedDB
// "pwm-modelos") e viram a peça "modelo" (v = o número do modelo). Os que vão no jogo pra todo mundo ficam
// em public/modelos/<número>.glb (o usuário manda o arquivo e eu copio). Só desenho: não muda a corrida.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export interface ModelPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  shadow?: boolean;
}
interface Stored {
  id: number;
  name: string;
  data: ArrayBuffer;
}

const models = new Map<number, { name: string; parts: ModelPart[] }>();

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open("pwm-modelos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("m", { keyPath: "id" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, fail) => {
    const req = fn(d.transaction("m", mode).objectStore("m"));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

/** número do modelo pelo nome e tamanho do arquivo (o mesmo arquivo dá o mesmo número em qualquer PC) */
function idOf(name: string, size: number) {
  let h = 2166136261;
  for (const ch of `${name}:${size}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 1e9;
}

/** o modelo em peças: em pé no chão (y = 0) e com o meio na origem; metros como vieram do arquivo */
async function parse(data: ArrayBuffer): Promise<ModelPart[]> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  const parts: ModelPart[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld).translate(-c.x, -box.min.y, -c.z);
    parts.push({ geo, mat: m.material, shadow: true });
  });
  return parts;
}

/** garante que os modelos destes números estão prontos (do navegador ou de public/modelos) */
export async function loadModels(ids: number[]) {
  for (const id of new Set(ids)) {
    if (models.has(id)) continue;
    try {
      let s: Stored | undefined = await store<Stored | undefined>("readonly", (st) => st.get(id) as IDBRequest<Stored | undefined>);
      if (!s) {
        const r = await fetch(`/modelos/${id}.glb`);
        if (r.ok) s = { id, name: `modelo ${id}`, data: await r.arrayBuffer() };
      }
      if (s) models.set(id, { name: s.name, parts: await parse(s.data) });
    } catch (e) {
      console.warn("modelo 3D", id, e);
    }
  }
}

/** importa um .glb: guarda no navegador e já deixa pronto; devolve o número */
export async function addModelFile(file: File) {
  const data = await file.arrayBuffer();
  const id = idOf(file.name, file.size);
  const parts = await parse(data);
  if (!parts.length) throw new Error("o arquivo não tem nenhuma malha");
  await store("readwrite", (st) => st.put({ id, name: file.name.replace(/\.glb$/i, ""), data } satisfies Stored));
  models.set(id, { name: file.name.replace(/\.glb$/i, ""), parts });
  return id;
}

/** os modelos guardados neste navegador */
export async function listModels(): Promise<{ id: number; name: string }[]> {
  try {
    const all = await store<Stored[]>("readonly", (st) => st.getAll() as IDBRequest<Stored[]>);
    return all.map((s) => ({ id: s.id, name: s.name }));
  } catch {
    return [];
  }
}

export async function deleteModel(id: number) {
  await store("readwrite", (st) => st.delete(id));
  models.delete(id);
}

export const modelName = (id: number) => models.get(id)?.name ?? `modelo ${id}`;

let missing: ModelPart[] | null = null;
/** as peças do modelo (sem ele: uma caixa rosa de 2 m, pra ver que falta o arquivo) */
export function modelParts(id: number): ModelPart[] {
  return (
    models.get(id)?.parts ??
    (missing ??= [{ geo: new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0), mat: new THREE.MeshLambertMaterial({ color: "#ff3bd0" }) }])
  );
}
