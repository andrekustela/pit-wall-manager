import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { profileOf } from "../sim/drivers";
import { fmtLap } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import type { Compound } from "../sim/types";
import { qualiCuts, type QualiResult } from "../sim/weekend";
import { backButtonHtml, bindBackButton, champLabel, esc, teamOfDriver, teamName, tyreIcon, updateWaitBar, wetLabel } from "./common";

/** altura da linha: cabe a tabela inteira na tela (sem rolar), entre 22 e 32 px */
const rowHeight = (n: number) => Math.max(22, Math.min(32, Math.floor((window.innerHeight - 150) / (n + 1))));
const HEAD_H = 28;

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
    const ROW_H = rowHeight(n);
    const mineIds = results.filter((r) => teamOfDriver(lobby, r.carId) === myTeam).map((r) => r.carId);
    root.innerHTML = `
      <div class="screen qscreen" style="--rh:${ROW_H}px"><div class="qwrap">
        <header class="qtop">
          <div><h1 class="title">CLASSIFICA<span>ÇÃO</span></h1>
            <p class="sub">${esc(champLabel(lobby))}${esc(CIRCUITS[w.trackIndex].name)} · ${wetLabel(wet)}</p></div>
          <div class="qsessions">
            <span data-s="0">Q1 <small>todos · caem ${n - c1}</small></span>
            <span data-s="1">Q2 <small>${c1} carros · caem ${c1 - c2}</small></span>
            <span data-s="2">Q3 <small>top ${c2} · pole</small></span>
            <button class="btn small" id="q-skip">PULAR ▶▶</button>
          </div>
        </header>
        <div class="qmain">
        <div class="box qboard" style="padding:0;height:${n * ROW_H + HEAD_H}px">
          <div class="qcut" style="top:${HEAD_H + c1 * ROW_H}px"><span>CORTE DO Q1</span></div>
          <div class="qcut" style="top:${HEAD_H + c2 * ROW_H}px"><span>CORTE DO Q2</span></div>
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
        <aside class="qside">
          <div class="qmine" id="q-mine"></div>
          <div class="polebanner" id="q-pole"></div>
          <div class="qbtns"><button class="go" id="q-go">IR PARA A ESTRATÉGIA ▶</button>${backButtonHtml(lobby, "VOLTAR PRO TREINO")}</div>
        </aside>
        </div>
      </div></div>`;

    const rowOf = new Map([...root.querySelectorAll<HTMLElement>(".qb-row")].map((el) => [el.dataset.car!, el]));
    const byId = new Map(results.map((r) => [r.carId, r]));
    const place = (order: string[]) =>
      order.forEach((id, i) => {
        const el = rowOf.get(id)!;
        el.style.top = `${HEAD_H + i * ROW_H}px`;
        el.querySelector(".p")!.textContent = String(i + 1);
      });
    // painel dos seus pilotos: posição agora, melhor tempo já mostrado e a distância pro corte
    const shown = new Map<string, number[]>();
    const renderMine = (order: string[], k: number) => {
      const box = root.querySelector<HTMLElement>("#q-mine")!;
      box.innerHTML = mineIds.length
        ? `<h3>SUA EQUIPE</h3>` +
          mineIds
            .map((id) => {
              const r = byId.get(id)!, d = profileOf(id)!, pos = order.indexOf(id) + 1;
              const times = shown.get(id) ?? [], best = times.length ? times[times.length - 1] : null;
              const out = this.done || (r.out && r.out <= k) ? r.out : 0;
              // já caiu numa sessão anterior: fica "fora" mesmo antes do fim
              const gone = r.out && r.out <= k;
              let status = this.done || gone ? (r.out ? `Fora no Q${r.out}` : pos === 1 ? "POLE POSITION!" : `Larga em P${pos}`) : k >= 0 ? `Q${k + 1}` : "Esperando";
              // na sessão: quanto falta pra passar do corte (ou a folga)
              if (!this.done && !gone && k >= 0 && k < 2 && best !== null) {
                const cut = k === 0 ? c1 : c2;
                const ranked = results.filter((x) => (shown.get(x.carId)?.length ?? 0) > k).sort((a, b) => a.q[k] - b.q[k]);
                const line = ranked[cut - 1];
                if (line && ranked.length > cut) {
                  const diff = r.q[k] - line.q[k];
                  // passando: folga pro 1º que está caindo; caindo: quanto falta pro último que passa
                  status = diff <= 0 ? `Q${k + 1} · passando, folga de ${(ranked[cut].q[k] - r.q[k]).toFixed(3)} s` : `Q${k + 1} · caindo: falta ${diff.toFixed(3)} s`;
                }
              }
              return `<div class="qm ${out ? "out" : ""}" style="--tc:${TEAMS.find((t) => t.id === myTeam)?.color ?? "#e8202a"}">
                <b class="pos">${pos ? `P${pos}` : "-"}</b>
                <div><b>${esc(d.name)}</b><small>${esc(status)}</small></div>
                <span class="tt">${best !== null ? fmtLap(best) : "--"}</span></div>`;
            })
            .join("")
        : "";
    };
    let lastOrder: string[] = [];
    let curK = -1;
    const placeAll = (order: string[]) => {
      lastOrder = order;
      place(order);
      renderMine(order, curK);
    };
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
      const arr = shown.get(r.carId) ?? [];
      arr[k] = r.q[k];
      shown.set(r.carId, arr);
      if (mineIds.includes(r.carId) || k < 2) renderMine(lastOrder, curK);
    };
    const markOut = (k: number) => {
      for (const r of results)
        if (r.out === k + 1) {
          const el = rowOf.get(r.carId)!;
          el.classList.add("out");
          el.querySelector(".tag")!.textContent = `FORA NO Q${k + 1}`;
        }
    };
    const setSession = (k: number) => {
      curK = k;
      root.querySelectorAll<HTMLElement>("[data-s]").forEach((s) => s.classList.toggle("on", Number(s.dataset.s) === k));
      renderMine(lastOrder, k);
    };
    const finish = () => {
      if (this.done) return;
      this.done = true;
      this.timers.forEach(clearTimeout);
      for (const r of results) r.q.forEach((_, k) => showTime(r, k));
      markOut(0);
      markOut(1);
      setSession(-1);
      placeAll(results.map((r) => r.carId));
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
      renderMine(lastOrder, -1);
    };

    // ---- animação ----
    // antes de começar: ordem das equipes
    const start = TEAMS.flatMap((t) => lobby.lineup[t.id] ?? []).filter((id) => byId.has(id));
    for (const r of results) if (!start.includes(r.carId)) start.push(r.carId);
    placeAll(start);
    let t = 300;
    const at = (ms: number, f: () => void) => this.timers.push(setTimeout(f, ms));
    for (let k = 0; k < 3; k++) {
      at(t, () => setSession(k));
      const alive = results.filter((r) => r.q.length > k);
      // os tempos chegam numa ordem embaralhada (cada um sai da garagem numa hora)
      const seq = [...alive].sort((a, b) => ((hashId(a.carId) + k * 7) % 13) - ((hashId(b.carId) + k * 7) % 13));
      seq.forEach((r, i) => at(t + 250 + i * 110, () => showTime(r, k)));
      t += 250 + seq.length * 110 + 300;
      at(t, () => placeAll(orderAt(k)));
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
