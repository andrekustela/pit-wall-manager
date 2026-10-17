import type { Connection } from "../net/connection";
import type { LobbyState, ServerMsg } from "../net/protocol";
import { DRIVERS } from "../sim/data";
import { fmtLap } from "../sim/race";
import { CIRCUITS, getTrack } from "../sim/track";
import { carProfile, type QualiLap } from "../sim/tuning";
import { COMPOUNDS, DEFAULT_TUNING, type Tuning } from "../sim/types";
import { PRACTICE_LAPS } from "../sim/weekend";
import { forecastText } from "../sim/weather";
import { backButtonHtml, bindBackButton, champLabel, drawTrackThumb, esc, teamName, tyreIcon, updateWaitBar, wetLabel } from "./common";

type PracticeMsg = Extract<ServerMsg, { t: "practice" }>;

interface CarPanel {
  id: string;
  tuning: Tuning;
  laps: QualiLap[];
  chosen: number | null; // índice da volta escolhida p/ classificação (null = acerto atual)
  pending: PracticeMsg | null;
  animating: boolean;
  el: HTMLElement;
}

const LABELS: [keyof Tuning, string, string, string][] = [
  ["fw", "Asa dianteira", "pouca", "muita"],
  ["rw", "Asa traseira", "pouca", "muita"],
  ["h", "Altura do carro", "baixo", "alto"],
];

export class PracticeScreen {
  private panels: CarPanel[] = [];
  private ready = false;

  constructor(private root: HTMLElement, private conn: Connection, private lobby: LobbyState) {
    const w = lobby.weekend!;
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    const track = CIRCUITS[w.trackIndex];
    root.innerHTML = `
      <div class="screen"><div class="wrap" style="max-width:1100px">
        <h1 class="title">TREINO <span>LIVRE</span></h1>
        <p class="sub">${esc(champLabel(lobby))}${esc(track.name)} · ${esc(teamName(lobby, me.teamId!))} · Cada piloto tem ${PRACTICE_LAPS} voltas de teste. Ninguém mais vê seus tempos.</p>
        <div class="cols" style="margin-bottom:12px">
          <div class="box"><h3>CONDIÇÕES</h3>
            <div>Treino: <b>${wetLabel(w.practiceWet)}</b></div>
            <div>Classificação: <b>${wetLabel(w.qualiWet)}</b> (previsão)</div>
            <div>Corrida: ${esc(forecastText(w))}</div>
          </div>
          <div class="box"><h3>COMO FUNCIONA</h3>
            <div class="hint" style="margin:0">Mais asa = mais rápido nas curvas, mais lento nas retas. Asa dianteira x traseira = equilíbrio.
            Carro baixo = mais aderência, mas bate no chão se a pista for ondulada. Ouça o piloto depois de cada volta.
            A volta escolhida é o acerto usado na classificação e na corrida (parque fechado).</div>
          </div>
        </div>
        <div class="cols" id="p-cars"></div>
        <div class="row-btns" style="margin-top:20px">
          <button class="go" id="p-ready" style="margin:0">PRONTO PARA A CLASSIFICAÇÃO ▶</button>
          ${backButtonHtml(lobby, lobby.champ && lobby.champ.round > 0 ? "VOLTAR PRO LOBBY (cancela o campeonato)" : "VOLTAR PRO LOBBY")}
        </div>
      </div></div>`;

    const wrap = root.querySelector("#p-cars")!;
    for (const d of DRIVERS.filter((x) => x.teamId === me.teamId)) {
      const el = document.createElement("div");
      el.className = "box";
      wrap.appendChild(el);
      const panel: CarPanel = { id: d.id, tuning: { ...DEFAULT_TUNING }, laps: [], chosen: null, pending: null, animating: false, el };
      this.panels.push(panel);
      el.innerHTML = `
        <h3>${esc(d.name.toUpperCase())}</h3>
        ${LABELS.map(
          ([k, label, lo, hi]) => `<div class="tune"><span>${label}</span><input type="range" min="1" max="11" step="1" value="${panel.tuning[k]}" data-k="${k}"><b data-v="${k}">${panel.tuning[k]}</b>
            <div class="ends"><span>${lo}</span><span>${hi}</span></div></div>`,
        ).join("")}
        <canvas class="lapcanvas"></canvas>
        <div class="radio" data-radio>Rádio: "Pronto pra sair, é só mandar."</div>
        <button class="btn primary" data-go style="width:100%;margin-top:10px"></button>
        <table class="laps"><thead><tr><th>#</th><th>TEMPO</th><th>RETA</th><th>D/T/A</th><th>USAR</th></tr></thead><tbody data-laps></tbody></table>`;
      el.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) =>
        inp.addEventListener("input", () => {
          const k = inp.dataset.k as keyof Tuning;
          panel.tuning[k] = Number(inp.value);
          el.querySelector(`[data-v=${k}]`)!.textContent = inp.value;
          if (panel.chosen === null) this.sendFinal(panel);
        }),
      );
      el.querySelector("[data-go]")!.addEventListener("click", () => this.runLap(panel));
      requestAnimationFrame(() => drawTrackThumb(el.querySelector("canvas")!, w.trackIndex));
      this.renderPanel(panel);
    }
    bindBackButton(root, (m) => conn.send(m), "Voltar pro lobby? Dá pra trocar equipe, pista e regras, mas o fim de semana recomeça.");
    root.querySelector("#p-ready")!.addEventListener("click", () => {
      this.ready = !this.ready;
      if (this.ready) for (const p of this.panels) this.sendFinal(p);
      conn.send({ t: "ready", ready: this.ready });
      this.renderReady();
    });
    this.renderReady();
  }

  private renderReady() {
    const b = this.root.querySelector<HTMLButtonElement>("#p-ready")!;
    b.textContent = this.ready ? "PRONTO ✓ (clique pra voltar a ajustar)" : "PRONTO PARA A CLASSIFICAÇÃO ▶";
    this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("#p-cars input, #p-cars button").forEach((x) => (x.disabled = this.ready));
    if (!this.ready) this.panels.forEach((p) => this.renderPanel(p));
  }

  private sendFinal(p: CarPanel) {
    const tuning = p.chosen !== null ? p.laps[p.chosen].tuning : p.tuning;
    this.conn.send({ t: "finalTuning", carId: p.id, tuning });
  }

  private runLap(p: CarPanel) {
    if (p.animating || p.laps.length >= PRACTICE_LAPS) return;
    p.animating = true;
    p.pending = null;
    this.conn.send({ t: "practiceLap", carId: p.id, tuning: { ...p.tuning } });
    this.renderPanel(p);
    p.el.querySelector("[data-radio]")!.textContent = "Volta lançada...";
    this.animate(p, { ...p.tuning }, () => {
      p.animating = false;
      if (p.pending) this.reveal(p);
      else this.renderPanel(p);
    });
  }

  onPractice(msg: PracticeMsg) {
    const p = this.panels.find((x) => x.id === msg.carId);
    if (!p) return;
    p.pending = msg;
    if (!p.animating) this.reveal(p);
  }

  private reveal(p: CarPanel) {
    const msg = p.pending!;
    p.pending = null;
    p.laps[msg.lapIndex] = msg.lap;
    // escolhe a melhor volta automaticamente
    let best = 0;
    p.laps.forEach((l, i) => (l.time < p.laps[best].time ? (best = i) : 0));
    p.chosen = best;
    this.sendFinal(p);
    p.el.querySelector("[data-radio]")!.innerHTML = `Rádio: ${msg.lap.feedback.map((f) => `"${esc(f)}"`).join("<br>")}`;
    this.renderPanel(p);
  }

  private renderPanel(p: CarPanel) {
    const left = PRACTICE_LAPS - p.laps.length;
    const go = p.el.querySelector<HTMLButtonElement>("[data-go]")!;
    go.textContent = p.animating ? "NA PISTA..." : left > 0 ? `DAR VOLTA DE TESTE (${left} restantes)` : "VOLTAS DE TESTE ESGOTADAS";
    go.disabled = this.ready || p.animating || left <= 0;
    const bestIdx = p.laps.reduce((b, l, i) => (l.time < p.laps[b].time ? i : b), 0);
    p.el.querySelector("[data-laps]")!.innerHTML =
      p.laps
        .map(
          (l, i) => `<tr class="${i === bestIdx ? "best" : ""} ${i === p.chosen ? "sel" : ""}">
          <td>${i + 1}</td><td class="t">${fmtLap(l.time)}</td><td>${l.topSpeed}</td>
          <td>${l.tuning.fw}/${l.tuning.rw}/${l.tuning.h} ${tyreIcon(l.tyre, COMPOUNDS[l.tyre].label)}</td>
          <td><input type="radio" name="use-${p.id}" data-use="${i}" ${i === p.chosen ? "checked" : ""} ${this.ready ? "disabled" : ""}></td></tr>`,
        )
        .join("") || `<tr><td colspan="5" class="fb">Nenhuma volta ainda. Sem voltas, vai pra classificação com o acerto atual.</td></tr>`;
    p.el.querySelectorAll<HTMLInputElement>("[data-use]").forEach((r) =>
      r.addEventListener("change", () => {
        p.chosen = Number(r.dataset.use);
        this.sendFinal(p);
        this.renderPanel(p);
      }),
    );
  }

  /** bolinha percorrendo a pista com o perfil de velocidade do acerto */
  private animate(p: CarPanel, tuning: Tuning, done: () => void) {
    const w = this.lobby.weekend!;
    const track = getTrack(w.trackIndex);
    const prof = carProfile(track, tuning);
    const cum = new Float32Array(track.L + 1);
    for (let i = 0; i < track.L; i++) cum[i + 1] = cum[i] + 1 / prof.v[i];
    const cv = p.el.querySelector<HTMLCanvasElement>("canvas")!;
    const DUR = 2600;
    const t0 = performance.now();
    let idx = 0;
    const frame = (now: number) => {
      const f = Math.min(1, (now - t0) / DUR);
      const target = f * cum[track.L];
      while (idx < track.L && cum[idx + 1] < target) idx++;
      const tf = drawTrackThumb(cv, w.trackIndex, "#5b616e");
      const g = cv.getContext("2d")!;
      const pt = track.pts[idx % track.L];
      const x = tf.ox + (pt.x - tf.minX) * tf.sc, y = tf.oy + (pt.y - tf.minY) * tf.sc;
      g.fillStyle = "#000";
      g.fillRect(x - 5, y - 5, 10, 10);
      g.fillStyle = "#ffcc00";
      g.fillRect(x - 4, y - 4, 8, 8);
      g.fillStyle = "#fff";
      g.font = "12px Silkscreen, monospace";
      g.fillText(`${Math.round(prof.v[idx % track.L] * 3.6)} km/h`, 8, 16);
      if (f < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  }

  update(lobby: LobbyState) {
    this.lobby = lobby;
    updateWaitBar(lobby);
  }

  destroy() {
    updateWaitBar(null);
  }
}
