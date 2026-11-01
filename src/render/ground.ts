// Que chão tem num ponto da volta (s, lateral): pros efeitos de acidente (a marca e a sujeira dependem dele:
// borracha no asfalto, sulco na brita, lama na grama). Com o autódromo 3D montado, pelas áreas e zebras dele (a
// de cima vale); sem ele (ou fora das áreas), pela mesma regra da beira da pista automática (track3d): por fora
// das curvas fechadas faixa/concreto até 6,5 m e brita até 10 m; no resto, grama; rua é concreto.
// (sem importar o 3D: as funções das linhas vêm de quem já tem ele carregado, cars3dReal)
import { TRACK_WIDTH, angDiff, type Track } from "../sim/track";
import type { PathItem } from "./paths3d";

/** as linhas e áreas do autódromo 3D montado, e como ler elas (paths3d.orderOf / samplePath) */
export interface GroundSrc {
  items: readonly PathItem[];
  orderOf: (it: PathItem) => number;
  samplePath: (it: PathItem, step?: number) => [number, number][];
}

export type Ground = "asfalto" | "zebra" | "concreto" | "grama" | "brita" | "areia";
/** chão solto: o carro deixa sulco/trilha e joga terra ou pedra */
export const looseGround = (g: Ground) => g === "grama" || g === "brita" || g === "areia";

const AREA: Partial<Record<PathItem["t"], Ground>> = { brita: "brita", grama: "grama", areia: "areia", concreto: "concreto", asfalto: "asfalto", pintura: "asfalto", rua: "asfalto", caminho: "concreto" };

type Poly = { g: Ground; pts: [number, number][]; x0: number; x1: number; y0: number; y1: number };
const inPoly = (x: number, y: number, pts: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** a consulta do chão desta pista (`src`: as linhas e áreas do autódromo 3D, se montado) */
export function groundMap(track: Track, src?: GroundSrc | null): (s: number, lat: number) => Ground {
  const W2 = TRACK_WIDTH / 2, street = !!track.def.street;
  // áreas de cima pra baixo (a de ordem maior fica por cima) e as zebras como pontos a cada 1 m
  const polys: Poly[] = [];
  const zebra: [number, number, number][] = [];
  for (const it of [...(src?.items ?? [])].sort((a, b) => src!.orderOf(b) - src!.orderOf(a))) {
    const g = AREA[it.t];
    if (it.t === "zebra") for (const [x, y] of src!.samplePath(it, 1)) zebra.push([x, y, ((it.w ?? 1.5) / 2 + 0.2) ** 2]);
    else if (g && it.p.length > 2) {
      const pts = it.reto ? it.p : src!.samplePath(it, 2);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      polys.push({ g, pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
  }
  const turn = (s: number) => angDiff(track.pose(track.wrap(s - 20), 0).h, track.pose(track.wrap(s + 20), 0).h);
  return (s, lat) => {
    const d = Math.abs(lat) - W2;
    if (d <= 0) return "asfalto";
    if (polys.length || zebra.length) {
      const p = track.pose(track.wrap(s), lat);
      for (const [x, y, r2] of zebra) if ((x - p.x) ** 2 + (y - p.y) ** 2 < r2) return "zebra";
      for (const q of polys) if (p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1 && inPoly(p.x, p.y, q.pts)) return q.g;
    }
    if (street) return "concreto";
    const t = turn(s);
    if (Math.abs(t) > 0.45 && (t > 0 ? -1 : 1) === Math.sign(lat)) return d < 1.4 ? "zebra" : d < 6.5 ? "concreto" : d < 10 ? "brita" : "grama";
    return "grama";
  };
}
