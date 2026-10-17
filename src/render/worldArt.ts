// Pré-renderiza o circuito inteiro num canvas grande (pixel art).
import { TEAMS } from "../sim/data";
import { Rng } from "../sim/rng";
import { PIT_LATERAL, TRACK_WIDTH, Track } from "../sim/track";

export const PPM = 2; // pixels por metro
const MARGIN = 160; // m

export interface World {
  canvas: HTMLCanvasElement;
  /** offset do mundo (m) -> pixel: (x - minX) * PPM */
  minX: number;
  minY: number;
}

export function buildWorld(track: Track): World {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of track.pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  minX -= MARGIN; minY -= MARGIN; maxX += MARGIN; maxY += MARGIN;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((maxX - minX) * PPM);
  canvas.height = Math.ceil((maxY - minY) * PPM);
  const g = canvas.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const rng = new Rng(1234);

  const W = (x: number) => (x - minX) * PPM;
  const H = (y: number) => (y - minY) * PPM;
  const P = (s: number, lat: number) => {
    const p = track.pose(s, lat);
    return [W(p.x), H(p.y)] as const;
  };

  // ---- grama com faixas de corte ----
  g.fillStyle = track.def.grass[0];
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 48) {
    g.fillStyle = (y / 48) % 2 ? track.def.grass[0] : track.def.grass[1];
    g.fillRect(0, y, canvas.width, 48);
  }
  speckle(g, rng, 0, 0, canvas.width, canvas.height, ["#367c33", "#4a9a45", "#2f7330"], 0.05);

  // ---- caminho fechado ao longo da pista ----
  const strokeAlong = (lat: number, width: number, color: string, from = 0, to = track.L, closed = true) => {
    g.beginPath();
    for (let s = from; s <= to; s += 2) {
      const [x, y] = P(s, lat);
      if (s === from) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (closed) g.closePath();
    g.strokeStyle = color;
    g.lineWidth = width * PPM;
    g.lineJoin = "round";
    g.lineCap = "butt";
    g.stroke();
  };

  // área de escape (cinza claro) em curvas
  for (let s = 0; s < track.L; s += 1) {
    const k = Math.abs(track.curvature[s]);
    if (k < 1 / 260) continue;
    const side = track.curvature[s] > 0 ? -1 : 1; // lado de fora
    const [x, y] = P(s, side * (TRACK_WIDTH / 2 + 9));
    g.fillStyle = "#b8a77a";
    g.fillRect(x - 18, y - 18, 36, 36);
  }
  speckleTrackBand(g, track, P, rng);

  // borda escura + asfalto
  strokeAlong(0, TRACK_WIDTH + 3, "#2a2a2e");
  strokeAlong(0, TRACK_WIDTH, "#55565c");
  // textura do asfalto
  for (let s = 0; s < track.L; s += 0.5) {
    const lat = rng.range(-TRACK_WIDTH / 2 + 0.5, TRACK_WIDTH / 2 - 0.5);
    const [x, y] = P(s, lat);
    g.fillStyle = rng.chance(0.5) ? "#4d4e54" : "#5e5f66";
    g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
  }
  // linha de borracha (traçado)
  for (let s = 0; s < track.L; s += 0.5) {
    const lat = track.curvature[Math.floor(s)] * 900 + rng.gauss(0.8);
    const l = Math.max(-TRACK_WIDTH / 2 + 2, Math.min(TRACK_WIDTH / 2 - 2, lat));
    const [x, y] = P(s, l);
    g.fillStyle = "rgba(30,30,34,0.35)";
    g.fillRect(Math.floor(x), Math.floor(y), 2, 2);
  }

  // linhas brancas de borda
  for (const side of [-1, 1]) {
    for (let s = 0; s < track.L; s += 0.5) {
      const [x, y] = P(s, side * (TRACK_WIDTH / 2 - 0.4));
      g.fillStyle = "#e8e8e8";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }

  // zebras nas curvas
  for (let s = 0; s < track.L; s += 0.5) {
    const k = Math.abs(track.curvature[Math.floor(s)]);
    if (k < 1 / 300) continue;
    const red = Math.floor(s / 3) % 2 === 0;
    for (const side of [-1, 1]) {
      for (let d = 0; d < 1.5; d += 0.5) {
        const [x, y] = P(s, side * (TRACK_WIDTH / 2 + d));
        g.fillStyle = red ? "#d42a2a" : "#f2f2f2";
        g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      }
    }
  }

  // ---- pit lane ----
  const entry = track.pitEntryS;
  const exit = track.pitExitS + track.L;
  for (let s = entry; s <= exit; s += 0.5) {
    const lat = track.pitLateralAt(s);
    for (let d = -4.5; d <= 4.5; d += 0.5) {
      const [x, y] = P(s, lat + d);
      g.fillStyle = Math.abs(d) > 4 ? "#2a2a2e" : rng.chance(0.15) ? "#4a4b51" : "#56575d";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }
  // muro do pit (entre pista e pit lane) na parte reta
  for (let s = entry + 80; s <= exit - 80; s += 0.5) {
    for (let d = 0; d < 1.5; d += 0.5) {
      const [x, y] = P(s, TRACK_WIDTH / 2 + 3 + d);
      g.fillStyle = Math.floor(s / 6) % 2 ? "#cfcfcf" : "#9a9a9a";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }
  // garagens por equipe
  const span = track.wrap(track.pitBoxEnd - track.pitBoxStart);
  TEAMS.forEach((team, i) => {
    const center = track.pitBoxStart + (span * (i + 0.5)) / TEAMS.length;
    const half = (span / TEAMS.length) * 0.42;
    for (let s = center - half; s <= center + half; s += 0.5) {
      for (let d = 5; d <= 16; d += 0.5) {
        const [x, y] = P(s, PIT_LATERAL + d);
        let col = d < 6 ? team.color : d > 15 ? "#20242c" : "#3a3f4a";
        if (d >= 6 && d < 8) col = "#5b616e";
        g.fillStyle = col;
        g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      }
      // caixa de parada pintada no chão
      const [bx, by] = P(s, PIT_LATERAL + 3);
      g.fillStyle = team.color;
      g.fillRect(Math.floor(bx), Math.floor(by), 1, 1);
    }
  });

  // ---- largada/chegada (quadriculado) ----
  for (let d = -TRACK_WIDTH / 2; d < TRACK_WIDTH / 2; d += 0.5) {
    for (let k = 0; k < 4; k++) {
      const [x, y] = P(k * 0.5, d);
      const on = (Math.floor(d * 2) + k) % 2 === 0;
      g.fillStyle = on ? "#f5f5f5" : "#141414";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }
  // marcas do grid
  for (let i = 0; i < 20; i++) {
    const s = track.L - 14 - i * 8 + 3.5;
    const lat = i % 2 === 0 ? -3 : 3;
    for (let d = -1.5; d <= 1.5; d += 0.5) {
      const [x, y] = P(s, lat + d);
      g.fillStyle = "#e8e8e8";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }

  // ---- arquibancadas ao longo da reta principal ----
  for (let s = track.L - 320; s < track.L + 260; s += 0.5) {
    for (let d = 0; d < 16; d += 0.5) {
      const [x, y] = P(s, -(TRACK_WIDTH / 2 + 7 + d));
      let col: string;
      if (d < 1) col = "#9aa0aa"; // grade
      else if (d > 14) col = "#2b2f38"; // telhado
      else {
        const row = Math.floor(d) % 2 === 0;
        col = row ? "#4a505c" : CROWD[Math.floor(rng.next() * CROWD.length)];
      }
      g.fillStyle = col;
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }
  // placas de patrocínio na grade
  const signs = ["#e8202a", "#1c6ed4", "#f2c230", "#16c2b0", "#ffffff"];
  for (let s = track.L - 300, i = 0; s < track.L + 240; s += 40, i++) {
    for (let k = 0; k < 24; k += 0.5) {
      for (let d = 0; d < 1.5; d += 0.5) {
        const [x, y] = P(s + k, -(TRACK_WIDTH / 2 + 5 + d));
        g.fillStyle = signs[i % signs.length];
        g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      }
    }
  }

  // ---- árvores longe da pista ----
  const near = nearGrid(track);
  for (let i = 0; i < 2600; i++) {
    const x = rng.range(minX, maxX), y = rng.range(minY, maxY);
    if (near(x, y, 45)) continue;
    const r = rng.range(3, 7) * PPM;
    const px = W(x), py = H(y);
    g.fillStyle = "#1f5a24";
    g.beginPath(); g.arc(px + 2, py + 2, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#2b7030";
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#3a8a3c";
    g.beginPath(); g.arc(px - r * 0.3, py - r * 0.3, r * 0.45, 0, Math.PI * 2); g.fill();
  }

  return { canvas, minX, minY };
}

const CROWD = ["#e8202a", "#f2f2f2", "#1c6ed4", "#f2c230", "#ff8a1c", "#16c2b0", "#d8b48a", "#7b3fe4", "#222"];

function speckle(g: CanvasRenderingContext2D, rng: Rng, x0: number, y0: number, w: number, h: number, cols: string[], density: number) {
  const n = Math.floor(w * h * density);
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[Math.floor(rng.next() * cols.length)];
    g.fillRect(Math.floor(x0 + rng.next() * w), Math.floor(y0 + rng.next() * h), 1, 1);
  }
}

function speckleTrackBand(
  g: CanvasRenderingContext2D,
  track: Track,
  P: (s: number, lat: number) => readonly [number, number],
  rng: Rng,
) {
  // pedrisco na brita
  for (let s = 0; s < track.L; s += 0.5) {
    const k = Math.abs(track.curvature[Math.floor(s)]);
    if (k < 1 / 260) continue;
    const side = track.curvature[Math.floor(s)] > 0 ? -1 : 1;
    for (let j = 0; j < 4; j++) {
      const [x, y] = P(s, side * rng.range(TRACK_WIDTH / 2 + 1, TRACK_WIDTH / 2 + 17));
      g.fillStyle = rng.chance(0.5) ? "#a39268" : "#cbbb8d";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
  }
}

function nearGrid(track: Track) {
  const cell = 20;
  const set = new Set<string>();
  for (let s = 0; s < track.L; s += 5) {
    const p = track.pts[s];
    set.add(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`);
  }
  return (x: number, y: number, dist: number) => {
    const r = Math.ceil(dist / cell);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) if (set.has(`${cx + dx},${cy + dy}`)) return true;
    return false;
  };
}
