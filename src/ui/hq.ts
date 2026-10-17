// Sede da equipe: entre uma etapa e outra do campeonato. Abas com o resumo
// (próxima pista e tabela), a fábrica (evolução do carro e motores), os
// mecânicos, a sala de troféus e os pilotos. Daqui se vai pra próxima etapa.
import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { POINTS, crewCost, standings } from "../sim/championship";
import { TEAMS } from "../sim/data";
import { profileOf } from "../sim/drivers";
import { CREW_DEFAULT, CREW_MAX, crewErrorChance, crewStopTime, fmtLap } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import { devInner } from "./devPanel";
import { driverCardHtml } from "./driverCard";
import { drawTrackThumb, esc, teamDrivers, teamName, teamOfDriver, updateWaitBar } from "./common";

type Tab = "resumo" | "fabrica" | "mecanicos" | "trofeus" | "pilotos";

const TABS: [Tab, string][] = [
  ["resumo", "RESUMO"],
  ["fabrica", "FÁBRICA"],
  ["mecanicos", "MECÂNICOS"],
  ["trofeus", "TROFÉUS"],
  ["pilotos", "PILOTOS"],
];

export class HqScreen {
  private tab: Tab = "resumo";
  private ready = false;

  constructor(private root: HTMLElement, private conn: Connection, private lobby: LobbyState) {
    this.render();
    root.addEventListener("click", this.onClick);
  }

  private me() {
    return this.lobby.players.find((p) => p.id === this.lobby.you)!;
  }

  private onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-hqtab]");
    if (tab) {
      this.tab = tab.dataset.hqtab as Tab;
      this.render();
      return;
    }
    const dev = t.closest<HTMLButtonElement>("[data-dev]");
    if (dev && !dev.disabled) this.conn.send({ t: "develop", area: dev.dataset.dev as "aero" });
    const rep = t.closest<HTMLButtonElement>("[data-repair]");
    if (rep && !rep.disabled) this.conn.send({ t: "repairEngine", carId: rep.dataset.repair! });
    const crew = t.closest<HTMLButtonElement>("[data-crew]");
    if (crew && !crew.disabled) this.conn.send({ t: "upgradeCrew" });
    if (t.closest("#hq-go")) {
      this.ready = !this.ready;
      this.conn.send({ t: "ready", ready: this.ready });
      this.renderGo();
    }
  };

  update(lobby: LobbyState) {
    this.lobby = lobby;
    updateWaitBar(lobby);
    const open = this.root.querySelector<HTMLDetailsElement>(".devrivals")?.open;
    const sc = window.scrollY;
    this.render();
    if (open) this.root.querySelector<HTMLDetailsElement>(".devrivals")!.open = true;
    window.scrollTo(0, sc);
  }

  destroy() {
    this.root.removeEventListener("click", this.onClick);
    updateWaitBar(null);
  }

  private render() {
    const l = this.lobby;
    const ch = l.champ!;
    const me = this.me();
    const team = me.teamId ?? "";
    const tcol = TEAMS.find((t) => t.id === team)?.color ?? "#fff";
    const pts = ch.devPts[team] ?? 0;
    const body =
      this.tab === "resumo" ? this.resumo() : this.tab === "fabrica" ? devInner(l) : this.tab === "mecanicos" ? this.mecanicos() : this.tab === "trofeus" ? this.trofeus() : this.pilotos();
    this.root.innerHTML = `
      <div class="screen"><div class="wrap hq">
        <div class="hqhead" style="border-left-color:${tcol}">
          <div><div class="hint" style="margin:0">SEDE DA EQUIPE · ${esc(ch.name ?? "Campeonato")}</div>
            <h1 class="title" style="margin:2px 0 0">${esc(teamName(l, team).toUpperCase())}</h1>
            <div class="hint" style="margin:4px 0 0">${ch.finished ? "Campeonato encerrado" : `Etapa ${ch.results.length} de ${ch.rounds.length} concluída`} · engenheiro ${esc(me.name)}</div></div>
          <div class="hqpts"><span class="devpts">${pts}</span><span>pontos de<br>desenvolvimento</span></div>
        </div>
        <div class="seg hqtabs">${TABS.map(([k, n]) => `<button data-hqtab="${k}" class="${k === this.tab ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="box hqbody">${body}</div>
        <div class="row-btns" style="margin-top:18px"><button class="go" id="hq-go" style="margin:0"></button></div>
      </div></div>`;
    this.renderGo();
    const cv = this.root.querySelector<HTMLCanvasElement>("canvas.hqtrack");
    const next = ch.rounds[ch.round + 1];
    if (cv && next !== undefined) requestAnimationFrame(() => drawTrackThumb(cv, next));
  }

  private renderGo() {
    const ch = this.lobby.champ!;
    const b = this.root.querySelector<HTMLButtonElement>("#hq-go");
    if (!b) return;
    const next = ch.rounds[ch.round + 1];
    b.textContent = this.ready ? "PRONTO ✓" : ch.finished ? "ENCERRAR CAMPEONATO ▶" : `IR PRA PRÓXIMA ETAPA: ${(CIRCUITS[next]?.name ?? "").toUpperCase()} ▶`;
  }

  // ---------- abas ----------

  private resumo(): string {
    const l = this.lobby;
    const ch = l.champ!;
    const team = this.me().teamId ?? "";
    const next = ch.rounds[ch.round + 1];
    const tr = next !== undefined ? CIRCUITS[next] : null;
    const allIds = TEAMS.flatMap((t) => l.lineup[t.id] ?? []);
    const byTeam = (d: string) => teamOfDriver(l, d);
    const drivers = standings(ch.driverPts, allIds, ch.results, byTeam);
    const teams = standings(ch.teamPts, TEAMS.map((t) => t.id), ch.results, byTeam, true);
    const row = (i: number, color: string, name: string, pts: number, mine: boolean) =>
      `<tr class="${mine ? "player" : ""}"><td>${i + 1}</td><td><span class="tdot" style="background:${color}"></span>${esc(name)}</td><td class="num"><b>${pts}</b></td></tr>`;
    const myPos = teams.findIndex((t) => t.id === team) + 1;
    const nextCard = tr
      ? `<div class="hqnext"><canvas class="hqtrack"></canvas><div><div class="hint" style="margin:0">PRÓXIMA ETAPA · ${ch.round + 2} de ${ch.rounds.length}</div>
          <h2 style="margin:4px 0">${esc(tr.name)}</h2><p class="hint" style="margin:0">${esc(tr.blurb)}</p>
          <p class="hint" style="margin:6px 0 0">${tr.street ? "Circuito de rua · " : ""}chance de chuva ${Math.round(tr.rainChance * 100)}%</p></div></div>`
      : `<div class="hqnext"><div><h2 style="margin:0">🏁 Campeonato encerrado</h2><p class="hint">Sua equipe terminou em ${myPos}º entre as equipes.</p></div></div>`;
    return `${nextCard}
      <div class="cols" style="margin-top:14px">
        <div><h3>PILOTOS</h3><table class="results">${drivers
          .slice(0, 10)
          .map((d, i) => {
            const t = byTeam(d.id);
            return row(i, TEAMS.find((x) => x.id === t)?.color ?? "#888", profileOf(d.id)?.name ?? d.id, d.pts, t === team);
          })
          .join("")}</table></div>
        <div><h3>EQUIPES</h3><table class="results">${teams
          .map((t, i) => row(i, TEAMS.find((x) => x.id === t.id)?.color ?? "#888", teamName(l, t.id), t.pts, t.id === team))
          .join("")}</table></div>
      </div>`;
  }

  private mecanicos(): string {
    const l = this.lobby;
    const ch = l.champ!;
    const team = this.me().teamId ?? "";
    const lv = ch.crew?.[team] ?? CREW_DEFAULT;
    const pts = ch.devPts[team] ?? 0;
    const max = lv >= CREW_MAX;
    const cost = crewCost(lv);
    const can = !max && pts >= cost && !ch.finished;
    const stat = (n: number) => `${crewStopTime(n).toFixed(1).replace(".", ",")} s · ${Math.round(crewErrorChance(n) * 1000) / 10}% de erro`;
    const rivals = TEAMS.map((t) => ({ t, lv: ch.crew?.[t.id] ?? CREW_DEFAULT }))
      .sort((a, b) => b.lv - a.lv)
      .map(({ t, lv: v }) => `<div class="${t.id === team ? "mine" : ""}"><span class="tdot" style="background:${t.color}"></span>${esc(teamName(l, t.id))}<span class="lv">nível ${v}</span></div>`)
      .join("");
    return `<div class="crewbox">
        <div><b>EQUIPE DE MECÂNICOS</b>
          <div class="pips big">${Array.from({ length: CREW_MAX }, (_, i) => `<i class="${i < lv ? "on" : ""}"></i>`).join("")}<span>nível ${lv} de ${CREW_MAX}</span></div>
          <p class="hint">Mecânicos treinados trocam os pneus mais rápido e erram menos (parada lenta ou liberação insegura, que dá 5 s de punição).</p>
          <table class="results crewtab"><tr><th></th><th>TROCA DE PNEU</th></tr>
            <tr class="player"><td>Agora (nível ${lv})</td><td>${stat(lv)}</td></tr>
            ${max ? "" : `<tr><td>Nível ${lv + 1}</td><td>${stat(lv + 1)}</td></tr>`}</table>
          <button class="btn ${can ? "primary" : ""}" data-crew ${can ? "" : "disabled"}>${max ? "NO MÁXIMO" : `TREINAR MECÂNICOS · ${cost} pts`}</button>
        </div>
        <details class="devrivals" open><summary>Mecânicos das equipes</summary><div>${rivals}</div></details>
      </div>`;
  }

  private trofeus(): string {
    const l = this.lobby;
    const ch = l.champ!;
    const team = this.me().teamId ?? "";
    const mine = (id: string) => teamOfDriver(l, id) === team;
    let wins = 0, pods = 0, poles = 0, fls = 0, points = 0;
    const cards = ch.results
      .map((r, i) => {
        const pos = r.order.map((id, k) => ({ id, k })).filter((x) => mine(x.id) && !r.retired.includes(x.id));
        const best = pos.length ? pos[0].k + 1 : null;
        pos.forEach((x) => (points += POINTS[x.k] ?? 0));
        const pole = !!r.pole && mine(r.pole);
        const fl = !!r.fastest && mine(r.fastest.carId);
        if (best === 1) wins++;
        if (best && best <= 3) pods++;
        if (pole) poles++;
        if (fl) fls++;
        const icon = best === 1 ? "🏆" : best === 2 ? "🥈" : best === 3 ? "🥉" : best && best <= 10 ? "🏁" : best ? "·" : "✕";
        const cls = best === 1 ? "gold" : best === 2 ? "silver" : best === 3 ? "bronze" : best ? "" : "dnf";
        const who = pos.length ? profileOf(pos[0].id)?.name ?? "" : "abandono";
        return `<div class="trophy ${cls}"><div class="ti">${icon}</div><div class="tn">${i + 1}. ${esc(CIRCUITS[r.trackIndex]?.name ?? "")}</div>
          <div class="tp">${best ? `${best}º lugar` : "não terminou"}</div><div class="tw">${esc(who)}</div>
          <div class="tx">${pole ? `<span title="pole position">⏱ POLE</span>` : ""}${fl ? `<span title="volta mais rápida: ${fmtLap(r.fastest!.time)}">⚡ VOLTA</span>` : ""}</div></div>`;
      })
      .join("");
    const tot = (n: number | string, label: string) => `<div><b>${n}</b><span>${label}</span></div>`;
    return `<div class="statsgrid">${tot(wins, "vitórias")}${tot(pods, "pódios")}${tot(poles, "poles")}${tot(fls, "voltas mais rápidas")}</div>
      <p class="hint">${points} pontos marcados pela equipe neste campeonato.</p>
      <div class="trophies">${cards || `<p class="hint">Nenhuma etapa disputada ainda.</p>`}</div>`;
  }

  private pilotos(): string {
    const l = this.lobby;
    const ch = l.champ!;
    const team = this.me().teamId ?? "";
    const color = TEAMS.find((t) => t.id === team)?.color ?? "#fff";
    return `<div class="hqdrivers">${teamDrivers(l, team)
      .map((d) => {
        const res = ch.results.map((r) => (r.retired.includes(d.id) ? null : r.order.indexOf(d.id) + 1));
        const finished = res.filter((x): x is number => !!x);
        const best = finished.length ? Math.min(...finished) : null;
        return `<div><div class="hqdstat"><b>${ch.driverPts[d.id] ?? 0}</b> pontos · melhor resultado ${best ? `${best}º` : "—"} · ${res.filter((x) => x === null).length} abandono(s)</div>${driverCardHtml(d, teamName(l, team), color)}</div>`;
      })
      .join("")}</div>`;
  }
}
