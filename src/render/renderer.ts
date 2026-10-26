import type { Race } from "../sim/race";
import { CAR_LEN_M, carImage, type CarImage } from "./carArt";
import { car3dPref, drawCar3d, lookOf, partPiece, type CarLook } from "./car3d";
import { CarFx } from "./carFx";
import { WorldTiles } from "./worldTiles";
import { TRACK_WIDTH, angDiff } from "../sim/track";

/**
 * Desenha a corrida num canvas de alta resolução: a pista em vetor (em tiles,
 * ver worldVector.ts) e por cima carros, safety car, etiquetas, chuva e luzes.
 * A câmera segue um carro; roda do mouse / +/- dão zoom.
 */
export class Renderer {
  private octx: CanvasRenderingContext2D;
  private world: WorldTiles;
  /** a pista já está desenhável? (pra tirar a tela de "preparando a pista") */
  get trackReady(): boolean {
    return this.world.ready;
  }
  private cam = { x: 0, y: 0, ready: false };
  private drops: { x: number; y: number; l: number }[] = [];
  private screenPos = new Map<string, { x: number; y: number }>();
  private dpr = 1;
  private zoom = 0;
  followId: string;

  constructor(private canvas: HTMLCanvasElement, private race: Race, followId: string, onPick: (id: string) => void) {
    this.octx = canvas.getContext("2d")!;
    canvas.style.imageRendering = "auto";
    this.world = new WorldTiles(race.opts.trackIndex);
    this.followId = followId;
    this.resize();
    window.addEventListener("resize", this.resize);
    // na hora que aperta (o carro anda entre apertar e soltar); área de toque generosa
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: string | null = null;
      let bestD = Math.max(36, CAR_LEN_M * this.m2css() * 1.1);
      for (const [id, p] of this.screenPos) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) onPick(best);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
  }

  destroy() {
    window.removeEventListener("resize", this.resize);
    this.world.destroy();
  }

  /** zoom em passos de 25% */
  setZoom(z: number) {
    this.zoom = Math.max(-4, Math.min(8, z));
  }

  zoomIn() {
    this.setZoom(this.zoom + 1);
  }

  zoomOut() {
    this.setZoom(this.zoom - 1);
  }

  /** metros -> pixels CSS na tela (~200 m visíveis na largura sem zoom) */
  private m2css() {
    return (window.innerWidth / 200) * Math.pow(1.25, this.zoom);
  }

  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  };

  /** um estado conhecido do carro (vindo da simulação) */
  private hist = new Map<string, { t: number; d: number; lat: number }[]>();
  private scHist: { t: number; d: number; lat: number }[] = [];
  private snapT = 0;
  private snapReal = 0;
  private interval = 0.05; // s reais entre estados (média)
  private simSpeed = 1;
  private camFrom: { x: number; y: number; t: number } | null = null;
  private lastFollow = "";

  /**
   * Chamado a cada estado novo da simulação. Guarda um histórico curto de
   * posições; a tela desenha um instantinho atrás e desliza entre dois
   * estados conhecidos (interpolação) — liso, sem tremer e sem voltar.
   */
  onSnapshot(speed: number) {
    const race = this.race;
    const now = performance.now();
    const t = race.time;
    if (t < this.snapT - 1e-6) {
      // o relógio da corrida zerou (largada): recomeça o histórico
      this.hist.clear();
      this.scHist = [];
      this.clock = t;
    }
    const gap = (now - this.snapReal) / 1000;
    if (this.snapReal && gap < 1) this.interval = this.interval * 0.85 + gap * 0.15;
    this.snapReal = now;
    this.snapT = t;
    this.simSpeed = speed;
    for (const c of race.cars) {
      let h = this.hist.get(c.id);
      if (!h) this.hist.set(c.id, (h = []));
      h.push({ t, d: race.dist(c), lat: c.lateral });
      if (h.length > 6) h.shift();
    }
    if (race.sc.active && race.sc.onTrack) {
      const L = race.track.L;
      const last = this.scHist[this.scHist.length - 1];
      let d = race.sc.s;
      if (last) {
        let delta = race.sc.s - (((last.d % L) + L) % L);
        if (delta < -L / 2) delta += L;
        if (delta > L / 2) delta -= L;
        d = last.d + delta;
      }
      this.scHist.push({ t, d, lat: 0 });
      if (this.scHist.length > 6) this.scHist.shift();
    } else this.scHist = [];
  }

  private clock = 0;

  /**
   * Relógio da tela (tempo de corrida mostrado): anda sozinho no ritmo real e
   * só se ajusta aos poucos pro alvo (um pouco atrás do último estado). Nunca
   * volta — é isso que deixa o movimento liso mesmo com estados chegando
   * adiantados ou atrasados.
   */
  private renderTime(realDt: number): number {
    if (this.race.phase !== "racing" || this.simSpeed === 0 || !this.snapReal) {
      if (this.clock > this.snapT + 1e-6 || this.clock < this.snapT - 2) this.clock = this.snapT;
      return Math.min(this.clock, this.snapT);
    }
    const delay = Math.max(0.05, this.interval * 1.5) * this.simSpeed;
    const target = this.snapT + ((performance.now() - this.snapReal) / 1000) * this.simSpeed - delay;
    const err = target - this.clock;
    if (Math.abs(err) > 2 * this.simSpeed + 1) this.clock = target; // muito longe: pula
    else this.clock += realDt * this.simSpeed * (1 + Math.max(-0.25, Math.min(0.25, err / (0.25 * this.simSpeed + 1e-6))));
    this.clock = Math.min(this.clock, this.snapT);
    return this.clock;
  }

  private sample(h: { t: number; d: number; lat: number }[] | undefined, rt: number) {
    if (!h || h.length === 0) return null;
    if (rt <= h[0].t) return h[0];
    for (let i = 0; i < h.length - 1; i++) {
      const a = h[i], b = h[i + 1];
      if (rt <= b.t) {
        const k = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
        return { t: rt, d: a.d + (b.d - a.d) * k, lat: a.lat + (b.lat - a.lat) * k };
      }
    }
    return h[h.length - 1];
  }

  /** posição na pista em metros */
  private px(s: number, lat: number) {
    return this.race.track.pose(s, lat);
  }

  private pos = new Map<string, { x: number; y: number; h: number }>();
  /** quanto o bico está virado em relação ao rumo da pista (suavizado), por carro */
  private yawOff = new Map<string, number>();
  /** estado das peças visto no último quadro (pra soltar o pedaço quando algo quebra) */
  private lookSeen = new Map<string, CarLook>();
  /** rodada, batida, fumaça, poeira, faíscas, marcas de pneu, tremor */
  private fx = new CarFx();
  /** pedaços de asa voando / caídos na pista (metros do mundo) */
  private debris: { img: CarImage; x: number; y: number; h: number; vx: number; vy: number; spin: number; t: number }[] = [];
  /** posição suavizada na pista (s, lateral) de cada carro, do último quadro: a câmera onboard usa */
  readonly interp = new Map<string, { s: number; lat: number }>();
  /** online: etiqueta dos carros dos jogadores mostra o engenheiro */
  showEngineers = false;
  /** altura de baixo coberta pelo painel (px); a câmera centraliza acima dela */
  private inset = 0;
  private insetTarget = 0;
  setBottomInset(px: number) {
    this.insetTarget = Math.min(px, window.innerHeight * 0.6);
  }

  draw(realDt: number, speed: number) {
    const race = this.race;
    const L = race.track.L;
    const W = window.innerWidth, H = window.innerHeight;
    const m = this.m2css();

    // posições interpoladas (em pixels do mundo)
    const rt = this.renderTime(realDt);
    const pos = this.pos;
    pos.clear();
    for (const c of race.cars) {
      const smp = this.sample(this.hist.get(c.id), rt);
      const s = smp ? (((smp.d % L) + L) % L) : c.s;
      const lat = smp ? smp.lat : c.lateral;
      const q = this.px(s, lat);
      // o bico aponta pra onde o carro está indo (seguindo o traçado ele atravessa a pista: com o ângulo
      // da linha do meio parecia drift). Direção = corda entre a posição de um instante atrás e a de
      // agora, mais metade do quanto a pista girou nesse trecho (a corda de um arco aponta pro meio
      // dele). Funciona igual em grampo, por dentro ou por fora
      const prev = smp && this.sample(this.hist.get(c.id), rt - 0.1);
      let off = 0;
      if (smp && prev && c.spin <= 0 && smp.d - prev.d > 0.8) {
        const p0 = this.px(((prev.d % L) + L) % L, prev.lat);
        const chord = Math.atan2(q.y - p0.y, q.x - p0.x);
        // não deixa passar de 35° do rumo da pista (amostra ruim, pit, batida)
        off = Math.max(-0.6, Math.min(0.6, angDiff(q.h, chord + angDiff(p0.h, q.h) / 2)));
      }
      // carro de verdade não gira de uma vez: quando ele muda de lado de repente (começa a ultrapassar,
      // desvia), o bico acompanha em ~0,06 s em vez de pular
      const was = this.yawOff.get(c.id) ?? off;
      const sm = was + (off - was) * (1 - Math.exp(-Math.max(0, realDt) * speed / 0.06));
      this.yawOff.set(c.id, sm);
      q.h += sm;
      pos.set(c.id, q);
      this.interp.set(c.id, { s, lat });
    }
    let scPos: { x: number; y: number; h: number } | null = null;
    if (race.sc.active && race.sc.onTrack) {
      const smp = this.sample(this.scHist, rt);
      scPos = this.px(smp ? (((smp.d % L) + L) % L) : race.sc.s, 0);
    }

    // câmera presa no carro seguido (transição suave quando troca de carro)
    const tp = (this.followId === "SC" ? scPos : pos.get(this.followId)) ?? pos.get(race.leader().id)!;
    if (this.followId !== this.lastFollow) {
      if (this.cam.ready) this.camFrom = { x: this.cam.x, y: this.cam.y, t: performance.now() };
      this.lastFollow = this.followId;
    }
    let cx = tp.x, cy = tp.y;
    if (this.camFrom) {
      const k = Math.min(1, (performance.now() - this.camFrom.t) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      cx = this.camFrom.x + (tp.x - this.camFrom.x) * e;
      cy = this.camFrom.y + (tp.y - this.camFrom.y) * e;
      if (k >= 1) this.camFrom = null;
    }
    this.cam = { x: cx, y: cy, ready: true };
    void realDt;

    // ---- pista (vetor, em tiles) ----
    const o = this.octx;
    // o carro seguido fica no meio da parte da tela que o painel não cobre (desliza junto)
    this.inset += (this.insetTarget - this.inset) * Math.min(1, realDt * 12);
    const [shx, shy] = this.fx.shakeOffset(realDt);
    const viewX = cx - W / m / 2 + shx, viewY = cy - (H - this.inset) / m / 2 + shy;
    o.setTransform(1, 0, 0, 1, 0, 0);
    // resolução cheia sempre: os tiles são desenhados no Worker, sem travar o jogo
    void speed;
    this.world.draw(o, viewX, viewY, W / m, H / m, m * this.dpr, 1);
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = "medium";
    if (race.wet > 0.02) {
      o.fillStyle = `rgba(20,40,75,${(race.wet * 0.3).toFixed(3)})`;
      o.fillRect(0, 0, W, H);
    }

    // ---- carros e o resto por cima ----
    const toCss = (p: { x: number; y: number }) => ({ x: (p.x - viewX) * m, y: (p.y - viewY) * m });

    this.screenPos.clear();
    const rainLight = race.wet > 0.2 && Math.floor(performance.now() / 300) % 2 === 0;
    const sorted = [...race.cars].sort((a, b) => Number(a.id === this.followId) - Number(b.id === this.followId));
    // pedaços de asa: voam um pouco, escorregam e ficam na pista até sumir
    // pausado: fumaça, faíscas e pedaços param junto com a corrida
    const dt = speed === 0 ? 0 : Math.min(0.1, realDt) * Math.min(4, Math.max(1, speed));
    this.debris = this.debris.filter((d) => (d.t += dt) < 14);
    for (const d of this.debris) {
      const f = Math.exp(-2.2 * dt);
      d.vx *= f;
      d.vy *= f;
      d.spin *= Math.exp(-1.6 * dt);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.h += d.spin * dt;
      const air = d.t < 0.6 ? 1 + 0.35 * Math.sin((d.t / 0.6) * Math.PI) : 1; // no ar parece maior
      const { x, y } = toCss(d);
      this.drawCar(o, x, y, d.h, d.img, m * air, d.t > 11 ? (14 - d.t) / 3 : 1);
    }
    this.fx.step(dt);
    this.fx.drawGround(o, toCss, m);
    for (const c of sorted) {
      const p = pos.get(c.id)!;
      const { x, y } = toCss(p);
      const margin = CAR_LEN_M * m;
      if (x < -margin || y < -margin || x > W + margin || y > H + margin) continue;
      this.screenPos.set(c.id, { x, y });
      if (race.wet > 0.25 && c.v > 25) this.spray(o, x, y, p.h, race.wet, m);
      const curv = race.track.curvature[Math.floor(race.track.wrap(c.s)) % L] ?? 0;
      const yaw = this.fx.update(c, p, dt, curv, !!race.track.def.street, c.id === this.followId, race.track.bumpAt(c.s));
      const crashed = this.fx.crashed(c);
      const hh = p.h + yaw, alpha = c.retired && !crashed ? 0.6 : 1;
      let look = lookOf(c.dmg, c.dmgSide, c.flatWheel, c.fault === "puncture", this.steerOf(c));
      // bateu: sem asa dianteira e com uma roda arrancada (os pedaços voam pelo dropParts)
      if (crashed) {
        const lost = [...c.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 4;
        look = { ...look, fw: { state: "none", side: "l" }, wheels: look.wheels.map((w, i) => (i === lost ? "off" : w)) as CarLook["wheels"] };
      }
      this.dropParts(c, look, p);
      if (!(car3dPref.on && drawCar3d(o, c.team, x, y, hh, m, alpha, look, rainLight, performance.now() / 1000)))
        this.drawCar(o, x, y, hh, carImage(c.team, rainLight), m, alpha);
      if (c.retired) this.smoke(o, x, y, m);
    }

    if (scPos) {
      const { x, y } = toCss(scPos);
      this.screenPos.set("SC", { x, y });
      const blink = Math.floor(performance.now() / 250) % 2 === 0;
      this.drawCar(o, x, y, scPos.h, carImage(race.cars[0].team, blink, true), m, 1);
    }

    this.fx.drawAir(o, toCss, m);

    // túnel: o teto cobre os carros (as etiquetas continuam aparecendo)
    if (race.track.tunnel) {
      o.setTransform(this.dpr * m, 0, 0, this.dpr * m, -viewX * m * this.dpr, -viewY * m * this.dpr);
      const tp = (this.tunnelPaths ??= tunnelPaths(race.track));
      o.fillStyle = "rgba(0,0,0,0.35)";
      o.fill(tp.shadow);
      o.fillStyle = "#3d4048";
      o.fill(tp.roof);
      o.strokeStyle = "#585c66";
      o.lineWidth = 0.6;
      o.stroke(tp.roof);
      o.strokeStyle = "#ffd98a";
      o.lineWidth = 0.5;
      o.setLineDash([1.2, 6]);
      o.stroke(tp.lights);
      o.setLineDash([]);
      o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // etiquetas: carro seguido, carros dos jogadores e safety car (empilham quando se sobrepõem)
    const placed: { x: number; y: number; w: number }[] = [];
    const lift = Math.max(14, 1.6 * m);
    if (scPos) {
      const sp = this.screenPos.get("SC")!;
      this.label(o, sp.x, sp.y - lift, this.followId === "SC" ? "SAFETY CAR" : "SC", "#ffcc00", "#111", placed);
    }
    for (const c of race.cars) {
      const sp = this.screenPos.get(c.id);
      if (!sp) continue;
      const mine = c.isHuman;
      if (!mine && c.id !== this.followId) continue;
      const eng = this.showEngineers && c.isHuman ? ` (${race.engineers[c.team.id]?.name ?? ""})` : "";
      const txt = (c.retired ? `OUT ${c.driver.short}` : `P${c.position} ${c.driver.short}`) + eng;
      this.label(o, sp.x, sp.y - lift, txt, mine ? c.team.color : "#111", mine && isLight(c.team.color) ? "#111" : "#fff", placed);
    }

    if (race.rain > 0) this.drawRain(o, W, H, realDt, race.rain);
    if (race.phase === "lights") this.drawLights(o, W);
  }

  private tunnelPaths: ReturnType<typeof tunnelPaths> | null = null;

  /** ângulo das rodas da frente: a curvatura um pouco à frente (exagerado pra ler de cima); rodando, contra-esterço */
  private steerSmooth = new Map<string, { v: number; t: number }>();
  private steerOf(c: Race["cars"][number]): number {
    const tr = this.race.track;
    let target: number;
    if (c.spin > 0) target = Math.sin(performance.now() / 90) * 0.45; // contra-esterço rodando
    else {
      // média da curvatura logo à frente (o piloto já vira na entrada) e ângulo proporcional à curva:
      // raio 300 m ≈ 5°, 100 m ≈ 14°, grampo = batente (exagerado de propósito pra ler de cima)
      let k = 0;
      for (const d of [2, 5, 8, 11]) k += tr.curvature[Math.floor(tr.wrap(c.s + d)) % tr.L] ?? 0;
      target = Math.max(-0.5, Math.min(0.5, (k / 4) * 25));
    }
    // suave: o volante não pula de uma posição pra outra
    const now = performance.now();
    const st = this.steerSmooth.get(c.id) ?? { v: target, t: now };
    st.v += (target - st.v) * Math.min(1, ((now - st.t) / 1000) * 7);
    st.t = now;
    this.steerSmooth.set(c.id, st);
    return st.v;
  }

  /** alguma peça saiu neste quadro: solta o pedaço (voa pra frente, girando, e fica na pista) */
  private dropParts(c: Race["cars"][number], look: CarLook, p: { x: number; y: number; h: number }) {
    const prev = this.lookSeen.get(c.id);
    this.lookSeen.set(c.id, look);
    if (!prev || !car3dPref.on) return;
    const out: ReturnType<typeof partPiece>[] = [];
    const wing = (part: "asa_d" | "asa_t", a: CarLook["fw"], b: CarLook["fw"]) => {
      if (a.state === b.state) return;
      if (b.state === "half") out.push(partPiece(c.team, part, b.side));
      else if (b.state === "none") out.push(partPiece(c.team, part, a.state === "half" ? (a.side === "l" ? "r" : "l") : "full"));
    };
    wing("asa_d", prev.fw, look.fw);
    wing("asa_t", prev.rw, look.rw);
    look.wheels.forEach((w, i) => {
      if (w === "off" && prev.wheels[i] !== "off") out.push(partPiece(c.team, "roda", i));
    });
    const fx = Math.cos(p.h), fy = Math.sin(p.h);
    for (const piece of out) {
      if (!piece) continue;
      const side = (Math.random() - 0.5) * 8 + piece.dy * 3;
      // sai de onde a peça estava no carro e gira em volta de si mesma
      const x = p.x + fx * piece.dx - fy * piece.dy, y = p.y + fy * piece.dx + fx * piece.dy;
      this.debris.push({ img: piece.img, x, y, h: p.h, vx: fx * c.v * 0.55 - fy * side, vy: fy * c.v * 0.55 + fx * side, spin: (Math.random() - 0.5) * 9, t: 0 });
    }
    while (this.debris.length > 16) this.debris.shift();
  }


  private drawCar(o: CanvasRenderingContext2D, x: number, y: number, h: number, img: ReturnType<typeof carImage>, m: number, alpha: number) {
    o.save();
    o.translate(x, y);
    o.rotate(h);
    o.globalAlpha = alpha;
    o.drawImage(img.canvas, (-img.wM / 2) * m, (-img.hM / 2) * m, img.wM * m, img.hM * m);
    o.restore();
  }

  private label(o: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, placed: { x: number; y: number; w: number }[]) {
    o.font = "600 12px Oswald, sans-serif";
    o.textAlign = "center";
    o.textBaseline = "middle";
    const w = Math.ceil(o.measureText(text).width) + 10;
    const anchor = y;
    // sobe a etiqueta até não encostar em nenhuma já desenhada
    const hits = () => placed.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 + 3 && Math.abs(r.y - y) < 17);
    for (let k = 0; k < 6 && hits(); k++) y -= 17;
    placed.push({ x, y, w });
    o.fillStyle = "rgba(0,0,0,0.55)";
    o.fillRect(x - 0.75, y + 7, 1.5, anchor - y + 4);
    o.fillStyle = "rgba(0,0,0,0.5)";
    o.fillRect(x - w / 2 + 2, y - 7 + 2, w, 15);
    o.fillStyle = bg;
    o.fillRect(x - w / 2, y - 7, w, 15);
    o.fillStyle = fg;
    o.fillText(text, x, y + 1);
  }

  private spray(o: CanvasRenderingContext2D, x: number, y: number, h: number, wet: number, m: number) {
    const n = Math.round(6 + wet * 14);
    for (let i = 0; i < n; i++) {
      const back = (2.6 + Math.random() * 4) * m;
      const side = (Math.random() - 0.5) * 2.2 * m;
      const sx = x - Math.cos(h) * back - Math.sin(h) * side;
      const sy = y - Math.sin(h) * back + Math.cos(h) * side;
      o.fillStyle = `rgba(220,230,245,${(0.1 + Math.random() * 0.22).toFixed(2)})`;
      const r = (0.15 + Math.random() * 0.35) * m;
      o.beginPath();
      o.arc(sx, sy, r, 0, Math.PI * 2);
      o.fill();
    }
  }

  private smoke(o: CanvasRenderingContext2D, x: number, y: number, m: number) {
    const t = performance.now() / 1000;
    for (let i = 0; i < 8; i++) {
      const k = (t * 0.7 + i / 8) % 1;
      o.fillStyle = `rgba(150,150,150,${(0.45 * (1 - k)).toFixed(2)})`;
      o.beginPath();
      o.arc(x + Math.sin(i * 3.1 + t) * 0.8 * m, y - k * 4 * m, (0.4 + k * 0.8) * m, 0, Math.PI * 2);
      o.fill();
    }
  }

  private drawRain(o: CanvasRenderingContext2D, W: number, H: number, dt: number, rain: number) {
    const want = Math.round(rain * 420 * (W * H) / (1600 * 1000));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * W, y: Math.random() * H, l: 8 + Math.random() * 10 });
    if (this.drops.length > want) this.drops.length = want;
    o.strokeStyle = "rgba(180,200,235,0.45)";
    o.lineWidth = 1.2;
    o.beginPath();
    for (const d of this.drops) {
      d.x -= 160 * dt;
      d.y += 800 * dt;
      if (d.y > H) {
        d.y = -10;
        d.x = Math.random() * (W + 80);
      }
      if (d.x < -10) d.x = W + 10;
      o.moveTo(d.x, d.y);
      o.lineTo(d.x - d.l * 0.2, d.y + d.l);
    }
    o.stroke();
  }

  private drawLights(o: CanvasRenderingContext2D, W: number) {
    const lit = Math.min(5, Math.floor(this.race.time));
    const r = 16, gap = 46;
    const x0 = W / 2 - gap * 2;
    o.fillStyle = "#111";
    o.fillRect(x0 - 30, 70, gap * 4 + 60, 56);
    for (let i = 0; i < 5; i++) {
      o.beginPath();
      o.arc(x0 + i * gap, 98, r, 0, Math.PI * 2);
      o.fillStyle = i < lit ? "#ff2a2a" : "#3a1010";
      if (i < lit) {
        o.shadowColor = "#ff2a2a";
        o.shadowBlur = 18;
      }
      o.fill();
      o.shadowBlur = 0;
    }
  }
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return r * 0.299 + gg * 0.587 + b * 0.114 > 160;
}

/** Minimapa com a pista inteira e os carros como pontos (clicável). */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private path: Path2D;
  private tf: (x: number, y: number) => [number, number];
  private dots = new Map<string, [number, number]>();

  constructor(private canvas: HTMLCanvasElement, private race: Race, onPick: (id: string) => void) {
    this.ctx = canvas.getContext("2d")!;
    const pts = race.track.pts;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = 10;
    const sc = Math.min((canvas.width - pad * 2) / (maxX - minX), (canvas.height - pad * 2 - 14) / (maxY - minY));
    const offX = (canvas.width - (maxX - minX) * sc) / 2, offY = (canvas.height - 14 - (maxY - minY) * sc) / 2;
    this.tf = (x, y) => [offX + (x - minX) * sc, offY + (y - minY) * sc];
    this.path = new Path2D();
    pts.forEach((p, i) => {
      const [x, y] = this.tf(p.x, p.y);
      if (i === 0) this.path.moveTo(x, y); else this.path.lineTo(x, y);
    });
    this.path.closePath();
    canvas.style.cursor = "pointer";
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * canvas.width;
      const y = ((e.clientY - r.top) / r.height) * canvas.height;
      let best: string | null = null;
      let bestD = 16;
      for (const [id, [dx, dy]] of this.dots) {
        const d = Math.hypot(dx - x, dy - y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best) onPick(best);
    });
  }

  draw(followId: string) {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.lineJoin = "round";
    g.strokeStyle = "#0b0d12";
    g.lineWidth = 7;
    g.stroke(this.path);
    g.strokeStyle = this.race.wet > 0.25 ? "#5a7fa8" : "#8b8f99";
    g.lineWidth = 3;
    g.stroke(this.path);
    const [sx, sy] = this.tf(this.race.track.pts[0].x, this.race.track.pts[0].y);
    g.fillStyle = "#fff";
    g.fillRect(sx - 1, sy - 4, 2, 8);

    this.dots.clear();
    const cars = [...this.race.cars].sort((a, b) => Number(a.isHuman) - Number(b.isHuman));
    for (const c of cars) {
      if (c.pit === "parked") continue;
      const p = this.race.track.pose(c.s, c.lateral);
      const [x, y] = this.tf(p.x, p.y);
      this.dots.set(c.id, [x, y]);
      const r = c.isHuman ? 4 : 3;
      g.fillStyle = "#000";
      g.fillRect(Math.round(x - r - 1), Math.round(y - r - 1), r * 2 + 2, r * 2 + 2);
      g.fillStyle = c.retired ? "#555" : c.team.color;
      g.fillRect(Math.round(x - r), Math.round(y - r), r * 2, r * 2);
      if (c.id === followId) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1;
        g.strokeRect(Math.round(x - r - 2) + 0.5, Math.round(y - r - 2) + 0.5, r * 2 + 3, r * 2 + 3);
      }
    }
    if (this.race.sc.active && this.race.sc.onTrack) {
      const p = this.race.track.pose(this.race.sc.s, 0);
      const [x, y] = this.tf(p.x, p.y);
      g.fillStyle = "#000";
      g.fillRect(Math.round(x - 4), Math.round(y - 4), 8, 8);
      g.fillStyle = "#ffcc00";
      g.fillRect(Math.round(x - 3), Math.round(y - 3), 6, 6);
      this.dots.set("SC", [x, y]);
      if (followId === "SC") {
        g.strokeStyle = "#fff";
        g.strokeRect(Math.round(x - 6) + 0.5, Math.round(y - 6) + 0.5, 11, 11);
      }
    }
  }
}


/** teto do túnel (cobre a pista e um pouco de cada lado) */
function tunnelPaths(t: import("../sim/track").Track) {
  const [a, b0] = t.tunnel!;
  const b = b0 < a ? b0 + t.L : b0;
  const half = TRACK_WIDTH / 2 + 4;
  const band = (l0: number, l1: number, dx = 0, dy = 0) => {
    const p = new Path2D();
    const pts: { x: number; y: number }[] = [];
    for (let s = a; s <= b; s += 3) pts.push(t.pose(s, l0));
    for (let s = b; s >= a; s -= 3) pts.push(t.pose(s, l1));
    pts.forEach((q, i) => (i ? p.lineTo(q.x + dx, q.y + dy) : p.moveTo(q.x + dx, q.y + dy)));
    p.closePath();
    return p;
  };
  const lights = new Path2D();
  for (const side of [-1, 1]) {
    let first = true;
    for (let s = a + 4; s <= b - 4; s += 3) {
      const q = t.pose(s, side * (half - 2.5));
      if (first) lights.moveTo(q.x, q.y);
      else lights.lineTo(q.x, q.y);
      first = false;
    }
  }
  return { roof: band(-half, half), shadow: band(-half, half, 1.6, 2), lights };
}
