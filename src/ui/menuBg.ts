// Fundo animado do menu: um circuito grande com brilho e alguns "carros" de luz
// dando volta, com rastro. Quando o líder completa a volta, a faixa vermelha sai
// pela esquerda e outra entra pela direita "varrendo" a tela: atrás dela (à
// direita) já aparece a pista nova; na frente (à esquerda) ainda é a antiga.
import { ACTIVE_TRACKS, CIRCUITS, getTrack, randomTrack, type Vec } from "../sim/track";
import { MENU_HANDOFF } from "./transition";

const RUNNERS = [
  { color: "#ff2a32", speed: 0.06, start: 0 }, // líder: a volta dele troca a pista
  { color: "#38c6ff", speed: 0.056, start: -0.04 },
  { color: "#ffc21a", speed: 0.053, start: -0.08 },
];
/** ida da faixa pra direita (apagando) / volta pra esquerda (desenhando a nova), em ms */
const EXIT_MS = 760;
const SWEEP_MS = 1100;
/** geometria da faixa (igual ao CSS de .m2stripe): esquerda em 33vw, 9vw de largura, inclinada -18° em volta de 55vh */
const STRIPE_LEFT = 0.33, STRIPE_W = 0.09, STRIPE_CY = 0.55, SKEW = Math.tan((18 * Math.PI) / 180);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Trava da faixa vermelha: o fundo (troca de pista) e o menu (troca de vista) usam a
 * mesma faixa, então só um anima por vez. `rush` pede pro dono atual acelerar até o
 * fim; `free` é chamado quando a faixa fica livre.
 */
export interface StripeLock {
  owner: "menu" | "bg" | null;
  rush?: () => void;
  free?: () => void;
}

/** libera a faixa e avisa quem estava esperando */
export function releaseStripe(lock: StripeLock) {
  lock.owner = null;
  lock.rush = undefined;
  const f = lock.free;
  lock.free = undefined;
  f?.();
}

/** pista do fundo e começo da volta dela, compartilhada entre a tela de entrada e o menu */
export const backdropMemo: { v: { idx: number; t0: number } | null } = { v: null };

export function trackIndexByName(name: string): number {
  const i = ACTIVE_TRACKS.find((k) => CIRCUITS[k].name.toLowerCase().includes(name.toLowerCase()));
  return i ?? ACTIVE_TRACKS[0];
}

interface TrackGeo {
  idx: number;
  pts: Vec[];
  cum: number[];
  total: number;
  bounds: [number, number, number, number];
}

function geo(idx: number): TrackGeo {
  const pts = getTrack(idx).pts;
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { idx, pts, cum, total: cum[cum.length - 1], bounds: [minX, minY, maxX, maxY] };
}

function pointAt(t: TrackGeo, u: number) {
  const d = (((u % 1) + 1) % 1) * t.total;
  let lo = 0, hi = t.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t.cum[m] <= d) lo = m;
    else hi = m;
  }
  const a = t.pts[lo % t.pts.length], b = t.pts[(lo + 1) % t.pts.length];
  const k = (d - t.cum[lo]) / Math.max(1e-6, t.cum[lo + 1] - t.cum[lo]);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** pista pronta pra desenhar: geometria + imagem do traçado + escala na tela */
interface Scene {
  tr: TrackGeo;
  layer: HTMLCanvasElement;
  map: { sc: number; ox: number; oy: number };
  t0: number; // quando a volta começou
}

/**
 * Monta o fundo no canvas. `stripe` é a faixa vermelha (o fundo move ela durante a
 * troca). `onTrack(idx)` avisa quando a pista nova começa a entrar.
 */
export function mountMenuBackdrop(
  cv: HTMLCanvasElement,
  trackIndex: number,
  stripe?: HTMLElement | null,
  onTrack?: (idx: number) => void,
  /** nomes pros 3 carros (1º, 2º e 3º melhor tempo da pista) */
  labels?: (idx: number) => string[],
  lock: StripeLock = { owner: null },
  /** continuar uma volta já começada (quando o menu é redesenhado): início dela em performance.now() */
  startT0?: number,
  /** avisa a pista atual e quando a volta dela começou (pra continuar depois de redesenhar) */
  onState?: (idx: number, t0: number) => void,
  /** voltando do jogo: a pista só aparece quando a faixa da transição chega (ela vai e volta desenhando) */
  intro = false,
) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const g = cv.getContext("2d")!;
  let grid: HTMLCanvasElement | null = null;
  let W = 0, H = 0, dpr = 1;

  const build = (idx: number, t0: number): Scene => {
    const tr = geo(idx);
    const [minX, minY, maxX, maxY] = tr.bounds;
    const areaX = W * 0.47, areaW = W * 0.44, areaY = H * 0.17, areaH = H * 0.58;
    const sc = Math.min(areaW / (maxX - minX), areaH / (maxY - minY));
    const map = { sc, ox: areaX + (areaW - (maxX - minX) * sc) / 2 - minX * sc, oy: areaY + (areaH - (maxY - minY) * sc) / 2 - minY * sc };
    const layer = document.createElement("canvas");
    layer.width = cv.width;
    layer.height = cv.height;
    const l = layer.getContext("2d")!;
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    const path = new Path2D();
    tr.pts.forEach((p, i) => {
      const x = map.ox + p.x * map.sc, y = map.oy + p.y * map.sc;
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
    });
    path.closePath();
    l.lineJoin = "round";
    l.lineCap = "round";
    l.shadowColor = "rgba(232,32,42,0.55)";
    l.shadowBlur = 28;
    l.strokeStyle = "rgba(232,32,42,0.35)";
    l.lineWidth = 16;
    l.stroke(path);
    l.shadowBlur = 0;
    l.strokeStyle = "#232a3a";
    l.lineWidth = 12;
    l.stroke(path);
    l.strokeStyle = "rgba(233,237,245,0.85)";
    l.lineWidth = 2;
    l.stroke(path);
    // linha de largada: atravessa a pista (perpendicular ao traçado), quadriculada
    const a0 = pointAt(tr, 0), a1 = pointAt(tr, 0.002);
    const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);
    l.save();
    l.translate(map.ox + a0.x * map.sc, map.oy + a0.y * map.sc);
    l.rotate(ang);
    const cw = 4, rows = 6; // 2 colunas x 6 linhas de quadradinhos
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < 2; c++) {
        l.fillStyle = (r + c) % 2 ? "#0b0e15" : "#ffffff";
        l.fillRect(-cw + c * cw, -rows * cw / 2 + r * cw, cw, cw);
      }
    l.restore();
    return { tr, layer, map, t0 };
  };

  let cur: Scene;
  let next: Scene | null = null;
  const layout = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth;
    H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    grid = document.createElement("canvas");
    grid.width = cv.width;
    grid.height = cv.height;
    const l = grid.getContext("2d")!;
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.strokeStyle = "rgba(120,140,180,0.025)";
    l.lineWidth = 1;
    for (let x = 0; x < W; x += 48) { l.beginPath(); l.moveTo(x, 0); l.lineTo(x, H); l.stroke(); }
    for (let y = 0; y < H; y += 48) { l.beginPath(); l.moveTo(0, y); l.lineTo(W, y); l.stroke(); }
    cur = build(cur ? cur.tr.idx : trackIndex, cur ? cur.t0 : startT0 ?? performance.now());
    if (next) next = build(next.tr.idx, next.t0);
  };
  layout();
  const onResize = () => layout();
  window.addEventListener("resize", onResize);

  // troca: "exit" (faixa sai pela esquerda) -> "sweep" (nova faixa varre da direita)
  let phase: "intro" | "run" | "exit" | "sweep" = "run";
  /** a pista ainda não apareceu (intro): na ida a faixa não tem o que apagar */
  let empty = false;
  if (intro && !reduce) {
    phase = "intro";
    empty = true;
    lock.owner = "bg";
    const go = () => {
      window.removeEventListener(MENU_HANDOFF, go);
      clearTimeout(fallback);
      if (phase !== "intro") return;
      cur = { ...cur, t0: performance.now() };
      phase = "exit";
      pk = 0;
      rushing = false;
      lock.rush = () => (rushing = true);
    };
    window.addEventListener(MENU_HANDOFF, go);
    // se a transição não avisar (tela revelada sem animação), começa assim mesmo
    const fallback = setTimeout(go, 1600);
  }
  /** progresso da fase atual (0..1); com pressa (o menu quer a faixa) as fases terminam rapidinho */
  let pk = 0;
  let last = performance.now();
  let rushing = false;
  let frozenAt = 0;
  const nextIdx = () => {
    return randomTrack(Math.random, cur.tr.idx);
  };

  /** desenha uma pista e os carros dela, recortada por `clip` (ou inteira) e deslocada em x */
  const drawScene = (s: Scene, now: number, clip: Path2D | null, dx: number, frozenAt?: number, alpha = 1) => {
    g.save();
    g.globalAlpha = alpha;
    if (clip) g.clip(clip);
    g.setTransform(1, 0, 0, 1, dx * dpr, 0);
    g.drawImage(s.layer, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, dx * dpr, 0);
    const t = ((frozenAt ?? now) - s.t0) / 1000;
    const names = labels?.(s.tr.idx) ?? [];
    RUNNERS.forEach((r, ri) => {
      const u = r.start + t * r.speed;
      for (let k = 14; k >= 0; k--) {
        const uk = u - k * 0.0035; // antes da largada fica no fim da volta (enfileirado atrás da linha)
        const p = pointAt(s.tr, uk);
        g.globalAlpha = alpha * (1 - k / 15) * 0.8;
        g.fillStyle = r.color;
        g.beginPath();
        g.arc(s.map.ox + p.x * s.map.sc, s.map.oy + p.y * s.map.sc, k === 0 ? 5 : 3.2 - k * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      const p = pointAt(s.tr, u);
      g.globalAlpha = alpha;
      g.shadowColor = r.color;
      g.shadowBlur = 18;
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(s.map.ox + p.x * s.map.sc, s.map.oy + p.y * s.map.sc, 2.4, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      // plaquinha com o nome (posição + nome) acima do carro
      const nm = names[ri];
      if (nm) {
        const x = s.map.ox + p.x * s.map.sc, y = s.map.oy + p.y * s.map.sc - 14;
        const txt = `${ri + 1}º ${nm.toUpperCase()}`;
        g.font = "600 11px Oswald, sans-serif";
        const w = g.measureText(txt).width + 10;
        g.fillStyle = "rgba(8,10,16,0.85)";
        g.fillRect(x - w / 2, y - 9, w, 16);
        g.fillStyle = r.color;
        g.fillRect(x - w / 2, y - 9, 2, 16);
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(txt, x + 1, y);
      }
    });
    g.restore();
  };

  /**
   * Bandeira quadriculada no fundo, bem apagada (só a impressão dela): as casas claras deslizam
   * devagar na diagonal e uma ondulação de tecido passa por elas (brilho e um balanço leve).
   * Mais fraca perto do menu (à esquerda) e nas bordas.
   */
  const FLAG_S = 54;
  /** bandeira tremulando no vento (?bandeira=calma = a versão antiga, que só desliza) */
  const WIND = new URLSearchParams(location.search).get("bandeira") !== "calma";
  /**
   * Bandeira no vento: presa do lado do menu e solta na ponta direita. Ondas atravessam o tecido
   * (mais fortes na ponta), as casas se deformam com a onda e as dobras ganham luz e sombra.
   */
  const drawWindFlag = (now: number) => {
    const t = reduce ? 0 : now / 1000;
    const x0 = W * 0.3; // onde o tecido "prende" (perto da faixa do menu)
    // deslocamento do tecido num ponto e a inclinação da onda ali (pra luz das dobras)
    const field = (x: number, y: number) => {
      const u = Math.max(0, Math.min(1, (x - x0) / (W - x0)));
      const ph = x * 0.011 + y * 0.0022 - t * 2.1;
      const ph2 = x * 0.019 - y * 0.004 - t * 3.3 + 1.3;
      const amp = 4 + 22 * u * u;
      return {
        x: x - Math.cos(ph) * 5 * u,
        y: y + Math.sin(ph) * amp + Math.sin(ph2) * 5 * u,
        light: Math.cos(ph) * (0.35 + 0.65 * u) + Math.cos(ph2) * 0.25 * u,
      };
    };
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let iy = -1; iy * FLAG_S < H + FLAG_S; iy++)
      for (let ix = 0; ix * FLAG_S < W + FLAG_S; ix++) {
        if ((ix + iy) & 1) continue;
        const x = ix * FLAG_S, y = iy * FLAG_S;
        const cx = x / W, cy = y / H;
        const fade = Math.min(1, Math.max(0, (cx - 0.12) * 2.2)) * Math.min(1, cy * 4 + 0.2, (1 - cy) * 4, (1 - cx) * 5 + 0.15);
        if (fade <= 0) continue;
        const a = field(x, y), b = field(x + FLAG_S, y), c = field(x + FLAG_S, y + FLAG_S), d = field(x, y + FLAG_S);
        const light = (a.light + b.light + c.light + d.light) / 4;
        // dobra virada pra luz = mais clara; virada pro outro lado = quase some
        const alpha = Math.max(0, (0.016 + 0.03 * (0.5 + 0.5 * light)) * fade);
        if (alpha < 0.003) continue;
        g.fillStyle = `rgba(205,215,240,${alpha.toFixed(4)})`;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.lineTo(c.x, c.y);
        g.lineTo(d.x, d.y);
        g.closePath();
        g.fill();
      }
    g.restore();
  };
  const drawFlag = (now: number) => {
    if (WIND) return drawWindFlag(now);
    const t = reduce ? 0 : now / 1000;
    const ox = (t * 6) % (FLAG_S * 2), oy = (t * 3) % (FLAG_S * 2);
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let iy = -2; iy * FLAG_S < H + FLAG_S; iy++)
      for (let ix = -2; ix * FLAG_S < W + FLAG_S; ix++) {
        if ((ix + iy) & 1) continue;
        const x = ix * FLAG_S + ox, y = iy * FLAG_S + oy;
        // onda de tecido atravessando a bandeira
        const wave = 0.5 + 0.5 * Math.sin(x * 0.0055 + y * 0.0025 - t * 0.85);
        const sway = Math.sin(x * 0.009 - t * 1.1) * 4;
        // some nas bordas e do lado do menu
        const cx = x / W, cy = y / H;
        const fade = Math.min(1, Math.max(0, (cx - 0.12) * 2.2)) * Math.min(1, cy * 4, (1 - cy) * 4, (1 - cx) * 5);
        const a = (0.01 + 0.032 * wave) * fade;
        if (a < 0.003) continue;
        g.fillStyle = `rgba(205,215,240,${a.toFixed(4)})`;
        g.fillRect(x, y + sway, FLAG_S, FLAG_S);
      }
    g.restore();
  };

  /** região à direita do centro da faixa (deslocada `tx` px da posição de descanso) */
  const rightOfStripe = (tx: number) => {
    const xc = (y: number) => W * (STRIPE_LEFT + STRIPE_W / 2) + tx - SKEW * (y - H * STRIPE_CY);
    const p = new Path2D();
    p.moveTo(xc(0) * dpr, 0);
    p.lineTo(cv.width + 10, 0);
    p.lineTo(cv.width + 10, cv.height);
    p.lineTo(xc(H) * dpr, cv.height);
    p.closePath();
    return p;
  };
  /** até onde a faixa vai pra direita (sai da tela, mesmo inclinada) */
  const farRight = () => W * (1 - STRIPE_LEFT) + W * 0.05 + H * SKEW * 0.6;
  const setStripe = (tx: number) => {
    if (stripe) stripe.style.transform = `translateX(${tx}px) skewX(-18deg)`;
  };

  let raf = 0;
  const frame = (now: number) => {
    if (!cv.isConnected) {
      window.removeEventListener("resize", onResize);
      if (lock.owner === "bg") releaseStripe(lock);
      return;
    }
    const dt = Math.min(100, now - last);
    last = now;
    // líder completou a volta: troca a pista — mas só se a faixa estiver livre (senão os carros seguem mais um pouco)
    if (phase === "run" && !reduce && lock.owner === null && RUNNERS[0].start + ((now - cur.t0) / 1000) * RUNNERS[0].speed >= 1) {
      phase = "exit";
      pk = 0;
      rushing = false;
      frozenAt = now;
      lock.owner = "bg";
      lock.rush = () => (rushing = true);
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (grid) g.drawImage(grid, 0, 0);
    drawFlag(now);

    if (phase === "intro") {
      setStripe(0); // só a grade: a pista aparece quando a faixa passar
    } else if (phase === "run") {
      drawScene(cur, now, null, 0);
    } else if (phase === "exit") {
      // ida: a faixa vai pra direita apagando a pista antiga (só sobra o que ainda está à direita dela)
      pk = Math.min(1, pk + dt / (rushing ? 110 : EXIT_MS));
      const tx = easeInOut(pk) * farRight();
      setStripe(tx);
      // intro: na ida não tem pista ainda (ela aparece na volta da faixa)
      if (!empty) drawScene(cur, now, rightOfStripe(tx), 0, frozenAt);
      if (pk >= 1) {
        // na intro a pista é a mesma (a faixa desenha ela na volta); senão sorteia a próxima
        next = empty ? cur : build(nextIdx(), now + (rushing ? 0 : SWEEP_MS * 0.35));
        if (!empty) onTrack?.(next.tr.idx);
        empty = false;
        phase = "sweep";
        pk = 0;
      }
    } else if (phase === "sweep" && next) {
      // volta: a faixa vem pra esquerda até o lugar dela, desenhando a pista nova por onde passa
      pk = Math.min(1, pk + dt / (rushing ? 140 : SWEEP_MS));
      const e = easeOut(pk);
      const tx = farRight() * (1 - e);
      setStripe(tx);
      drawScene(next, Math.max(now, next.t0), rightOfStripe(tx), 40 * (1 - e));
      if (pk >= 1) {
        cur = next;
        next = null;
        onState?.(cur.tr.idx, cur.t0);
        phase = "run";
        setStripe(0);
        releaseStripe(lock);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
