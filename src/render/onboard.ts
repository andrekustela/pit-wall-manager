// Câmera onboard: a visão do piloto em pseudo-3D retrô (estilo Out Run), toda
// em vetor. A pista é projetada a partir da geometria real (x, y de cada metro),
// então as curvas são as de verdade; o sobe-e-desce é inventado, mais forte
// nas pistas onduladas. Por cima, o cockpit: halo, bico, pneus da frente,
// retrovisores e o volante com marcha, velocidade e luzes de giro.
import type { Race } from "../sim/race";
import { TRACK_WIDTH, type Track } from "../sim/track";
import type { CarState } from "../sim/types";

const COMPOUND_COLOR: Record<string, string> = { S: "#ff3b3b", M: "#ffd23b", H: "#f2f2f2", I: "#3bd16f", W: "#2e8bff" };
const EYE = 0.95; // altura do olho do piloto (m)
const FAR = 340; // até onde enxerga (m)
const W2 = TRACK_WIDTH / 2;

interface Pt {
  x: number;
  y: number;
  /** escala (px por metro) nessa distância */
  k: number;
}

/** sobe-e-desce inventado (periódico na volta), mais forte em pista ondulada */
function makeElevation(track: Track) {
  const L = track.L;
  const amp = 1.2 + track.def.minHeight * 1.1;
  let seed = 0;
  for (const ch of track.name) seed = (seed * 31 + ch.charCodeAt(0)) % 1000;
  const p1 = seed * 0.01, p2 = seed * 0.037, p3 = seed * 0.11;
  const w = (2 * Math.PI) / L;
  return (s: number) => amp * (0.6 * Math.sin(s * w * 2 + p1) + 0.3 * Math.sin(s * w * 5 + p2) + 0.12 * Math.sin(s * w * 11 + p3));
}

export class OnboardCam {
  private elev: (s: number) => number;
  private ridge: number[] = [];
  private shake = 0;
  private tread = 0;
  private drops: { x: number; y: number; r: number; life: number }[] = [];
  private steer = new Map<string, number>();

  constructor(private race: Race) {
    this.elev = makeElevation(race.track);
    // silhueta das montanhas/prédios do fundo (dá a volta inteira em 360°)
    let v = 0.5;
    let rnd = 7;
    for (let i = 0; i < 360; i++) {
      rnd = (rnd * 16807) % 2147483647;
      v += ((rnd / 2147483647) - 0.5) * 0.18;
      v = Math.max(0.15, Math.min(1, v));
      this.ridge.push(v);
    }
  }

  /**
   * Desenha a visão do carro `car`, que está em s/lat (suavizados pela tela).
   * `t` = tempo real (s) pra animações; `dt` = tempo do quadro.
   */
  draw(g: CanvasRenderingContext2D, W: number, H: number, car: CarState, s0: number, lat0: number, dt: number, interp?: Map<string, { s: number; lat: number }>) {
    const race = this.race;
    const t = race.track;
    const L = t.L;
    const street = !!t.def.street;
    const wet = race.wet;
    const v = car.v;
    const f = W * 0.82; // distância focal
    const horizon = H * 0.44;
    const cx = W / 2;

    // câmera: posição e direção do carro (direção = tangente da pista + um tiquinho pro lado que ele está indo)
    const cam = t.pose(s0, lat0);
    const ahead = t.pose(s0 + 6, lat0);
    const h0 = Math.atan2(ahead.y - cam.y, ahead.x - cam.x);
    const fx = Math.cos(h0), fy = Math.sin(h0);
    this.shake = v > 10 ? Math.sin(performance.now() / 23) * Math.min(1.2, v / 80) * (car.offTrack > 0 ? 3 : 0.5) : 0;
    const camZ = this.elev(s0) + EYE;
    // ponto que cai atrás da câmera (borda de dentro de curva fechada) é puxado pro plano da frente
    const proj = (wx: number, wy: number, wz: number, clamp = true): Pt | null => {
      const dx = wx - cam.x, dy = wy - cam.y;
      let fwd = dx * fx + dy * fy;
      if (fwd < 0.6) {
        if (!clamp) return null;
        fwd = 0.6;
      }
      const side = -dx * fy + dy * fx;
      const k = f / fwd;
      return { x: cx + side * k, y: horizon + (camZ - wz) * k + this.shake, k };
    };

    // ---- céu e fundo ----
    const tunnel = t.tunnel;
    const inTunnel = (s: number) => {
      if (!tunnel) return false;
      const [a, b] = tunnel;
      const x = ((s % L) + L) % L;
      return a < b ? x >= a && x <= b : x >= a || x <= b;
    };
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    if (wet > 0.15) {
      sky.addColorStop(0, "#4a5260");
      sky.addColorStop(1, "#8f97a3");
    } else {
      sky.addColorStop(0, "#2f6fc4");
      sky.addColorStop(0.7, "#8fc3ef");
      sky.addColorStop(1, "#d8ecfa");
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon + 2);
    // nuvens
    g.fillStyle = wet > 0.15 ? "rgba(70,76,88,.55)" : "rgba(255,255,255,.75)";
    for (let i = 0; i < 6; i++) {
      const ang = (i * 61 + 20) * (Math.PI / 180);
      let rel = ang - h0;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const x = cx + rel * f * 0.9;
      if (x < -W * 0.3 || x > W * 1.3) continue;
      const y = horizon * (0.25 + (i % 3) * 0.15);
      const r = W * 0.035 * (1 + (i % 2));
      g.beginPath();
      g.ellipse(x, y, r * 2.2, r * 0.7, 0, 0, Math.PI * 2);
      g.ellipse(x + r, y - r * 0.35, r * 1.3, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
    // montanhas (ou prédios, na rua) girando com o carro
    const grass = t.def.grass;
    g.fillStyle = street ? "#5d6470" : "#5f8a6a";
    g.beginPath();
    g.moveTo(0, horizon + 1);
    const deg = (h0 * 180) / Math.PI;
    for (let x = 0; x <= W; x += W / 90) {
      const a = (deg + ((x - cx) / f) * (180 / Math.PI) + 3600) % 360;
      const i0 = Math.floor(a), fr = a - i0;
      const r = this.ridge[i0 % 360] * (1 - fr) + this.ridge[(i0 + 1) % 360] * fr;
      if (street) {
        const blk = Math.floor(a / 3);
        const hgt = (0.25 + ((blk * 37) % 11) / 14) * horizon * 0.4;
        g.lineTo(x, horizon - hgt);
      } else g.lineTo(x, horizon - r * horizon * 0.22);
    }
    g.lineTo(W, horizon + 1);
    g.closePath();
    g.fill();
    g.fillStyle = grass[0];
    g.fillRect(0, horizon, W, H - horizon);

    // ---- pista (de longe pra perto) ----
    const samples: { s: number; c: Pt | null; l: Pt | null; r: Pt | null; z: number; ws: number }[] = [];
    let z = 1.2;
    while (z < FAR) {
      const s = s0 + z;
      const ez = this.elev(s);
      const pl = t.pose(s, -W2), pr = t.pose(s, W2), pc = t.pose(s, 0);
      const c = proj(pc.x, pc.y, ez, false);
      if (!c) break; // o meio da pista voltou pra trás (grampo): para aqui
      const l = proj(pl.x, pl.y, ez), r = proj(pr.x, pr.y, ez);
      samples.push({ s, c, l, r, z, ws: ez });
      z += 1.2 + z * 0.035;
    }
    // névoa: o que está longe puxa pra cor do horizonte
    let haze = 0;
    const hazeCol = wet > 0.15 ? [143, 151, 163] : [200, 222, 240];
    const mix = (hex: string) => {
      if (haze <= 0.01) return hex;
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
      const m = (a: number, c: number) => Math.round(a + (c - a) * haze);
      return `rgb(${m(r, hazeCol[0])},${m(gg, hazeCol[1])},${m(b, hazeCol[2])})`;
    };
    const poly = (pts: (Pt | { x: number; y: number })[], fill: string) => {
      const c = mix(fill);
      g.fillStyle = c;
      g.strokeStyle = c;
      g.lineWidth = 1;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
      g.stroke(); // cobre a emenda entre os pedaços
    };
    const at = (s: number, lat: number, ez: number) => {
      const p = t.pose(s, lat);
      return proj(p.x, p.y, ez);
    };
    const pitIn = t.pitEntryS, pitOut = t.pitExitS;
    const inPit = (s: number) => {
      const x = ((s % L) + L) % L;
      return x >= pitIn || x <= pitOut;
    };
    for (let i = samples.length - 2; i >= 0; i--) {
      const n = samples[i], fa = samples[i + 1];
      const stripe = Math.floor(n.s / 10) % 2 === 0;
      const tun = inTunnel(n.s);
      haze = tun ? 0 : Math.min(0.75, Math.pow(n.z / FAR, 1.3) * 0.9);
      // grama (faixas largas dão a sensação de velocidade)
      g.fillStyle = mix(tun ? "#2a2c31" : stripe ? grass[0] : grass[1]);
      const top = Math.min(fa.c!.y, n.c!.y);
      g.fillRect(0, top, W, Math.abs(n.c!.y - fa.c!.y) + 1);
      // calçada/zebra larga + muro (rua) ou brita nas curvas
      const curv = t.curvature[Math.floor(((n.s % L) + L) % L) % L];
      const corner = Math.abs(curv) > 1 / 320;
      if (street || tun) {
        for (const side of [-1, 1]) {
          const a1 = at(n.s, side * (W2 + 1.6), n.ws), a2 = at(fa.s, side * (W2 + 1.6), fa.ws);
          if (!a1 || !a2) continue;
          const hgt = tun ? 6 : 1.1;
          const b1 = { x: a1.x, y: a1.y - hgt * a1.k }, b2 = { x: a2.x, y: a2.y - hgt * a2.k };
          poly([a1, a2, b2, b1], tun ? (stripe ? "#4a4d55" : "#43464d") : stripe ? "#c9ccd2" : "#b5b9c0");
          if (!tun) poly([a1, a2, { x: a2.x, y: a2.y - 0.25 * a2.k }, { x: a1.x, y: a1.y - 0.25 * a1.k }], stripe ? "#c62828" : "#e8e8e8");
          else if (Math.floor(n.s / 14) % 2 === 0) {
            // luzes do túnel
            g.fillStyle = "#ffe2a0";
            g.fillRect(b1.x - 0.4 * a1.k, b1.y + 0.4 * a1.k, Math.max(1, 0.8 * a1.k), Math.max(1, 0.25 * a1.k));
          }
        }
        if (tun) {
          // teto
          const c1 = at(n.s, -(W2 + 1.6), n.ws + 6), c2 = at(n.s, W2 + 1.6, n.ws + 6);
          const c3 = at(fa.s, W2 + 1.6, fa.ws + 6), c4 = at(fa.s, -(W2 + 1.6), fa.ws + 6);
          if (c1 && c2 && c3 && c4) poly([c1, c2, c3, c4], stripe ? "#33363c" : "#2d3035");
        }
      } else if (corner) {
        // brita do lado de fora da curva
        const out = curv > 0 ? -1 : 1;
        const g1 = at(n.s, out * W2, n.ws), g2 = at(fa.s, out * W2, fa.ws);
        const g3 = at(fa.s, out * (W2 + 16), fa.ws), g4 = at(n.s, out * (W2 + 16), n.ws);
        if (g1 && g2 && g3 && g4) poly([g1, g2, g3, g4], stripe ? "#c9b88a" : "#bfae80");
      }
      // pit lane
      if (inPit(n.s)) {
        const pl = t.pitLateralAt(n.s), pf = t.pitLateralAt(fa.s);
        const p1 = at(n.s, pl - 4.5, n.ws), p2 = at(fa.s, pf - 4.5, fa.ws), p3 = at(fa.s, pf + 4.5, fa.ws), p4 = at(n.s, pl + 4.5, n.ws);
        if (p1 && p2 && p3 && p4) poly([p1, p2, p3, p4], "#55565c");
      }
      // asfalto
      poly([n.l!, fa.l!, fa.r!, n.r!], stripe ? "#5a5b61" : "#55565c");
      // zebras
      if (corner) {
        const red = Math.floor(n.s / 4) % 2 === 0 ? "#d42a2a" : "#f2f2f2";
        for (const side of [-1, 1]) {
          const k1 = at(n.s, side * W2, n.ws), k2 = at(fa.s, side * W2, fa.ws);
          const k3 = at(fa.s, side * (W2 + 1.3), fa.ws), k4 = at(n.s, side * (W2 + 1.3), n.ws);
          if (k1 && k2 && k3 && k4) poly([k1, k2, k3, k4], red);
        }
      }
      // linhas brancas da borda
      for (const side of [-1, 1]) {
        const e1 = at(n.s, side * (W2 - 0.3), n.ws), e2 = at(fa.s, side * (W2 - 0.3), fa.ws);
        const e3 = at(fa.s, side * (W2 - 0.7), fa.ws), e4 = at(n.s, side * (W2 - 0.7), n.ws);
        if (e1 && e2 && e3 && e4) poly([e1, e2, e3, e4], "#e8e8e8");
      }
      // linha de chegada
      const sm = ((n.s % L) + L) % L;
      if (sm < 3 || sm > L - 1) {
        for (let k = 0; k < 12; k++) {
          const la = -W2 + (k * TRACK_WIDTH) / 12, lb = la + TRACK_WIDTH / 12;
          const q1 = at(n.s, la, n.ws), q2 = at(n.s, lb, n.ws), q3 = at(n.s + 1.5, lb, n.ws), q4 = at(n.s + 1.5, la, n.ws);
          if (q1 && q2 && q3 && q4) poly([q1, q2, q3, q4], k % 2 ? "#111" : "#fff");
        }
      }
    }

    // ---- outros carros (de longe pra perto) ----
    const others: { c: CarState; d: number; p: Pt; lat: number; s: number }[] = [];
    for (const o of race.cars) {
      if (o === car || o.pit === "parked") continue;
      const os = interp?.get(o.id)?.s ?? o.s;
      let d = os - s0;
      d = ((d % L) + L) % L;
      if (d > FAR || d < 1.5) continue;
      const ol = interp?.get(o.id)?.lat ?? o.lateral;
      const pp = t.pose(s0 + d, ol);
      const p = proj(pp.x, pp.y, this.elev(s0 + d), false);
      if (p) others.push({ c: o, d, p, lat: ol, s: s0 + d });
    }
    others.sort((a, b) => b.d - a.d);
    for (const o of others) this.drawCar(g, o.p, o.c, wet);

    // ---- cockpit ----
    this.cockpit(g, W, H, car, s0, dt, inTunnel(s0));

    // chuva na viseira
    if (race.rain > 0.05) {
      if (Math.random() < race.rain * 0.9) this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.7, r: 1 + Math.random() * 3, life: 1 });
      g.fillStyle = "rgba(220,235,255,.35)";
      for (const d of this.drops) {
        d.life -= dt * (0.6 + v / 60);
        d.y += dt * v * 0.8;
        d.x += (d.x - cx) * dt * v * 0.02;
        g.beginPath();
        g.ellipse(d.x, d.y, d.r * (W / 400), d.r * (W / 400) * 1.6, 0, 0, Math.PI * 2);
        g.fill();
      }
      this.drops = this.drops.filter((d) => d.life > 0 && d.y < H);
    } else this.drops = [];
    if (inTunnel(s0)) {
      g.fillStyle = "rgba(0,0,10,.25)";
      g.fillRect(0, 0, W, H);
    }
  }

  /** carro visto de trás (vetor) */
  private drawCar(g: CanvasRenderingContext2D, p: Pt, c: CarState, wet: number) {
    const k = p.k; // px por metro
    if (k < 0.6) return;
    const x = p.x, y = p.y;
    const col = c.team.color, acc = c.team.accent;
    const r = (dx: number, dy: number, w: number, h: number, fill: string, rad = 0) => {
      g.fillStyle = fill;
      g.beginPath();
      g.roundRect(x + dx * k, y - dy * k, w * k, h * k, rad * k);
      g.fill();
    };
    // sombra
    g.fillStyle = "rgba(0,0,0,.35)";
    g.beginPath();
    g.ellipse(x, y, 1.1 * k, 0.18 * k, 0, 0, Math.PI * 2);
    g.fill();
    // pneus traseiros
    r(-1.0, 0.68, 0.42, 0.66, "#141414", 0.12);
    r(0.58, 0.68, 0.42, 0.66, "#141414", 0.12);
    // corpo / tampa do motor
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x - 0.55 * k, y - 0.1 * k);
    g.lineTo(x - 0.35 * k, y - 0.62 * k);
    g.lineTo(x - 0.1 * k, y - 0.95 * k);
    g.lineTo(x + 0.1 * k, y - 0.95 * k);
    g.lineTo(x + 0.35 * k, y - 0.62 * k);
    g.lineTo(x + 0.55 * k, y - 0.1 * k);
    g.closePath();
    g.fill();
    // difusor
    r(-0.5, 0.22, 1.0, 0.2, "#222", 0.03);
    // asa traseira
    r(-0.62, 0.98, 1.24, 0.2, col, 0.03);
    r(-0.62, 0.86, 1.24, 0.07, acc);
    r(-0.66, 1.02, 0.07, 0.62, "#1a1a1a");
    r(0.59, 1.02, 0.07, 0.62, "#1a1a1a");
    // luz de chuva
    if (wet > 0.2 && Math.floor(performance.now() / 300) % 2 === 0) r(-0.06, 0.42, 0.12, 0.08, "#ff3030");
  }

  /** cockpit: pneus da frente, bico, laterais, retrovisores, halo e volante */
  private cockpit(g: CanvasRenderingContext2D, W: number, H: number, car: CarState, s0: number, dt: number, tunnel: boolean) {
    const t = this.race.track;
    const L = t.L;
    const col = car.team.color, acc = car.team.accent;
    const u = W / 100; // unidade relativa à largura
    const v = car.v;
    this.tread = (this.tread + v * dt * 3) % 10;
    // volante: média da curva logo à frente, girando suave
    let k = 0;
    for (let d = 2; d <= 22; d += 4) k += t.curvature[Math.floor(((s0 + d) % L + L) % L) % L];
    k /= 6;
    const want = Math.max(-1, Math.min(1, k * 60)) * 0.9;
    const prev = this.steer.get(car.id) ?? want;
    const steer = prev + (want - prev) * Math.min(1, dt * 7);
    this.steer.set(car.id, steer);

    // pneus dianteiros: a parte de cima do pneu, com a faixa do composto girando
    const tyreCol = COMPOUND_COLOR[car.compound] ?? "#ffd23b";
    for (const side of [-1, 1]) {
      const tx = W / 2 + side * u * 31;
      const ty = H * 0.92;
      g.save();
      g.translate(tx, ty);
      g.rotate(steer * 0.18 * side * 0 + steer * 0.12);
      const tw = u * 13, th = u * 19;
      const tg = g.createLinearGradient(-tw / 2, 0, tw / 2, 0);
      tg.addColorStop(0, "#050505");
      tg.addColorStop(0.35, "#2a2b2e");
      tg.addColorStop(0.65, "#1c1d20");
      tg.addColorStop(1, "#050505");
      g.fillStyle = tg;
      g.beginPath();
      g.ellipse(0, 0, tw / 2, th / 2, 0, 0, Math.PI * 2);
      g.fill();
      // faixa do composto na lateral
      g.strokeStyle = tyreCol;
      g.lineWidth = u * 0.9;
      g.beginPath();
      g.ellipse(side * -tw * 0.36, 0, tw * 0.1, th * 0.38, 0, 0, Math.PI * 2);
      g.stroke();
      // sulcos de borracha correndo (sensação de velocidade)
      g.strokeStyle = "rgba(255,255,255,.07)";
      g.lineWidth = u * 0.5;
      for (let i = 0; i < 4; i++) {
        const yy = -th / 2 + ((i * 2.5 + this.tread) % 10) * (th / 10);
        const half = Math.sqrt(Math.max(0, 1 - (yy / (th / 2)) ** 2)) * tw * 0.42;
        g.beginPath();
        g.moveTo(-half, yy);
        g.lineTo(half, yy);
        g.stroke();
      }
      g.restore();
      // suspensão (braços na cor do carro)
      g.strokeStyle = "#1b1d22";
      g.lineWidth = u * 1.1;
      g.beginPath();
      g.moveTo(tx - side * u * 5, ty - u * 4);
      g.lineTo(W / 2 + side * u * 6, H * 0.74);
      g.moveTo(tx - side * u * 5, ty + u * 2);
      g.lineTo(W / 2 + side * u * 7, H * 0.84);
      g.stroke();
    }
    // bico e laterais
    const nose = g.createLinearGradient(0, H * 0.62, 0, H);
    nose.addColorStop(0, col);
    nose.addColorStop(1, shade(col, -0.45));
    g.fillStyle = nose;
    g.beginPath();
    g.moveTo(W / 2 - u * 2.2, H * 0.6);
    g.lineTo(W / 2 + u * 2.2, H * 0.6);
    g.lineTo(W / 2 + u * 9, H * 0.86);
    g.lineTo(W / 2 + u * 25, H);
    g.lineTo(W / 2 - u * 25, H);
    g.lineTo(W / 2 - u * 9, H * 0.86);
    g.closePath();
    g.fill();
    g.fillStyle = acc;
    g.beginPath();
    g.moveTo(W / 2 - u * 0.8, H * 0.61);
    g.lineTo(W / 2 + u * 0.8, H * 0.61);
    g.lineTo(W / 2 + u * 2.6, H * 0.86);
    g.lineTo(W / 2 - u * 2.6, H * 0.86);
    g.closePath();
    g.fill();
    // carenagem do cockpit (escura) nas bordas de baixo
    g.fillStyle = "#15171c";
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, H * 0.84);
    g.quadraticCurveTo(W * 0.1, H * 0.86, W * 0.2, H * 0.95);
    g.lineTo(W * 0.24, H);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(W, H);
    g.lineTo(W, H * 0.84);
    g.quadraticCurveTo(W * 0.9, H * 0.86, W * 0.8, H * 0.95);
    g.lineTo(W * 0.76, H);
    g.closePath();
    g.fill();
    // retrovisores
    for (const side of [-1, 1]) {
      const mx = W / 2 + side * u * 40;
      const my = H * 0.66;
      g.fillStyle = "#15171c";
      g.beginPath();
      g.roundRect(mx - u * 6.5, my - u * 2.6, u * 13, u * 5.2, u * 1.4);
      g.fill();
      const mir = g.createLinearGradient(0, my - u * 2, 0, my + u * 2);
      mir.addColorStop(0, tunnel ? "#2c2f36" : "#a9cbe9");
      mir.addColorStop(0.55, tunnel ? "#24262b" : "#7a8a9a");
      mir.addColorStop(1, "#4b4c52");
      g.fillStyle = mir;
      g.beginPath();
      g.roundRect(mx - u * 5.6, my - u * 1.9, u * 11.2, u * 3.8, u * 1);
      g.fill();
      g.strokeStyle = "#15171c";
      g.lineWidth = u * 1.2;
      g.beginPath();
      g.moveTo(mx - side * u * 4, my + u * 2.4);
      g.lineTo(mx - side * u * 7, my + u * 7);
      g.stroke();
    }
    // halo
    g.strokeStyle = "#1b1d22";
    g.lineCap = "round";
    g.lineWidth = u * 1.7;
    g.beginPath();
    g.moveTo(W / 2, H * 0.72);
    g.lineTo(W / 2, H * 0.06);
    g.stroke();
    g.lineWidth = u * 2.2;
    g.beginPath();
    g.moveTo(W * 0.12, H * 0.74);
    g.quadraticCurveTo(W * 0.18, H * 0.02, W / 2, H * 0.02);
    g.quadraticCurveTo(W * 0.82, H * 0.02, W * 0.88, H * 0.74);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,.08)";
    g.lineWidth = u * 0.6;
    g.beginPath();
    g.moveTo(W / 2 - u * 0.6, H * 0.7);
    g.lineTo(W / 2 - u * 0.6, H * 0.08);
    g.stroke();

    // volante
    const wx = W / 2, wy = H * 1.0;
    g.save();
    g.translate(wx, wy);
    g.scale(0.82, 0.82);
    g.rotate(steer * 0.45);
    g.fillStyle = "#101114";
    g.beginPath();
    g.moveTo(-u * 17, -u * 3);
    g.quadraticCurveTo(-u * 18, -u * 13, -u * 11, -u * 14);
    g.lineTo(u * 11, -u * 14);
    g.quadraticCurveTo(u * 18, -u * 13, u * 17, -u * 3);
    g.lineTo(u * 12, u * 3);
    g.lineTo(-u * 12, u * 3);
    g.closePath();
    g.fill();
    // pegadores (luvas na cor da equipe)
    g.fillStyle = shade(col, -0.2);
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * u * 16, -u * 6, u * 3.6, u * 5.4, side * 0.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = acc;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * u * 16.5, -u * 9.5, u * 2.4, u * 1.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    // telinha: marcha e velocidade
    const kmh = Math.round(v * 3.6);
    const gear = v < 1 ? "N" : String(Math.min(8, 1 + Math.floor(Math.max(0, kmh - 20) / 40)));
    g.fillStyle = "#06080b";
    g.beginPath();
    g.roundRect(-u * 7, -u * 12, u * 14, u * 8, u * 1);
    g.fill();
    g.fillStyle = "#e9edf5";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(u * 5)}px "Silkscreen", monospace`;
    g.fillText(gear, -u * 3, -u * 8);
    g.font = `700 ${Math.round(u * 2.4)}px "Silkscreen", monospace`;
    g.fillStyle = "#9fe2ff";
    g.fillText(String(kmh), u * 3.2, -u * 9);
    g.fillStyle = "#8a93a6";
    g.font = `${Math.round(u * 1.6)}px "Silkscreen", monospace`;
    g.fillText("KM/H", u * 3.2, -u * 6.2);
    // luzes de giro
    const inGear = kmh <= 20 ? kmh / 20 : ((kmh - 20) % 40) / 40;
    const leds = 12;
    for (let i = 0; i < leds; i++) {
      const on = i / leds < inGear;
      g.fillStyle = !on ? "#1d2027" : i < 5 ? "#3bd16f" : i < 9 ? "#ff3b3b" : "#3b8bff";
      g.beginPath();
      g.arc(-u * 6.6 + (i * u * 13.2) / (leds - 1), -u * 13.4, u * 0.55, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}

/** escurece/clareia uma cor #rrggbb */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch((n >> 16) & 255), gg = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, "0")}`;
}
