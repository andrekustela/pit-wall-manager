// Carro 3D visto de cima: render do Blender (public/car3d, feito por art/render_carro3d.py) pintado na
// hora com as cores da equipe. Vem em camadas alinhadas (corpo, asa dianteira, asa traseira e as 4 rodas):
// cada peça é desenhada por conta própria, então pode ficar folgada, quebrar pela metade, sair voando,
// e as rodas da frente viram nas curvas. base_* = luz e reflexos (pintável em cinza claro);
// mask_* = onde vai cada cor (R carroceria, G asa, B capacete). O 2D clássico (carArt.ts) continua.
import type { Team } from "../sim/types";
import { liveryKey } from "../sim/livery";
import { storeGet, storeSet } from "../ui/common";
import { patternShapes, type CarImage } from "./carArt";

/** comprimento do carro na pista (m): o mesmo porte do 2D, pros carros não se sobreporem nas disputas */
const SHOW_LEN = 4.8;

/** liga/desliga (configuração do perfil); padrão: 3D */
export const car3dPref = {
  get on() {
    return storeGet("pwm.car3d") !== "0";
  },
  set(on: boolean) {
    storeSet("pwm.car3d", on ? "1" : "0");
  },
};

type Tag = "corpo" | "asa_d" | "asa_t" | "roda_fe" | "roda_fd" | "roda_te" | "roda_td";
interface Info { layers: Tag[]; pxPerM: number; lenM: number; widM: number; carLen: number; carWid: number }
interface Layer { base: ImageData; mask: ImageData; box: [number, number, number, number] }
let assets: { info: Info; W: number; H: number; layers: Record<Tag, Layer>; wheelOrder: Tag[]; helm: [number, number]; shadow: Record<Tag, HTMLCanvasElement> } | null = null;
/** folga em volta da sombra de cada peça (px), pro borrão não cortar */
const SH_PAD = 16;

/** sombra de uma peça: a silhueta dela, preta e borrada, cortada no tamanho da peça + folga */
function shadowOf(l: Layer): HTMLCanvasElement {
  const [x0, y0, x1, y1] = l.box;
  const w = x1 - x0, h = y1 - y0;
  const sil = document.createElement("canvas");
  sil.width = w;
  sil.height = h;
  const sg = sil.getContext("2d")!;
  sg.putImageData(l.base, -x0, -y0);
  sg.globalCompositeOperation = "source-in";
  sg.fillStyle = "#000";
  sg.fillRect(0, 0, w, h);
  const c = document.createElement("canvas");
  c.width = w + SH_PAD * 2;
  c.height = h + SH_PAD * 2;
  const g = c.getContext("2d")!;
  g.filter = "blur(6px)";
  g.drawImage(sil, SH_PAD, SH_PAD);
  return c;
}
let loading = false;

/** onde a peça (cortada) fica, em px da imagem cheia */
function bbox(img: ImageData): [number, number, number, number] {
  const { width: W, height: H, data } = img;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > 6) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1 + 1, y1 + 1];
}

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

/** carrega as imagens uma vez (sem bloquear: enquanto não chegam, o jogo usa o 2D) */
export function car3dReady(): boolean {
  if (assets) return true;
  if (!loading) {
    loading = true;
    const img = (n: string) =>
      new Promise<HTMLImageElement>((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = fail;
        i.src = `/car3d/${n}.png`;
      });
    void fetch("/car3d/info.json")
      .then((r) => r.json() as Promise<Info>)
      .then(async (info) => {
        const imgs = await Promise.all(info.layers.flatMap((t) => [img(`base_${t}`), img(`mask_${t}`)]));
        const layers = {} as Record<Tag, Layer>;
        info.layers.forEach((t, i) => {
          const base = pixels(imgs[i * 2]);
          layers[t] = { base, mask: pixels(imgs[i * 2 + 1]), box: bbox(base) };
        });
        const W = layers.corpo.base.width, H = layers.corpo.base.height;
        // rodas na ordem do jogo: dianteira esq., dianteira dir., traseira esq., traseira dir. (esq. = metade de cima da imagem)
        const wheels = (["roda_fe", "roda_fd", "roda_te", "roda_td"] as Tag[]).map((t) => {
          const [x0, y0, x1, y1] = layers[t].box;
          return { t, front: (x0 + x1) / 2 > W / 2, left: (y0 + y1) / 2 < H / 2 };
        });
        const pick = (front: boolean, left: boolean) => wheels.find((w) => w.front === front && w.left === left)!.t;
        const wheelOrder = [pick(true, true), pick(true, false), pick(false, true), pick(false, false)];
        // centro do capacete (azul no molde do corpo), pra faixa
        const m = layers.corpo.mask.data;
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < m.length; i += 4)
          if (m[i + 2] > 128) {
            const p = i / 4;
            sx += p % W;
            sy += Math.floor(p / W);
            n++;
          }
        // sombra de CADA peça (silhueta borrada, igual pra todas as equipes): peça que sai leva a sombra junto
        const shadow = {} as Record<Tag, HTMLCanvasElement>;
        for (const t of info.layers) shadow[t] = shadowOf(layers[t]);
        assets = { info, W, H, layers, wheelOrder, helm: n ? [sx / n, sy / n] : [W / 2, H / 2], shadow };
      })
      .catch(() => {
        /* sem os arquivos: fica no 2D */
      });
  }
  return false;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** cor de cada pixel pra carroceria (principal + estilo de pintura) e pro capacete (cor + faixa) */
function tintMaps(team: Team, info: Info, W: number, H: number, helm: [number, number]): { body: ImageData; helmet: ImageData } {
  const lv = team.livery;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c.getContext("2d", { willReadFrequently: true })!;
  };
  const g = mk();
  g.fillStyle = lv?.base ?? team.color;
  g.fillRect(0, 0, W, H);
  // as formas foram desenhadas pro carro 2D (bico em +2,4 m): encaixa no comprimento da carroceria 3D
  const px = info.pxPerM;
  g.setTransform(px * 1.02, 0, 0, px, W / 2 + 0.25 * px, H / 2);
  if (!lv || lv.pattern === "classica") {
    g.beginPath();
    g.moveTo(-2.3, -0.07);
    g.lineTo(0.3, -0.11);
    g.lineTo(2.4, -0.035);
    g.lineTo(2.4, 0.035);
    g.lineTo(0.3, 0.11);
    g.lineTo(-2.3, 0.07);
    g.closePath();
    g.fillStyle = lv?.patternColor ?? team.accent;
    g.fill();
  } else patternShapes(g, lv);
  const h = mk();
  h.fillStyle = lv?.helmet ?? team.accent;
  h.fillRect(0, 0, W, H);
  h.fillStyle = lv?.helmetDetail ?? team.color;
  h.fillRect(helm[0] - 0.16 * px, helm[1] - 0.028 * px, 0.32 * px, 0.056 * px); // faixa de trás pra frente
  return { body: g.getImageData(0, 0, W, H), helmet: h.getImageData(0, 0, W, H) };
}

/** pinta uma camada e corta no tamanho da peça */
function paint(layer: Layer, body: ImageData, helmet: ImageData, wing: number[]): HTMLCanvasElement {
  const { base, mask, box } = layer;
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0, W = base.width;
  const out = new ImageData(w, h);
  const b = base.data, m = mask.data, o = out.data, bd = body.data, hd = helmet.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * W + (x + x0)) * 4, j = (y * w + x) * 4;
      const r = m[i] / 255, gc = m[i + 1] / 255, bc = m[i + 2] / 255;
      for (let k = 0; k < 3; k++) {
        // a base pintável é cinza ~0,82: o 1,22 devolve a cor certa
        const tint = 1 + r * ((bd[i + k] / 255) * 1.22 - 1) + gc * (wing[k] * 1.22 - 1) + bc * ((hd[i + k] / 255) * 1.22 - 1);
        o[j + k] = Math.min(255, b[i + k] * tint);
      }
      o[j + 3] = b[i + 3];
    }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}

const painted = new Map<string, Record<Tag, HTMLCanvasElement>>();
function paintedFor(team: Team): Record<Tag, HTMLCanvasElement> | null {
  if (!assets) return null;
  const key = `${team.id}|${liveryKey(team.livery)}`;
  let p = painted.get(key);
  if (!p) {
    if (painted.size > 40) painted.clear();
    const { info, W, H, layers, helm } = assets;
    const { body, helmet } = tintMaps(team, info, W, H, helm);
    const lv = team.livery;
    const wing = rgb(lv?.wing ?? lv?.accent ?? team.accent);
    p = {} as Record<Tag, HTMLCanvasElement>;
    for (const t of info.layers) p[t] = paint(layers[t], body, helmet, wing);
    painted.set(key, p);
  }
  return p;
}

// ---------- estado de cada peça ----------

export type WingLook = { state: "ok" | "loose" | "half" | "none"; side: "l" | "r" };
export type WheelLook = "ok" | "flat" | "bent" | "off";
export interface CarLook {
  fw: WingLook;
  rw: WingLook;
  /** dianteira esq., dianteira dir., traseira esq., traseira dir. */
  wheels: [WheelLook, WheelLook, WheelLook, WheelLook];
  /** ângulo das rodas da frente (rad, + = virando pra direita) */
  steer: number;
}
export const LOOK_OK: CarLook = { fw: { state: "ok", side: "l" }, rw: { state: "ok", side: "l" }, wheels: ["ok", "ok", "ok", "ok"], steer: 0 };

type Dmg = { fw: number; suspF: number; rw: number; suspR: number };
type Sides = Partial<Record<keyof Dmg, "l" | "r" | "b">>;

/** do dano da simulação pro desenho: pancada leve = folgada, média = perde o lado, forte (ou dos dois lados) = sai */
export function lookOf(dmg: Dmg | undefined, sides: Sides | undefined, flatWheel: number | undefined, punctured: boolean, steer: number): CarLook {
  if (!dmg) return { ...LOOK_OK, steer };
  const s = sides ?? {};
  const wing = (d: number, side: "l" | "r" | "b" | undefined, half: number, gone: number): WingLook => {
    const sd = side === "r" ? "r" : "l";
    if (d <= 0.05) return { state: "ok", side: sd };
    if (side === "b" || d >= gone) return { state: "none", side: sd };
    return { state: d < half ? "loose" : "half", side: sd };
  };
  const wheel = (i: number): WheelLook => {
    const front = i < 2, left = i % 2 === 0;
    const d = front ? dmg.suspF : dmg.suspR;
    const sd = s[front ? "suspF" : "suspR"];
    const hit = d > 0.05 && (sd === "b" || sd === undefined || (sd === "l") === left);
    if (hit && d >= 1.8) return "off";
    if (hit) return "bent";
    if (punctured && flatWheel === i) return "flat";
    return "ok";
  };
  return { fw: wing(dmg.fw, s.fw, 0.6, 1.1), rw: wing(dmg.rw, s.rw, 0.7, 1.3), wheels: [wheel(0), wheel(1), wheel(2), wheel(3)], steer };
}

/** escala: px da imagem -> metros na pista */
const kOf = () => (assets ? SHOW_LEN / assets.info.carLen / assets.info.pxPerM : 0);

/** desenha o carro 3D com o estado das peças (false = ainda carregando: use o 2D) */
export function drawCar3d(o: CanvasRenderingContext2D, team: Team, x: number, y: number, h: number, m: number, alpha: number, look: CarLook, rainLight: boolean, t: number): boolean {
  if (!car3dReady() || !assets) return false;
  const p = paintedFor(team)!;
  const { W, H, layers, wheelOrder, shadow } = assets;
  const k = kOf();
  o.save();
  o.translate(x, y);
  o.rotate(h);
  o.scale(m * k, m * k);
  o.translate(-W / 2, -H / 2);
  o.globalAlpha = alpha;
  // sombra
  // 2 passadas: sombras (deslocadas, como se o sol estivesse no alto) e depois as peças por cima
  let shadowPass = true;
  const sox = 0.09 / k, soy = 0.13 / k;
  const put = (tag: Tag, rot = 0, dx = 0, dy = 0, sx = 1, sy = 1) => {
    const [x0, y0, x1, y1] = layers[tag].box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    o.save();
    if (shadowPass) {
      o.globalAlpha = alpha * 0.42;
      o.translate(sox, soy);
    }
    o.translate(cx + dx, cy + dy);
    if (rot) o.rotate(rot);
    if (sx !== 1 || sy !== 1) o.scale(sx, sy);
    if (shadowPass) o.drawImage(shadow[tag], -(x1 - x0) / 2 - SH_PAD, -(y1 - y0) / 2 - SH_PAD);
    else o.drawImage(p[tag], -(x1 - x0) / 2, -(y1 - y0) / 2);
    o.restore();
  };
  const wingDraw = (tag: Tag, wl: WingLook, front: boolean) => {
    if (wl.state === "none") return;
    const [, y0, , y1] = layers[tag].box;
    const cy = (y0 + y1) / 2 + (shadowPass ? soy : 0);
    if (wl.state === "half") {
      // perdeu o lado da pancada (esquerda = metade de cima da imagem)
      o.save();
      o.beginPath();
      if (wl.side === "l") o.rect(-W, cy, W * 3, H * 2);
      else o.rect(-W, -H, W * 3, cy + H);
      o.clip();
      put(tag);
      o.restore();
    } else if (wl.state === "loose") {
      // folgada: o lado da pancada cede pra trás e balança
      const sgn = (wl.side === "l" ? -1 : 1) * (front ? 1 : -1);
      put(tag, sgn * (0.13 + 0.05 * Math.sin(t * 22)), (front ? -1 : 1) * 0.06 / k);
    } else put(tag);
  };
  const parts = () => {
    // rodas por baixo do corpo (os braços da suspensão passam por cima)
    look.wheels.forEach((st, i) => {
      if (st === "off") return;
      const tag = wheelOrder[i];
      const front = i < 2, left = i % 2 === 0, out = left ? -1 : 1;
      let rot = front ? look.steer : 0, dy = 0, sy = 1;
      if (st === "bent") {
        rot += out * 0.42; // suspensão quebrada: roda torta, abrindo pra fora
        dy = (out * 0.07) / k;
      } else if (st === "flat") {
        rot += Math.sin(t * 30 + i) * 0.06; // pneu murcho trepidando
        sy = 0.84;
        dy = (out * 0.03) / k;
      }
      put(tag, rot, 0, dy, 1, sy);
      if (st === "flat" && !shadowPass) {
        // pneu murcho: borracha mais escura
        const [x0, y0, x1, y1] = layers[tag].box;
        o.save();
        o.globalAlpha = alpha * 0.5;
        o.fillStyle = "#000";
        o.fillRect(x0, y0 + dy + (y1 - y0) * 0.08, x1 - x0, (y1 - y0) * 0.84);
        o.restore();
      }
    });
    put("corpo");
    wingDraw("asa_d", look.fw, true);
    wingDraw("asa_t", look.rw, false);
  };
  parts();
  shadowPass = false;
  parts();
  // luz de chuva na traseira
  if (rainLight) {
    o.fillStyle = "#ff2a2a";
    o.shadowColor = "#ff2a2a";
    o.shadowBlur = 0.3 / k;
    o.beginPath();
    o.ellipse(0.2 / k, H / 2, 0.06 / k, 0.07 / k, 0, 0, Math.PI * 2);
    o.fill();
  }
  o.restore();
  return true;
}

/** imagem de uma peça solta (pra voar e ficar na pista) + onde o centro dela fica no carro (m: dx frente, dy lado) */
export function partPiece(team: Team, part: "asa_d" | "asa_t" | "roda", which: "full" | "l" | "r" | number): { img: CarImage; dx: number; dy: number } | null {
  const p = assets && paintedFor(team);
  if (!p || !assets) return null;
  const k = kOf();
  const { W, H, layers, wheelOrder } = assets;
  const tag: Tag = part === "roda" ? wheelOrder[which as number] : part;
  const src = p[tag];
  const [x0, y0, x1, y1] = layers[tag].box;
  let cv = src, cy = (y0 + y1) / 2, ch = y1 - y0, sy = 0;
  if (part !== "roda" && which !== "full") {
    // só a metade que saiu (esquerda = de cima)
    const half = Math.round(H / 2 - y0);
    sy = which === "l" ? 0 : half;
    ch = which === "l" ? half : y1 - y0 - half;
    cv = document.createElement("canvas");
    cv.width = src.width;
    cv.height = Math.max(1, ch);
    cv.getContext("2d")!.drawImage(src, 0, sy, src.width, ch, 0, 0, src.width, ch);
    cy = y0 + sy + ch / 2;
  }
  return { img: { canvas: cv, wM: cv.width * k, hM: cv.height * k }, dx: ((x0 + x1) / 2 - W / 2) * k, dy: (cy - H / 2) * k };
}

/** carro inteiro numa imagem (prévias: editor de pintura, lobby) */
export function car3dPreview(team: Team): HTMLCanvasElement | null {
  if (!car3dReady() || !assets) return null;
  const { W, H } = assets;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const k = kOf();
  drawCar3d(g, team, W / 2, H / 2, 0, 1 / k, 1, LOOK_OK, false, 0);
  return c;
}
