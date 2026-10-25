// Cockpit 3D da câmera onboard (render do Blender nos olhos do piloto: art/render_onboard.py),
// pintado com as cores da equipe. O volante vem separado: gira com a curva e a telinha dele
// mostra marcha e velocidade. Sem os arquivos (ou com o 2D clássico), a onboard usa o vetor.
import type { Team } from "../sim/types";
import { liveryKey } from "../sim/livery";
import { car3dPref } from "./car3d";

interface Info { w: number; h: number; wheel: [number, number, number, number]; display: [number, number, number, number] }
let assets: { info: Info; corpo: [ImageData, ImageData]; volante: [ImageData, ImageData] } | null = null;
let loading = false;

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

function ready(): boolean {
  if (assets) return true;
  if (!loading) {
    loading = true;
    const img = (n: string) =>
      new Promise<HTMLImageElement>((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = fail;
        i.src = `/onboard/${n}.png`;
      });
    void fetch("/onboard/info.json")
      .then((r) => r.json() as Promise<Info>)
      .then(async (info) => {
        const [bc, mc, bv, mv] = await Promise.all(["base_corpo", "mask_corpo", "base_volante", "mask_volante"].map(img));
        assets = { info, corpo: [pixels(bc), pixels(mc)], volante: [pixels(bv), pixels(mv)] };
      })
      .catch(() => {
        /* sem os arquivos: fica no vetor */
      });
  }
  return false;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function paint([base, mask]: [ImageData, ImageData], body: number[], wing: number[]): HTMLCanvasElement {
  const out = new ImageData(base.width, base.height);
  const b = base.data, m = mask.data, o = out.data;
  for (let i = 0; i < b.length; i += 4) {
    const r = m[i] / 255, gc = m[i + 1] / 255;
    for (let k = 0; k < 3; k++) o[i + k] = Math.min(255, b[i + k] * (1 + r * (body[k] * 1.22 - 1) + gc * (wing[k] * 1.22 - 1)));
    o[i + 3] = b[i + 3];
  }
  const c = document.createElement("canvas");
  c.width = base.width;
  c.height = base.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}

const cache = new Map<string, { corpo: HTMLCanvasElement; volante: HTMLCanvasElement }>();

/**
 * Desenha o cockpit 3D (false = use o vetor). `steer` -1..1, `kmh`, `gear` e `rev` (0..1, luzes de giro).
 * Ocupa a largura toda, encostado embaixo: a pista aparece por cima do halo.
 */
export function drawCockpit3d(g: CanvasRenderingContext2D, W: number, H: number, team: Team, steer: number, kmh: number, gear: string, rev: number, dark: boolean): boolean {
  if (!car3dPref.on || !ready() || !assets) return false;
  const key = `${team.id}|${liveryKey(team.livery)}`;
  let p = cache.get(key);
  if (!p) {
    if (cache.size > 20) cache.clear();
    const lv = team.livery;
    const body = rgb(lv?.base ?? team.color), wing = rgb(lv?.wing ?? lv?.accent ?? team.accent);
    p = { corpo: paint(assets.corpo, body, wing), volante: paint(assets.volante, body, wing) };
    cache.set(key, p);
  }
  const { info } = assets;
  // encostado embaixo e um pouco cortado (14%), pra sobrar mais pista por cima do halo
  const s = W / info.w, y0 = H - info.h * s * 0.86;
  g.save();
  if (dark) g.filter = "brightness(0.62)";
  g.drawImage(p.corpo, 0, y0, W, info.h * s);
  // volante: gira em volta do centro dele
  const [wx0, wy0, wx1, wy1] = info.wheel;
  const cx = ((wx0 + wx1) / 2) * W, cy = y0 + ((wy0 + wy1) / 2) * info.h * s;
  g.translate(cx, cy);
  g.rotate(steer * 0.85);
  g.translate(-cx, -cy);
  g.drawImage(p.volante, 0, y0, W, info.h * s);
  g.filter = "none";
  // telinha do volante: marcha, velocidade e luzes de giro (giram junto)
  const [dx0, dy0, dx1, dy1] = info.display;
  const x = dx0 * W, y = y0 + dy0 * info.h * s, w = (dx1 - dx0) * W, h = (dy1 - dy0) * info.h * s;
  g.fillStyle = "#05070a";
  g.fillRect(x + w * 0.04, y + h * 0.08, w * 0.92, h * 0.84);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#e9edf5";
  g.font = `700 ${Math.max(7, Math.round(h * 0.55))}px "Oswald", sans-serif`;
  g.fillText(gear, x + w * 0.3, y + h * 0.56);
  g.fillStyle = "#9fe2ff";
  g.font = `700 ${Math.max(6, Math.round(h * 0.32))}px "Oswald", sans-serif`;
  g.fillText(String(kmh), x + w * 0.7, y + h * 0.56);
  for (let i = 0; i < 10; i++) {
    const on = i / 10 < rev;
    g.fillStyle = !on ? "#1d2027" : i < 4 ? "#3bd16f" : i < 7 ? "#ff3b3b" : "#3b8bff";
    g.fillRect(x + w * 0.06 + (i * w * 0.88) / 10, y + h * 0.14, (w * 0.88) / 10 - 1, h * 0.12);
  }
  g.restore();
  return true;
}
