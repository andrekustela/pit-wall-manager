// Sede da equipe: entre uma etapa e outra do campeonato. Abas com o resumo
// (próxima pista e tabela), a fábrica (evolução do carro e motores), os
// mecânicos, a sala de troféus e os pilotos. Daqui se vai pra próxima etapa.
import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { RENEW_COST, SIGN_COST, standings } from "../sim/championship";
import { CREW_AREAS, CREW_MAX, crewCost, crewErrorChance, crewOf, crewStopTime, normCrew, refuelMult, repairMult, type CrewArea } from "../sim/crew";
import { TEAMS } from "../sim/data";
import { profileOf } from "../sim/drivers";
import { CIRCUITS } from "../sim/track";
import { devInner } from "./devPanel";
import { calendarHtml, drawCalendarThumbs } from "./calendar";
import { driverCardHtml } from "./driverCard";
import { editMyLivery } from "./liveryEditor";
import { emblemSvg } from "../render/emblem";
import { drawTrackThumb, esc, teamDrivers, teamName, teamOfDriver, updateWaitBar } from "./common";

type Tab = "resumo" | "calendario" | "fabrica" | "mecanicos" | "trofeus" | "pilotos" | "mercado";

const TABS: [Tab, string][] = [
  ["resumo", "RESUMO"],
  ["fabrica", "FÁBRICA"],
  ["mecanicos", "MECÂNICOS"],
  ["trofeus", "TROFÉUS"],
  ["pilotos", "PILOTOS"],
  ["calendario", "CALENDÁRIO"],
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
    if (dev && !dev.disabled) this.conn.send({ t: "develop", carId: dev.dataset.car!, area: dev.dataset.dev as "aero" });
    const rep = t.closest<HTMLButtonElement>("[data-repair]");
    if (rep && !rep.disabled) this.conn.send({ t: "repairEngine", carId: rep.dataset.repair! });
    const crew = t.closest<HTMLButtonElement>("[data-crew]");
    if (crew && !crew.disabled) this.conn.send({ t: "upgradeCrew", carId: crew.dataset.car!, area: crew.dataset.crew as CrewArea });
    if (t.closest("#hq-livery")) editMyLivery(this.me().teamId ?? "", teamName(this.lobby, this.me().teamId ?? ""), this.conn);
    if (t.closest("#hq-season")) this.conn.send({ t: "newSeason" });
    const rn = t.closest<HTMLButtonElement>("[data-renew]");
    if (rn && !rn.disabled) this.conn.send({ t: "renewDriver", carId: rn.dataset.renew! });
    const sg = t.closest<HTMLButtonElement>("[data-sign]");
    if (sg && !sg.disabled) this.conn.send({ t: "signDriver", outId: sg.dataset.out!, inId: sg.dataset.sign! });
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
    const tcol = me.livery?.base ?? TEAMS.find((t) => t.id === team)?.color ?? "#fff";
    const cars = l.lineup[team] ?? [];
    const body =
      this.tab === "resumo" ? this.resumo() : this.tab === "fabrica" ? devInner(l) : this.tab === "mecanicos" ? this.mecanicos() : this.tab === "trofeus" ? this.trofeus() : this.tab === "mercado" ? this.mercado() : this.tab === "calendario" ? calendarHtml(ch) : this.pilotos();
    this.root.innerHTML = `
      <div class="screen"><div class="wrap hq">
        <div class="hqhead" style="border-left-color:${tcol}">
          <div class="accname">${me.livery ? emblemSvg(me.livery.emblem, 64) : ""}<div><div class="hint" style="margin:0">SEDE DA EQUIPE · ${esc(ch.name ?? "Campeonato")}</div>
            <h1 class="title" style="margin:2px 0 0">${esc(teamName(l, team).toUpperCase())}</h1>
            <div class="hint" style="margin:4px 0 0">Temporada ${ch.season ?? 1} · ${ch.finished ? "temporada encerrada" : `etapa ${ch.results.length} de ${ch.rounds.length} concluída`} · engenheiro ${esc(me.name)} · <button class="btn small" id="hq-livery">🎨 PINTURA E EMBLEMA</button></div></div></div>
          <div class="hqcarpts">${cars
            .map((id) => `<div><b>${esc(profileOf(id)?.name.split(" ").slice(-1)[0] ?? id)}</b><span><i class="devpts">${ch.devPts[id] ?? 0}</i> carro</span><span><i class="devpts crewpts">${ch.crewPts?.[id] ?? 0}</i> mecânicos</span></div>`)
            .join("")}</div>
        </div>
        <div class="seg hqtabs">${[...TABS, ...(ch.finished ? ([["mercado", "MERCADO"]] as [Tab, string][]) : [])].map(([k, n]) => `<button data-hqtab="${k}" class="${k === this.tab ? "on" : ""} ${k === "mercado" ? "hot" : ""}">${n}</button>`).join("")}</div>
        <div class="box hqbody">${body}</div>
        <div class="row-btns" style="margin-top:18px;align-items:center">${ch.finished && this.lobby.hostId === this.lobby.you ? `<button class="go" id="hq-season" style="margin:0">🏁 NOVA TEMPORADA ${(ch.season ?? 1) + 1} ▶</button>` : ""}<button class="${ch.finished ? "btn" : "go"}" id="hq-go" style="margin:0"></button></div>
      </div></div>`;
    this.renderGo();
    if (this.tab === "calendario") drawCalendarThumbs(this.root);
    const cv = this.root.querySelector<HTMLCanvasElement>("canvas.hqtrack");
    const next = ch.rounds[ch.round + 1];
    if (cv && next !== undefined) requestAnimationFrame(() => drawTrackThumb(cv, next, undefined, true));
  }

  private renderGo() {
    const ch = this.lobby.champ!;
    const b = this.root.querySelector<HTMLButtonElement>("#hq-go");
    if (!b) return;
    const next = ch.rounds[ch.round + 1];
    b.textContent = this.ready ? "PRONTO ✓" : ch.finished ? "ENCERRAR CARREIRA" : `IR PRA PRÓXIMA ETAPA: ${(CIRCUITS[next]?.name ?? "").toUpperCase()} ▶`;
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
    const me = this.me();
    const team = me.teamId ?? "";
    const color = me.livery?.base ?? TEAMS.find((t) => t.id === team)?.color ?? "#fff";
    const num = (n: number, d = 1) => n.toFixed(d).replace(".", ",");
    /** o que cada especialista faz no nível n */
    const eff = (a: CrewArea, n: number) =>
      a === "pneus" ? `troca em ${num(crewStopTime(n))} s`
      : a === "gasolina" ? `reabastece em ${Math.round(refuelMult(n) * 100)}% do tempo`
      : a === "pecas" ? `conserta em ${Math.round(repairMult(n) * 100)}% do tempo`
      : `${num(crewErrorChance(n) * 100)}% de chance de erro`;
    const car = (id: string) => {
      const c = normCrew(ch.crew?.[id] ?? crewOf());
      const pts = ch.crewPts?.[id] ?? 0;
      const cards = CREW_AREAS.map((a) => {
        const lv = c[a.id];
        const max = lv >= CREW_MAX;
        const cost = crewCost(lv);
        const can = !max && pts >= cost && !ch.finished;
        return `<div class="crewcard"><b>${a.icon} ${a.label}</b>
          <div class="pips">${Array.from({ length: CREW_MAX }, (_, i) => `<i class="${i < lv ? "on" : ""}"></i>`).join("")}<span>nível ${lv}</span></div>
          <p>${a.desc}</p>
          <div class="eff">Agora: ${eff(a.id, lv)}${max ? "" : ` · nível ${lv + 1}: ${eff(a.id, lv + 1)}`}</div>
          <button class="btn small ${can ? "primary" : ""}" data-crew="${a.id}" data-car="${id}" ${can ? "" : "disabled"}>${max ? "NO MÁXIMO" : `TREINAR · ${cost} pt${cost > 1 ? "s" : ""}`}</button></div>`;
      }).join("");
      return `<div class="devcar" style="border-left-color:${color}">
          <div class="devtop"><b class="devcarname">${esc(profileOf(id)?.name ?? id)}</b><div><span class="devpts crewpts">${pts}</span> ponto${pts === 1 ? "" : "s"} de mecânicos</div></div>
          <div class="crewcards">${cards}</div></div>`;
    };
    const rivals = TEAMS.flatMap((t) => (l.lineup[t.id] ?? []).map((id) => ({ t, id, c: normCrew(ch.crew?.[id] ?? crewOf()) })))
      .sort((a, b) => b.c.pneus + b.c.gasolina + b.c.pecas + b.c.chefe - (a.c.pneus + a.c.gasolina + a.c.pecas + a.c.chefe))
      .map(({ t, id, c }) => `<div class="${t.id === team ? "mine" : ""}"><span class="tdot" style="background:${t.color}"></span>${esc(profileOf(id)?.name ?? id)} <span class="hint" style="margin:0">${esc(teamName(l, t.id))}</span><span class="lv">🛞${c.pneus} ⛽${c.gasolina} 🔧${c.pecas} 🚦${c.chefe}</span></div>`)
      .join("");
    return `<p class="hint" style="margin-top:0">Cada carro tem os seus mecânicos, com pontos próprios (separados dos pontos do carro). Cada etapa dá de 2 a 4 pontos de mecânicos pra cada carro (quem está atrás ganha mais).</p>
      <div class="devcars">${(l.lineup[team] ?? []).map(car).join("")}</div>
      <details class="devrivals"><summary>Mecânicos de todos os carros (🛞 pneus, ⛽ combustível, 🔧 peças, 🚦 chefe de box)</summary><div>${rivals}</div></details>`;
  }

  /** troféus: só pódio (1º, 2º, 3º), contados por pista, de todas as temporadas */
  private trofeus(): string {
    const l = this.lobby;
    const ch = l.champ!;
    const team = this.me().teamId ?? "";
    const mine = ch.trophies?.[team] ?? {};
    const rows = Object.entries(mine)
      .map(([k, v]) => ({ track: Number(k), v }))
      .filter((x) => x.v[0] + x.v[1] + x.v[2] > 0)
      .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
    const tot = [0, 1, 2].map((k) => rows.reduce((a, r) => a + r.v[k], 0));
    const LABEL = ["1º lugar", "2º lugar", "3º lugar"];
    const CLS = ["gold", "silver", "bronze"];
    /** desenho do troféu: usa a pixel art em /trophies/1.png, 2.png, 3.png quando existir */
    const cup = (k: number, size: number) =>
      `<span class="cup ${CLS[k]}" style="width:${size}px;height:${size}px"><img src="/trophies/${k + 1}.png" alt="" onerror="this.remove()"><em>${["🏆", "🥈", "🥉"][k]}</em></span>`;
    const cards = rows
      .map(
        ({ track, v }) => `<div class="trackcup"><div class="tn">${esc(CIRCUITS[track]?.name ?? "")}</div>
          <div class="cups">${[0, 1, 2]
            .filter((k) => v[k] > 0)
            .map((k) => `<div class="cupn">${cup(k, 40)}<b>${v[k]}×</b><span>${LABEL[k]}</span></div>`)
            .join("")}</div></div>`,
      )
      .join("");
    return `<div class="cuptotals">${[0, 1, 2].map((k) => `<div>${cup(k, 64)}<b>${tot[k]}</b><span>${LABEL[k]}</span></div>`).join("")}</div>
      <div class="trackcups">${cards || `<p class="hint">Nenhum pódio ainda. Os troféus aparecem aqui, por pista, quando um piloto seu terminar entre os 3 primeiros.</p>`}</div>
      ${this.pastSeasons()}`;
  }

  /** temporadas anteriores (carreira) */
  private pastSeasons(): string {
    const l = this.lobby;
    const past = l.champ!.past ?? [];
    if (!past.length) return "";
    const team = this.me().teamId ?? "";
    const rows = past
      .map((p) => {
        const pos = p.teamOrder.indexOf(team) + 1;
        const champ = p.championTeam === team;
        return `<tr class="${champ ? "player" : ""}"><td>${p.season}</td><td>${champ ? "🏆 " : ""}${esc(profileOf(p.champion)?.name ?? p.champion)}</td><td>${esc(teamName(l, p.championTeam))}</td><td class="num">${pos ? `${pos}º` : "—"}</td><td class="num">${p.teamPts[team] ?? 0}</td><td class="num">${p.rounds}</td></tr>`;
      })
      .join("");
    return `<h3 style="margin-top:18px">TEMPORADAS ANTERIORES</h3><table class="results"><tr><th>TEMP.</th><th>CAMPEÃO</th><th>EQUIPE CAMPEÃ</th><th>SUA EQUIPE</th><th>PONTOS</th><th>ETAPAS</th></tr>${rows}</table>`;
  }

  /** fim da temporada: renovar contratos e contratar pilotos livres */
  private mercado(): string {
    const l = this.lobby;
    const ch = l.champ!;
    const team = this.me().teamId ?? "";
    const color = TEAMS.find((t) => t.id === team)?.color ?? "#fff";
    const mine = teamDrivers(l, team);
    const myRows = mine
      .map((d) => {
        const ct = ch.contracts?.[d.id] ?? 1;
        const ends = ct <= 1;
        const pts = ch.devPts[d.id] ?? 0;
        return `<div class="mkrow"><span class="tdot" style="background:${color}"></span><b>${esc(d.name)}</b><span class="hint" style="margin:0">nota ${d.rating} · ${ch.devPts[d.id] ?? 0} pts no carro · ${ends ? "contrato acaba nesta temporada" : `contrato: mais ${ct - 1} temporada(s)`}</span>
          <button class="btn small ${ends && pts >= RENEW_COST ? "primary" : ""}" data-renew="${d.id}" ${pts >= RENEW_COST ? "" : "disabled"}>RENOVAR +2 TEMP. · ${RENEW_COST} pts</button></div>`;
      })
      .join("");
    const free = (ch.market ?? [])
      .map((id) => {
        const p = profileOf(id);
        if (!p) return "";
        return `<div class="mkfree"><div class="mkhead"><b>${esc(p.name)}</b><span class="hint" style="margin:0">${esc(p.style)} · nota ${p.rating}</span></div>
          <div class="row-btns" style="margin:6px 0 0">${mine
            .map((d) => `<button class="btn small" data-sign="${id}" data-out="${d.id}" ${(ch.devPts[d.id] ?? 0) >= SIGN_COST ? "" : "disabled"}>NO LUGAR DE ${esc(d.name.split(" ").slice(-1)[0].toUpperCase())} · ${SIGN_COST} pts</button>`)
            .join("")}</div></div>`;
      })
      .join("");
    return `<p class="hint" style="margin-top:0">Fim da temporada ${ch.season ?? 1}. Renovar ou contratar usa os pontos do carro daquele piloto (quem chega fica com o carro e os mecânicos de quem saiu). Quem tem contrato acabando e não for renovado continua por mais 1 temporada. Na temporada nova o carro fica com metade da evolução, motores e reservas renovam e os mecânicos ficam.</p>
      <h3>SEUS PILOTOS</h3>${myRows}
      <h3 style="margin-top:16px">PILOTOS LIVRES NO MERCADO</h3><div class="mkgrid">${free || `<p class="hint">Ninguém livre agora.</p>`}</div>`;
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
        const ct = ch.contracts?.[d.id];
        return `<div><div class="hqdstat"><b>${ch.driverPts[d.id] ?? 0}</b> pontos · melhor resultado ${best ? `${best}º` : "—"} · ${res.filter((x) => x === null).length} abandono(s)${ct !== undefined ? ` · contrato: ${ct} temporada${ct === 1 ? "" : "s"}` : ""}</div>${driverCardHtml(d, teamName(l, team), color)}</div>`;
      })
      .join("")}</div>`;
  }
}
