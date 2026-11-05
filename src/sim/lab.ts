// LABORATÓRIO DE ACIDENTES (?lab=<cena>): a cada `gap` s força a cena num carro do pelotão, no lugar certo dela,
// pra ver o mesmo tipo de acidente muitas vezes (com &replays cada um ganha replay). Também roda sem navegador
// (scripts/fiscal.ts --lab <cena>).
import type { CarState } from "./types";
import type { IncidentKind, Race } from "./race";
import type { HitSpec } from "./slidePhysics";
import { CIRCUITS, angDiff, getTrack } from "./track";

export type LabScene = IncidentKind | "toque" | "fisica" | "misto" | "lance";
export const LAB_SCENES: LabScene[] = ["susto", "rodada", "batida", "escapada", "passou-reto", "toque", "fisica", "misto", "lance"];
export interface LabConfig {
  scene: LabScene;
  /** segundos entre uma cena e a próxima */
  gap: number;
  /** cena "fisica": a pancada, a velocidade (m/s; sem = a que o carro tiver) e onde (reta ou curva) */
  hit: HitSpec;
  vel?: number;
  onde: "reta" | "curva";
  /** cena "lance": o que o usuário desenhou no EDITOR DE LANCE (lanceToScript) */
  lance?: LabLance | null;
}

let LAB: LabConfig | null = null;
export function setLab(cfg: LabConfig | null) {
  LAB = cfg;
}

/** lê ?lab=rodada&gap=15&vel=200&ang=45&forca=4&ponto=traseira&onde=reta (vel em km/h) */
export function labFromParams(p: URLSearchParams): LabConfig | null {
  const scene = p.get("lab") as LabScene | null;
  if (!scene || !LAB_SCENES.includes(scene)) return null;
  const num = (k: string, d: number) => (p.has(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : d);
  const ponto = p.get("ponto");
  return {
    scene,
    gap: Math.max(6, num("gap", 15)),
    hit: { ang: num("ang", 45), forca: num("forca", 4), ponto: ponto === "dianteira" || ponto === "meio" ? ponto : "traseira" },
    vel: p.has("vel") ? num("vel", 200) / 3.6 : undefined,
    onde: p.get("onde") === "curva" ? "curva" : scene === "fisica" ? "reta" : "curva",
  };
}


/** um quadro do lance desenhado, já em coordenadas da pista (s contínuo, sem voltar a zero na linha) */
export interface ScriptFrame {
  t: number;
  s: number;
  lat: number;
  yaw: number;
  marks: string[];
}
export interface LabLance {
  track: string;
  cars: ScriptFrame[][];
}
type EdPos = { x: number; y: number; h: number; marks?: string[] };

/** o lance do EDITOR DE LANCE (localStorage "pwm.lance", x/y/bico no mundo) → por carro, metro/lateral/bico na pista */
export function lanceToScript(raw: unknown): LabLance | null {
  const L = raw as { track?: number; frames?: ({ t: number; cars?: EdPos[] } & Partial<EdPos>)[] } | null;
  if (!L || typeof L.track !== "number" || !Array.isArray(L.frames) || !L.frames.length || !CIRCUITS[L.track]) return null;
  const t = getTrack(L.track);
  // (formato antigo do editor: um carro só, o quadro era o próprio carro)
  const frames = L.frames.map((f) => ({ t: f.t, cars: f.cars ?? [{ x: f.x ?? 0, y: f.y ?? 0, h: f.h ?? 0, marks: f.marks ?? [] }] }));
  const cars: ScriptFrame[][] = [];
  for (let i = 0; i < frames[0].cars.length; i++) {
    let prev: number | null = null;
    cars.push(
      frames.map((f) => {
        const c = f.cars[i];
        let best = 0, bd = Infinity;
        for (let s = 0; s < t.L; s++) {
          const p = t.pts[s], d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
          if (d < bd) [bd, best] = [d, s];
        }
        const p = t.pose(best, 0);
        let s = best;
        if (prev !== null) while (s - prev > t.L / 2) s -= t.L;
        if (prev !== null) while (prev - s > t.L / 2) s += t.L;
        prev = s;
        return { t: f.t, s, lat: -Math.sin(p.h) * (c.x - p.x) + Math.cos(p.h) * (c.y - p.y), yaw: angDiff(p.h, c.h), marks: c.marks ?? [] };
      }),
    );
  }
  return { track: t.name, cars };
}

/** cena "lance": carros do meio do pelotão vão pro começo do desenho e fazem o que foi desenhado (Race.stepScript) */
function lanceTick(r: Race, cfg: LabConfig, st: { next: number; n: number; warned?: boolean }) {
  const ln = cfg.lance;
  const warn = (text: string) => {
    if (!st.warned) r.note(`🧪 laboratório: ${text}`);
    st.warned = true;
  };
  if (!ln) return warn("nenhum lance salvo no editor de lance");
  if (ln.track !== r.track.name) return warn(`o lance é da pista ${ln.track} (esta é ${r.track.name})`);
  if (r.time < st.next || r.cars.some((c) => c.script)) return;
  const running = r.ordered().filter((c) => !c.retired && !c.finished && !c.slide && c.pit === "none" && c.lap >= 0);
  if (running.length < ln.cars.length) return;
  const from = Math.max(0, Math.floor(running.length / 2) - 1);
  ln.cars.forEach((f, i) => {
    const c = running[from + i];
    c.script = { t0: r.time, k: 0, f };
    r.note(`🧪 laboratório: lance desenhado — ${c.driver.name}${ln.cars.length > 1 ? (i ? ` (adversário ${i})` : " (carro 1)") : ""}`, c.id);
  });
  st.n++;
  st.next = r.time + Math.max(...ln.cars.map((f) => f[f.length - 1].t)) + cfg.gap;
}
const state = new WeakMap<Race, { next: number; n: number; warned?: boolean; ram?: { id: string; other: string; dir: number; until: number } }>();
const MIXED: (IncidentKind | "toque" | "fisica")[] = ["susto", "rodada", "batida", "escapada", "passou-reto", "toque", "fisica"];

export function labTick(r: Race, dt: number) {
  const cfg = LAB;
  if (!cfg || r.checkered) return;
  let st = state.get(r);
  if (!st) state.set(r, (st = { next: 20, n: 0 }));
  if (cfg.scene === "lance") return lanceTick(r, cfg, st);
  const t = r.track;
  const rel = (a: CarState, b: CarState) => {
    let d = t.wrap(b.s - a.s);
    if (d > t.L / 2) d -= t.L;
    return d;
  };
  // toque em andamento: o piloto fecha a porta no outro até encostar, a 4 m/s de lado (mais devagar a separação de
  // carros ganhava e nunca encostava); quem resolve o toque é a corrida (resolveContacts, no mesmo passo)
  if (st.ram) {
    const c = r.cars.find((x) => x.id === st!.ram!.id), o = r.cars.find((x) => x.id === st!.ram!.other);
    if (!c || !o || c.slide || o.slide || r.time > st.ram.until) st.ram = undefined;
    else {
      const to = o.lateral - st.ram.dir * 1.8, d = to - c.lateral;
      // (o último meio metro de uma vez, que é a pancada: devagar a separação empurrava o outro pra longe antes)
      c.lateral += Math.abs(d) < 0.5 ? d : Math.sign(d) * 4 * dt;
      c.lateralTarget = to;
      c.labLat = r.time + 0.1;
      if (Math.abs(d) < 0.5) st.ram = undefined;
    }
    return;
  }
  if (r.time < st.next) return;
  // espera o anterior acabar (ninguém escorregando)
  if (r.cars.some((c) => c.slide && c.slide.mode !== "rejoin")) return;
  const scene = cfg.scene === "misto" ? MIXED[st.n % MIXED.length] : cfg.scene;
  const reta = (cfg.scene === "fisica" || scene === "fisica") && cfg.onde === "reta";
  const running = r.cars.filter((c) => !c.retired && !c.finished && !c.slide && c.pit === "none" && c.spin <= 0 && c.offTrack <= 0 && c.lap >= 0 && c.v > 25);
  for (const c of running) {
    // no pelotão: alguém até 40 m atrás (pra ver como os outros reagem)
    if (!running.some((o) => o !== c && rel(c, o) < 0 && rel(c, o) > -40)) continue;
    if (scene === "toque") {
      // lado a lado de verdade (os carros emparelhados, um do lado do outro)
      const o = running.find((o) => o !== c && Math.abs(rel(c, o)) < 2.5 && Math.abs(o.lateral - c.lateral) > 1.95 && Math.abs(o.lateral - c.lateral) < 4.5);
      if (!o) continue;
      st.ram = { id: c.id, other: o.id, dir: Math.sign(o.lateral - c.lateral), until: r.time + 1.5 };
    } else if (reta ? !t.isStraight(c.s) || !t.isStraight(c.s + 60) : r.riskAt(c.s + 15) < 1.6) continue;
    r.note(`🧪 laboratório: ${scene} — ${c.driver.name}`, c.id);
    if (scene === "fisica") r.labHit(c, cfg.hit, cfg.vel);
    else if (scene !== "toque") r.incident(c, scene);
    st.n++;
    st.next = r.time + cfg.gap;
    return;
  }
}
