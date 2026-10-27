// O que passa nos telões do autódromo 3D: a classificação ao vivo (posição, piloto, diferença), a volta e o
// safety car. Uma textura só, usada por todos os telões; a corrida atualiza umas duas vezes por segundo.
import * as THREE from "three";
import type { Race } from "../sim/race";

const W = 512, H = 288;
let cv: HTMLCanvasElement | null = null;
let tex: THREE.CanvasTexture | null = null;
let last = 0;

/** a textura dos telões (até a corrida mandar algo: o logo do jogo) */
export function liveScreenTexture() {
  if (tex) return tex;
  cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#0d1626";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#e32222";
  g.font = "bold 46px 'Arial Black', Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("PIT WALL", W / 2, H / 2 - 22);
  g.fillStyle = "#ffffff";
  g.font = "bold 30px Arial, sans-serif";
  g.fillText("MANAGER", W / 2, H / 2 + 26);
  tex.needsUpdate = true;
  return tex;
}

/** redesenha a classificação (no máximo ~2 vezes por segundo) */
export function updateLiveScreen(race: Race) {
  if (!tex || !cv) return;
  const now = performance.now();
  if (now - last < 500) return;
  last = now;
  const g = cv.getContext("2d")!;
  const sc = race.sc.active && !race.checkered;
  g.fillStyle = "#0d1626";
  g.fillRect(0, 0, W, H);
  // cabeçalho: volta (ou safety car / final)
  g.fillStyle = sc ? "#f6d21a" : "#e32222";
  g.fillRect(0, 0, W, 40);
  g.fillStyle = sc ? "#111" : "#fff";
  g.font = "bold 24px Arial, sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText(sc ? "SAFETY CAR" : "CLASSIFICAÇÃO", 14, 21);
  g.textAlign = "right";
  g.fillText(race.checkered ? "FINAL" : `VOLTA ${race.currentLap()}/${race.laps}`, W - 14, 21);
  // as 10 primeiras posições em duas colunas
  const order = [...race.cars].sort((a, b) => a.position - b.position).slice(0, 10);
  const gaps = order.map((c) => race.gapToLeader(c));
  order.forEach((c, i) => {
    const col = i < 5 ? 0 : 1, row = i % 5;
    const x = 10 + col * (W / 2), y = 52 + row * 46;
    g.fillStyle = row % 2 ? "#15213a" : "#111b30";
    g.fillRect(x, y, W / 2 - 20, 42);
    g.fillStyle = "#fff";
    g.font = "bold 24px Arial, sans-serif";
    g.textAlign = "right";
    g.fillText(String(c.position), x + 32, y + 22);
    g.fillStyle = c.team.color;
    g.fillRect(x + 40, y + 7, 6, 28);
    g.fillStyle = "#fff";
    g.textAlign = "left";
    g.fillText(c.driver.short, x + 54, y + 22);
    const gp = gaps[i];
    const txt = c.retired ? "OUT" : c.pit !== "none" && c.pit !== "parked" && !c.finished ? "BOX" : i === 0 ? "LÍDER" : gp.laps > 0 ? `+${gp.laps}V` : `+${gp.seconds.toFixed(1)}`;
    g.fillStyle = txt === "OUT" ? "#ff6b6b" : txt === "BOX" ? "#f6d21a" : "#9fb3d1";
    g.font = "bold 20px Arial, sans-serif";
    g.textAlign = "right";
    g.fillText(txt, x + W / 2 - 30, y + 22);
  });
  tex.needsUpdate = true;
}
