// Carro de F1 em vetor, visto de cima (frente pra +x), desenhado UMA vez por
// equipe numa imagem de alta resolução e depois só girado/escalado a cada frame.
import type { Team } from "../sim/types";
import { liveryKey, type Livery } from "../sim/livery";

/** tamanho real do carro (m) */
export const CAR_LEN_M = 4.3;
/** o desenho foi feito com 5,6 m; encolhe no comprimento pra não parecer espichado */
const SQUASH = CAR_LEN_M / 5.6;
export const CAR_WID_M = 2.0;
/** resolução da imagem pré-desenhada (pixels por metro) */
const RES = 40;
/** sobra em volta (m), pra sombra */
const PAD = 0.35;

/** número do carro na pintura: desligado por enquanto (o dado continua salvo) */
const SHOW_NUMBER = false;

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
  const key = `${safety ? "SC" : team.id}|${rainLight}|${safety ? "" : liveryKey(team.livery)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 300) cache.clear(); // prévias do editor de pintura não acumulam pra sempre
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
  const lv = team.livery;
  const body = lv?.base ?? team.color;
  const acc = lv?.accent ?? team.accent;
  const wing = lv?.wing ?? acc;

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
  bodyPath(g);
  g.fillStyle = bodyGrad;
  g.fill();
  // pintura escolhida pelo jogador (fica só dentro da carroceria)
  if (lv && lv.pattern !== "classica") paintPattern(g, lv);
  bodyPath(g);
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

  // faixa da pintura ao longo da capa do motor e do bico (estilo clássico)
  if (!lv || lv.pattern === "classica") {
  g.beginPath();
  g.moveTo(-2.3, -0.06);
  g.lineTo(0.3, -0.1);
  g.lineTo(2.25, -0.03);
  g.lineTo(2.25, 0.03);
  g.lineTo(0.3, 0.1);
  g.lineTo(-2.3, 0.06);
  g.closePath();
  g.fillStyle = lv?.patternColor ?? acc;
  g.fill();
  }
  // número do carro na capa do motor (desligado por enquanto)
  if (lv && SHOW_NUMBER) {
    g.save();
    g.translate(-1.25, 0);
    g.rotate(Math.PI / 2);
    g.font = "900 0.36px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 0.05;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.strokeText(String(lv.number), 0, 0.01);
    g.fillStyle = lv.numberColor;
    g.fillText(String(lv.number), 0, 0.01);
    g.restore();
  }

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
    g.strokeStyle = i === 0 ? wing : shade(wing, -0.25 - i * 0.1);
    g.lineWidth = 0.075;
    g.stroke();
  }
  g.fillStyle = "#16171b";
  g.fillRect(2.36, -0.99, 0.42, 0.06);
  g.fillRect(2.36, 0.93, 0.42, 0.06);

  // asa traseira: plano principal + flap + placas laterais
  rr(g, -2.78, -0.5, 0.22, 1.0, 0.03);
  g.fillStyle = wing;
  g.fill();
  rr(g, -2.56, -0.48, 0.1, 0.96, 0.03);
  g.fillStyle = shade(wing, -0.3);
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

/** contorno da carroceria (laterais largas que afinam no cockpit e viram bico) */
function bodyPath(g: CanvasRenderingContext2D) {
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
}

/** estilos de pintura (desenhados por cima da cor principal, dentro da carroceria) */
function paintPattern(g: CanvasRenderingContext2D, lv: Livery) {
  g.save();
  bodyPath(g);
  g.clip();
  patternShapes(g, lv);
  g.restore();
}

/** as formas de cada estilo, em metros do desenho (frente pra +x); o carro 3D também usa */
export function patternShapes(g: CanvasRenderingContext2D, lv: Livery) {
  const c = lv.patternColor;
  g.fillStyle = c;
  const poly = (pts: number[][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  switch (lv.pattern) {
    case "faixas":
      for (const y of [-0.16, 0.16]) g.fillRect(-2.4, y - 0.045, 4.8, 0.09);
      break;
    case "lateral":
      for (const s of [-1, 1]) poly([[-2.2, 0.3 * s], [0.4, 0.44 * s], [0.45, 0.6 * s], [-2.2, 0.42 * s]]);
      break;
    case "chevron":
      for (const dx of [0, -0.75]) poly([[-1.0 + dx, -0.75], [0.25 + dx, 0], [-1.0 + dx, 0.75], [-1.3 + dx, 0.75], [-0.05 + dx, 0], [-1.3 + dx, -0.75]]);
      break;
    case "diagonal":
      for (let x = -2.4; x < 2.5; x += 0.5) poly([[x, -0.8], [x + 0.18, -0.8], [x + 0.58, 0.8], [x + 0.4, 0.8]]);
      break;
    case "dividida":
      g.fillRect(-2.5, -1, 1.95, 2);
      break;
    case "degrade": {
      const gr = g.createLinearGradient(2.4, 0, -2.4, 0);
      gr.addColorStop(0, c);
      gr.addColorStop(0.55, c + "66");
      gr.addColorStop(1, c + "00");
      g.fillStyle = gr;
      g.fillRect(-2.5, -1, 5, 2);
      break;
    }
    case "flechas":
      for (const s of [-1, 1]) poly([[2.35, 0.02 * s], [0.9, 0.16 * s], [-0.4, 0.62 * s], [-0.55, 0.5 * s], [0.75, 0.1 * s]]);
      break;
    case "pontas":
      g.fillRect(1.25, -0.3, 1.3, 0.6);
      for (const s of [-1, 1]) poly([[-0.75, 0.66 * s], [0.45, 0.4 * s], [0.45, 0.5 * s], [-0.75, 0.75 * s]]);
      g.fillRect(-2.5, -0.3, 0.45, 0.6);
      break;
  }
}

/** safety car: esportivo amarelo (estilo superesportivo italiano), giroflex no teto */
function drawSafetyCar(g: CanvasRenderingContext2D, lightOn: boolean) {
  // sombra
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 0.3 * RES;
  g.shadowOffsetX = 0.12 * RES;
  g.shadowOffsetY = 0.16 * RES;
  rr(g, -2.55, -0.95, 5.1, 1.9, 0.6);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fill();
  g.restore();

  // carroceria: frente fina e arredondada, traseira larga (paralamas)
  const body = new Path2D();
  body.moveTo(2.62, 0);
  body.bezierCurveTo(2.62, -0.45, 2.45, -0.78, 2.1, -0.84);
  body.bezierCurveTo(1.4, -0.9, 0.6, -0.86, -0.1, -0.9);
  body.bezierCurveTo(-0.8, -0.98, -1.7, -1.0, -2.25, -0.9);
  body.bezierCurveTo(-2.55, -0.82, -2.62, -0.5, -2.62, 0);
  body.bezierCurveTo(-2.62, 0.5, -2.55, 0.82, -2.25, 0.9);
  body.bezierCurveTo(-1.7, 1.0, -0.8, 0.98, -0.1, 0.9);
  body.bezierCurveTo(0.6, 0.86, 1.4, 0.9, 2.1, 0.84);
  body.bezierCurveTo(2.45, 0.78, 2.62, 0.45, 2.62, 0);
  body.closePath();
  const paint = g.createLinearGradient(0, -1, 0, 1);
  paint.addColorStop(0, "#fff58a");
  paint.addColorStop(0.35, "#ffdd1a");
  paint.addColorStop(0.75, "#e6b800");
  paint.addColorStop(1, "#a88400");
  g.fillStyle = paint;
  g.fill(body);
  g.strokeStyle = "rgba(90,70,0,0.55)";
  g.lineWidth = 0.03;
  g.stroke(body);

  // vincos do capô
  g.strokeStyle = "rgba(150,115,0,0.45)";
  g.lineWidth = 0.025;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(1.15, 0.42 * s);
    g.quadraticCurveTo(1.9, 0.5 * s, 2.45, 0.3 * s);
    g.stroke();
  }
  // entradas de ar na frente
  for (const s of [-1, 1]) {
    rr(g, 2.38, 0.25 * s - (s < 0 ? 0.22 : 0), 0.14, 0.22, 0.05);
    g.fillStyle = "#1a1a1a";
    g.fill();
  }
  // faróis (alongados, nas pontas)
  for (const s of [-1, 1]) {
    g.save();
    g.translate(2.2, 0.62 * s);
    g.rotate(-0.55 * s);
    g.beginPath();
    g.ellipse(0, 0, 0.28, 0.08, 0, 0, Math.PI * 2);
    g.fillStyle = "#f4f6f8";
    g.fill();
    g.strokeStyle = "#333";
    g.lineWidth = 0.02;
    g.stroke();
    g.restore();
  }

  // para-brisa
  const glass = g.createLinearGradient(0.5, 0, 1.3, 0);
  glass.addColorStop(0, "#2b2f36");
  glass.addColorStop(1, "#5d6470");
  g.beginPath();
  g.moveTo(0.5, -0.58);
  g.lineTo(1.28, -0.5);
  g.quadraticCurveTo(1.36, 0, 1.28, 0.5);
  g.lineTo(0.5, 0.58);
  g.closePath();
  g.fillStyle = glass;
  g.fill();
  // teto
  rr(g, -0.4, -0.56, 0.92, 1.12, 0.18);
  g.fillStyle = "#f2cc00";
  g.fill();
  // giroflex do safety car (laranja piscando)
  rr(g, -0.05, -0.48, 0.24, 0.96, 0.06);
  g.fillStyle = "#222";
  g.fill();
  for (let i = 0; i < 4; i++) {
    const on = (i % 2 === 0) === lightOn;
    g.fillStyle = on ? "#ffa000" : "#5a3600";
    g.fillRect(-0.02, -0.44 + i * 0.22, 0.18, 0.18);
    if (on) {
      g.save();
      g.shadowColor = "#ffa000";
      g.shadowBlur = 0.35 * RES;
      g.fillRect(-0.02, -0.44 + i * 0.22, 0.18, 0.18);
      g.restore();
    }
  }
  // vidro traseiro / tampa do motor com aletas
  g.beginPath();
  g.moveTo(-0.42, -0.5);
  g.lineTo(-1.6, -0.42);
  g.lineTo(-1.6, 0.42);
  g.lineTo(-0.42, 0.5);
  g.closePath();
  g.fillStyle = "#30353d";
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 0.025;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(-0.6 - i * 0.17, -0.38);
    g.lineTo(-0.6 - i * 0.17, 0.38);
    g.stroke();
  }
  // tomadas de ar laterais (atrás das portas)
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(-0.45, 0.82 * s);
    g.quadraticCurveTo(-0.9, 0.7 * s, -1.3, 0.86 * s);
    g.strokeStyle = "#222";
    g.lineWidth = 0.07;
    g.stroke();
  }
  // retrovisores
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(0.72, 1.0 * s, 0.13, 0.07, 0.3 * s, 0, Math.PI * 2);
    g.fillStyle = "#1c1c1c";
    g.fill();
  }
  // lanternas traseiras redondas
  for (const s of [-1, 1]) {
    for (const y of [0.42, 0.66]) {
      g.beginPath();
      g.arc(-2.5, y * s, 0.09, 0, Math.PI * 2);
      g.fillStyle = "#d81818";
      g.fill();
    }
  }
  // difusor
  g.fillStyle = "#1a1a1a";
  g.fillRect(-2.64, -0.3, 0.08, 0.6);
}
