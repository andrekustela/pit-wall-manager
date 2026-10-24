import type { Connection } from "../net/connection";
import { ENGINE_GRID_PEN, sparesOf } from "../sim/championship";
import { confirmDialog } from "./confirm";
import type { LobbyState, ServerMsg } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { toDriver } from "../sim/drivers";
import { showDriverCards, showReserveReveal } from "./driverCard";
import { fmtLap } from "../sim/race";
import { CIRCUITS, getTrack } from "../sim/track";
import { carProfile, type QualiLap } from "../sim/tuning";
import { COMPOUNDS, DEFAULT_TUNING, type Tuning } from "../sim/types";
import { PRACTICE_LAPS, weekendConditions } from "../sim/weekend";
import { forecastText } from "../sim/weather";
import { backButtonHtml, bindBackButton, champLabel, drawTrackThumb, esc, natBadge, teamDrivers, teamName, tipButton, tyreIcon, updateWaitBar, wetIcon, wetLabel } from "./common";

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

const LABELS: [keyof Tuning, string, string, string, string][] = [
  ["fw", "Asa dianteira", "pouca", "muita", "Mais asa na frente = a frente gruda mais nas curvas. Se o piloto diz que o carro sai de frente (subesterço), aumente. Também ajuda no equilíbrio com a asa traseira."],
  ["rw", "Asa traseira", "pouca", "muita", "É a maior asa do carro: mais asa = muito mais rápido nas curvas, mas mais lento nas retas (arrasto). Pista travada pede muita asa; pista de retão, pouca. Se a traseira escapa (sobresterço), aumente."],
  ["h", "Altura do carro", "baixo", "alto", "Carro baixo gruda mais no chão (mais aderência). Mas se a pista for ondulada e o carro estiver baixo demais, ele bate no chão e perde muito. Procure o mais baixo possível sem o piloto reclamar de batida."],
  ["sf", "Suspensão dianteira", "macia", "dura", "Dura demais o carro pula nas zebras e ondulações; macia demais ele balança e demora a reagir. Suspensão dianteira mais dura que a traseira deixa o carro sair mais de frente."],
  ["sr", "Suspensão traseira", "macia", "dura", "Mesma ideia da dianteira. Traseira mais dura que a dianteira deixa a traseira mais solta (sobresterço). Pista ondulada costuma pedir suspensão mais macia."],
];

export class PracticeScreen {
  private panels: CarPanel[] = [];
  private ready = false;

  constructor(private root: HTMLElement, private conn: Connection, private lobby: LobbyState) {
    this.build();
  }

  /** ids dos meus pilotos agora (pra perceber a troca pelo reserva) */
  private myIds(lobby: LobbyState): string {
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    return teamDrivers(lobby, me.teamId!).map((d) => d.id).join(",");
  }

  private build() {
    const lobby = this.lobby;
    const conn = this.conn;
    const root = this.root;
    this.panels = [];
    this.ready = false;
    const w = lobby.weekend!;
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    const track = CIRCUITS[w.trackIndex];
    root.innerHTML = `
      <div class="screen"><div class="wrap" style="max-width:1100px">
        <h1 class="title">TREINO <span>LIVRE</span></h1>
        <p class="sub">${esc(champLabel(lobby))}${esc(track.name)} · ${esc(teamName(lobby, me.teamId!))} · Cada piloto tem ${PRACTICE_LAPS} voltas de teste. Ninguém mais vê seus tempos.</p>
        ${this.conditionsHtml(w)}
        <div class="cols" id="p-cars"></div>
        <div class="row-btns" style="margin-top:20px">
          <button class="go" id="p-ready" style="margin:0">PRONTO PARA A CLASSIFICAÇÃO ▶</button>
          ${backButtonHtml(lobby, lobby.champ && lobby.champ.round > 0 ? "VOLTAR PRO LOBBY (cancela o campeonato)" : "VOLTAR PRO LOBBY")}
        </div>
      </div></div>`;

    const wrap = root.querySelector("#p-cars")!;
    const myTeam = TEAMS.find((t) => t.id === me.teamId)!;
    for (const d of teamDrivers(lobby, me.teamId!)) {
      const el = document.createElement("div");
      el.className = "box";
      wrap.appendChild(el);
      const panel: CarPanel = { id: d.id, tuning: { ...DEFAULT_TUNING }, laps: [], chosen: null, pending: null, animating: false, el };
      this.panels.push(panel);
      el.innerHTML = `
        <h3 style="display:flex;justify-content:space-between;align-items:center"><span>${natBadge(d)} ${esc(d.name.toUpperCase())} · ${esc(d.style)}</span>
          <span><button class="linkbtn" data-ficha>ver ficha</button></span></h3>
        <div class="engrow" data-engrow></div>
        ${LABELS.map(
          ([k, label, lo, hi, tip]) => `<div class="tune"><span>${label}${tipButton(tip)}</span><input type="range" min="0" max="100" step="1" value="${panel.tuning[k]}" data-k="${k}"><b data-v="${k}">${panel.tuning[k]}</b>
            <div class="ends"><span>${lo}</span><span>${hi}</span></div></div>`,
        ).join("")}
        <canvas class="lapcanvas"></canvas>
        <div class="radio" data-radio>Rádio: "Pronto pra sair, é só mandar."</div>
        <button class="btn primary" data-go style="width:100%;margin-top:10px"></button>
        <table class="laps"><thead><tr><th>#</th><th>TEMPO</th><th>RETA</th><th title="Asa dianteira / traseira / altura / suspensão diant. e tras.">ACERTO</th><th>USAR</th></tr></thead><tbody data-laps></tbody></table>`;
      el.querySelector("[data-ficha]")!.addEventListener("click", () => showDriverCards([d], teamName(lobby, myTeam.id), myTeam.color));
      el.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) =>
        inp.addEventListener("input", () => {
          const k = inp.dataset.k as keyof Tuning;
          panel.tuning[k] = Number(inp.value);
          el.querySelector(`[data-v=${k}]`)!.textContent = inp.value;
          if (panel.chosen === null) this.sendFinal(panel);
        }),
      );
      el.querySelector("[data-go]")!.addEventListener("click", () => this.runLap(panel));
      el.querySelector("[data-engrow]")!.addEventListener("click", async (e) => {
        if (!(e.target as HTMLElement).closest("[data-neweng]")) return;
        const ch = this.lobby.champ!;
        const spares = sparesOf(ch, d.id);
        const ok = await confirmDialog({
          title: "Motor novo",
          icon: "🔧",
          text: spares > 0
            ? `Colocar um motor novo no carro de ${d.name}? Usa 1 das ${spares} reserva(s) deste carro.`
            : `Acabaram as reservas. Um motor novo agora custa ${ENGINE_GRID_PEN} posições no grid de largada.`,
          ok: spares > 0 ? "TROCAR MOTOR" : "TROCAR E PERDER POSIÇÕES",
          danger: spares === 0,
        });
        if (ok) this.conn.send({ t: "newEngine", carId: d.id });
      });
      this.renderEngine(panel);
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

  /** faixa de condições: ícone + % de chuva; clique mostra os detalhes */
  private conditionsHtml(w: NonNullable<LobbyState["weekend"]>): string {
    const f = w.forecast;
    const chance = f ? f.chance : 0;
    const raceIcon = !f ? "☀" : chance >= 70 ? "🌧" : "🌦";
    const notes = weekendConditions(w).notes;
    const NL = "\n";
    const trackTip = notes.length
      ? "Neste fim de semana:" + NL + NL + notes.map((n) => `${n.icon} ${n.title}`).join(NL)
      : "Condições normais de pista neste fim de semana.";
    const item = (icon: string, title: string, sub: string, tip: string) =>
      `<button type="button" class="cond" data-tip="${esc(tip)}"><span class="ci">${icon}</span><span>${title}<small>${sub}</small></span></button>`;
    return `<div class="conds" style="margin-bottom:12px">
      ${item(wetIcon(w.practiceWet), "Treino", wetLabel(w.practiceWet), `Treino livre: ${wetLabel(w.practiceWet).toLowerCase()}. Os tempos do treino são com bastante combustível.`)}
      ${item(wetIcon(w.qualiWet), "Classificação", wetLabel(w.qualiWet), `Previsão pra classificação: ${wetLabel(w.qualiWet).toLowerCase()}. Pista molhada = todo mundo de pneu de chuva.`)}
      ${item(raceIcon, "Corrida", `${chance}% de chuva`, forecastText(w))}
      ${item("🏁", "Pista", notes.length ? notes.map((n) => n.icon).join(" ") + ` ${notes.length === 1 ? "1 aviso" : `${notes.length} avisos`}` : "normal", trackTip)}
      ${item("?", "Como funciona", "acerto", "Ajuste o carro e dê voltas de teste. Depois de cada volta o piloto diz no rádio o que está errado (piloto com bom feedback é mais preciso). O acerto ideal muda com a pista, as condições do fim de semana e o gosto de cada piloto. A volta marcada em USAR é a que vai pra classificação e pra corrida.")}
    </div>`;
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
          <td title="Asa diant. / asa tras. / altura / susp. diant. / susp. tras.">${l.tuning.fw}/${l.tuning.rw}/${l.tuning.h}/${l.tuning.sf}/${l.tuning.sr} ${tyreIcon(l.tyre, COMPOUNDS[l.tyre].label)}</td>
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
    const me = this.lobby.players.find((x) => x.id === this.lobby.you)!;
    const prof = carProfile(track, tuning, weekendConditions(w), toDriver(teamDrivers(this.lobby, me.teamId!).find((x) => x.id === p.id)!, me.teamId!));
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
      g.font = "600 13px Oswald, sans-serif";
      g.fillText(`${Math.round(prof.v[idx % track.L] * 3.6)} km/h`, 8, 16);
      if (f < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  }

  /** motor do carro no campeonato (gasto que vem das etapas anteriores) */
  private renderEngine(p: CarPanel) {
    const row = p.el.querySelector<HTMLElement>("[data-engrow]")!;
    const ch = this.lobby.champ;
    if (!ch?.engines) {
      row.hidden = true;
      return;
    }
    const h = ch.engines[p.id] ?? 1;
    const spares = sparesOf(ch, p.id);
    const pen = ch.gridPen[p.id];
    const cls = h > 0.6 ? "ok" : h > 0.35 ? "warn" : "bad";
    row.innerHTML = `<span>Motor</span><div class="engbar"><i class="${cls}" style="width:${Math.round(h * 100)}%"></i></div><b class="${cls}">${Math.round(h * 100)}%</b>
      <span class="hint" style="margin:0">${spares} reserva${spares === 1 ? "" : "s"} neste carro${pen ? ` · <span style="color:var(--warn)">-${pen} no grid</span>` : ""}</span>
      ${h < 0.999 ? `<button class="btn small" data-neweng>MOTOR NOVO</button>` : ""}`;
  }

  update(lobby: LobbyState) {
    const before = this.myIds(this.lobby);
    const old = teamDrivers(this.lobby, this.lobby.players.find((p) => p.id === this.lobby.you)!.teamId!);
    this.lobby = lobby;
    updateWaitBar(lobby);
    for (const p of this.panels) this.renderEngine(p);
    if (this.myIds(lobby) !== before) {
      // trocou pelo reserva: revela a carta e redesenha a tela com o piloto novo
      const me = lobby.players.find((p) => p.id === lobby.you)!;
      const now = teamDrivers(lobby, me.teamId!);
      const gone = old.find((d) => !now.some((x) => x.id === d.id));
      const came = now.find((d) => !old.some((x) => x.id === d.id));
      this.build();
      if (gone && came) showReserveReveal(gone, came, teamName(lobby, me.teamId!), TEAMS.find((t) => t.id === me.teamId)!.color);
    }
  }

  destroy() {
    updateWaitBar(null);
  }
}
