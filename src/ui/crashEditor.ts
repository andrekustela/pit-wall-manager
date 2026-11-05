// EDITOR DE LANCE: o usuário mostra como um acidente deve ser, quadro a quadro, em cima da pista vista de cima:
// um ou mais carros (o seu e adversários), onde cada um está, pra onde o bico aponta e o que acontece com cada um
// (perde asa inteira ou meia, solta/fura cada roda, bate, toca no outro, fumaça...). TOCAR anima; COMPARAR roda a
// física do jogo (slidePhysics, a do escorregão) a partir do começo do carro escolhido, em vermelho; COPIAR leva tudo
// em texto pra conversa. Abre pelo Editor > PISTAS ou ?editor=lance. Guardado em localStorage "pwm.lance".
import { ACTIVE_TRACKS, CIRCUITS, getTrack, type Track } from "../sim/track";
import { slideStep, type SlideBody } from "../sim/slidePhysics";
import { car3dReady, drawCar3d, lookOf } from "../render/car3d";
import { TEAMS } from "../sim/data";

/** um carro num quadro */
interface Pos {
  x: number;
  y: number;
  h: number;
  marks: string[];
  note?: string;
}
interface Frame {
  t: number;
  cars: Pos[];
}
interface Lance {
  track: number;
  name: string;
  dt: number;
  frames: Frame[];
  cx: number;
  cy: number;
  zoom: number;
}
type Pose = { x: number; y: number; h: number };

const KEY = "pwm.lance";
const CAR_L = 4.8, CAR_W = 1.8, HALF_TRACK = 9;
/** o que pode acontecer com um carro num quadro, em grupos (id: texto) */
const GROUPS: [string, [string, string][]][] = [
  ["Asa dianteira", [["fw", "perde inteira"], ["fwE", "perde metade esq."], ["fwD", "perde metade dir."]]],
  ["Asa traseira", [["rw", "perde"]]],
  ["Roda solta", [["offDE", "diant. esq."], ["offDD", "diant. dir."], ["offTE", "tras. esq."], ["offTD", "tras. dir."]]],
  ["Pneu furado", [["furDE", "diant. esq."], ["furDD", "diant. dir."], ["furTE", "tras. esq."], ["furTD", "tras. dir."]]],
  ["Batida", [["muro", "bate no muro"], ["toque", "toca no outro carro"], ["para", "para"]]],
  ["Efeitos", [["fumaca", "fumaça de pneu"], ["trava", "trava as rodas"], ["faisca", "faísca"], ["terra", "joga brita/terra"], ["motor", "fumaça do motor"]]],
];
const LABEL = new Map(GROUPS.flatMap(([g, ms]) => ms.map(([id, t]) => [id, `${g.toLowerCase()}: ${t}`] as const)));
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const num = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
const carName = (i: number) => (i ? `Adversário ${i}` : "Carro 1");

function load(): Lance | null {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? "null") as (Omit<Lance, "frames"> & { frames: (Frame | (Pos & { t: number }))[] }) | null;
    if (!l || !Array.isArray(l.frames) || !l.frames.length || !CIRCUITS[l.track]) return null;
    // (formato antigo, um carro só: o quadro era o próprio carro; marcas antigas viram as novas)
    const old: Record<string, string> = { "perde asa dianteira": "fw", "perde asa traseira": "rw", "perde roda": "offDE", "bate no muro": "muro", "toque em outro carro": "toque", "fumaça de pneu": "fumaca", "trava as rodas": "trava", para: "para" };
    l.frames = l.frames.map((f) => ("cars" in f ? f : { t: f.t, cars: [{ x: f.x, y: f.y, h: f.h, marks: f.marks.map((m) => old[m] ?? m), note: f.note }] }));
    return l as Lance;
  } catch {
    return null;
  }
}
/** o texto do 📋 COPIAR / do arquivo salvo (a linha do JSON no fim, com metro/lateral/bico na pista) → o lance de volta no editor */
export function fromText(text: string): Lance | null {
  const i = text.indexOf('{"pista"');
  if (i < 0) return null;
  type P = { s: number; lat: number; yaw: number; marks?: string[]; note?: string };
  const d = JSON.parse(text.slice(i).trim()) as { pista: string; nome?: string; quadros: ({ t: number; carros?: P[] } & Partial<P>)[] };
  const ti = CIRCUITS.findIndex((c) => c.name === d.pista);
  if (ti < 0 || !Array.isArray(d.quadros) || !d.quadros.length) return null;
  const tr = getTrack(ti);
  const pos = (p: P): Pos => {
    const q = tr.pose(tr.wrap(p.s), p.lat);
    return { x: q.x, y: q.y, h: q.h + p.yaw, marks: p.marks ?? [], note: p.note };
  };
  // (texto de um carro só, do editor antigo: o quadro era o próprio carro)
  const frames = d.quadros.map((q) => ({ t: q.t, cars: (q.carros ?? [q as P]).map(pos) }));
  const c0 = frames[0].cars[0];
  return { track: ti, name: d.nome ?? "lance colado", dt: 0.2, frames, cx: c0.x, cy: c0.y, zoom: 16 };
}
function fresh(track: number): Lance {
  const t = getTrack(track), p = t.pose(0, 0);
  return { track, name: "meu lance", dt: 0.2, frames: [{ t: 0, cars: [{ x: p.x, y: p.y, h: p.h, marks: [] }] }], cx: p.x, cy: p.y, zoom: 16 };
}

/** onde o carro está em relação à pista: s (m), lateral (m, + = direita) e o bico em relação à pista (rad) */
export function onTrack(t: Track, f: Pose): { s: number; lat: number; yaw: number } {
  let best = 0, bd = Infinity;
  for (let s = 0; s < t.L; s++) {
    const p = t.pts[s], d = (p.x - f.x) ** 2 + (p.y - f.y) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  const p = t.pose(best, 0);
  return { s: best, lat: -Math.sin(p.h) * (f.x - p.x) + Math.cos(p.h) * (f.y - p.y), yaw: angDiff(p.h, f.h) };
}

/** a física do jogo a partir dos dois primeiros quadros de um carro (velocidade, rumo e giro), no asfalto, sem muro */
function physics(fr: Frame[], who: number): (Pose & { t: number })[] {
  if (fr.length < 2) return [];
  const a = { ...fr[0].cars[who], t: fr[0].t }, b = { ...fr[1].cars[who], t: fr[1].t }, dt = Math.max(0.01, b.t - a.t);
  const body: SlideBody = { v: Math.hypot(b.x - a.x, b.y - a.y) / dt, psi: Math.atan2(b.y - a.y, b.x - a.x), yaw: a.h, w: angDiff(a.h, b.h) / dt };
  const out = [{ t: a.t, x: a.x, y: a.y, h: a.h }];
  let x = a.x, y = a.y, t = a.t;
  const h = 0.05 / 8;
  // (atrito do stepSlide rodando no asfalto: 9 m/s²)
  for (let i = 0; i < 8 * 20 * 12 && (body.v > 0.3 || Math.abs(body.w) > 0.3); i++) {
    slideStep(body, 9, h);
    x += body.v * Math.cos(body.psi) * h;
    y += body.v * Math.sin(body.psi) * h;
    t += h;
    if (i % 8 === 7) out.push({ t, x, y, h: body.yaw });
  }
  return out;
}

/** o carro como fica até o quadro i: o que foi perdido até ali some do desenho (lookOf, o mesmo do jogo) */
function lookUntil(fr: Frame[], who: number, i: number) {
  const m = new Set(fr.slice(0, i + 1).flatMap((f) => f.cars[who]?.marks ?? []));
  const side = (l: boolean, r: boolean) => (l && r ? "b" : l ? "l" : r ? "r" : undefined);
  const fwSide = m.has("fw") ? "b" : side(m.has("fwE"), m.has("fwD"));
  const sF = side(m.has("offDE"), m.has("offDD")), sR = side(m.has("offTE"), m.has("offTD"));
  const flat = ["furDE", "furDD", "furTE", "furTD"].findIndex((k) => m.has(k));
  return lookOf(
    { fw: m.has("fw") ? 2 : fwSide ? 0.8 : 0, rw: m.has("rw") ? 2 : 0, suspF: sF ? 2 : 0, suspR: sR ? 2 : 0 },
    { fw: fwSide, suspF: sF, suspR: sR },
    flat >= 0 ? flat : undefined,
    flat >= 0,
    0,
  );
}

export function showCrashEditor(onClose?: () => void) {
  let L = load() ?? fresh(ACTIVE_TRACKS[0] ?? 0);
  let track = getTrack(L.track);
  let sel = 0, who = 0, play: number | null = null, playT = 0, compare = false, ghost: ReturnType<typeof physics> = [];
  const ncars = () => L.frames[0].cars.length;
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(L));
    } catch {
      /* sem armazenamento: só nesta aba */
    }
  };

  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;z-index:200;display:flex;background:#2f4f2a;font:500 14px 'Barlow Condensed','Rajdhani',sans-serif;color:#fff";
  root.innerHTML = `
    <canvas style="flex:1;min-width:0;touch-action:none;cursor:grab"></canvas>
    <div data-panel style="width:330px;flex:none;overflow-y:auto;background:rgba(12,14,20,.96);border-left:4px solid #e10600;padding:12px;display:flex;flex-direction:column;gap:7px">
      <b style="font-size:18px">🎬 EDITOR DE LANCE</b>
      <small style="opacity:.75">Clique num carro pra escolher. Arraste ele pra mover. Bolinha <b style="color:#ffcc00">amarela</b> (bico): gira com a traseira parada. Bolinha <b style="color:#3fd0ff">azul</b> (traseira): a traseira escapa com o bico parado. Q/E gira no meio. Fundo: arrasta a pista; roda do mouse: zoom.</small>
      <label>Nome <input data-name class="txt" style="width:100%"></label>
      <label>Pista <select data-track style="width:100%"></select></label>
      <label>Ir pra pista no metro <input data-s type="range" min="0" step="5" style="width:100%"></label>
      <div><b>Carros</b></div>
      <div data-cars style="display:flex;flex-wrap:wrap;gap:4px"></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn small" data-addcar>+ ADVERSÁRIO</button>
        <button class="btn small" data-delcar>✕ tirar este carro</button>
      </div>
      <div><b>Quadros</b> <small data-info style="opacity:.75"></small></div>
      <div data-frames style="display:flex;flex-wrap:wrap;gap:4px"></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn small primary" data-add>+ QUADRO</button>
        <label style="display:flex;align-items:center;gap:4px">a cada <input data-dt type="number" step="0.05" min="0.05" style="width:58px"> s</label>
        <button class="btn small" data-del>✕ apagar quadro</button>
      </div>
      <div data-read style="background:#1d212b;border-radius:6px;padding:6px 8px;line-height:1.5"></div>
      <div><b>O que acontece com <span data-whoname></span> neste quadro</b></div>
      <div data-marks style="display:flex;flex-direction:column;gap:5px"></div>
      <input data-note class="txt" placeholder="observação (o que mais acontece, opcional)">
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
        <button class="btn small primary" data-play>▶ TOCAR</button>
        <button class="btn small" data-cmp>COMPARAR COM A FÍSICA</button>
      </div>
      <small data-cmpinfo style="opacity:.75"></small>
      <button class="btn small primary" data-see style="margin-top:6px">▶ VER NA PISTA (3D)</button>
      <small style="opacity:.75">Abre a corrida nesta pista: lá pelos 20 s, carros do pelotão fazem o seu lance (e repete).</small>
      <div><b>Arquivos de lance</b></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
        <button class="btn small" data-save title="salva este lance num arquivo, na pasta que você escolher">💾 SALVAR ARQUIVO</button>
        <button class="btn small" data-open title="abre um lance salvo">📂 ABRIR ARQUIVO</button>
        <button class="btn small" data-paste title="cola o texto que o 📋 COPIAR gerou e o lance volta igual">📥 COLAR</button>
        <input data-file type="file" accept=".txt,.json" hidden>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:auto">
        <button class="btn small primary" data-copy>📋 COPIAR PRA CONVERSA</button>
        <button class="btn small" data-new>NOVO</button>
        <button class="btn small" data-close>✕ FECHAR</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const cv = root.querySelector("canvas")!, g = cv.getContext("2d")!;
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(`[data-${s}]`)!;
  const trackSel = q<HTMLSelectElement>("track");
  trackSel.innerHTML = ACTIVE_TRACKS.map((i) => `<option value="${i}">${CIRCUITS[i].name.replace(/</g, "")}</option>`).join("");

  const toScr = (x: number, y: number) => [(x - L.cx) * L.zoom + cv.clientWidth / 2, (y - L.cy) * L.zoom + cv.clientHeight / 2] as const;
  const toWorld = (sx: number, sy: number) => [(sx - cv.clientWidth / 2) / L.zoom + L.cx, (sy - cv.clientHeight / 2) / L.zoom + L.cy] as const;
  // alças: amarela na frente do bico, azul atrás da traseira (1,4 m pra fora do carro)
  const nose = (f: Pose) => [f.x + Math.cos(f.h) * (CAR_L / 2 + 1.4), f.y + Math.sin(f.h) * (CAR_L / 2 + 1.4)] as const;
  const tail = (f: Pose) => [f.x - Math.cos(f.h) * (CAR_L / 2 + 1.4), f.y - Math.sin(f.h) * (CAR_L / 2 + 1.4)] as const;
  const teamOf = (i: number) => TEAMS[(i * 3) % TEAMS.length];
  let retry = 0;

  /** desenha um carro (o do 2D estilizado; enquanto não carrega, um retângulo) */
  function car(f: Pose, i: number, alpha: number, opts: { look?: number; handles?: boolean; ring?: boolean; label?: string; fill?: string } = {}) {
    const [sx, sy] = toScr(f.x, f.y), z = L.zoom;
    if (opts.ring) {
      g.save();
      g.translate(sx, sy);
      g.rotate(f.h);
      g.strokeStyle = "#ffcc00";
      g.lineWidth = 2;
      g.strokeRect((-CAR_L / 2 - 0.4) * z, (-CAR_W / 2 - 0.4) * z, (CAR_L + 0.8) * z, (CAR_W + 0.8) * z);
      g.restore();
    }
    const real = !opts.fill && drawCar3d(g, teamOf(i), sx, sy, f.h, z, alpha, lookUntil(L.frames, i, opts.look ?? 0), false, 0);
    if (!opts.fill && !real && !car3dReady() && !retry) retry = window.setTimeout(() => ((retry = 0), draw()), 300);
    if (!real) {
      g.save();
      g.globalAlpha = alpha;
      g.translate(sx, sy);
      g.rotate(f.h);
      g.fillStyle = opts.fill ?? (i ? "#c0c6d4" : "#2e8bff");
      g.fillRect((-CAR_L / 2) * z, (-CAR_W / 2) * z, CAR_L * z, CAR_W * z);
      // bico (branco) e asa de trás (preta), pra ver pra onde aponta
      g.fillStyle = "#fff";
      g.fillRect((CAR_L / 2 - 0.5) * z, (-CAR_W / 2) * z, 0.5 * z, CAR_W * z);
      g.fillStyle = "#111";
      g.fillRect((-CAR_L / 2) * z, (-CAR_W / 2) * z, 0.4 * z, CAR_W * z);
      g.restore();
    }
    if (opts.label) {
      g.globalAlpha = alpha;
      g.fillStyle = "#fff";
      g.font = "600 12px 'Barlow Condensed',sans-serif";
      g.fillText(opts.label, sx + 8, sy - 8);
    }
    if (opts.handles)
      for (const [pt, col] of [[nose(f), "#ffcc00"], [tail(f), "#3fd0ff"]] as const) {
        const [hx, hy] = toScr(pt[0], pt[1]);
        g.globalAlpha = 1;
        g.strokeStyle = col;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(hx, hy);
        g.stroke();
        g.fillStyle = col;
        g.beginPath();
        g.arc(hx, hy, 7, 0, Math.PI * 2);
        g.fill();
      }
    g.globalAlpha = 1;
  }

  /** um carro no instante t (entre dois quadros: posição e bico interpolados) */
  function at(fr: (Pose & { t: number })[], t: number): Pose {
    if (t <= fr[0].t) return fr[0];
    for (let i = 1; i < fr.length; i++)
      if (t <= fr[i].t) {
        const a = fr[i - 1], b = fr[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h: a.h + angDiff(a.h, b.h) * u };
      }
    return fr[fr.length - 1];
  }
  const track1 = (i: number) => L.frames.map((f) => ({ ...f.cars[i], t: f.t }));

  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * devicePixelRatio || cv.height !== H * devicePixelRatio) {
      cv.width = W * devicePixelRatio;
      cv.height = H * devicePixelRatio;
    }
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.fillStyle = "#3d6b33";
    g.fillRect(0, 0, W, H);
    // pista: asfalto, borda branca e o meio tracejado
    const line = (lat: number) => {
      g.beginPath();
      for (let s = 0; s <= track.L; s += 2) {
        const p = track.pose(s % track.L, lat), [x, y] = toScr(p.x, p.y);
        if (s) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
    };
    g.lineJoin = "round";
    line(0);
    g.strokeStyle = "#3a3d45";
    g.lineWidth = HALF_TRACK * 2 * L.zoom;
    g.stroke();
    for (const side of [1, -1]) {
      line(side * HALF_TRACK);
      g.strokeStyle = "#e9e9e9";
      g.lineWidth = Math.max(1, 0.4 * L.zoom);
      g.stroke();
    }
    line(0);
    g.setLineDash([3 * L.zoom, 6 * L.zoom]);
    g.strokeStyle = "rgba(255,255,255,.25)";
    g.lineWidth = Math.max(1, 0.15 * L.zoom);
    g.stroke();
    g.setLineDash([]);
    const fr = L.frames;
    // caminho de cada carro
    for (let i = 0; i < ncars(); i++) {
      g.strokeStyle = i === who ? "rgba(255,204,0,.7)" : "rgba(255,255,255,.35)";
      g.lineWidth = 2;
      g.beginPath();
      fr.forEach((f, k) => {
        const [x, y] = toScr(f.cars[i].x, f.cars[i].y);
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
    // física do jogo (vermelho), do carro escolhido: caminho + fantasmas nos instantes dos quadros
    if (compare && ghost.length) {
      g.strokeStyle = "rgba(255,40,40,.8)";
      g.beginPath();
      ghost.forEach((p, i) => {
        const [x, y] = toScr(p.x, p.y);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
      if (play === null) for (const f of fr) car(at(ghost, f.t), who, 0.35, { fill: "#ff3030" });
    }
    if (play !== null) {
      const k = fr.reduce((a, f, i) => (f.t <= playT ? i : a), 0);
      for (let i = 0; i < ncars(); i++) car(at(track1(i), playT), i, 1, { look: k, label: i === 0 ? `${num(playT, 2)} s` : undefined });
      if (compare && ghost.length) car(at(ghost, playT), who, 0.8, { fill: "#ff3030" });
      for (let i = 0; i < ncars(); i++) {
        const near = fr.find((f) => Math.abs(f.t - playT) < 0.12 && f.cars[i].marks.length);
        if (!near) continue;
        const p = near.cars[i], [x, y] = toScr(p.x, p.y);
        g.fillStyle = "#ffcc00";
        g.font = "700 15px 'Barlow Condensed',sans-serif";
        g.fillText(p.marks.map((m) => LABEL.get(m) ?? m).join(" · ").toUpperCase(), x + 10, y + 22);
      }
    } else {
      // os outros quadros como fantasmas, o escolhido por cima
      fr.forEach((f, k) => k !== sel && f.cars.forEach((p, i) => car(p, i, 0.3, { look: k })));
      fr[sel].cars.forEach((p, i) => car(p, i, 1, { look: sel, ring: i === who, handles: i === who, label: `${i ? `A${i}` : "C1"} · ${num(fr[sel].t, 2)} s${p.marks.length ? " ★" : ""}` }));
    }
  }

  function panel() {
    const fr = L.frames, f = fr[sel], p = f.cars[who];
    q<HTMLInputElement>("name").value = L.name;
    trackSel.value = String(L.track);
    q<HTMLInputElement>("s").max = String(track.L);
    q<HTMLInputElement>("dt").value = String(L.dt);
    q("cars").innerHTML = f.cars.map((_, i) => `<button class="btn small${i === who ? " primary" : ""}" data-c="${i}">${carName(i)}</button>`).join("");
    q("frames").innerHTML = fr.map((x, i) => `<button class="btn small${i === sel ? " primary" : ""}" data-f="${i}">${i + 1}${x.cars.some((c) => c.marks.length) ? "★" : ""}</button>`).join("");
    q("info").textContent = `${fr.length} · ${num(fr[fr.length - 1].t - fr[0].t, 2)} s`;
    q("whoname").textContent = carName(who).toLowerCase();
    const o = onTrack(track, p), prev = fr[sel - 1]?.cars[who];
    let speed = "—", turn = "—";
    if (prev) {
      const dt = Math.max(1e-6, f.t - fr[sel - 1].t);
      speed = `${Math.round((Math.hypot(p.x - prev.x, p.y - prev.y) / dt) * 3.6)} km/h`;
      turn = `${deg(angDiff(prev.h, p.h) / dt)}°/s`;
    }
    q("read").innerHTML = `<b>${carName(who)} · quadro ${sel + 1}</b> · ${num(f.t, 2)} s<br>na pista: metro ${o.s}, ${num(Math.abs(o.lat))} m ${o.lat >= 0 ? "pra direita" : "pra esquerda"}${Math.abs(o.lat) > HALF_TRACK ? " (fora da pista)" : ""}<br>bico: ${deg(o.yaw)}° em relação à pista<br>desde o anterior: ${speed} · giro ${turn}`;
    q("marks").innerHTML = GROUPS.map(([gname, ms]) => `<div><small style="opacity:.7">${gname}</small><div style="display:flex;flex-wrap:wrap;gap:3px">${ms.map(([id, t]) => `<button class="btn small${p.marks.includes(id) ? " primary" : ""}" data-m="${id}">${t}</button>`).join("")}</div></div>`).join("");
    q<HTMLInputElement>("note").value = p.note ?? "";
    q("cmp").classList.toggle("primary", compare);
    const end = ghost[ghost.length - 1], p0 = fr[0].cars[who];
    q("cmpinfo").textContent = compare ? (end ? `Física do jogo (vermelho) pro ${carName(who).toLowerCase()}, começando com a velocidade e o giro do quadro 1 → 2: para em ${num(end.t - fr[0].t)} s, girou ${deg(end.h - p0.h)}°.` : "Precisa de pelo menos 2 quadros.") : "";
    draw();
  }
  const changed = () => {
    ghost = compare ? physics(L.frames, who) : [];
    save();
    panel();
  };

  // ---- mouse: escolhe/arrasta carro, gira pelo bico ou pela traseira, arrasta a pista; roda = zoom ----
  let drag: { kind: "car" | "rot" | "rotr" | "pan"; sx: number; sy: number; cx: number; cy: number } | null = null;
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = L.frames[sel].cars[who], [nx, ny] = toScr(...nose(f)), [tx, ty] = toScr(...tail(f));
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* clique sem ponteiro de verdade */
    }
    // (alça da frente gira em volta da traseira; a de trás, em volta do bico: cx/cy = o ponto que fica parado)
    if (Math.hypot(mx - nx, my - ny) < 12) drag = { kind: "rot", sx: mx, sy: my, cx: f.x - Math.cos(f.h) * (CAR_L / 2), cy: f.y - Math.sin(f.h) * (CAR_L / 2) };
    else if (Math.hypot(mx - tx, my - ty) < 12) drag = { kind: "rotr", sx: mx, sy: my, cx: f.x + Math.cos(f.h) * (CAR_L / 2), cy: f.y + Math.sin(f.h) * (CAR_L / 2) };
    else {
      const [wx, wy] = toWorld(mx, my), near = (p: Pos, d: number) => Math.hypot(p.x - wx, p.y - wy) < d;
      // carro do quadro de agora primeiro (o escolhido ganha folga); depois os fantasmas dos outros quadros
      let hitF = sel, hitC = near(f, CAR_L / 2 + 0.5) ? who : L.frames[sel].cars.findIndex((p) => near(p, CAR_L / 2));
      if (hitC < 0)
        for (let k = 0; k < L.frames.length && hitC < 0; k++) {
          const i = L.frames[k].cars.findIndex((p) => near(p, CAR_L / 2));
          if (i >= 0) [hitF, hitC] = [k, i];
        }
      if (hitC >= 0) {
        [sel, who] = [hitF, hitC];
        const p = L.frames[sel].cars[who];
        drag = { kind: "car", sx: wx - p.x, sy: wy - p.y, cx: 0, cy: 0 };
        changed();
      } else drag = { kind: "pan", sx: mx, sy: my, cx: L.cx, cy: L.cy };
    }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = L.frames[sel].cars[who];
    if (drag.kind === "pan") {
      L.cx = drag.cx - (mx - drag.sx) / L.zoom;
      L.cy = drag.cy - (my - drag.sy) / L.zoom;
      draw();
      return;
    }
    const [wx, wy] = toWorld(mx, my);
    if (drag.kind === "car") {
      f.x = wx - drag.sx;
      f.y = wy - drag.sy;
    } else if (drag.kind === "rot") {
      f.h = Math.atan2(wy - drag.cy, wx - drag.cx);
      f.x = drag.cx + Math.cos(f.h) * (CAR_L / 2);
      f.y = drag.cy + Math.sin(f.h) * (CAR_L / 2);
    } else {
      f.h = Math.atan2(drag.cy - wy, drag.cx - wx);
      f.x = drag.cx - Math.cos(f.h) * (CAR_L / 2);
      f.y = drag.cy - Math.sin(f.h) * (CAR_L / 2);
    }
    panel();
  });
  cv.addEventListener("pointerup", () => {
    if (drag && drag.kind !== "pan") changed();
    else save();
    drag = null;
  });
  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, [wx, wy] = toWorld(mx, my);
      L.zoom = Math.max(0.3, Math.min(40, L.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const [ax, ay] = toWorld(mx, my);
      L.cx += wx - ax;
      L.cy += wy - ay;
      draw();
    },
    { passive: false },
  );
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "q" || e.key === "e") {
      L.frames[sel].cars[who].h += (e.key === "q" ? -5 : 5) * (Math.PI / 180);
      changed();
    } else if (e.key === "Escape") close();
  };
  window.addEventListener("keydown", onKey);

  // ---- painel ----
  root.querySelector("[data-panel]")!.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const fb = t.closest<HTMLElement>("[data-f]");
    if (fb) {
      sel = Number(fb.dataset.f);
      const p = L.frames[sel].cars[who];
      [L.cx, L.cy] = [p.x, p.y];
      return panel();
    }
    const cb = t.closest<HTMLElement>("[data-c]");
    if (cb) {
      who = Number(cb.dataset.c);
      return changed();
    }
    const mb = t.closest<HTMLElement>("[data-m]");
    if (mb) {
      const p = L.frames[sel].cars[who], m = mb.dataset.m!;
      p.marks = p.marks.includes(m) ? p.marks.filter((x) => x !== m) : [...p.marks, m];
      return changed();
    }
    if (t.closest("[data-addcar]")) {
      // o adversário nasce do lado do carro escolhido (3 m), em todos os quadros, andando junto: depois é ajeitar
      const n = ncars();
      for (const f of L.frames) {
        const p = f.cars[who];
        f.cars.push({ x: p.x - Math.sin(p.h) * 3, y: p.y + Math.cos(p.h) * 3, h: p.h, marks: [] });
      }
      who = n;
      return changed();
    }
    if (t.closest("[data-delcar]") && ncars() > 1 && confirm(`Tirar o ${carName(who).toLowerCase()} do lance?`)) {
      for (const f of L.frames) f.cars.splice(who, 1);
      who = Math.max(0, who - 1);
      return changed();
    }
    if (t.closest("[data-add]")) {
      // o próximo quadro: cada carro já nasce onde estaria seguindo a velocidade e o giro de agora
      const f = L.frames[sel], pf = L.frames[sel - 1], dt = L.dt;
      const nf: Frame = {
        t: f.t + dt,
        cars: f.cars.map((c, i) => {
          const p = pf?.cars[i];
          if (!p) return { x: c.x + Math.cos(c.h) * 50 * dt, y: c.y + Math.sin(c.h) * 50 * dt, h: c.h, marks: [] };
          const k = dt / Math.max(1e-6, f.t - pf.t);
          return { x: c.x + (c.x - p.x) * k, y: c.y + (c.y - p.y) * k, h: c.h + angDiff(p.h, c.h) * k, marks: [] };
        }),
      };
      // (depois dele, os quadros seguintes andam no tempo junto)
      for (const x of L.frames.slice(sel + 1)) x.t += dt;
      L.frames.splice(sel + 1, 0, nf);
      sel++;
      return changed();
    }
    if (t.closest("[data-del]") && L.frames.length > 1) {
      L.frames.splice(sel, 1);
      sel = Math.max(0, sel - 1);
      return changed();
    }
    if (t.closest("[data-play]")) {
      if (play !== null) return stop();
      playT = L.frames[0].t;
      let last = performance.now();
      const step = (now: number) => {
        playT += Math.min(0.1, (now - last) / 1000);
        last = now;
        const end = Math.max(L.frames[L.frames.length - 1].t, compare && ghost.length ? ghost[ghost.length - 1].t : 0);
        if (playT > end + 0.6) return stop();
        draw();
        play = requestAnimationFrame(step);
      };
      q("play").textContent = "■ PARAR";
      play = requestAnimationFrame(step);
      return;
    }
    if (t.closest("[data-cmp]")) {
      compare = !compare;
      return changed();
    }
    if (t.closest("[data-copy]")) return void copy();
    if (t.closest("[data-see]")) {
      save();
      window.open(`/?auto&lab=lance&gap=20&replays&tv&carros=3d&camera=tv&pista=${encodeURIComponent(track.name)}`, "_blank");
      return;
    }
    if (t.closest("[data-save]")) return void saveFile();
    if (t.closest("[data-open]")) return q<HTMLInputElement>("file").click();
    if (t.closest("[data-paste]")) return void paste();
    if (t.closest("[data-new]") && confirm("Começar um lance novo? (o atual some)")) {
      L = fresh(L.track);
      sel = who = 0;
      return changed();
    }
    if (t.closest("[data-close]")) close();
  });
  const stop = () => {
    if (play !== null) cancelAnimationFrame(play);
    play = null;
    q("play").textContent = "▶ TOCAR";
    draw();
  };
  q<HTMLInputElement>("name").addEventListener("input", (e) => {
    L.name = (e.target as HTMLInputElement).value.slice(0, 60);
    save();
  });
  q<HTMLInputElement>("note").addEventListener("input", (e) => {
    L.frames[sel].cars[who].note = (e.target as HTMLInputElement).value.slice(0, 200) || undefined;
    save();
  });
  q<HTMLInputElement>("dt").addEventListener("change", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v >= 0.05 && v <= 5) L.dt = v;
    save();
  });
  trackSel.addEventListener("change", () => {
    L = fresh(Number(trackSel.value));
    track = getTrack(L.track);
    sel = who = 0;
    changed();
  });
  q<HTMLInputElement>("s").addEventListener("input", (e) => {
    const p = track.pose(Number((e.target as HTMLInputElement).value), 0);
    [L.cx, L.cy] = [p.x, p.y];
    // (lance novo de um quadro e um carro só: o carro vai junto pro trecho escolhido)
    if (L.frames.length === 1 && ncars() === 1) Object.assign(L.frames[0].cars[0], { x: p.x, y: p.y, h: p.h });
    panel();
    save();
  });

  /** troca o lance aberto por outro (arquivo ou colado) */
  function useLance(n: Lance | null) {
    if (!n) return alert("Não reconheci esse lance. Use o texto do 📋 COPIAR ou um arquivo do 💾 SALVAR ARQUIVO.");
    stop();
    L = n;
    track = getTrack(L.track);
    sel = who = 0;
    changed();
  }
  async function paste() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* sem permissão: pergunta */
    }
    if (!text.includes('{"pista"')) text = prompt("Cole aqui o texto do lance (o que o 📋 COPIAR gerou):") ?? "";
    if (text) useLance(safeFromText(text));
  }
  const safeFromText = (text: string) => {
    try {
      return fromText(text);
    } catch {
      return null;
    }
  };
  q<HTMLInputElement>("file").addEventListener("change", async (e) => {
    const inp = e.target as HTMLInputElement, file = inp.files?.[0];
    inp.value = "";
    if (file) useLance(safeFromText(await file.text()));
  });
  async function saveFile() {
    const text = lanceText(), name = `${(L.name.trim() || "lance").replace(/[\\/:*?"<>|]+/g, "-")}.lance.txt`;
    type Picker = (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
    const pick = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
    try {
      if (pick) {
        // (Edge/Chrome: escolhe a pasta e o nome)
        const h = await pick({ suggestedName: name, types: [{ description: "Lance do Pit Wall", accept: { "text/plain": [".txt"] } }] });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      q("save").textContent = "✓ SALVO";
      setTimeout(() => (q("save").textContent = "💾 SALVAR ARQUIVO"), 1800);
    } catch (err) {
      if ((err as Error).name !== "AbortError") alert(`Não deu pra salvar: ${(err as Error).message}`);
    }
  }
  async function copy() {
    const text = lanceText();
    try {
      await navigator.clipboard.writeText(text);
      q("copy").textContent = "✓ COPIADO";
    } catch {
      prompt("Copie o texto:", text);
    }
    setTimeout(() => (q("copy").textContent = "📋 COPIAR PRA CONVERSA"), 2000);
  }
  /** o lance em texto (linhas pra ler + a linha do JSON no fim, que o COLAR/ABRIR entende) */
  function lanceText() {
    const fr = L.frames, out: string[] = [`[LANCE "${L.name}" · ${track.name} · ${fr.length} quadros · ${ncars()} carro${ncars() > 1 ? "s" : ""}]`];
    for (let i = 0; i < ncars(); i++) {
      if (ncars() > 1) out.push(`— ${carName(i)}`);
      fr.forEach((f, k) => {
        const c = f.cars[i], o = onTrack(track, c), p = fr[k - 1]?.cars[i], dt = k ? Math.max(1e-6, f.t - fr[k - 1].t) : 1;
        const mv = p ? ` · ${Math.round((Math.hypot(c.x - p.x, c.y - p.y) / dt) * 3.6)} km/h · giro ${deg(angDiff(p.h, c.h) / dt)}°/s` : "";
        out.push(`q${k + 1} ${num(f.t, 2)} s · metro ${o.s} · lateral ${num(o.lat)} m · bico ${deg(o.yaw)}°${mv}${c.marks.length ? ` · ${c.marks.map((m) => LABEL.get(m) ?? m).join(", ")}` : ""}${c.note ? ` · "${c.note}"` : ""}`);
      });
    }
    const data = { pista: track.name, nome: L.name, quadros: fr.map((f) => ({ t: f.t, carros: f.cars.map((c) => ({ ...onTrack(track, c), marks: c.marks, note: c.note })) })) };
    return `${out.join("\n")}\n${JSON.stringify(data)}`;
  }
  function close() {
    stop();
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", draw);
    root.remove();
    onClose?.();
  }
  window.addEventListener("resize", draw);
  changed();
}
