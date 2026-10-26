// Piloto 3D em pé (render do Blender: art/render_piloto.py), pintado com o uniforme da equipe:
// macacão, faixas do macacão e capacete. Usado no pódio e no editor do uniforme.
import type { Team } from "../sim/types";

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
