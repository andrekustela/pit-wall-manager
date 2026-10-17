import type { Team } from "../sim/types";

export const CAR_LEN = 12; // px (apontando pra +x)
export const CAR_WID = 6;

const cache = new Map<string, HTMLCanvasElement>();

/** Sprite top-down de F1 em pixel art, 12x6, frente pra direita. */
export function carSprite(team: Team): HTMLCanvasElement {
  const hit = cache.get(team.id);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = CAR_LEN;
  c.height = CAR_WID;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  // pneus
  px(1, 0, 3, 1, "#111");
  px(1, 5, 3, 1, "#111");
  px(8, 0, 2, 1, "#111");
  px(8, 5, 2, 1, "#111");
  // asa traseira
  px(0, 1, 1, 4, team.accent);
  // carroceria
  px(1, 2, 10, 2, team.color);
  px(3, 1, 5, 4, team.color);
  // detalhe lateral
  px(4, 1, 3, 1, team.accent);
  px(4, 4, 3, 1, team.accent);
  // cockpit + capacete
  px(6, 2, 2, 2, "#1a1a1a");
  px(6, 2, 1, 2, "#f5d742");
  // asa dianteira
  px(11, 0, 1, 6, team.accent);
  cache.set(team.id, c);
  return c;
}

const scCache = new Map<boolean, HTMLCanvasElement>();

/** carro de segurança: carro esporte prata com giroflex laranja piscando */
export function safetyCarSprite(blink: boolean): HTMLCanvasElement {
  const hit = scCache.get(blink);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 12;
  c.height = 6;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  px(1, 0, 2, 1, "#111");
  px(1, 5, 2, 1, "#111");
  px(8, 0, 2, 1, "#111");
  px(8, 5, 2, 1, "#111");
  px(0, 1, 12, 4, "#d9dde3");
  px(4, 1, 4, 4, "#1d2738"); // vidros
  px(5, 1, 2, 4, "#d9dde3"); // teto
  px(5, 1, 1, 2, blink ? "#ffb000" : "#5a3a00");
  px(5, 3, 1, 2, blink ? "#5a3a00" : "#ffb000");
  px(11, 1, 1, 1, "#fff6b0");
  px(11, 4, 1, 1, "#fff6b0");
  scCache.set(blink, c);
  return c;
}
