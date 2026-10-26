import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { profileOf } from "../sim/drivers";
import { fmtLap } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import type { Compound } from "../sim/types";
import { qualiCuts, type QualiResult } from "../sim/weekend";
import { backButtonHtml, bindBackButton, champLabel, esc, teamOfDriver, teamName, tyreIcon, updateWaitBar, wetLabel } from "./common";

const ROW_H = 34;

/**
 * Classificação em 3 sessões: os tempos do Q1 aparecem, a tabela se reordena,
 * os 5 últimos caem; depois Q2 e Q3. Dá pra pular a animação.
 */
export class QualiScreen {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ready = false;
  private done = false;

  constructor(root: HTMLElement, conn: Connection, lobby: LobbyState, results: QualiResult[], wet: number) {
    const w = lobby.weekend!;
    // a sua equipe e as dos outros jogadores (online), com o nome de quem joga
    const myTeam = lobby.players.find((p) => p.id === lobby.you)?.teamId;
    const others = new Map(lobby.players.filter((p) => p.id !== lobby.you && p.teamId).map((p) => [p.teamId!, p.name]));
    const n = results.length;
    const [c1, c2] = qualiCuts(n);
    root.innerHTML = `
      <div class="screen"><div class="wrap">
        <h1 class="title">CLASSIFICA<span>ÇÃO</span></h1>
        <p class="sub">${esc(champLabel(lobby))}${esc(CIRCUITS[w.trackIndex].name)} · Q1, Q2 e Q3 · ${wetLabel(wet)}</p>
        <div class="qsessions">
          <span data-s="0">Q1 <small>todos · caem ${n - c1}</small></span>
          <span data-s="1">Q2 <small>${c1} carros · caem ${c1 - c2}</small></span>
          <span data-s="2">Q3 <small>top ${c2} · briga pela pole</small></span>
          <button class="btn small" id="q-skip">PULAR ▶▶</button>
        </div>
        <div class="box qboard" style="padding:0;height:${n * ROW_H + 30}px">
          <div class="qhead"><span>POS</span><span></span><span>PILOTO</span><span>Q1</span><span>Q2</span><span>Q3</span><span>DIF.</span></div>
          ${results
            .map((r) => {
              const d = profileOf(r.carId)!;
              const t = TEAMS.find((x) => x.id === teamOfDriver(lobby, r.carId))!;
              const mine = t.id === myTeam, who = others.get(t.id);
              return `<div class="qb-row ${mine ? "player mine" : who ? "player human" : ""}" data-car="${r.carId}" style="--tc:${t.color}">
                <span class="p"></span><span style="height:16px;background:${t.color}"></span>
                <span class="nm"><b>${esc(d.name)}</b> <span class="tm">${esc(teamName(lobby, t.id))}</span>${mine ? `<em class="who me">VOCÊ</em>` : who ? `<em class="who on" title="Equipe de outro jogador">👤 ${esc(who)}</em>` : ""}<i class="tag"></i></span>
                ${[0, 1, 2].map((k) => `<span class="t q${k}"></span>`).join("")}
                <span class="t gap"></span>
              </div>`;
            })
            .join("")}
        </div>
        <div class="polebanner" id="q-pole"></div>
        <div class="row-btns" style="align-items:center"><button class="go" id="q-go" style="margin:0">IR PARA A ESTRATÉGIA ▶</button>${backButtonHtml(lobby, "VOLTAR PRO TREINO")}</div>
      </div></div>`;

    const rowOf = new Map([...root.querySelectorAll<HTMLElement>(".qb-row")].map((el) => [el.dataset.car!, el]));
    const byId = new Map(results.map((r) => [r.carId, r]));
    const place = (order: string[]) =>
      order.forEach((id, i) => {
        const el = rowOf.get(id)!;
        el.style.top = `${30 + i * ROW_H}px`;
        el.querySelector(".p")!.textContent = String(i + 1);
      });
    // ordem de largada da sessão k: quem está nela (pelo tempo) e depois os que já caíram
    const orderAt = (k: number) => {
      const alive = results.filter((r) => r.q.length > k).sort((a, b) => a.q[k] - b.q[k]);
      const out = results.filter((r) => r.q.length <= k);
      return [...alive, ...out].map((r) => r.carId);
    };
    const showTime = (r: QualiResult, k: number) => {
      const el = rowOf.get(r.carId)!.querySelector<HTMLElement>(`.q${k}`)!;
      el.textContent = fmtLap(r.q[k]);
      el.classList.add("in");
    };
    const markOut = (k: number) => {
      for (const r of results)
        if (r.out === k + 1) {
          const el = rowOf.get(r.carId)!;
          el.classList.add("out");
          el.querySelector(".tag")!.textContent = `FORA NO Q${k + 1}`;
        }
    };
    const setSession = (k: number) => root.querySelectorAll<HTMLElement>("[data-s]").forEach((s) => s.classList.toggle("on", Number(s.dataset.s) === k));
    const finish = () => {
      if (this.done) return;
      this.done = true;
      this.timers.forEach(clearTimeout);
      for (const r of results) r.q.forEach((_, k) => showTime(r, k));
      markOut(0);
      markOut(1);
      setSession(-1);
      place(results.map((r) => r.carId));
      const pole = results[0];
      results.forEach((r, i) => {
        const el = rowOf.get(r.carId)!;
        el.classList.toggle("pole", i === 0);
        // diferença pro melhor da mesma sessão
        const k = r.q.length - 1;
        const best = Math.min(...results.filter((x) => x.q.length > k).map((x) => x.q[k]));
        el.querySelector(".gap")!.innerHTML = i === 0 ? tyreIcon(r.tyre as Compound) : `+${(r.q[k] - best).toFixed(3)}`;
      });
      root.querySelector("#q-pole")!.textContent = `POLE POSITION: ${profileOf(pole.carId)!.name} · ${fmtLap(pole.time)}`;
      root.querySelector<HTMLElement>("#q-skip")!.hidden = true;
    };

    // ---- animação ----
    // antes de começar: ordem das equipes
    const start = TEAMS.flatMap((t) => lobby.lineup[t.id] ?? []).filter((id) => byId.has(id));
    for (const r of results) if (!start.includes(r.carId)) start.push(r.carId);
    place(start);
    let t = 300;
    const at = (ms: number, f: () => void) => this.timers.push(setTimeout(f, ms));
    for (let k = 0; k < 3; k++) {
      at(t, () => setSession(k));
      const alive = results.filter((r) => r.q.length > k);
      // os tempos chegam numa ordem embaralhada (cada um sai da garagem numa hora)
      const seq = [...alive].sort((a, b) => ((hashId(a.carId) + k * 7) % 13) - ((hashId(b.carId) + k * 7) % 13));
      seq.forEach((r, i) => at(t + 250 + i * 110, () => showTime(r, k)));
      t += 250 + seq.length * 110 + 300;
      at(t, () => place(orderAt(k)));
      t += 800;
      if (k < 2) at(t, () => markOut(k));
      t += 900;
    }
    at(t, finish);

    root.querySelector("#q-skip")!.addEventListener("click", finish);
    bindBackButton(root, (m) => conn.send(m));
    const go = root.querySelector<HTMLButtonElement>("#q-go")!;
    go.addEventListener("click", () => {
      finish();
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

function hashId(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
