// Carro 3D visto de cima: render do Blender (public/car3d) pintado na hora com as cores da equipe.
// base_* = luz e reflexos (partes pintáveis em cinza claro); mask_* = onde vai cada cor
// (R carroceria, G asa, B capacete). A asa dianteira vem numa camada à parte: pode quebrar
// pela metade ou sair inteira (e voar). O 2D clássico (carArt.ts) continua como opção.
import type { Team } from "../sim/types";
import { liveryKey } from "../sim/livery";
import { storeGet, storeSet } from "../ui/common";
import { patternShapes, type CarImage } from "./carArt";

/** comprimento do carro na pista (m): o mesmo porte do 2D, pros carros não se sobreporem nas disputas */
const SHOW_LEN = 4.8;
/** sobra em volta da imagem (m), pra sombra */
const PAD = 0.3;

export type WingState = "ok" | "left" | "right" | "none";

interface Info { pxPerM: number; lenM: number; widM: number; carLen: number; carWid: number }
interface Layer { base: ImageData; mask: ImageData }
let assets: { info: Info; car: Layer; wing: Layer } | null = null;
let loading = false;

/** liga/desliga (configuração do perfil); padrão: 3D */
export const car3dPref = {
  get on() {
    return storeGet("pwm.car3d") !== "0";
  },
  set(on: boolean) {
    storeSet("pwm.car3d", on ? "1" : "0");
  },
};

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
    void Promise.all([fetch("/car3d/info.json").then((r) => r.json() as Promise<Info>), img("base_carro"), img("mask_carro"), img("base_asa"), img("mask_asa")])
      .then(([info, bc, mc, ba, ma]) => {
        assets = { info, car: { base: pixels(bc), mask: pixels(mc) }, wing: { base: pixels(ba), mask: pixels(ma) } };
      })
      .catch(() => {
        /* sem os arquivos: fica no 2D */
      });
  }
  return false;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** pinta uma camada: base × cor (a cor da carroceria pode variar pixel a pixel, por causa do estilo de pintura) */
function paint(layer: Layer, body: ImageData, wing: number[], helm: number[]): HTMLCanvasElement {
  const { base, mask } = layer;
  const out = new ImageData(base.width, base.height);
  const b = base.data, m = mask.data, o = out.data, bd = body.data;
  for (let i = 0; i < b.length; i += 4) {
    const r = m[i] / 255, gc = m[i + 1] / 255, bc = m[i + 2] / 255;
    for (let k = 0; k < 3; k++) {
      // a base pintável é cinza ~0,82: o 1,22 devolve a cor certa
      const tint = 1 + r * ((bd[i + k] / 255) * 1.22 - 1) + gc * (wing[k] * 1.22 - 1) + bc * (helm[k] * 1.22 - 1);
      o[i + k] = Math.min(255, b[i + k] * tint);
    }
    o[i + 3] = b[i + 3];
  }
  const c = document.createElement("canvas");
  c.width = base.width;
  c.height = base.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}

/** cor da carroceria pixel a pixel: a principal + o estilo de pintura escolhido no editor */
function bodyColors(team: Team, info: Info, w: number, h: number): ImageData {
  const lv = team.livery;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = lv?.base ?? team.color;
  g.fillRect(0, 0, w, h);
  // as formas foram desenhadas pro carro 2D (bico em +2,4 m): encaixa no comprimento da carroceria 3D
  const px = info.pxPerM;
  g.setTransform(px * 1.02, 0, 0, px, w / 2 + 0.25 * px, h / 2);
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
  return g.getImageData(0, 0, w, h);
}

interface Painted { car: HTMLCanvasElement; wing: HTMLCanvasElement }
const painted = new Map<string, Painted>();
const final = new Map<string, CarImage>();

function paintedFor(team: Team): Painted | null {
  if (!assets) return null;
  const key = `${team.id}|${liveryKey(team.livery)}`;
  let p = painted.get(key);
  if (!p) {
    if (painted.size > 60) painted.clear();
    const { info, car, wing } = assets;
    const lv = team.livery;
    const body = bodyColors(team, info, car.base.width, car.base.height);
    const w = rgb(lv?.wing ?? lv?.accent ?? team.accent), hm = rgb(lv?.accent ?? team.accent);
    p = { car: paint(car, body, w, hm), wing: paint(wing, body, w, hm) };
    painted.set(key, p);
  }
  return p;
}

/** escala da imagem (px) pra metros na pista */
const scale = (info: Info) => SHOW_LEN / info.carLen / info.pxPerM;

/** carro 3D pronto pra desenhar (null = ainda carregando ou desligado: use o 2D) */
export function car3dImage(team: Team, rainLight: boolean, wingState: WingState): CarImage | null {
  if (!car3dReady() || !assets) return null;
  const key = `${team.id}|${liveryKey(team.livery)}|${rainLight}|${wingState}`;
  const hit = final.get(key);
  if (hit) return hit;
  const p = paintedFor(team)!;
  const { info } = assets;
  const k = scale(info);
  const padPx = Math.round(PAD / k);
  const W = p.car.width + padPx * 2, H = p.car.height + padPx * 2;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  // sombra no chão (o render vem sem chão)
  g.save();
  g.shadowColor = "rgba(0,0,0,0.6)";
  g.shadowBlur = 0.22 / k;
  g.shadowOffsetX = 0.1 / k;
  g.shadowOffsetY = 0.14 / k;
  g.globalAlpha = 0.55;
  g.drawImage(p.car, padPx, padPx);
  g.restore();
  g.drawImage(p.car, padPx, padPx);
  // asa dianteira: inteira, uma metade (a outra quebrou) ou nada
  if (wingState !== "none") {
    g.save();
    if (wingState !== "ok") {
      g.beginPath();
      if (wingState === "left") g.rect(0, 0, W, H / 2);
      else g.rect(0, H / 2, W, H / 2);
      g.clip();
    }
    g.drawImage(p.wing, padPx, padPx);
    g.restore();
  }
  // luz de chuva na traseira
  if (rainLight) {
    g.save();
    g.fillStyle = "#ff2a2a";
    g.shadowColor = "#ff2a2a";
    g.shadowBlur = 0.3 / k;
    g.beginPath();
    g.ellipse(padPx + 0.2 / k, H / 2, 0.06 / k, 0.07 / k, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const img: CarImage = { canvas: cv, wM: W * k, hM: H * k };
  if (final.size > 200) final.clear();
  final.set(key, img);
  return img;
}

/** pedaço da asa dianteira que saiu (recortado no tamanho dele) + onde o centro dele fica no carro
 * (metros: dx pra frente, dy pro lado) — pra ele girar em volta de si mesmo ao voar */
export function wingPiece(team: Team, part: "full" | "left" | "right"): { img: CarImage; dx: number; dy: number } | null {
  const p = assets && paintedFor(team);
  if (!p || !assets) return null;
  const key = `peca|${team.id}|${liveryKey(team.livery)}|${part}`;
  const k = scale(assets.info);
  const src = p.wing, W = src.width, H = src.height;
  // caixa da parte visível da metade pedida
  const y0 = part === "right" ? Math.floor(H / 2) : 0, y1 = part === "left" ? Math.ceil(H / 2) : H;
  const a = assets.wing.base.data;
  let x0 = W, x1 = 0, ya = H, yb = 0;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++)
      if (a[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < ya) ya = y;
        if (y > yb) yb = y;
      }
  if (x1 < x0) return null;
  let img = final.get(key);
  if (!img) {
    const cv = document.createElement("canvas");
    cv.width = x1 - x0 + 1;
    cv.height = yb - ya + 1;
    cv.getContext("2d")!.drawImage(src, x0, ya, cv.width, cv.height, 0, 0, cv.width, cv.height);
    img = { canvas: cv, wM: cv.width * k, hM: cv.height * k };
    final.set(key, img);
  }
  return { img, dx: ((x0 + x1) / 2 - W / 2) * k, dy: ((ya + yb) / 2 - H / 2) * k };
}

/** estado da asa a partir do dano (metade num toque leve, tudo num dano forte); o lado é fixo por carro */
export function wingStateOf(carId: string, fwDamage: number): WingState {
  if (fwDamage <= 0.05) return "ok";
  if (fwDamage >= 0.9) return "none";
  let h = 0;
  for (const ch of carId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h & 1 ? "left" : "right";
}
