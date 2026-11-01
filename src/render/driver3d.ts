// Piloto 3D em pé (render do Blender: art/render_piloto.py), pintado com o uniforme da equipe:
// macacão, faixas do macacão e capacete. Usado no pódio. A prévia do editor do uniforme é a do fim (pilotPreview).
import type { Livery } from "../sim/livery";
import type { Team } from "../sim/types";
import { GLOVE_RULES, HELMET_RULES, SHOE_RULES, SUIT_RULES } from "./uniformStyles";

export type DriverPose = "stand" | "win" | "p2" | "p3";
interface Info { w: number; h: number; poses: DriverPose[]; ground: number; heightM: number }
let assets: { info: Info; img: Map<DriverPose, [ImageData, ImageData]> } | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, HTMLCanvasElement>();

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

/** carrega os renders (uma vez); resolve quando prontos (ou falha silenciosa: sem os arquivos) */
export function loadDriver3d(): Promise<void> {
  if (!loading) {
    const img = (n: string) =>
      new Promise<HTMLImageElement>((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = fail;
        i.src = `/piloto/${n}.png`;
      });
    loading = fetch("/piloto/piloto.json")
      .then((r) => r.json() as Promise<Info>)
      .then(async (info) => {
        const m = new Map<DriverPose, [ImageData, ImageData]>();
        await Promise.all(
          info.poses.map(async (p) => {
            const [b, k] = await Promise.all([img(p), img(`${p}_mask`)]);
            m.set(p, [pixels(b), pixels(k)]);
          }),
        );
        assets = { info, img: m };
      })
      .catch(() => {});
  }
  return loading;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** cores do uniforme (da pintura da equipe; sem pintura, das cores dela) */
export function uniformOf(team: Pick<Team, "color" | "accent" | "livery">) {
  const lv = team.livery;
  return { suit: lv?.suit ?? team.color, detail: lv?.suitDetail ?? team.accent, helmet: lv?.helmet ?? team.accent };
}

/** o piloto pintado (null = ainda carregando / sem os arquivos). Altura da imagem = info.heightM metros */
export function driverCanvas(pose: DriverPose, u: { suit: string; detail: string; helmet: string }): HTMLCanvasElement | null {
  if (!assets) return null;
  const key = `${pose}|${u.suit}|${u.detail}|${u.helmet}`;
  let c = cache.get(key);
  if (c) return c;
  const [base, mask] = assets.img.get(pose)!;
  const out = new ImageData(base.width, base.height);
  const b = base.data, m = mask.data, o = out.data;
  const cs = [rgb(u.suit), rgb(u.detail), rgb(u.helmet)];
  for (let i = 0; i < b.length; i += 4) {
    const w = [m[i] / 255, m[i + 1] / 255, m[i + 2] / 255];
    for (let k = 0; k < 3; k++) {
      let f = 1;
      for (let j = 0; j < 3; j++) f += w[j] * (cs[j][k] * 1.18 - 1);
      o[i + k] = Math.min(255, b[i + k] * f);
    }
    o[i + 3] = b[i + 3];
  }
  c = document.createElement("canvas");
  c.width = base.width;
  c.height = base.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  if (cache.size > 40) cache.clear();
  cache.set(key, c);
  return c;
}

/** onde fica o pé na imagem (fração de cima pra baixo) */
export function driverGround(): number {
  return assets?.info.ground ?? 0.95;
}

// ---- prévia da aba PILOTO: o piloto em pé "assado" do 3D (scripts/bake-pilot.ts → public/piloto/pe*.png) ----
// A foto vem cinza-clara (PE_GRAY) e os mapas dizem o que cada pixel é; aqui cada pixel é tingido com a cor e o
// desenho do capacete, do macacão, das luvas e do tênis, pelas mesmas regras do 3D (uniformStyles.ts). Sem
// baixar o 3D. Também as miniaturas dos botões de desenho (um recorte do piloto com cada desenho).
type Rect = [number, number, number, number];
let pe: { shade: ImageData; q: ImageData; m: ImageData; crop: Record<Part, Rect> } | null = null;
let peLoading: Promise<boolean> | null = null;
const peCache = new Map<string, HTMLCanvasElement>();
/** a cor cinza-clara da foto (viewer3dScene.PE_GRAY): o tingimento divide por ela */
const PE_GRAY = 0xd6 / 255;
/** a parte de baixo da peça preta do tênis que é sola (cars3dReal.SHOE_SOLE: aqui sem baixar o 3D) */
const SHOE_SOLE = 0.2;
/** peça do uniforme (miniaturas): capacete, macacão, luva, tênis */
export type Part = "h" | "s" | "g" | "f";

/** retângulo dos pixels de uma peça nos mapas (com folga) */
function cropOf(m: ImageData, want: (reg: number, x: number, g: number) => boolean, pad: number): Rect {
  let x0 = m.width, y0 = m.height, x1 = 0, y1 = 0;
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const i = (y * m.width + x) * 4;
      if (!want(Math.round(m.data[i] / 32), x, m.data[i + 1])) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  const w = x1 - x0, h = y1 - y0, p = Math.max(w, h) * pad;
  return [Math.max(0, Math.floor(x0 - p)), Math.max(0, Math.floor(y0 - p)), Math.min(m.width, Math.ceil(x1 + p)) - Math.max(0, Math.floor(x0 - p)), Math.min(m.height, Math.ceil(y1 + p)) - Math.max(0, Math.floor(y0 - p))];
}

export function loadPilotPreview(): Promise<boolean> {
  peLoading ??= Promise.all(
    ["pe", "pe_q", "pe_m"].map(
      (n) =>
        new Promise<HTMLImageElement>((ok, fail) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = fail;
          i.src = `/piloto/${n}.png`;
        }),
    ),
  )
    .then(([a, b, c]) => {
      const m = pixels(c), half = m.width / 2;
      pe = {
        shade: pixels(a),
        q: pixels(b),
        m,
        crop: {
          h: cropOf(m, (r) => r === 3, 0.12),
          s: cropOf(m, (r) => r >= 1 && r <= 6, 0.04),
          // (uma mão só, a da direita da imagem)
          g: cropOf(m, (r, x) => r === 5 && x > half, 0.18),
          // (um pé só, o da direita da imagem)
          f: cropOf(m, (r, x) => r === 6 && x > half, 0.12),
        },
      };
      return true;
    })
    .catch(() => false);
  return peLoading;
}

/** tinge os pixels do retângulo com o uniforme da pintura */
function compose(lv: Livery, [x0, y0, w, h]: Rect): ImageData {
  const { shade, q, m } = pe!;
  const S = shade.data, Q = q.data, M = m.data, W = shade.width;
  const out = new ImageData(w, h), o = out.data;
  const suit = rgb(lv.suit), suitD = rgb(lv.suitDetail), helm = rgb(lv.helmet), helmD = rgb(lv.helmetDetail);
  const glove = rgb(lv.glove ?? lv.suit), gloveD = rgb(lv.gloveDetail ?? lv.suitDetail);
  const shoe = rgb(lv.shoe ?? lv.suit), shoeD = rgb(lv.shoeDetail ?? lv.suitDetail), sole = rgb("#151517");
  const sRule = SUIT_RULES.at(lv.suitStyle ?? 1)?.js, hRule = HELMET_RULES.at(lv.helmetStyle ?? 1)?.js;
  const gRule = GLOVE_RULES.at(lv.gloveStyle ?? 0)?.js, fRule = SHOE_RULES.at(lv.shoeStyle ?? 0)?.js, fStyle = lv.shoeStyle ?? 0;
  const qq = { x: 0, y: 0, z: 0 }, nn = { x: 0, y: 0, z: 0 }, gg = { t: 0, f: 0, b: 0, s: 0 }, ff = { t: 0, h: 0, s: 0, p: 0 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * W + x0 + x) * 4, d = (y * w + x) * 4;
      const reg = Math.round(M[i] / 32);
      let col: number[] | null = null;
      if (reg === 1 || reg === 3) {
        qq.x = Q[i] / 127.5 - 1;
        qq.y = Q[i + 1] / 127.5 - 1;
        qq.z = Q[i + 2] / 127.5 - 1;
        if (reg === 3) col = hRule?.(qq) ? helmD : helm;
        else {
          nn.x = (M[i + 2] / 127.5 - 1) * Math.sign(qq.x);
          col = sRule?.(qq, nn, M[i + 1] > 127 ? 1 : 0) ? suitD : suit;
        }
      } else if (reg === 2) col = suitD;
      else if (reg === 4) col = suit;
      else if (reg === 5) {
        gg.t = (Q[i] / 255) * 2 - 0.5;
        gg.f = Q[i + 1] / 255;
        gg.b = Q[i + 2] / 127.5 - 1;
        gg.s = M[i + 1] > 127 ? 1 : -1;
        col = gRule?.(gg) ? gloveD : glove;
      } else if (reg === 6) {
        ff.p = Math.round(M[i + 1] / 127.5);
        ff.t = Q[i] / 255;
        ff.h = Q[i + 1] / 255;
        ff.s = Q[i + 2] > 127 ? 1 : -1;
        // (a faixa leva o detalhe; a peça preta abaixo de SHOE_SOLE é sola — preta, menos em "Sola colorida"; o
        // resto é cabedal, com a cor e o desenho)
        col = ff.p === 1 ? shoeD : ff.p === 2 && ff.h < SHOE_SOLE ? (fStyle === 4 ? shoeD : sole) : fStyle !== 4 && fRule?.(ff) ? shoeD : shoe;
      }
      for (let k = 0; k < 3; k++) o[d + k] = col ? Math.min(255, (S[i + k] * col[k]) / PE_GRAY) : S[i + k];
      o[d + 3] = S[i + 3];
    }
  return out;
}
const toCanvas = (img: ImageData) => {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
};
const keyOf = (lv: Livery) => [lv.suit, lv.suitDetail, lv.helmet, lv.helmetDetail, lv.glove, lv.gloveDetail, lv.shoe, lv.shoeDetail, lv.helmetStyle, lv.suitStyle, lv.gloveStyle, lv.shoeStyle].join("|");

/** o piloto em pé com o uniforme e os desenhos (null = ainda carregando / sem os arquivos) */
export function pilotPreview(lv: Livery): HTMLCanvasElement | null {
  if (!pe) return null;
  const key = keyOf(lv);
  let c = peCache.get(key);
  if (c) return c;
  c = toCanvas(compose(lv, [0, 0, pe.shade.width, pe.shade.height]));
  if (peCache.size > 30) peCache.clear();
  peCache.set(key, c);
  return c;
}

/** miniatura de uma peça (capacete, macacão, luva, tênis) com o desenho `style` (null = ainda carregando) */
export function pilotThumb(lv: Livery, part: Part, style: number): HTMLCanvasElement | null {
  if (!pe) return null;
  const k = { h: "helmetStyle", s: "suitStyle", g: "gloveStyle", f: "shoeStyle" }[part] as "helmetStyle";
  return toCanvas(compose({ ...lv, [k]: style }, pe.crop[part]));
}
