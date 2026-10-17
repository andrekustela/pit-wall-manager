// Carro de F1 em vetor, visto de cima (frente pra +x), desenhado UMA vez por
// equipe numa imagem de alta resolução e depois só girado/escalado a cada frame.
import type { Team } from "../sim/types";

/** tamanho real do carro (m) */
export const CAR_LEN_M = 4.3;
/** o desenho foi feito com 5,6 m; encolhe no comprimento pra não parecer espichado */
const SQUASH = CAR_LEN_M / 5.6;
export const CAR_WID_M = 2.0;
/** resolução da imagem pré-desenhada (pixels por metro) */
const RES = 40;
/** sobra em volta (m), pra sombra */
const PAD = 0.35;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

export interface CarImage {
  canvas: HTMLCanvasElement;
  /** tamanho total da imagem em metros (com a sobra) */
  wM: number;
  hM: number;
}

const cache = new Map<string, CarImage>();

export function carImage(team: Team, rainLight = false, safety = false): CarImage {
  const key = `${safety ? "SC" : team.id}|${rainLight}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const wM = CAR_LEN_M + PAD * 2, hM = CAR_WID_M + PAD * 2;
  const cv = document.createElement("canvas");
  cv.width = Math.round(wM * RES);
  cv.height = Math.round(hM * RES);
  const g = cv.getContext("2d")!;
  g.translate(cv.width / 2, cv.height / 2);
  g.scale(RES, RES);
  g.scale(SQUASH, 1);
  if (safety) drawSafetyCar(g, rainLight);
  else drawF1(g, team, rainLight);
  const img = { canvas: cv, wM, hM };
  cache.set(key, img);
  return img;
}

// ---------- peças ----------

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function tyre(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "#2b2b2e");
  grad.addColorStop(0.5, "#141416");
  grad.addColorStop(1, "#08080a");
  rr(g, x, y, w, h, 0.07);
  g.fillStyle = grad;
  g.fill();
  // sulco/brilho da borracha
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(x + 0.04, y + h * 0.18, w - 0.08, h * 0.12);
}

function arm(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = "#1a1b1f";
  g.lineWidth = 0.045;
  g.stroke();
}

function drawF1(g: CanvasRenderingContext2D, team: Team, rainLight: boolean) {
  const body = team.color;
  const acc = team.accent;

  // sombra no chão
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 0.25 * RES;
  g.shadowOffsetX = 0.12 * RES;
  g.shadowOffsetY = 0.16 * RES;
  rr(g, -2.75, -0.78, 5.45, 1.56, 0.4);
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fill();
  g.restore();

  // assoalho (floor) escuro, por baixo de tudo
  g.beginPath();
  g.moveTo(-2.25, -0.55);
  g.lineTo(0.5, -0.74);
  g.lineTo(1.05, -0.45);
  g.lineTo(1.05, 0.45);
  g.lineTo(0.5, 0.74);
  g.lineTo(-2.25, 0.55);
  g.closePath();
  g.fillStyle = "#18191d";
  g.fill();

  // suspensão (braços) — atrás do corpo
  for (const s of [-1, 1]) {
    arm(g, -2.05, 0.18 * s, -2.0, 0.8 * s);
    arm(g, -1.75, 0.22 * s, -1.95, 0.8 * s);
    arm(g, 1.45, 0.1 * s, 1.75, 0.78 * s);
    arm(g, 1.95, 0.09 * s, 1.8, 0.78 * s);
  }

  // pneus traseiros (largos) e dianteiros
  tyre(g, -2.42, 0.6, 0.74, 0.4);
  tyre(g, -2.42, -1.0, 0.74, 0.4);
  tyre(g, 1.48, 0.63, 0.62, 0.35);
  tyre(g, 1.48, -0.98, 0.62, 0.35);

  // carroceria: laterais largas que afinam no cockpit e viram bico
  const bodyGrad = g.createLinearGradient(0, -0.7, 0, 0.7);
  bodyGrad.addColorStop(0, shade(body, 0.35));
  bodyGrad.addColorStop(0.45, body);
  bodyGrad.addColorStop(1, shade(body, -0.38));
  g.beginPath();
  g.moveTo(-2.35, -0.2);
  g.bezierCurveTo(-1.8, -0.32, -1.3, -0.62, -0.75, -0.64);
  g.bezierCurveTo(-0.1, -0.66, 0.25, -0.6, 0.45, -0.38);
  g.bezierCurveTo(0.7, -0.24, 0.95, -0.17, 1.2, -0.14);
  g.lineTo(2.3, -0.075);
  g.quadraticCurveTo(2.42, 0, 2.3, 0.075);
  g.lineTo(1.2, 0.14);
  g.bezierCurveTo(0.95, 0.17, 0.7, 0.24, 0.45, 0.38);
  g.bezierCurveTo(0.25, 0.6, -0.1, 0.66, -0.75, 0.64);
  g.bezierCurveTo(-1.3, 0.62, -1.8, 0.32, -2.35, 0.2);
  g.closePath();
  g.fillStyle = bodyGrad;
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 0.025;
  g.stroke();

  // entradas de ar das laterais
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0.3, 0.42 * s);
    g.quadraticCurveTo(0.1, 0.6 * s, -0.15, 0.62 * s);
    g.lineTo(-0.12, 0.5 * s);
    g.quadraticCurveTo(0.08, 0.48 * s, 0.22, 0.38 * s);
    g.closePath();
    g.fillStyle = "#0d0e11";
    g.fill();
    // grelha de refrigeração (riscos) no fundo das laterais
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 0.02;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(-1.55 + i * 0.12, 0.42 * s);
      g.lineTo(-1.45 + i * 0.12, 0.55 * s);
      g.stroke();
    }
  }

  // faixa da pintura ao longo da capa do motor e do bico
  g.beginPath();
  g.moveTo(-2.3, -0.06);
  g.lineTo(0.3, -0.1);
  g.lineTo(2.25, -0.03);
  g.lineTo(2.25, 0.03);
  g.lineTo(0.3, 0.1);
  g.lineTo(-2.3, 0.06);
  g.closePath();
  g.fillStyle = acc;
  g.fill();

  // tomada de ar acima do piloto (airbox) e capa do motor
  rr(g, -0.05, -0.12, 0.32, 0.24, 0.08);
  g.fillStyle = shade(body, -0.5);
  g.fill();

  // cockpit + capacete + halo
  g.beginPath();
  g.ellipse(0.62, 0, 0.32, 0.17, 0, 0, Math.PI * 2);
  g.fillStyle = "#08090b";
  g.fill();
  const hel = g.createRadialGradient(0.55, -0.04, 0.02, 0.58, 0, 0.14);
  hel.addColorStop(0, "#fff6b8");
  hel.addColorStop(1, "#d9b51e");
  g.beginPath();
  g.arc(0.58, 0, 0.12, 0, Math.PI * 2);
  g.fillStyle = hel;
  g.fill();
  g.fillStyle = "#1a1a1a";
  g.fillRect(0.64, -0.08, 0.05, 0.16); // viseira
  g.beginPath();
  g.ellipse(0.66, 0, 0.3, 0.2, 0, -Math.PI * 0.62, Math.PI * 0.62);
  g.moveTo(0.96, 0);
  g.lineTo(1.12, 0);
  g.strokeStyle = "#2a2b30";
  g.lineWidth = 0.06;
  g.stroke();

  // espelhos
  for (const s of [-1, 1]) {
    g.fillStyle = "#111";
    g.fillRect(0.95, 0.3 * s - 0.03, 0.12, 0.06);
  }

  // asa dianteira: elementos curvos + placas laterais
  for (let i = 0; i < 3; i++) {
    const x = 2.42 + i * 0.1;
    g.beginPath();
    g.moveTo(x, -0.95);
    g.quadraticCurveTo(x + 0.14 - i * 0.04, 0, x, 0.95);
    g.strokeStyle = i === 0 ? acc : shade(acc, -0.25 - i * 0.1);
    g.lineWidth = 0.075;
    g.stroke();
  }
  g.fillStyle = "#16171b";
  g.fillRect(2.36, -0.99, 0.42, 0.06);
  g.fillRect(2.36, 0.93, 0.42, 0.06);

  // asa traseira: plano principal + flap + placas laterais
  rr(g, -2.78, -0.5, 0.22, 1.0, 0.03);
  g.fillStyle = acc;
  g.fill();
  rr(g, -2.56, -0.48, 0.1, 0.96, 0.03);
  g.fillStyle = shade(acc, -0.3);
  g.fill();
  g.fillStyle = "#16171b";
  g.fillRect(-2.8, -0.54, 0.38, 0.06);
  g.fillRect(-2.8, 0.48, 0.38, 0.06);

  // luz de chuva traseira
  g.fillStyle = rainLight ? "#ff2a2a" : "#3a0d0d";
  g.fillRect(-2.86, -0.05, 0.08, 0.1);
  if (rainLight) {
    g.save();
    g.shadowColor = "#ff2a2a";
    g.shadowBlur = 0.3 * RES;
    g.fillRect(-2.86, -0.05, 0.08, 0.1);
    g.restore();
  }
}

function drawSafetyCar(g: CanvasRenderingContext2D, lightOn: boolean) {
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 0.25 * RES;
  g.shadowOffsetX = 0.12 * RES;
  g.shadowOffsetY = 0.16 * RES;
  rr(g, -2.4, -0.95, 4.8, 1.9, 0.5);
  const grad = g.createLinearGradient(0, -0.95, 0, 0.95);
  grad.addColorStop(0, "#f1f3f6");
  grad.addColorStop(0.5, "#c9ced6");
  grad.addColorStop(1, "#8d939c");
  g.fillStyle = grad;
  g.fill();
  g.restore();
  // vidros e teto
  rr(g, -0.9, -0.72, 1.9, 1.44, 0.3);
  g.fillStyle = "#18202c";
  g.fill();
  rr(g, -0.55, -0.62, 1.1, 1.24, 0.2);
  g.fillStyle = "#d4d8de";
  g.fill();
  // giroflex
  g.fillStyle = lightOn ? "#ffb000" : "#6b4600";
  g.fillRect(-0.1, -0.5, 0.22, 0.45);
  g.fillStyle = lightOn ? "#6b4600" : "#ffb000";
  g.fillRect(-0.1, 0.05, 0.22, 0.45);
  // faróis
  g.fillStyle = "#fff6b0";
  g.fillRect(2.25, -0.75, 0.12, 0.35);
  g.fillRect(2.25, 0.4, 0.12, 0.35);
}
