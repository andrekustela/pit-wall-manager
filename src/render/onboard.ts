// Câmera onboard: a visão do piloto em pseudo-3D retrô (estilo Out Run), toda
// em vetor. A pista é projetada a partir da geometria real (x, y de cada metro),
// então as curvas são as de verdade; o sobe-e-desce é inventado, mais forte
// nas pistas onduladas. Por cima, o cockpit: halo, bico, pneus da frente,
// retrovisores e o volante com marcha, velocidade e luzes de giro.
import type { Race } from "../sim/race";
import { TRACK_WIDTH, type Track } from "../sim/track";
import type { CarState } from "../sim/types";

const COMPOUND_COLOR: Record<string, string> = { S: "#ff3b3b", M: "#ffd23b", H: "#f2f2f2", I: "#3bd16f", W: "#2e8bff" };
/** quanto a camada do carro sobra pra cada lado (fração da largura) */
const BODY_MARGIN = 0.4;
const EYE = 1.35; // altura da câmera (atrás da cabeça do piloto, m)
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
  private pedals = new Map<string, { v: number; thr: number; brk: number }>();

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
    const f = W * 0.64; // distância focal (ângulo aberto)
    const horizon = H * 0.4;
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
    const night = !!t.def.night;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    if (night) {
      sky.addColorStop(0, "#03050d");
      sky.addColorStop(0.75, "#0e1630");
      sky.addColorStop(1, "#2a2f4a");
    } else if (wet > 0.15) {
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
    for (let i = 0; i < (night ? 0 : 6); i++) {
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
    for (let x = 0; x <= W; x += W / (W < 400 ? 30 : 90)) {
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
    const lowQ = W < 400;
    const far = lowQ ? FAR * 0.7 : FAR;
    while (z < far) {
      const s = s0 + z;
      const ez = this.elev(s);
      const pl = t.pose(s, -W2), pr = t.pose(s, W2), pc = t.pose(s, 0);
      const c = proj(pc.x, pc.y, ez, false);
      if (!c) break; // o meio da pista voltou pra trás (grampo): para aqui
      const l = proj(pl.x, pl.y, ez), r = proj(pr.x, pr.y, ez);
      samples.push({ s, c, l, r, z, ws: ez });
      z += lowQ ? 2 + z * 0.09 : 1.2 + z * 0.04;
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
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
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

    // noite: escurece o mundo (a pista fica iluminada pelos refletores) e acende as estrelas
    if (night) {
      g.fillStyle = "rgba(3, 5, 18, 0.45)";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,.8)";
      for (let i = 0; i < 60; i++) {
        const sx = ((i * 7919 + Math.floor(h0 * 900)) % 1000) / 1000 * W;
        const sy = ((i * 104729) % 1000) / 1000 * horizon * 0.85;
        g.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
      }
    }

    // ---- cockpit ----
    // cockpit menor e embaixo: sobra mais pista à vista
    g.save();
    const ck = W < 400 ? 0.72 : 0.62;
    g.translate(W / 2, H);
    g.scale(ck, ck);
    g.translate(-W / 2, -H);
    this.cockpit(g, W, H, car, s0, dt, inTunnel(s0) || night);
    g.restore();

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

  /**
   * Cockpit visto de trás da cabeça do piloto (câmera "T"): bico e laterais na
   * cor da equipe, pneus da frente com a faixa do composto, halo, retrovisores
   * e o volante com as luvas.
   */
  private cockpit(g: CanvasRenderingContext2D, W: number, H: number, car: CarState, s0: number, dt: number, tunnel: boolean) {
    const t = this.race.track;
    const L = t.L;
    const acc = car.team.accent;
    const X = (p: number) => (p * W) / 100;
    const Y = (p: number) => (p * H) / 100;
    const u = Math.min(W, H * 1.6) / 100;
    const v = car.v;
    this.tread = (this.tread + v * dt * 0.9) % 1;
    // volante: média da curva logo à frente, girando suave
    let k = 0;
    for (let d = 2; d <= 22; d += 4) k += t.curvature[Math.floor(((s0 + d) % L + L) % L) % L];
    k /= 6;
    const want = Math.max(-1, Math.min(1, k * 60)) * 0.9;
    const prev = this.steer.get(car.id) ?? want;
    const steer = prev + (want - prev) * Math.min(1, dt * 7);
    this.steer.set(car.id, steer);
    const light = tunnel ? -0.35 : 0;

    // ---- asa dianteira (na ponta do bico, atrás dos pneus) ----
    g.drawImage(this.layer("wing|" + `${W}x${H}|${car.team.id}|${tunnel ? 1 : 0}`, g, W, H, (c) => this.wingLayer(c, W, H, car, tunnel)), 0, 0, W, H);

    // ---- pneus da frente ----
    const tyreCol = COMPOUND_COLOR[car.compound] ?? "#ffd23b";
    const tyres: [number, number][] = [[23, 47], [77, 47]];
    for (const [tx, ty] of tyres) {
      const side = tx < 50 ? -1 : 1;
      // braços da suspensão
      g.strokeStyle = shade("#1d1f24", light);
      g.lineWidth = Math.max(1, u * 0.9);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(X(tx - side * 6), Y(ty - 3));
      g.lineTo(X(50 - side * 3.5), Y(ty - 1));
      g.moveTo(X(tx - side * 6), Y(ty + 5));
      g.lineTo(X(50 - side * 4), Y(ty + 8));
      g.moveTo(X(tx - side * 5), Y(ty + 1));
      g.lineTo(X(50 - side * 4), Y(ty + 2));
      g.stroke();
      g.save();
      g.translate(X(tx), Y(ty));
      g.rotate(steer * 0.12);
      const tw = X(14), th = Y(33);
      const tg = g.createLinearGradient(-tw / 2, 0, tw / 2, 0);
      tg.addColorStop(0, "#030303");
      tg.addColorStop(0.3, shade("#2b2c30", light));
      tg.addColorStop(0.55, shade("#202125", light));
      tg.addColorStop(1, "#040404");
      g.fillStyle = tg;
      g.beginPath();
      g.roundRect(-tw / 2, -th / 2, tw, th, Math.min(tw, th) * 0.42);
      g.fill();
      // sulcos andando (sensação de velocidade)
      g.strokeStyle = "rgba(255,255,255,.06)";
      g.lineWidth = Math.max(1, u * 0.35);
      for (let i = 0; i < 5; i++) {
        const yy = -th / 2 + (((i + this.tread * 5) % 5) / 5) * th;
        g.beginPath();
        g.moveTo(-tw * 0.32, yy);
        g.lineTo(tw * 0.32, yy);
        g.stroke();
      }
      // faixa do composto na lateral de dentro
      g.strokeStyle = tyreCol;
      g.lineWidth = Math.max(1, u * 0.6);
      g.beginPath();
      g.ellipse(-side * tw * 0.36, 0, tw * 0.07, th * 0.36, 0, 0, Math.PI * 2);
      g.stroke();
      // aro (só uma beirinha aparece)
      g.fillStyle = shade("#5a5d66", light);
      g.beginPath();
      g.ellipse(-side * tw * 0.44, 0, tw * 0.04, th * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // partes paradas (bico, laterais, retrovisores, halo) vêm de uma imagem pronta
    const key = `${W}x${H}|${car.team.id}|${tunnel ? 1 : 0}`;
    // a camada do carro é mais larga que a tela: as laterais continuam até os cantos
    g.drawImage(this.layer("body|" + key, g, W, H, (c) => this.bodyLayer(c, W, H, car, tunnel), BODY_MARGIN), -W * BODY_MARGIN, 0, W * (1 + 2 * BODY_MARGIN), H);
    // acelerador e freio (estimados pela variação da velocidade)
    const ped = this.pedals.get(car.id) ?? { v, thr: 0.5, brk: 0 };
    const dv = dt > 0 ? (v - ped.v) / dt : 0;
    const thrWant = dv < -3 ? 0 : v > 3 ? Math.max(0.35, Math.min(1, 0.55 + dv / 9)) : 0.3;
    const brkWant = dv < -3 ? Math.min(1, -dv / 32) : 0;
    const kk = Math.min(1, dt * 10);
    ped.thr += (thrWant - ped.thr) * kk;
    ped.brk += (brkWant - ped.brk) * kk;
    ped.v = v;
    this.pedals.set(car.id, ped);

    g.save();
    g.translate(X(50), Y(90));
    g.rotate(steer * 0.55);
    const ww = X(12), wh = Y(11);
    // volante estilo F1: corpo largo com pegadores dos lados
    g.fillStyle = "#16171b";
    g.beginPath();
    g.moveTo(-ww * 0.62, -wh);
    g.lineTo(ww * 0.62, -wh);
    g.quadraticCurveTo(ww * 0.78, -wh, ww * 0.82, -wh * 0.7);
    g.lineTo(ww * 1.05, -wh * 0.55);
    g.quadraticCurveTo(ww * 1.22, wh * 0.1, ww * 1.0, wh * 0.75);
    g.lineTo(ww * 0.55, wh * 0.75);
    g.lineTo(ww * 0.45, wh * 0.45);
    g.lineTo(-ww * 0.45, wh * 0.45);
    g.lineTo(-ww * 0.55, wh * 0.75);
    g.lineTo(-ww * 1.0, wh * 0.75);
    g.quadraticCurveTo(-ww * 1.22, wh * 0.1, -ww * 1.05, -wh * 0.55);
    g.lineTo(-ww * 0.82, -wh * 0.7);
    g.quadraticCurveTo(-ww * 0.78, -wh, -ww * 0.62, -wh);
    g.closePath();
    g.fill();
    // botões coloridos
    const btn = ["#ff3b3b", "#3b8bff", "#ffd23b", "#3bd16f"];
    btn.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc((i < 2 ? -1 : 1) * ww * 0.7, -wh * 0.35 + (i % 2) * wh * 0.42, Math.max(1, ww * 0.06), 0, Math.PI * 2);
      g.fill();
    });
    // telinha
    const kmh = Math.round(v * 3.6);
    const gear = v < 1 ? "N" : String(Math.min(8, 1 + Math.floor(Math.max(0, kmh - 20) / 40)));
    g.fillStyle = "#06080b";
    g.fillRect(-ww * 0.55, -wh * 0.7, ww * 1.1, wh * 0.85);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#e9edf5";
    g.font = `700 ${Math.max(6, Math.round(wh * 0.55))}px "Silkscreen", monospace`;
    g.fillText(gear, -ww * 0.22, -wh * 0.27);
    g.fillStyle = "#9fe2ff";
    g.font = `700 ${Math.max(5, Math.round(wh * 0.3))}px "Silkscreen", monospace`;
    g.fillText(String(kmh), ww * 0.28, -wh * 0.27);
    // luzes de giro
    const inGear = kmh <= 20 ? kmh / 20 : ((kmh - 20) % 40) / 40;
    for (let i = 0; i < 10; i++) {
      const on = i / 10 < inGear;
      g.fillStyle = !on ? "#1d2027" : i < 4 ? "#3bd16f" : i < 7 ? "#ff3b3b" : "#3b8bff";
      g.fillRect(-ww * 0.55 + (i * ww * 1.1) / 10 + 1, -wh * 0.9, (ww * 1.1) / 10 - 2, wh * 0.13);
    }
    // luvas
    const glove = shade(acc, 0.05);
    for (const side of [-1, 1]) {
      g.fillStyle = glove;
      g.beginPath();
      g.ellipse(side * ww * 1.02, -wh * 0.1, ww * 0.42, wh * 0.62, side * 0.35, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = shade(acc, -0.3);
      g.beginPath();
      g.ellipse(side * ww * 1.0, wh * 0.38, ww * 0.3, wh * 0.18, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // barras de freio (vermelha) e acelerador (verde), dos lados do volante
    const bw = X(2.2), bh = Y(17), by = Y(76);
    for (const [bx, val, c] of [[X(27), ped.brk, "#ff3b3b"], [X(73) - bw, ped.thr, "#3bd16f"]] as [number, number, string][]) {
      g.fillStyle = "rgba(0,0,0,.55)";
      g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      g.fillStyle = "#1d2027";
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = c;
      g.fillRect(bx, by + bh * (1 - val), bw, bh * val);
    }

  }

  private layers = new Map<string, HTMLCanvasElement>();

  /** camada guardada (desenhada uma vez na resolução da tela) */
  private layer(key: string, g: CanvasRenderingContext2D, W: number, H: number, paint: (c: CanvasRenderingContext2D) => void, margin = 0) {
    let cv = this.layers.get(key);
    if (!cv) {
      const sc = g.getTransform().a || 1;
      cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(W * (1 + 2 * margin) * sc));
      cv.height = Math.max(1, Math.round(H * sc));
      const c = cv.getContext("2d")!;
      c.setTransform(sc, 0, 0, sc, W * margin * sc, 0);
      paint(c);
      if (this.layers.size > 24) this.layers.clear();
      this.layers.set(key, cv);
    }
    return cv;
  }

  private bodyLayer(g: CanvasRenderingContext2D, W: number, H: number, car: CarState, tunnel: boolean) {
    const col = car.team.color, acc = car.team.accent;
    const X = (p: number) => (p * W) / 100;
    const Y = (p: number) => (p * H) / 100;
    const u = Math.min(W, H * 1.6) / 100;
    const light = tunnel ? -0.35 : 0;
    const shape = (pts: [number, number][], fill: string | CanvasGradient) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.fill();
    };
    // ---- bico/monocoque ----
    const body = g.createLinearGradient(X(44), 0, X(56), 0);
    body.addColorStop(0, shade(col, -0.35 + light));
    body.addColorStop(0.5, shade(col, 0.12 + light));
    body.addColorStop(1, shade(col, -0.35 + light));
    shape([[47.6, 40], [52.4, 40], [56, 64], [44, 64]], body);
    // corpo continua do bico até o cockpit (sem buraco no meio)
    const deck = g.createLinearGradient(X(40), 0, X(60), 0);
    deck.addColorStop(0, shade(col, -0.3 + light));
    deck.addColorStop(0.5, shade(col, 0.05 + light));
    deck.addColorStop(1, shade(col, -0.3 + light));
    shape([[44, 62], [56, 62], [60, 100], [40, 100]], deck);
    // faixa da equipe no meio do bico
    shape([[49.4, 41], [50.6, 41], [51.4, 63], [48.6, 63]], shade(acc, light));
    shape([[48.6, 63], [51.4, 63], [52, 72], [48, 72]], shade(acc, -0.1 + light));
    // câmera/antena no bico
    g.strokeStyle = "#111";
    g.lineWidth = Math.max(1, u * 0.25);
    g.beginPath();
    g.moveTo(X(50), Y(44));
    g.lineTo(X(50), Y(28));
    g.stroke();
    shape([[48.8, 43], [51.2, 43], [51.2, 46], [48.8, 46]], "#141519");

    // ---- laterais (sidepods) e retrovisores ----
    for (const side of [-1, 1]) {
      const sx = (p: number) => (side < 0 ? p : 100 - p);
      const pod = g.createLinearGradient(0, Y(62), 0, Y(100));
      pod.addColorStop(0, shade(col, 0.1 + light));
      pod.addColorStop(1, shade(col, -0.4 + light));
      // a lateral continua pra fora da tela (o cockpit é desenhado menor) descendo em curva suave
      g.fillStyle = pod;
      g.beginPath();
      g.moveTo(X(sx(44)), Y(63));
      g.bezierCurveTo(X(sx(30)), Y(63.5), X(sx(10)), Y(66), X(sx(-6)), Y(72));
      g.bezierCurveTo(X(sx(-20)), Y(77), X(sx(-32)), Y(86), X(sx(-40)), Y(100));
      g.lineTo(X(sx(43)), Y(100));
      g.closePath();
      g.fill();
      // borda clara no alto da lateral (dá volume)
      g.strokeStyle = shade(col, 0.35 + light);
      g.lineWidth = Math.max(1, u * 0.5);
      g.beginPath();
      g.moveTo(X(sx(43)), Y(63.3));
      g.bezierCurveTo(X(sx(30)), Y(63.8), X(sx(10)), Y(66.3), X(sx(-6)), Y(72.3));
      g.bezierCurveTo(X(sx(-20)), Y(77.3), X(sx(-32)), Y(86.3), X(sx(-40)), Y(100));
      g.stroke();
      // faixa de cor da equipe acompanhando a curva
      g.fillStyle = shade(acc, -0.1 + light);
      g.beginPath();
      g.moveTo(X(sx(40)), Y(74));
      g.bezierCurveTo(X(sx(22)), Y(75), X(sx(2)), Y(79), X(sx(-14)), Y(86));
      g.bezierCurveTo(X(sx(-24)), Y(91), X(sx(-30)), Y(96), X(sx(-33)), Y(100));
      g.lineTo(X(sx(-27)), Y(100));
      g.bezierCurveTo(X(sx(-22)), Y(95), X(sx(-14)), Y(91), X(sx(-6)), Y(87));
      g.bezierCurveTo(X(sx(6)), Y(82), X(sx(24)), Y(78.5), X(sx(40)), Y(78));
      g.closePath();
      g.fill();
      // retrovisor
      const mx = sx(8);
      const housing = g.createLinearGradient(0, Y(62), 0, Y(72));
      housing.addColorStop(0, shade(acc, 0.15 + light));
      housing.addColorStop(1, shade(acc, -0.35 + light));
      g.fillStyle = housing;
      g.beginPath();
      g.roundRect(X(mx) - X(8), Y(62), X(16), Y(9.5), u * 1.6);
      g.fill();
      const glass = g.createLinearGradient(0, Y(63), 0, Y(70));
      glass.addColorStop(0, tunnel ? "#2c2f36" : "#b6d3ec");
      glass.addColorStop(0.6, tunnel ? "#1e2025" : "#738396");
      glass.addColorStop(1, "#3c3e44");
      g.fillStyle = glass;
      g.beginPath();
      g.roundRect(X(mx) - X(6.8), Y(63.2), X(13.6), Y(6.6), u * 1.1);
      g.fill();
    }

    // ---- abertura do cockpit, volante e luvas ----
    g.fillStyle = "#0a0b0e";
    g.beginPath();
    g.ellipse(X(50), Y(96), X(15), Y(26), 0, Math.PI, 0);
    g.lineTo(X(65), Y(100));
    g.lineTo(X(35), Y(100));
    g.closePath();
    g.fill();
    g.strokeStyle = shade(col, -0.5 + light);
    g.lineWidth = Math.max(1, u * 0.8);
    g.beginPath();
    g.ellipse(X(50), Y(96), X(15), Y(26), 0, Math.PI, 0);
    g.stroke();
  }

  private wingLayer(g: CanvasRenderingContext2D, W: number, H: number, car: CarState, tunnel: boolean) {
    const X = (p: number) => (p * W) / 100;
    const Y = (p: number) => (p * H) / 100;
    const light = tunnel ? -0.35 : 0;
    const col = car.team.color, acc = car.team.accent;
    // três planos empilhados, curvando pra cima nas pontas
    const flap = (y: number, h: number, fill: string, inset: number) => {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(X(6 + inset), Y(y - 1.5));
      g.quadraticCurveTo(X(50), Y(y + 1.2), X(94 - inset), Y(y - 1.5));
      g.lineTo(X(94 - inset), Y(y - 1.5 + h));
      g.quadraticCurveTo(X(50), Y(y + 1.2 + h), X(6 + inset), Y(y - 1.5 + h));
      g.closePath();
      g.fill();
    };
    flap(36, 2.2, shade("#15161a", light), 0);
    flap(38.3, 1.8, shade(col, light), 1.5);
    flap(40.2, 1.6, shade(acc, light), 3);
    // placas das pontas
    for (const x of [5, 93]) {
      g.fillStyle = shade("#121317", light);
      g.beginPath();
      g.roundRect(X(x), Y(32.5), X(2), Y(10), 2);
      g.fill();
      g.fillStyle = shade(col, -0.2 + light);
      g.fillRect(X(x) + 1, Y(33.2), Math.max(1, X(2) - 2), Y(2.4));
    }
    // suportes até o bico
    g.strokeStyle = shade("#15161a", light);
    g.lineWidth = Math.max(1, X(0.6));
    g.beginPath();
    g.moveTo(X(47.5), Y(41));
    g.lineTo(X(46.5), Y(37));
    g.moveTo(X(52.5), Y(41));
    g.lineTo(X(53.5), Y(37));
    g.stroke();
  }
}
/** escurece/clareia uma cor #rrggbb */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch((n >> 16) & 255), gg = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, "0")}`;
}
