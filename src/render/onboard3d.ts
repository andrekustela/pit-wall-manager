// Cockpit 3D da câmera onboard (render do Blender nos olhos do piloto: art/render_onboard.py),
// pintado com as cores da equipe. O volante e os braços do piloto vêm parados e o jogo gira os dois
// juntos (suave); o braço já vem sumindo perto de onde o cockpit o corta. A telinha do volante mostra
// marcha e velocidade. Sem os arquivos (ou com o 2D clássico), a onboard usa o vetor.
import type { Team } from "../sim/types";
import { liveryKey } from "../sim/livery";
import { car3dPref } from "./car3d";

interface Info {
  w: number;
  h: number;
  wheel: [number, number, number, number];
  display: [number, number, number, number];
  /** volante: onde fica o recorte (px) e os cantos do vidro da telinha (sup. esq., sup. dir., inf. esq., fração) */
  wheelCrop: [number, number, number, number];
  quad: [number, number][];
  /** giro máximo do volante (rad) e onde fica o recorte dos braços (px) */
  max: number;
  armsCrop: [number, number, number, number];
}
let assets: { info: Info; corpo: [ImageData, ImageData]; volante: [ImageData, ImageData]; bracos: HTMLImageElement } | null = null;
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
        i.src = `/onboard/${n.includes(".") ? n : n + ".png"}`;
      });
    void fetch("/onboard/info.json")
      .then((r) => r.json() as Promise<Info>)
      .then(async (info) => {
        if (!info.wheelCrop) throw new Error("formato antigo");
        const [bc, mc, bv, mv, br] = await Promise.all(["base_corpo", "mask_corpo", "base_volante", "mask_volante", "base_bracos"].map(img));
        assets = { info, corpo: [pixels(bc), pixels(mc)], volante: [pixels(bv), pixels(mv)], bracos: br };
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
/** volante suavizado (ângulo em rad) e hora do último quadro */
const wheelSm = { a: 0, t: 0 };

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
  const px = (fx: number, fy: number) => [fx * W, y0 + fy * info.h * s];
  g.save();
  if (dark) g.filter = "brightness(0.62)";
  g.drawImage(p.corpo, 0, y0, W, info.h * s);
  // volante suavizado (a direção chega tremida)
  const now = performance.now(), dt = Math.min(0.1, (now - wheelSm.t) / 1000);
  wheelSm.t = now;
  wheelSm.a += (steer * 0.85 - wheelSm.a) * Math.min(1, dt * 10);
  const a = Math.max(-info.max, Math.min(info.max, wheelSm.a));
  // ---- volante: gira em volta do centro dele, com a telinha ----
  const [wx0, wy0, wx1, wy1] = info.wheel;
  const [cx, cy] = px((wx0 + wx1) / 2, (wy0 + wy1) / 2);
  const [vx, vy, vw, vh] = info.wheelCrop;
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.translate(-cx, -cy);
  g.drawImage(p.volante, vx * s, y0 + vy * s, vw * s, vh * s);
  g.save();
  const [tl, tr, bl] = info.quad.map(([qx, qy]) => px(qx, qy));
  const lu = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]), lv = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  g.transform((tr[0] - tl[0]) / lu, (tr[1] - tl[1]) / lu, (bl[0] - tl[0]) / lv, (bl[1] - tl[1]) / lv, tl[0], tl[1]);
  g.filter = "none";
  // a tela cinza do render ocupa esta fração do vidro
  drawDisplay(g, lu * 0.15, lv * 0.22, lu * 0.69, lv * 0.74, gear, kmh, rev);
  g.restore();
  // ---- braços: presos no volante, giram junto ----
  const [ax, ay, aw, ah] = info.armsCrop;
  g.drawImage(assets.bracos, ax * s, y0 + ay * s, aw * s, ah * s);
  g.restore();
  g.restore();
  return true;
}

/** telinha do volante: marcha, velocidade e luzes de giro */
function drawDisplay(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, gear: string, kmh: number, rev: number) {
  const glass = g.createLinearGradient(0, y, 0, y + h);
  glass.addColorStop(0, "#0d1118");
  glass.addColorStop(1, "#040507");
  g.fillStyle = glass;
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(1, h * 0.12));
  g.fill();
  g.save();
  g.clip();
  // luzes de giro: uma fileira fina no alto
  const n = 10, lw = (w * 0.86) / n;
  for (let i = 0; i < n; i++) {
    const on = i / n < rev;
    g.fillStyle = !on ? "#1a1d24" : i < 4 ? "#3bd16f" : i < 7 ? "#ff3b3b" : "#4a8cff";
    g.fillRect(x + w * 0.07 + i * lw + lw * 0.12, y + h * 0.1, lw * 0.76, Math.max(1, h * 0.1));
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f2f4f8";
  g.font = `600 ${Math.max(6, Math.round(h * 0.6))}px "Oswald", sans-serif`;
  g.fillText(gear, x + w * 0.27, y + h * 0.6);
  g.fillStyle = "#9fe2ff";
  g.font = `600 ${Math.max(5, Math.round(h * 0.34))}px "Oswald", sans-serif`;
  g.fillText(String(kmh), x + w * 0.68, y + h * 0.54);
  g.fillStyle = "#6c7684";
  g.font = `500 ${Math.max(4, Math.round(h * 0.14))}px "Oswald", sans-serif`;
  g.fillText("KM/H", x + w * 0.68, y + h * 0.8);
  // reflexo do vidro
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.fillRect(x, y, w, h * 0.35);
  g.restore();
}

// ---------- carros à frente (vistos de trás) ----------
// em vários ângulos (yaw > 0 = o bico aponta pra direita da tela): na curva aparece a lateral
interface RearFrame { base: ImageData; mask: ImageData; widM: number; ground: number }
let rear: { frames: RearFrame[]; yaws: number[] } | null = null;
let rearLoading = false;
const rearCache = new Map<string, HTMLCanvasElement[]>();

/** linha do chão: a última com pixel (embaixo dos pneus) */
function groundOf(base: ImageData) {
  for (let y = base.height - 1; y > 0; y--)
    for (let x = 0; x < base.width; x++) if (base.data[(y * base.width + x) * 4 + 3] > 20) return y;
  return base.height - 1;
}

function rearReady(): boolean {
  if (rear) return true;
  if (!rearLoading) {
    rearLoading = true;
    const img = (n: string) =>
      new Promise<HTMLImageElement>((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = fail;
        i.src = `/onboard/${n}.png`;
      });
    void fetch("/onboard/tras.json")
      .then((r) => r.json() as Promise<{ yaws: number[]; widsM: number[] }>)
      .then(async (info) => {
        const frames = await Promise.all(
          info.yaws.map(async (_, i) => {
            const [b, m] = await Promise.all([img(`base_tras${i}`), img(`mask_tras${i}`)]);
            const base = pixels(b);
            return { base, mask: pixels(m), widM: info.widsM[i], ground: groundOf(base) };
          }),
        );
        rear = { frames, yaws: info.yaws };
      })
      .catch(() => {});
  }
  return false;
}

/**
 * carro à frente na onboard, visto de trás (false = use o vetor). (x, y) = ponto no chão; k = px por metro;
 * yaw = pra onde o bico dele aponta em relação à linha de visão (graus, > 0 = direita da tela)
 */
export function drawRearCar(g: CanvasRenderingContext2D, team: Team, x: number, y: number, k: number, rainLight: boolean, yaw = 0): boolean {
  if (!car3dPref.on || !rearReady() || !rear) return false;
  const key = `${team.id}|${liveryKey(team.livery)}`;
  let cs = rearCache.get(key);
  if (!cs) {
    if (rearCache.size > 30) rearCache.clear();
    const lv = team.livery;
    const body = rgb(lv?.base ?? team.color), wing = rgb(lv?.wing ?? lv?.accent ?? team.accent);
    cs = rear.frames.map((f) => paint([f.base, f.mask], body, wing));
    rearCache.set(key, cs);
  }
  // ângulo mais perto
  let i = 0;
  rear.yaws.forEach((v, j) => {
    if (Math.abs(v - yaw) < Math.abs(rear!.yaws[i] - yaw)) i = j;
  });
  const c = cs[i], f = rear.frames[i];
  // escala: a imagem tem widM metros de largura
  const s = k / (c.width / f.widM);
  const w = c.width * s, h = c.height * s;
  // sombra no chão
  g.fillStyle = "rgba(0,0,0,.35)";
  g.beginPath();
  g.ellipse(x, y, w * 0.45, Math.max(1, k * 0.16), 0, 0, Math.PI * 2);
  g.fill();
  g.drawImage(c, x - w / 2, y - f.ground * s, w, h);
  if (rainLight && Math.abs(rear.yaws[i]) < 30) {
    g.fillStyle = "#ff3030";
    g.shadowColor = "#ff3030";
    g.shadowBlur = Math.max(2, k * 0.25);
    g.fillRect(x - k * 0.05, y - k * 0.5, k * 0.1, k * 0.07);
    g.shadowBlur = 0;
  }
  return true;
}
