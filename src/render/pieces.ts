// Peças do autódromo 3D que dá pra editar (Editor > Autódromo 3D): cada uma tem tipo, posição, giro, tamanho e cor.
// O posicionamento automático (track3d.ts) cria a lista; o editor mexe nela e salva por pista. Aqui elas
// viram InstancedMesh (uma malha por tipo e variante), e o editor acha qual peça foi clicada.
// Mundo da pista (x, y) -> Three (X = x, Z = y), Y pra cima. Só desenho: não muda nada da corrida.
import * as THREE from "three";
import type { PathItem } from "./paths3d";
import { Terrain } from "./terrain";
import { apartmentGeo, palaceGeo, hotelGeo, villaGeo, yachtGeo, sailboatGeo, cruiseGeo, pierGeo, lighthouseGeo, tunnelGeo, tyreBlockGeo, brakeBoardGeos, brakeBoardTex, pitLightGeo, inflatableArchGeo, hedgeGeo, rockGeo, toiletGeo, golfCartGeo, generatorGeo } from "./trackParts";
import { liveScreenTexture } from "./liveScreen";
import { ambulanceGeo, flowerBedGeo, jerseyGeo, photographerGeo, pitCrewGeo, sausageGeo } from "./trackParts";
import { modelParts } from "./customModels";
import { BRANDS, containerGeo, cratesGeo, flagpoleGeo, helipadGeo, marshalGeo, podiumGeo, screenGeo, truckGeo, tvTowerGeo, barrierGeo, billboardGeos, billboardTex, blob, bridgeGeo, busGeo, carGeo, coneGeo, crowdGeo, gantryGeo, garageTex, guardrailGeo, houseGeos, lampGeo, motorhomeGeo, palmGeo, pineGeo, standModule, stoneWallGeo, tallBuildingGeo, tentGeo, towerGeo, tyreStackGeo, waterTowerGeo } from "./trackParts";

export type PieceKind =
  | "arquibancada" | "torcida" | "box" | "torre" | "tenda" | "motorhome" | "onibus" | "pneu" | "barreira" | "guardrail" | "muro" | "cone"
  | "placa" | "poste" | "portico" | "passarela" | "arvore" | "pinheiro" | "palmeira" | "arbusto" | "casa" | "predio" | "caixadagua" | "carro" | "telao" | "bandeira" | "fiscal" | "cameratv" | "container" | "caminhao" | "podio" | "heliponto" | "caixas" | "freada" | "semaforo" | "arco" | "cercaviva" | "pedra" | "banheiro" | "golfe" | "gerador" | "blocopneus" | "apartamento" | "palacete" | "hotel" | "vila" | "iate" | "veleiro" | "cruzeiro" | "pier" | "farol" | "tunel" | "edificio" | "modelo" | "jersey" | "salsicha" | "ambulancia" | "fotografo" | "equipe" | "canteiro";

export interface Piece {
  k: PieceKind;
  x: number;
  z: number;
  /** giro em volta do eixo vertical (rad) */
  r: number;
  /** tamanho (1 = normal) */
  s?: number;
  /** medidas próprias (casa: comprimento, altura e largura em m) */
  sx?: number;
  sy?: number;
  sz?: number;
  /** cor principal e a segunda (casa: telhado) */
  c?: string;
  c2?: string;
  /** variante (placa: a marca; árvore: 0 detalhada, 1 simples) */
  v?: number;
  /** altura do chão (pra pôr em cima de prédio: heliponto, placa no teto...) */
  y?: number;
}

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  /** pinta com a cor da peça (1 = c, 2 = c2) */
  tint?: 1 | 2;
  shadow?: boolean;
  /** versão simples, desenhada no lugar desta quando a peça está longe da câmera (PieceLayer.lod) */
  far?: Part;
}
interface Def {
  label: string;
  /** cores padrão (a primeira é a de c, a segunda a de c2) */
  cores?: string[];
  /** quantas variantes (e o nome de cada) */
  variantes?: string[];
  parts: (v: number) => Part[];
}

const lam = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
/** material de quem já vem com a cor nos vértices */
const vc = (extra: THREE.MeshLambertMaterialParameters = {}) => lam("#ffffff", { vertexColors: true, ...extra });
const trunkGeo = (h: number) => new THREE.CylinderGeometry(0.144, 0.234, h, 5, 1, true).translate(0, h / 2, 0);

export const PIECES: Record<PieceKind, Def> = {
  arquibancada: {
    label: "Arquibancada",
    // v: 0-3 o tipo; +4 com torcida (e +8/+16 sorteiam quem senta onde: `standV`)
    variantes: ["Com cobertura", "Sem cobertura", "Sobre pilares, com cobertura", "Sobre pilares, sem cobertura"],
    parts: (v) => {
      const kind = v & 3, lift = kind >= 2 ? 4 : 0;
      const out: Part[] = [{ geo: standModule(undefined, undefined, kind % 2 === 0, lift), mat: lam("#ffffff", { vertexColors: true, flatShading: true, side: THREE.DoubleSide }), shadow: true }];
      if (v & 4) out.push({ geo: crowdGeo(23 + (v >> 3), lift), mat: vc(), shadow: true, far: { geo: crowdGeo(23 + (v >> 3), lift, true), mat: vc() } });
      return out;
    },
  },
  torcida: { label: "Torcida", parts: () => [{ geo: crowdGeo(), mat: vc(), shadow: true, far: { geo: crowdGeo(23, 0, true), mat: vc() } }] },
  box: {
    label: "Box (garagem)",
    parts: () => {
      const white = lam("#f4f4f2");
      return [
        { geo: new THREE.BoxGeometry(6.2, 11, 14).translate(0, 5.5, 7), mat: [white, white, white, white, white, lam("#ffffff", { map: garageTex() })], shadow: true },
        // telhado marrom passando um pouco da frente
        { geo: new THREE.BoxGeometry(6.25, 0.7, 16).translate(0, 11.35, 7), mat: lam("#a5653b"), shadow: true },
      ];
    },
  },
  torre: { label: "Torre de controle", parts: () => [{ geo: towerGeo(), mat: lam("#ffffff", { vertexColors: true, flatShading: true }), shadow: true }] },
  tenda: { label: "Tenda", parts: () => [{ geo: tentGeo(), mat: lam("#ffffff", { vertexColors: true, flatShading: true, side: THREE.DoubleSide }), shadow: true }] },
  motorhome: { label: "Motorhome", cores: ["#ffffff"], parts: () => [{ geo: motorhomeGeo(), mat: lam("#ffffff", { vertexColors: true }), tint: 1, shadow: true }] },
  blocopneus: { label: "Bloco de pneus", cores: ["#1c1c1c"], parts: () => [{ geo: tyreBlockGeo(), mat: vc(), tint: 1, shadow: true }] },
  pneu: { label: "Pneu (barreira)", cores: ["#1c1c1c"], parts: () => [{ geo: tyreStackGeo(), mat: lam("#ffffff"), tint: 1, shadow: true }] },
  placa: {
    label: "Placa",
    variantes: BRANDS.map((b) => b[0]),
    parts: (v) => {
      const bg = billboardGeos();
      return [
        { geo: bg.posts, mat: lam("#59606a"), shadow: true },
        { geo: bg.face, mat: lam("#ffffff", { map: billboardTex(v) }) },
      ];
    },
  },
  arvore: {
    label: "Árvore",
    cores: ["#4a8a2c"],
    variantes: ["Detalhada", "Simples (leve)"],
    parts: (v) => [
      { geo: trunkGeo(1.1), mat: lam("#7a5a3c") },
      {
        geo: blob(v === 1 ? 0 : 1).translate(0, 1.55, 0),
        mat: lam("#ffffff", { flatShading: true }),
        tint: 1,
        shadow: true,
        // (a detalhada vira a simples de longe: 20 triângulos em vez de 80)
        ...(v === 1 ? {} : { far: { geo: blob(0).translate(0, 1.55, 0), mat: lam("#ffffff", { flatShading: true }), shadow: true } }),
      },
    ],
  },
  pinheiro: {
    label: "Pinheiro",
    cores: ["#24561f"],
    parts: () => [
      { geo: trunkGeo(1.4), mat: lam("#7a5a3c") },
      { geo: pineGeo().scale(0.95, 2.2, 0.95).translate(0, 0.5, 0), mat: lam("#ffffff", { flatShading: true }), tint: 1, shadow: true },
    ],
  },
  casa: {
    label: "Casa",
    cores: ["#f5f1e8", "#e46a24"],
    parts: () => {
      const { walls, roof } = houseGeos();
      return [
        { geo: walls, mat: lam("#ffffff"), tint: 1, shadow: true },
        { geo: roof.scale(1.06, 0.6, 1.14).translate(0, 1, 0), mat: lam("#ffffff", { flatShading: true }), tint: 2, shadow: true },
      ];
    },
  },
  onibus: { label: "Ônibus", cores: ["#f2f2f2"], parts: () => [{ geo: busGeo(), mat: vc(), tint: 1, shadow: true }] },
  barreira: { label: "Barreira vermelha e branca", parts: () => [{ geo: barrierGeo(), mat: vc(), shadow: true }] },
  guardrail: { label: "Guard-rail", parts: () => [{ geo: guardrailGeo(), mat: vc(), shadow: true }] },
  muro: { label: "Muro de pedra", parts: () => [{ geo: stoneWallGeo(), mat: vc(), shadow: true }] },
  cone: { label: "Cone", parts: () => [{ geo: coneGeo(), mat: vc() }] },
  poste: { label: "Poste de luz", parts: () => [{ geo: lampGeo(), mat: vc(), shadow: true }] },
  portico: { label: "Pórtico de largada", parts: () => [{ geo: gantryGeo(), mat: vc(), shadow: true }] },
  passarela: { label: "Passarela", parts: () => [{ geo: bridgeGeo(), mat: vc({ side: THREE.DoubleSide }), shadow: true }] },
  palmeira: { label: "Palmeira", parts: () => [{ geo: palmGeo(), mat: vc({ side: THREE.DoubleSide }), shadow: true }] },
  arbusto: { label: "Arbusto", cores: ["#3d7a26"], parts: () => [{ geo: blob(0).scale(1.6, 0.9, 1.6).translate(0, 0.75, 0), mat: lam("#ffffff", { flatShading: true }), tint: 1, shadow: true }] },
  predio: { label: "Prédio alto", cores: ["#e8d6a8"], parts: () => [{ geo: tallBuildingGeo(), mat: vc(), tint: 1, shadow: true }] },
  caixadagua: { label: "Caixa d'água", parts: () => [{ geo: waterTowerGeo(), mat: vc({ flatShading: true }), shadow: true }] },
  telao: {
    label: "Telão",
    parts: () => [
      { geo: screenGeo(), mat: vc(), shadow: true },
      // (a tela mostra a classificação ao vivo, sem luz nem sombra: brilha como uma tela)
      { geo: new THREE.PlaneGeometry(12, 6.8).rotateY(Math.PI).translate(0, 11.3, -0.57), mat: new THREE.MeshBasicMaterial({ map: liveScreenTexture(), toneMapped: false }) },
    ],
  },
  freada: {
    label: "Placa de freada",
    variantes: ["100 m", "200 m", "300 m"],
    parts: (v) => {
      const g = brakeBoardGeos();
      return [
        { geo: g.post, mat: lam("#59606a") },
        { geo: g.face, mat: lam("#ffffff", { map: brakeBoardTex((v + 1) * 100) }) },
      ];
    },
  },
  semaforo: { label: "Semáforo do box", parts: () => [{ geo: pitLightGeo(), mat: vc(), shadow: true }] },
  arco: { label: "Arco inflável", cores: ["#e32222"], parts: () => [{ geo: inflatableArchGeo(), mat: vc(), tint: 1, shadow: true }] },
  cercaviva: { label: "Cerca viva", parts: () => [{ geo: hedgeGeo(), mat: vc({ flatShading: true }), shadow: true }] },
  pedra: { label: "Pedra", cores: ["#8a8f94"], parts: () => [{ geo: rockGeo(), mat: lam("#ffffff", { flatShading: true }), tint: 1, shadow: true }] },
  banheiro: { label: "Banheiro químico", parts: () => [{ geo: toiletGeo(), mat: vc(), shadow: true }] },
  golfe: { label: "Carrinho de golfe", parts: () => [{ geo: golfCartGeo(), mat: vc(), shadow: true }] },
  gerador: { label: "Gerador", parts: () => [{ geo: generatorGeo(), mat: vc(), shadow: true }] },
  bandeira: { label: "Mastro com bandeira", cores: ["#18b04f"], parts: () => [{ geo: flagpoleGeo(), mat: vc({ side: THREE.DoubleSide }), tint: 1, shadow: true }] },
  fiscal: { label: "Posto de fiscal", parts: () => [{ geo: marshalGeo(), mat: vc(), shadow: true }] },
  cameratv: { label: "Torre de câmera de TV", parts: () => [{ geo: tvTowerGeo(), mat: vc(), shadow: true }] },
  container: { label: "Contêiner", cores: ["#1f5fbf"], parts: () => [{ geo: containerGeo(), mat: vc(), tint: 1, shadow: true }] },
  caminhao: { label: "Caminhão de equipe", cores: ["#d62b2b"], parts: () => [{ geo: truckGeo(), mat: vc(), tint: 1, shadow: true }] },
  podio: { label: "Pódio", parts: () => [{ geo: podiumGeo(), mat: vc(), shadow: true }] },
  heliponto: { label: "Heliponto", parts: () => [{ geo: helipadGeo(), mat: vc({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }) }] },
  caixas: { label: "Caixas e paletes", parts: () => [{ geo: cratesGeo(), mat: vc(), shadow: true }] },
  edificio: {
    label: "Construção modular",
    cores: ["#f1e2c6", "#c9c2b4"],
    variantes: ["Janelas", "Vidro (espelhado)", "Parede lisa"],
    parts: (v) => [
      { geo: wallsGeo(), mat: buildingMat(v), tint: 1, shadow: true },
      { geo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 1, 0), mat: lam("#ffffff"), tint: 2, shadow: true },
    ],
  },
  apartamento: {
    label: "Prédio de apartamentos",
    cores: ["#f1e2c6"],
    variantes: ["4 andares", "8 andares", "14 andares", "22 andares (fino)"],
    parts: (v) => [{ geo: v === 3 ? apartmentGeo(22, 12, 12) : apartmentGeo([4, 8, 14][v] ?? 4, v === 0 ? 12 : 16, 12), mat: vc(), tint: 1, shadow: true }],
  },
  palacete: { label: "Palacete clássico", parts: () => [{ geo: palaceGeo(), mat: vc({ flatShading: true }), shadow: true }] },
  hotel: { label: "Hotel", parts: () => [{ geo: hotelGeo(), mat: vc(), shadow: true }] },
  vila: { label: "Casa mediterrânea", cores: ["#f3d9b1"], parts: () => [{ geo: villaGeo(), mat: vc(), tint: 1, shadow: true }] },
  iate: { label: "Iate", cores: ["#ffffff"], variantes: ["Pequeno (14 m)", "Grande (40 m)"], parts: (v) => [{ geo: yachtGeo(v === 1), mat: vc({ side: THREE.DoubleSide }), tint: 1, shadow: true }] },
  veleiro: { label: "Veleiro", parts: () => [{ geo: sailboatGeo(), mat: vc({ side: THREE.DoubleSide }), shadow: true }] },
  cruzeiro: { label: "Navio de cruzeiro", parts: () => [{ geo: cruiseGeo(), mat: vc({ side: THREE.DoubleSide }), shadow: true }] },
  pier: { label: "Píer de madeira", parts: () => [{ geo: pierGeo(), mat: vc(), shadow: true }] },
  farol: { label: "Farol", parts: () => [{ geo: lighthouseGeo(), mat: vc({ flatShading: true }), shadow: true }] },
  tunel: { label: "Entrada de túnel", parts: () => [{ geo: tunnelGeo(), mat: vc(), shadow: true }] },
  jersey: { label: "Barreira de concreto", parts: () => [{ geo: jerseyGeo(), mat: vc(), shadow: true }] },
  salsicha: { label: "Zebra alta (salsicha)", parts: () => [{ geo: sausageGeo(), mat: vc(), shadow: true }] },
  ambulancia: { label: "Ambulância", parts: () => [{ geo: ambulanceGeo(), mat: vc(), shadow: true }] },
  fotografo: { label: "Fotógrafo", parts: () => [{ geo: photographerGeo(), mat: vc(), shadow: true }] },
  equipe: { label: "Equipe de box", cores: ["#d62b2b"], parts: () => [{ geo: pitCrewGeo(), mat: vc(), tint: 1, shadow: true }] },
  canteiro: { label: "Canteiro de flores", parts: () => [{ geo: flowerBedGeo(), mat: vc(), shadow: true }] },
  // (v = o número do modelo .glb importado: src/render/customModels.ts)
  modelo: { label: "Modelo 3D importado", parts: (v) => modelParts(v) },
  carro: { label: "Carro parado", cores: ["#d62b2b"], parts: () => [{ geo: carGeo(), mat: lam("#ffffff", { vertexColors: true }), tint: 1, shadow: true }] },
};

/** variante da arquibancada: tipo (0-3) e torcida (sorteia um dos 4 jeitos de sentar) */
export const standV = (kind: number, crowd: boolean, seed = Math.floor(Math.random() * 4)) => (kind & 3) | (crowd ? 4 | (seed << 3) : 0);

/** medidas padrão de cada tipo (as próprias da casa) */
export const DEFAULT_SIZE: Partial<Record<PieceKind, [number, number, number]>> = { casa: [8, 4, 7], edificio: [16, 12, 12] };

/** paredes de uma caixa 1×1×1 (sem o teto, que é outra parte, nem o fundo), origem no chão */
function wallsGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // (tira as faces de cima e de baixo: grupos 2 e 3 da caixa)
  const idx = g.index!.array, keep: number[] = [];
  for (const gr of g.groups) if (gr.materialIndex !== 2 && gr.materialIndex !== 3) for (let i = gr.start; i < gr.start + gr.count; i++) keep.push(idx[i]);
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

/**
 * Material das construções: as janelas são desenhadas no próprio material, em metros (uma a cada 3 m,
 * por andar), pelo tamanho de cada peça. Assim esticar ou pôr mais andares não deforma as janelas.
 * 0 = janelas (e vitrine no térreo), 1 = vidro espelhado com caixilhos, 2 = parede lisa.
 */
const bMats = new Map<number, THREE.Material>();
/** (com `color`: um material só desse prédio, pros desenhados pelo contorno) */
export function buildingMat(v: number, color?: string) {
  let m = color ? undefined : bMats.get(v);
  if (m) return m;
  const mm = lam(color ?? "#ffffff");
  if (v !== 2) {
    mm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBL;\nvarying vec3 vBN;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 bsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          #else
            vec3 bsc = vec3(1.0);
          #endif
          vBL = position * bsc;
          vBN = normal;`,
        );
      const paint =
        v === 1
          ? `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.36, 0.5), 0.85);
             if (fract(bu / 2.0) < 0.05 || fract(bv / 3.0) < 0.06) diffuseColor.rgb = vec3(0.82);`
          : `float fu = fract(bu / 3.0 + 0.5), fv = fract(bv / 3.0);
             if (bv > 2.9 && fu > 0.2 && fu < 0.8 && fv > 0.3 && fv < 0.8) diffuseColor.rgb = vec3(0.2, 0.27, 0.36);
             if (bv > 0.3 && bv < 2.5 && fu > 0.08 && fu < 0.92) diffuseColor.rgb = vec3(0.16, 0.21, 0.28);`;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBL;\nvarying vec3 vBN;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          float bu = abs(vBN.x) > 0.5 ? vBL.z : vBL.x;
          float bv = vBL.y;
          ${paint}`);
    };
    mm.customProgramCacheKey = () => `edificio${v}`;
  }
  if (!color) bMats.set(v, mm);
  return mm;
}

// geometrias e materiais feitos uma vez por tipo e variante (o editor refaz as malhas várias vezes)
const partCache = new Map<string, Part[]>();
const partsOf = (k: PieceKind, v: number) => {
  const key = `${k}:${v}`;
  let p = partCache.get(key);
  // (modelo importado: não guarda, ele pode chegar depois do primeiro desenho)
  if (k === "modelo") return PIECES[k].parts(v);
  if (!p) partCache.set(key, (p = PIECES[k].parts(v)));
  return p;
};

const tq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const tc = new THREE.Color();
/** matriz da peça no mundo */
export function pieceMatrix(p: Piece, out = new THREE.Matrix4()) {
  const s = p.s ?? 1;
  return out.compose(tv.set(p.x, p.y ?? 0, p.z), tq.setFromAxisAngle(UP, p.r), ts.set(s * (p.sx ?? 1), s * (p.sy ?? 1), s * (p.sz ?? 1)));
}

/** as peças desenhadas: uma InstancedMesh por tipo, variante e parte */
export class PieceLayer {
  group = new THREE.Group();
  meshes: THREE.InstancedMesh[] = [];
  /** pra cada malha, qual peça é cada instância */
  private owner = new Map<THREE.InstancedMesh, number[]>();
  /** pra cada peça, onde ela está: [malha, instância, tint, 0 = sempre / 1 = só de perto / 2 = só de longe] */
  private where: [THREE.InstancedMesh, number, 1 | 2 | undefined, 0 | 1 | 2][][] = [];
  private m4 = new THREE.Matrix4();
  /** peças com versão de longe, e se cada peça está sendo desenhada de perto (1) ou de longe (0) */
  private lodIds: number[] = [];
  private nearNow: Uint8Array = new Uint8Array(0);
  /**
   * malhas de perto (1) e de longe (2): só as instâncias que valem agora, uma atrás da outra, e `count` pra
   * desenhar só elas (instância de tamanho zero ainda passa pela placa de vídeo)
   */
  private lodMeshes = new Map<THREE.InstancedMesh, { ids: number[]; role: 1 | 2; tint?: 1 | 2 }>();

  constructor(
    public pieces: Piece[],
    private shadows: boolean,
  ) {
    this.rebuild();
  }

  /** refaz tudo (depois de pôr ou tirar peças) */
  rebuild() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.meshes = [];
    this.owner.clear();
    this.where = this.pieces.map(() => []);
    this.nearNow = new Uint8Array(this.pieces.length);
    this.lodIds = [];
    this.lodMeshes.clear();
    this.lodAt = null;
    const groups = new Map<string, number[]>();
    this.pieces.forEach((p, i) => {
      const key = `${p.k}:${p.v ?? 0}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(i);
    });
    for (const [key, ids] of groups) {
      const [k, v] = key.split(":");
      const parts = partsOf(k as PieceKind, Number(v));
      if (parts.some((p) => p.far)) this.lodIds.push(...ids);
      for (const part of parts) {
        const list: [Part, 0 | 1 | 2][] = part.far ? [[part, 1], [part.far, 2]] : [[part, 0]];
        for (const [pt, role] of list) {
          const im = new THREE.InstancedMesh(pt.geo, pt.mat, ids.length);
          im.castShadow = this.shadows && !!pt.shadow;
          im.receiveShadow = this.shadows;
          ids.forEach((pi, j) => this.where[pi].push([im, j, pt.tint ?? part.tint, role]));
          this.owner.set(im, ids);
          if (role) this.lodMeshes.set(im, { ids, role, tint: pt.tint ?? part.tint });
          this.meshes.push(im);
          this.group.add(im);
        }
      }
    }
    this.pieces.forEach((_, i) => this.write(i));
    for (const im of this.lodMeshes.keys()) this.refill(im);
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  private tintOf(p: Piece, tint: 1 | 2) {
    return tc.set((tint === 2 ? p.c2 : p.c) ?? PIECES[p.k].cores?.[tint - 1] ?? "#ffffff");
  }

  private write(i: number) {
    const p = this.pieces[i];
    pieceMatrix(p, this.m4);
    for (const [im, j, tint, role] of this.where[i]) {
      if (role) continue; // (as de perto/de longe: refill)
      im.setMatrixAt(j, this.m4);
      if (tint) im.setColorAt(j, this.tintOf(p, tint));
    }
  }

  /** malha de perto ou de longe: põe na frente só as peças que valem agora */
  private refill(im: THREE.InstancedMesh) {
    const lm = this.lodMeshes.get(im)!, vis: number[] = [];
    for (const pi of lm.ids) {
      if ((lm.role === 1) !== (this.nearNow[pi] === 1)) continue;
      const p = this.pieces[pi];
      im.setMatrixAt(vis.length, pieceMatrix(p, this.m4));
      if (lm.tint) im.setColorAt(vis.length, this.tintOf(p, lm.tint));
      vis.push(pi);
    }
    im.count = vis.length;
    // (o clique acha a peça pela posição da instância)
    this.owner.set(im, vis);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.boundingSphere = null;
  }

  /**
   * de perto ou de longe, pela distância até a câmera (com folga pra não ficar trocando na divisa).
   * Sem chamar: tudo de longe. dist = Infinity: tudo de perto (Configurações > Gráficos dos cenários 3D).
   */
  lod(cam: THREE.Vector3, dist: number) {
    // (só quando a câmera andou ou a distância mudou: são milhares de árvores)
    if (this.lodAt && this.lodAt.distanceToSquared(cam) < 4 && dist === this.lodDist) return;
    (this.lodAt ??= new THREE.Vector3()).copy(cam);
    this.lodDist = dist;
    const d2in = dist * dist, d2out = (dist * 1.15) ** 2;
    const dirty = new Set<THREE.InstancedMesh>();
    for (const i of this.lodIds) {
      const p = this.pieces[i], d2 = (p.x - cam.x) ** 2 + ((p.y ?? 0) - cam.y) ** 2 + (p.z - cam.z) ** 2;
      const was = this.nearNow[i], now = was ? d2 < d2out : d2 < d2in;
      if (now === !!was) continue;
      this.nearNow[i] = now ? 1 : 0;
      for (const [im, , , role] of this.where[i]) if (role) dirty.add(im);
    }
    for (const im of dirty) this.refill(im);
  }
  private lodAt: THREE.Vector3 | null = null;
  private lodDist = 0;

  /** a peça i mudou (posição, giro, tamanho ou cor) */
  update(i: number) {
    this.write(i);
    for (const [im, , , role] of this.where[i]) {
      if (role) {
        this.refill(im);
        continue;
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      // (a esfera serve pro clique e pro que aparece na tela: recalcula quando precisar)
      im.boundingSphere = null;
    }
  }

  /** qual peça é esta instância */
  pieceAt(mesh: THREE.Object3D, instanceId: number): number {
    return this.owner.get(mesh as THREE.InstancedMesh)?.[instanceId] ?? -1;
  }

  /** caixa da peça no mundo (pro destaque da seleção) */
  boxOf(i: number) {
    const box = new THREE.Box3();
    const m = pieceMatrix(this.pieces[i]);
    for (const [im] of this.where[i]) {
      if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
      box.union(im.geometry.boundingBox!.clone().applyMatrix4(m));
    }
    return box;
  }

  dispose() {
    for (const m of this.meshes) m.dispose();
  }
}

// ---- guardar por pista (no navegador) ----
const KEY = (slug: string) => `pwm.autodromo.${slug}`;
type Row = [PieceKind, number, number, number, number?, number?, number?, number?, string?, string?, number?, number?];
const r1 = (n: number) => Math.round(n * 10) / 10, r3 = (n: number) => Math.round(n * 1000) / 1000;

/** as peças salvas desta pista (null = usa o automático) */
export function loadPieces(slug: string): Piece[] | null {
  try {
    const raw = localStorage.getItem(KEY(slug));
    if (!raw) return null;
    const d = JSON.parse(raw) as { v: number; pecas: Row[] };
    return d.pecas.map(([k, x, z, r, s, sx, sy, sz, c, c2, v, y]) => ({ k, x, z, r, s: s ?? undefined, sx: sx ?? undefined, sy: sy ?? undefined, sz: sz ?? undefined, c: c ?? undefined, c2: c2 ?? undefined, v: v ?? undefined, y: y ?? undefined }));
  } catch {
    return null;
  }
}

export function piecesToJson(pieces: Piece[], paths: PathItem[] = [], terrain?: Terrain | null) {
  const rows: Row[] = pieces.map((p) => {
    const row: (string | number | null)[] = [p.k, r1(p.x), r1(p.z), r3(p.r), p.s ?? null, p.sx != null ? r1(p.sx) : null, p.sy != null ? r1(p.sy) : null, p.sz != null ? r1(p.sz) : null, p.c ?? null, p.c2 ?? null, p.v ?? null, p.y != null ? r1(p.y) : null];
    while (row.length > 4 && row[row.length - 1] === null) row.pop();
    return row as Row;
  });
  const linhas = paths.map((it) => ({ ...it, p: it.p.map(([x, z]) => [r1(x), r1(z)]) }));
  return JSON.stringify({ v: 1, pecas: rows, linhas, ...(terrain && !terrain.flat ? { relevo: terrain.toJson() } : {}) });
}

/** o relevo de um arquivo ou do que foi salvo (null = plano) */
export function terrainFromJson(text: string): Terrain | null {
  const d = JSON.parse(text) as { relevo?: Parameters<typeof Terrain.fromJson>[0] };
  return d.relevo ? Terrain.fromJson(d.relevo) : null;
}
export function loadTerrain(slug: string): Terrain | null | undefined {
  try {
    const raw = localStorage.getItem(KEY(slug));
    return raw ? terrainFromJson(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** as linhas e áreas (guard-rail, zebra, chão pintado...) de um arquivo ou do que foi salvo */
export function pathsFromJson(text: string): PathItem[] {
  const d = JSON.parse(text) as { linhas?: PathItem[] };
  return Array.isArray(d.linhas) ? d.linhas.filter((it) => it && Array.isArray(it.p)) : [];
}
export function loadPaths(slug: string): PathItem[] | null {
  try {
    const raw = localStorage.getItem(KEY(slug));
    // (salvo antes das linhas existirem: sem o campo, usa as automáticas)
    return raw && raw.includes('"linhas"') ? pathsFromJson(raw) : null;
  } catch {
    return null;
  }
}

/** salva (false = não coube no navegador) */
export function savePieces(slug: string, pieces: Piece[], paths: PathItem[] = [], terrain?: Terrain | null): boolean {
  try {
    localStorage.setItem(KEY(slug), piecesToJson(pieces, paths, terrain));
    return true;
  } catch {
    return false;
  }
}

export function clearPieces(slug: string) {
  localStorage.removeItem(KEY(slug));
}

export function piecesFromJson(text: string): Piece[] {
  const d = JSON.parse(text) as { pecas: Row[] };
  if (!Array.isArray(d.pecas)) throw new Error("arquivo sem peças");
  return d.pecas.map(([k, x, z, r, s, sx, sy, sz, c, c2, v, y]) => ({ k, x, z, r, s: s ?? undefined, sx: sx ?? undefined, sy: sy ?? undefined, sz: sz ?? undefined, c: c ?? undefined, c2: c2 ?? undefined, v: v ?? undefined, y: y ?? undefined }));
}
