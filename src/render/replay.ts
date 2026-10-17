// Replay da corrida: durante a prova o jogo grava a posição de todos os carros
// (4x por segundo de corrida). No pódio dá pra rever os melhores momentos
// (largada, ultrapassagens, batidas, rodadas, safety car, bandeirada) ou
// qualquer instante pela linha do tempo, com a câmera seguindo o carro envolvido.
import { Race } from "../sim/race";
import type { RaceEvent } from "../sim/types";
import { Renderer } from "./renderer";

/** campos gravados por carro em cada quadro */
const F = 6; // s, lateral, v, volta, flags (1 abandono, 2 box, 4 rodando), posição
const STEP = 0.25; // s de corrida entre quadros

interface Frame {
  t: number;
  wet: number;
  rain: number;
  sc: { active: boolean; onTrack: boolean; s: number } | null;
  cars: Float32Array;
}

export class ReplayRecorder {
  frames: Frame[] = [];
  private ids: string[] = [];
  private last = -1e9;

  add(race: Race) {
    if (!this.ids.length) this.ids = race.cars.map((c) => c.id);
    if (race.time < this.last) {
      // relógio voltou (largada de novo): recomeça
      this.frames = [];
      this.last = -1e9;
    }
    if (race.time - this.last < STEP) return;
    this.last = race.time;
    const a = new Float32Array(this.ids.length * F);
    race.cars.forEach((c) => {
      const i = this.ids.indexOf(c.id);
      if (i < 0) return;
      const o = i * F;
      a[o] = c.s;
      a[o + 1] = c.lateral;
      a[o + 2] = c.v;
      a[o + 3] = c.lap;
      a[o + 4] = (c.retired ? 1 : 0) | (c.pit !== "none" ? 2 : 0) | (c.spin > 0 ? 4 : 0);
      a[o + 5] = c.position;
    });
    this.frames.push({ t: race.time, wet: race.wet, rain: race.rain, sc: race.sc.active ? { active: true, onTrack: race.sc.onTrack, s: race.sc.s } : null, cars: a });
  }

  carIds() {
    return this.ids;
  }
}

interface Highlight {
  t: number;
  carId?: string;
  icon: string;
  text: string;
}

/** lista dos melhores momentos a partir do que aconteceu na corrida */
function highlights(race: Race, myTeam: string): Highlight[] {
  const out: Highlight[] = [{ t: 0, carId: race.ordered()[0]?.id, icon: "🚦", text: "Largada" }];
  const mine = new Set(race.cars.filter((c) => c.team.id === myTeam).map((c) => c.id));
  for (const e of race.events as RaceEvent[]) {
    const k = e.kind ?? "";
    const isMine = !!e.carId && mine.has(e.carId);
    const keep =
      k === "crash" || k === "sc" || k === "scin" ||
      (k === "spin" || k === "off" || k === "damage" || k === "touch") ||
      (k === "overtake" && (isMine || e.important || /passa/.test(e.text) && out.filter((h) => h.icon === "⇄").length < 8));
    if (!keep) continue;
    const icon = k === "crash" ? "💥" : k === "sc" || k === "scin" ? "🚨" : k === "spin" ? "↻" : k === "off" ? "↗" : k === "damage" || k === "touch" ? "⚠" : "⇄";
    out.push({ t: e.time, carId: e.carId, icon, text: e.text });
  }
  const win = race.ordered()[0];
  if (win?.finishTime) out.push({ t: win.finishTime, carId: win.id, icon: "🏁", text: `Bandeirada: ${win.driver.name} vence` });
  // não deixa dois lances quase no mesmo instante
  return out.filter((h, i, a) => i === 0 || h.t - a[i - 1].t > 2 || h.carId !== a[i - 1].carId).slice(0, 40);
}

/** abre o replay em tela cheia */
export function showReplay(race: Race, rec: ReplayRecorder, myTeam: string) {
  if (rec.frames.length < 4) return;
  const ghost = new Race(race.opts);
  ghost.phase = "racing";
  const ids = rec.carIds();
  const byId = new Map(ghost.cars.map((c) => [c.id, c]));
  const end = rec.frames[rec.frames.length - 1].t;
  const hl = highlights(race, myTeam);

  const el = document.createElement("div");
  el.className = "replay";
  el.innerHTML = `<canvas></canvas>
    <div class="rpside panel"><div class="rphead"><b>🎬 MELHORES MOMENTOS</b><button class="btn small" data-rp="close">✕ FECHAR</button></div>
      <div class="rplist">${hl.map((h, i) => `<button class="rpitem" data-hl="${i}"><span class="rpt">${fmt(h.t)}</span><span>${h.icon}</span><span class="rptx">${escTxt(h.text)}</span></button>`).join("")}</div></div>
    <div class="rpbar panel">
      <button class="btn small" data-rp="play">❚❚</button>
      <button class="btn small" data-rp="back" title="Voltar 5 s">⟲ 5s</button>
      <input type="range" class="rpseek" min="0" max="${end.toFixed(1)}" step="0.1" value="0">
      <span class="rptime"></span>
      <div class="seg rpspeed">${[0.5, 1, 2, 4].map((s) => `<button data-speed="${s}" class="${s === 1 ? "on" : ""}">${s}x</button>`).join("")}</div>
    </div>`;
  document.body.appendChild(el);
  const cv = el.querySelector("canvas")!;
  let follow = hl[0]?.carId ?? ids[0];
  const renderer = new Renderer(cv, ghost, follow, (id) => {
    follow = id;
    renderer.followId = id;
  });

  let t = 0;
  let playing = true;
  let speed = 1;
  let stopAt = Infinity;
  let snapAcc = 0;

  /** coloca os carros do "fantasma" no instante t (interpolando entre dois quadros) */
  const place = (time: number) => {
    const fr = rec.frames;
    let lo = 0, hi = fr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fr[mid].t <= time) lo = mid;
      else hi = mid;
    }
    const a = fr[lo], b = fr[hi];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t))) : 0;
    const L = ghost.track.L;
    ids.forEach((id, i) => {
      const c = byId.get(id);
      if (!c) return;
      const o = i * F;
      let ds = b.cars[o] - a.cars[o];
      if (ds < -L / 2) ds += L;
      if (ds > L / 2) ds -= L;
      c.s = (((a.cars[o] + ds * k) % L) + L) % L;
      c.lateral = a.cars[o + 1] + (b.cars[o + 1] - a.cars[o + 1]) * k;
      c.v = a.cars[o + 2] + (b.cars[o + 2] - a.cars[o + 2]) * k;
      c.lap = k < 0.5 ? a.cars[o + 3] : b.cars[o + 3];
      const flags = k < 0.5 ? a.cars[o + 4] : b.cars[o + 4];
      c.retired = (flags & 1) !== 0;
      c.spin = flags & 4 ? 3 : 0;
      c.position = k < 0.5 ? a.cars[o + 5] : b.cars[o + 5];
    });
    ghost.time = time;
    ghost.wet = a.wet;
    ghost.rain = a.rain;
    const sc = a.sc;
    ghost.sc.active = !!sc;
    ghost.sc.onTrack = !!sc?.onTrack;
    if (sc) ghost.sc.s = sc.s;
  };

  const jump = (time: number) => {
    t = Math.max(0, Math.min(end, time));
    place(t);
    // recomeça o histórico do desenho (senão ele desliza do ponto antigo)
    (renderer as unknown as { hist: Map<string, unknown> }).hist.clear();
    renderer.onSnapshot(1);
  };

  const playBtn = el.querySelector<HTMLButtonElement>("[data-rp=play]")!;
  const seek = el.querySelector<HTMLInputElement>(".rpseek")!;
  const timeEl = el.querySelector<HTMLElement>(".rptime")!;
  const setPlaying = (p: boolean) => {
    playing = p;
    playBtn.textContent = p ? "❚❚" : "▶";
  };

  el.addEventListener("click", (e) => {
    const tg = e.target as HTMLElement;
    const h = tg.closest<HTMLElement>("[data-hl]");
    if (h) {
      const x = hl[Number(h.dataset.hl)];
      follow = x.carId ?? follow;
      renderer.followId = follow;
      el.querySelectorAll(".rpitem").forEach((b) => b.classList.toggle("on", b === h));
      jump(x.t - 5);
      stopAt = x.t + 4;
      setPlaying(true);
      return;
    }
    const sp = tg.closest<HTMLElement>("[data-speed]");
    if (sp) {
      speed = Number(sp.dataset.speed);
      el.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", b === sp));
    }
    const act = tg.closest<HTMLElement>("[data-rp]")?.dataset.rp;
    if (act === "close") close();
    if (act === "play") {
      if (!playing && t >= end - 0.05) jump(0);
      stopAt = Infinity;
      setPlaying(!playing);
    }
    if (act === "back") jump(t - 5);
  });
  seek.addEventListener("input", () => {
    stopAt = Infinity;
    jump(Number(seek.value));
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();
      stopAt = Infinity;
      setPlaying(!playing);
    }
  };
  window.addEventListener("keydown", onKey, true);

  let raf = 0;
  let last = performance.now();
  jump(0);
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      t += dt * speed;
      if (t >= stopAt) {
        t = stopAt;
        setPlaying(false);
        stopAt = Infinity;
      }
      if (t >= end) {
        t = end;
        setPlaying(false);
      }
      place(t);
      snapAcc += dt * speed;
      if (snapAcc >= 0.05) {
        snapAcc = 0;
        renderer.onSnapshot(speed);
      }
    }
    renderer.draw(dt, playing ? speed : 0);
    seek.value = String(t);
    timeEl.textContent = `${fmt(t)} / ${fmt(end)}`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function close() {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    renderer.destroy();
    el.remove();
  }
}

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escTxt(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
