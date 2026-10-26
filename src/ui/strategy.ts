import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";

import { fuelPerLap } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import { ALL_COMPOUNDS, COMPOUNDS, DRY, FUEL_MAX, bestForWet, isWetTyre, type CarSetup, type Compound } from "../sim/types";
import { forecastText } from "../sim/weather";
import type { QualiResult } from "../sim/weekend";
import { conditionsBar } from "./practice";
import { backButtonHtml, bindBackButton, champLabel, esc, teamDrivers, tyreIcon, updateWaitBar, wetLabel } from "./common";

/**
 * Na tela o combustível é escolhido em VOLTAS (proporcional ao tamanho da
 * corrida); os kg são calculados. Internamente o setup continua em kg.
 */
interface StopUI {
  lap: number;
  compound: Compound;
  fuelLaps: number;
}
interface PlanUI {
  tyre: Compound;
  fuelLaps: number;
  stops: StopUI[];
}

interface Panel {
  id: string;
  plan: PlanUI;
  el: HTMLElement;
}

export class StrategyScreen {
  private panels: Panel[] = [];
  private ready = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private laps: number;
  private cons: number;
  private maxLaps: number;

  constructor(root: HTMLElement, private conn: Connection, private lobby: LobbyState, quali: QualiResult[]) {
    const w = lobby.weekend!;
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    this.laps = w.laps;
    this.cons = fuelPerLap(w.laps);
    this.maxLaps = Math.floor((FUEL_MAX - 1) / this.cons);
    root.innerHTML = `
      <div class="screen stratscreen"><div class="swrap">
        <header class="shead">
          <div><h1 class="title">ESTRA<span>TÉGIA</span></h1>
            <p class="sub">${esc(champLabel(lobby))}${esc(CIRCUITS[w.trackIndex].name)} · ${w.laps} voltas · o tanque cabe combustível pra ${Math.min(this.maxLaps, w.laps)} voltas</p></div>
          ${conditionsBar(w, {
            sub: "estratégia",
            tip: `Largada: ${wetLabel(w.startWet)}. ${forecastText(w)}

Escolha um plano pronto ou monte o seu. Combustível é escolhido em voltas: mais voltas = carro mais pesado (mais lento), menos voltas = vai ter que parar pra reabastecer.

O plano é um lembrete: na volta marcada o engenheiro avisa e sugere o box, mas quem decide se para é você (e dá pra mudar as paradas na corrida).

No seco é obrigatório usar 2 tipos de pneu diferentes.`,
          })}
        </header>
        <div class="cols scols" id="s-cars"></div>
        <footer class="sbtns">
          <span class="phint">Plano pronto num clique ou monte o seu. Na volta marcada o engenheiro avisa; quem decide o box é você.</span>
          ${backButtonHtml(lobby, "VOLTAR PRA CLASSIFICAÇÃO")}
          <button class="go" id="s-go">IR PARA O GRID ▶</button>
        </footer>
      </div></div>`;

    const wrap = root.querySelector("#s-cars")!;
    for (const d of teamDrivers(lobby, me.teamId!)) {
      const q = quali.findIndex((r) => r.carId === d.id);
      const el = document.createElement("div");
      el.className = "box";
      wrap.appendChild(el);
      const p: Panel = { id: d.id, plan: this.preset(0, w.startWet), el };
      this.panels.push(p);
      el.dataset.title = `${d.name.toUpperCase()} · LARGA EM P${q + 1}`;
      this.render(p);
    }
    bindBackButton(root, (m) => this.conn.send(m));
    root.querySelector("#s-go")!.addEventListener("click", () => {
      this.ready = !this.ready;
      this.flush();
      conn.send({ t: "ready", ready: this.ready });
      root.querySelector("#s-go")!.textContent = this.ready ? "PRONTO ✓ (clique pra editar)" : "IR PARA O GRID ▶";
      this.panels.forEach((x) => this.render(x));
    });
    this.flush();
  }

  private kg(laps: number) {
    return laps <= 0 ? 0 : Math.min(FUEL_MAX, Math.ceil(laps * this.cons * 1.02 + 1.5));
  }

  private presetNames(wet: number): string[] {
    const best = bestForWet(wet);
    if (best === "dry") return ["1 parada: Médio → Duro", "1 parada: Duro → Médio", "2 paradas: Macio → Médio → Médio"];
    const t = COMPOUNDS[best].label;
    return [`Chuva: ${t} → ${t}`, `Chuva: ${t} → Médio (se secar)`];
  }

  private preset(i: number, wet: number): PlanUI {
    const N = this.laps;
    const mk = (tyres: Compound[], stops: number[]): PlanUI => {
      const ends = [...stops, N];
      return {
        tyre: tyres[0],
        fuelLaps: ends[0],
        stops: stops.map((lap, k) => ({ lap, compound: tyres[k + 1], fuelLaps: ends[k + 1] - lap })),
      };
    };
    const best = bestForWet(wet);
    if (best !== "dry") return i === 0 ? mk([best, best], [Math.round(N * 0.5)]) : mk([best, "M"], [Math.round(N * 0.45)]);
    switch (i) {
      case 1: return mk(["H", "M"], [Math.round(N * 0.58)]);
      case 2: return mk(["S", "M", "M"], [Math.round(N * 0.3), Math.round(N * 0.65)]);
      default: return mk(["M", "H"], [Math.round(N * 0.42)]);
    }
  }

  private toSetup(p: PlanUI): CarSetup {
    return {
      tyre: p.tyre,
      fuel: this.kg(p.fuelLaps),
      plan: p.stops.map((s) => ({ lap: s.lap, compound: s.compound, fuel: this.kg(s.fuelLaps) })),
    };
  }

  private changed() {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.flush(), 250);
  }

  private flush() {
    const setups: Record<string, CarSetup> = {};
    for (const p of this.panels) setups[p.id] = this.toSetup(p.plan);
    this.conn.send({ t: "setup", setups });
  }

  /** voltas que o pneu aguenta antes de começar a cair de rendimento */
  private life(c: Compound) {
    return Math.round(0.72 / (COMPOUNDS[c].wearPerLap * (30 / this.laps)));
  }

  /** explicação do plano, em frases simples */
  private analysis(p: PlanUI): string {
    const msgs: string[] = [];
    const stops = [...p.stops].sort((a, b) => a.lap - b.lap);
    const stints: { tyre: Compound; from: number; to: number }[] = [];
    let tyre = p.tyre;
    let from = 0;
    let fuelUntil = p.fuelLaps; // até que volta o combustível dá
    let fuelProblem: string | null = null;
    for (let k = 0; k <= stops.length; k++) {
      const to = k < stops.length ? stops[k].lap : this.laps;
      stints.push({ tyre, from, to });
      if (!fuelProblem && fuelUntil < to) {
        fuelProblem =
          k < stops.length
            ? `O combustível acaba na volta ${fuelUntil}, antes da parada ${k + 1} (volta ${to}). Coloque mais combustível ${k === 0 ? "na largada" : `na parada ${k}`} ou adiante a parada.`
            : `O combustível acaba na volta ${fuelUntil}, mas a corrida tem ${this.laps}. Coloque mais combustível ${k === 0 ? "na largada" : `na última parada`} ou adicione uma parada.`;
      }
      if (k < stops.length) {
        const leftover = Math.max(0, fuelUntil - to);
        fuelUntil = to + Math.min(this.maxLaps, leftover + stops[k].fuelLaps);
        tyre = stops[k].compound;
        from = to;
      }
    }
    if (fuelProblem) msgs.push(`<div class="msg bad">⛽ ${fuelProblem}</div>`);
    else msgs.push(`<div class="msg good">⛽ O combustível chega até o fim da corrida.</div>`);

    for (const [i, st] of stints.entries()) {
      const len = st.to - st.from;
      if (isWetTyre(st.tyre)) continue;
      const life = this.life(st.tyre);
      if (len > life + 1)
        msgs.push(
          `<div class="msg warn">🛞 Trecho ${i + 1} (voltas ${st.from + 1} a ${st.to}): o ${COMPOUNDS[st.tyre].label} dura umas ${life} voltas e o trecho tem ${len}. No fim ele vai ficar bem lento.</div>`,
        );
    }
    const used = new Set([p.tyre, ...stops.map((x) => x.compound)]);
    if (![...used].some(isWetTyre) && [...used].filter((c) => DRY.includes(c)).length < 2)
      msgs.push(`<div class="msg bad">⚠ No seco é obrigatório usar 2 tipos de pneu diferentes, senão o piloto leva +30 segundos.</div>`);

    const lines = stints
      .map((st, i) => {
        const len = st.to - st.from;
        const life = isWetTyre(st.tyre) ? len : this.life(st.tyre);
        const pct = Math.min(100, Math.round((len / Math.max(1, life)) * 100));
        const col = pct > 100 || len > life + 1 ? "var(--soft)" : pct > 85 ? "var(--warn)" : "var(--ok)";
        return `<div class="stint"><span>Trecho ${i + 1}: ${tyreIcon(st.tyre)} voltas ${st.from + 1}–${st.to}</span>
          <span class="lifebar" title="quanto do pneu esse trecho usa"><i style="width:${pct}%;background:${col}"></i></span>
          <span>${len}/${isWetTyre(st.tyre) ? "—" : life} v</span></div>`;
      })
      .join("");
    return `<div class="analysis">${msgs.join("")}<div class="hint" style="margin:4px 0 0">Duração de cada trecho x quanto o pneu aguenta:</div>${lines}</div>`;
  }

  private render(p: Panel) {
    const w = this.lobby.weekend!;
    const s = p.plan;
    const dis = this.ready ? "disabled" : "";
    const tyreSeg = (sel: Compound, act: string, i = -1) =>
      `<div class="seg">${ALL_COMPOUNDS.map(
        (c) => `<button class="t${c} ${c === sel ? "on" : ""}" data-act="${act}" data-i="${i}" data-c="${c}" title="${COMPOUNDS[c].label}" ${dis}>${c}</button>`,
      ).join("")}</div>`;
    const stepper = (val: string, act: string, i = -1) =>
      `<span class="stepper"><button data-act="${act}" data-i="${i}" data-d="-1" ${dis}>−</button><b>${val}</b><button data-act="${act}" data-i="${i}" data-d="1" ${dis}>+</button></span>`;
    const kgTxt = (laps: number) => `<span class="hint">(${this.kg(laps)} kg)</span>`;
    p.el.innerHTML = `
      <h3>${esc(p.el.dataset.title)}</h3>
      <div class="presets"><span class="hint">Planos prontos:</span>${this.presetNames(w.startWet).map((name, i) => `<button class="btn small" data-preset="${i}" ${dis}>${esc(name)}</button>`).join("")}</div>
      <div class="sbody"><div class="sedit">
      <div class="stop"><b>Largada</b><span></span>
        <span>Pneu</span>${tyreSeg(s.tyre, "tyre")}
        <span>Combustível</span><span>${stepper(`${s.fuelLaps} voltas`, "fuel")} ${kgTxt(s.fuelLaps)}</span></div>
      <div class="stops">${s.stops
        .map(
          (st, k) => `<div class="stop"><b>Parada ${k + 1}</b><span style="display:flex;justify-content:space-between;align-items:center">
            <span>no fim da volta ${stepper(String(st.lap), "lap", k)}</span>
            <button class="btn small" data-act="del" data-i="${k}" ${dis}>remover</button></span>
            <span>Pneu</span>${tyreSeg(st.compound, "stopTyre", k)}
            <span>Combustível</span><span>${stepper(`+${st.fuelLaps} voltas`, "stopFuel", k)} ${kgTxt(st.fuelLaps)}</span></div>`,
        )
        .join("")}</div>
      <button class="btn small" data-act="add" style="margin-top:6px" ${dis}>+ ADICIONAR PARADA</button>
      </div><div class="sana">${this.analysis(s)}</div></div>`;

    p.el.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        const d = Number(b.dataset.d);
        if (b.dataset.preset !== undefined) p.plan = this.preset(Number(b.dataset.preset), w.startWet);
        switch (b.dataset.act) {
          case "tyre": s.tyre = b.dataset.c as Compound; break;
          case "fuel": s.fuelLaps = clamp(s.fuelLaps + d, 1, Math.min(this.maxLaps, this.laps)); break;
          case "lap": s.stops[i].lap = clamp(s.stops[i].lap + d, 1, this.laps - 1); break;
          case "stopTyre": s.stops[i].compound = b.dataset.c as Compound; break;
          case "stopFuel": s.stops[i].fuelLaps = clamp(s.stops[i].fuelLaps + d, 0, Math.min(this.maxLaps, this.laps)); break;
          case "del": s.stops.splice(i, 1); break;
          case "add": {
            const last = s.stops[s.stops.length - 1]?.lap ?? 0;
            const lap = Math.min(this.laps - 1, last + Math.max(2, Math.round(this.laps * 0.3)));
            s.stops.push({ lap, compound: s.tyre === "M" ? "H" : "M", fuelLaps: this.laps - lap });
            break;
          }
        }
        this.render(p);
        this.changed();
      }),
    );
  }

  update(lobby: LobbyState) {
    this.lobby = lobby;
    updateWaitBar(lobby);
  }

  destroy() {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    updateWaitBar(null);
  }
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}
