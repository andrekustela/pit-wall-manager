import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { DRIVERS, TEAMS } from "../sim/data";
import { fmtLap } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import type { Compound } from "../sim/types";
import type { QualiResult } from "../sim/weekend";
import { backButtonHtml, bindBackButton, champLabel, esc, teamName, tyreIcon, updateWaitBar, wetLabel } from "./common";

export class QualiScreen {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ready = false;

  constructor(root: HTMLElement, conn: Connection, lobby: LobbyState, results: QualiResult[], wet: number) {
    const w = lobby.weekend!;
    const humans = new Set(lobby.players.map((p) => p.teamId));
    const pole = results[0].time;
    root.innerHTML = `
      <div class="screen"><div class="wrap" style="max-width:820px">
        <h1 class="title">CLASSIFICA<span>ÇÃO</span></h1>
        <p class="sub">${esc(champLabel(lobby))}${esc(CIRCUITS[w.trackIndex].name)} · Volta única · ${wetLabel(wet)}</p>
        <div class="box" style="padding:0">
          ${results
            .map((r, i) => {
              const d = DRIVERS.find((x) => x.id === r.carId)!;
              const t = TEAMS.find((x) => x.id === d.teamId)!;
              return `<div class="qrow ${i === 0 ? "pole" : ""} ${humans.has(t.id) ? "player" : ""}" data-i="${i}">
                <span class="p">${i + 1}</span><span style="height:16px;background:${t.color}"></span>
                <span><b>${esc(d.name)}</b> <span style="color:var(--muted)">${esc(teamName(lobby, t.id))}</span></span>
                <span class="t">${fmtLap(r.time)}</span>
                <span class="t" style="color:var(--muted)">${i === 0 ? tyreIcon(r.tyre as Compound) : `+${(r.time - pole).toFixed(3)}`}</span>
              </div>`;
            })
            .join("")}
        </div>
        <div class="polebanner" id="q-pole"></div>
        <div class="row-btns" style="align-items:center"><button class="go" id="q-go" style="margin:0">IR PARA A ESTRATÉGIA ▶</button>${backButtonHtml(lobby, "VOLTAR PRO TREINO")}</div>
      </div></div>`;

    // revela do último pro primeiro
    const rows = [...root.querySelectorAll<HTMLElement>(".qrow")];
    const order = rows.slice().reverse();
    order.forEach((row, k) => this.timers.push(setTimeout(() => row.classList.add("show"), 250 + k * 220)));
    this.timers.push(
      setTimeout(() => {
        const d = DRIVERS.find((x) => x.id === results[0].carId)!;
        root.querySelector("#q-pole")!.textContent = `POLE POSITION: ${d.name} · ${fmtLap(pole)}`;
      }, 400 + order.length * 220),
    );
    bindBackButton(root, (m) => conn.send(m));
    const go = root.querySelector<HTMLButtonElement>("#q-go")!;
    go.addEventListener("click", () => {
      rows.forEach((r) => r.classList.add("show"));
      this.ready = !this.ready;
      conn.send({ t: "ready", ready: this.ready });
      go.textContent = this.ready ? "PRONTO ✓" : "IR PARA A ESTRATÉGIA ▶";
    });
  }

  update(lobby: LobbyState) {

    updateWaitBar(lobby);
  }

  destroy() {
    this.timers.forEach(clearTimeout);
    updateWaitBar(null);
  }
}
