import type { Team } from "../sim/types";

// Carro visto de cima, frente pra direita (+x). 16 x 7 px ≈ 5,3 m x 2,3 m a 3 px/m.
export const CAR_LEN = 16;
export const CAR_WID = 7;

/**
 * Mapa do carro (uma letra por pixel, traseira à esquerda):
 *   A = asa (cor de destaque)   B = carroceria   L = carroceria clara (luz de cima)
 *   D = carroceria escura       K = pneu         k = banda do pneu
 *   G = assoalho/difusor        H = capacete     V = halo / cockpit
 *   S = faixa da pintura (cor de destaque) ao longo do carro
 *   R = luz de chuva traseira   . = vazio
 */
const CAR_MAP = [
  "AKKK.......KKK.A",
  "AKkKLLLLL..KkKAA",
  "AGGLLBBBBLBBB.AA",
  "RSSSSSSSHVBBBBBA",
  "AGGDDDDDDDDDD.AA",
  "AKkKDDDDD..KkKAA",
  "AKKK.......KKK.A",
];

const SC_MAP = [
  "..KK.......KK...",
  ".WWWWWWWWWWWWWW.",
  "WWWWGGGOOGGWWWWY",
  "WWWWGGGWWGGWWWWW",
  "WWWWGGGooGGWWWWY",
  ".WWWWWWWWWWWWWW.",
  "..KK.......KK...",
];

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function paint(map: string[], pal: Record<string, string>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = map[0].length;
  c.height = map.length;
  const g = c.getContext("2d")!;
  map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const col = pal[ch];
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();

/** Sprite do carro da equipe. `rainLight` acende a luz vermelha traseira (chuva). */
export function carSprite(team: Team, rainLight = false): HTMLCanvasElement {
  const key = `${team.id}|${rainLight}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = paint(CAR_MAP, {
    A: team.accent,
    S: shade(team.accent, team.accent === team.color ? 0.4 : 0),
    B: team.color,
    L: shade(team.color, 0.28),
    D: shade(team.color, -0.32),
    K: "#121212",
    k: "#2e2e2e",
    G: "#1d1f24",
    H: "#f5d742",
    V: "#0b0b0d",
    R: rainLight ? "#ff2a2a" : "#3a0f0f",
  });
  cache.set(key, c);
  return c;
}

const scCache = new Map<boolean, HTMLCanvasElement>();

/** carro de segurança: esportivo prata com giroflex laranja piscando */
export function safetyCarSprite(blink: boolean): HTMLCanvasElement {
  const hit = scCache.get(blink);
  if (hit) return hit;
  const c = paint(SC_MAP, {
    W: "#d9dde3",
    G: "#1d2738",
    K: "#121212",
    O: blink ? "#ffb000" : "#5a3a00",
    o: blink ? "#5a3a00" : "#ffb000",
    Y: "#fff6b0",
  });
  scCache.set(blink, c);
  return c;
}
