// Carro solto (rodada, passada reta, batida) como corpo rígido no plano, no referencial da pista: as rodas
// travadas arrastam no chão e o atrito de cada eixo (frente e trás, com o peso de cada um) freia o carro E faz
// ele girar. O giro nasce do atrito (e não de uma taxa fixa): rodando rápido ele gira, quase parando ele assenta;
// o lado mais pesado (trás) tende a ficar atrás, como uma flecha. Batendo na barreira, quem encosta é o canto
// do carro (virado ele ocupa mais de lado) e o impulso no canto faz o carro quicar e girar.

/** distância do centro de massa ao eixo da frente e ao de trás (m) e o peso em cada um */
const AX_F = 1.7, AX_R = 1.8, WT_F = 0.48, WT_R = 0.52;
/** inércia de giro por massa (m²) */
export const GYR2 = 1.5;
/** abaixo disso (m/s) o atrito vira linear: para sem tremer */
const REG = 0.6;

/** o carro solto: velocidade (m/s) e rumo dela (psi), para onde o bico aponta (yaw) — ambos em rad em relação à
 * pista — e a velocidade de giro (w, rad/s; positivo gira pro lado de +lateral) */
export interface SlideBody {
  v: number;
  psi: number;
  yaw: number;
  w: number;
}

/** um passo de `h` s com o chão freando até `acc` m/s² (rodas travadas: o atrito é igual em qualquer direção) */
export function slideStep(b: SlideBody, acc: number, h: number) {
  // velocidade no referencial do carro (x pra frente, y pro lado de +lateral)
  const rel = b.psi - b.yaw;
  const u = b.v * Math.cos(rel), w = b.v * Math.sin(rel);
  let fx = 0, fy = 0, tq = 0;
  for (let i = 0; i < 2; i++) {
    const arm = i ? -AX_R : AX_F, wt = i ? WT_R : WT_F;
    // o eixo anda com o carro e com o giro (v + w × r)
    const ay = w + b.w * arm, sp = Math.hypot(u, ay);
    const k = (acc * wt) / Math.max(sp, REG);
    fx -= k * u;
    fy -= k * ay;
    tq -= arm * k * ay;
  }
  b.w += (tq / GYR2) * h;
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  const vx = b.v * Math.cos(b.psi) + (fx * cy - fy * sy) * h;
  const vy = b.v * Math.sin(b.psi) + (fx * sy + fy * cy) * h;
  b.v = Math.hypot(vx, vy);
  if (b.v > 1e-4) b.psi = Math.atan2(vy, vx);
  b.yaw += b.w * h;
}

/**
 * o canto do carro (meio comprimento `hl`, meia largura `hw`) mais pro lado `side` (+1/-1 de lateral): devolve o
 * quanto ele fica de lado do centro (sempre >= hw) e onde fica ao longo da pista (rx)
 */
export function outerCorner(yaw: number, hl: number, hw: number, side: number): { reach: number; rx: number; lx: number; ly: number } {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  let reach = -Infinity, rx = 0, cx = 0, cyy = 0;
  for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
    const ox = lx * cy - ly * sy, oy = (lx * sy + ly * cy) * side;
    if (oy > reach) {
      reach = oy;
      rx = ox;
      cx = lx;
      cyy = ly;
    }
  }
  // (lx/ly: o canto no carro — lx > 0 frente, ly > 0 o lado direito do carro)
  return { reach, rx, lx: cx, ly: cyy };
}

/**
 * impulso do canto contra a barreira (de lado `side`, a pista corre em x): restituição `e` (quanto quica) e
 * atrito `muW` com a barreira. Devolve a velocidade do canto contra a barreira antes do impulso (m/s; 0 se ele
 * já estava saindo)
 */
export function wallImpulse(b: SlideBody, side: number, rx: number, reach: number, e: number, muW: number): number {
  const oy = side * reach;
  let vx = b.v * Math.cos(b.psi), vy = b.v * Math.sin(b.psi);
  // velocidade do canto: v + w × r, com r = (rx, oy)
  const pvx = vx - b.w * oy, pvn = (vy + b.w * rx) * side;
  if (pvn <= 0) return 0;
  const j = ((1 + e) * pvn) / (1 + (rx * rx) / GYR2);
  vy -= j * side;
  let w = b.w - (rx * j * side) / GYR2;
  // atrito ao longo da barreira (no máximo muW do impulso)
  const jt = Math.max(-muW * j, Math.min(muW * j, pvx / (1 + (oy * oy) / GYR2)));
  vx -= jt;
  w += (oy * jt) / GYR2;
  b.v = Math.hypot(vx, vy);
  if (b.v > 1e-4) b.psi = Math.atan2(vy, vx);
  b.w = w;
  return pvn;
}
