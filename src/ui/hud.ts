import { fmtLap, fuelPerLap, type Race } from "../sim/race";
import {
  ALL_COMPOUNDS,
  COMPOUNDS,
  ENGINE,
  FUEL_MAX,
  PACE,
  type CarState,
  type Command,
  type Compound,
  type EngineMode,
  type PaceMode,
  type PlannedStop,
} from "../sim/types";
import { forecastText } from "../sim/weather";
import { esc, storeGet, storeSet, tyreIcon, wetLabel } from "./common";

export const SPEEDS = [1, 2, 4, 8, 16];

export interface HudHooks {
  myTeamId: string;
  isHost: boolean;
  getFollow(): string;
  setFollow(id: string): void;
  getSpeed(): number; // 0 = pausado
  setSpeed(s: number): void;
  send(cmd: Command): void;
  skip(): void;
}

interface CardState {
  next: Compound;
  /** voltas de combustível pra colocar; null = automático (o necessário pra terminar) */
  fuelLaps: number | null;
  planOpen: boolean;
  planSig: string;
  dueApplied: boolean;
}

export class Hud {
  private el: HTMLElement;
  private board: HTMLElement;
  private boardHead: HTMLElement;
  private info: HTMLElement;
  private feed: HTMLElement;
  private top: HTMLElement;
  private spd: HTMLElement;
  private banner: HTMLElement;
  private flag: HTMLElement;
  private cards = new Map<string, HTMLElement>();
  private cardState = new Map<string, CardState>();
  private feedCount = -1;
  private checkeredSeen: number | null = null;
  private cons: number;
  readonly minimapCanvas: HTMLCanvasElement;

  constructor(root: HTMLElement, private race: Race, private hooks: HudHooks) {
    this.cons = fuelPerLap(race.laps);
    this.el = document.createElement("div");
    this.el.innerHTML = `
      <div class="board panel"><div class="head"><span class="hl">POS</span><span class="lapc"></span></div>
        <div class="colhead"><span></span><span></span><span>PILOTO</span><span style="text-align:right">GAP</span><span style="text-align:right">ÚLT</span><span></span></div>
        <div class="rows"></div></div>
      <div class="topbar panel"></div>
      <div class="banner"></div>
      <div class="checkered"><div class="flag"></div><div class="txt">BANDEIRA QUADRICULADA</div></div>
      <div class="raceinfo panel"><div class="head">CORRIDA</div><div class="body"></div></div>
      <div class="feed"></div>
      <div class="teamwrap"><button class="btn small teamtoggle" title="Minimizar/expandir (tecla M)"></button><div class="team"></div></div>
      <div class="mini panel"><canvas width="230" height="160"></canvas><div class="spd"></div></div>`;
    root.appendChild(this.el);
    this.board = this.el.querySelector(".board .rows")!;
    this.boardHead = this.el.querySelector(".board .head")!;
    this.info = this.el.querySelector(".raceinfo .body")!;
    this.feed = this.el.querySelector(".feed")!;
    this.top = this.el.querySelector(".topbar")!;
    this.spd = this.el.querySelector(".mini .spd")!;
    this.banner = this.el.querySelector(".banner")!;
    this.flag = this.el.querySelector(".checkered")!;
    this.minimapCanvas = this.el.querySelector(".mini canvas")!;

    this.banner.addEventListener("click", () => {
      if (this.race.sc.active && this.race.sc.onTrack) this.hooks.setFollow("SC");
    });
    this.board.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-car]");
      if (row) this.hooks.setFollow(row.dataset.car!);
    });

    this.buildTopbar();
    this.buildCards();
    const toggle = this.el.querySelector<HTMLButtonElement>(".teamtoggle")!;
    toggle.addEventListener("click", () => this.toggleCompact());
    this.applyCompact();
  }

  private compact = storeGet("pwm.compact") === "1";

  toggleCompact() {
    this.compact = !this.compact;
    storeSet("pwm.compact", this.compact ? "1" : "0");
    this.applyCompact();
  }

  private applyCompact() {
    this.el.querySelector(".team")!.classList.toggle("compact", this.compact);
    this.el.querySelector(".teamtoggle")!.textContent = this.compact ? "▲ EXPANDIR PAINEL (M)" : "▼ MINIMIZAR PAINEL (M)";
  }

  destroy() {
    this.el.remove();
  }

  private buildTopbar() {
    const host = this.hooks.isHost;
    this.top.innerHTML =
      [0, ...SPEEDS].map((s) => `<button data-speed="${s}" ${host ? "" : "disabled"}>${s === 0 ? "❚❚" : `${s}x`}</button>`).join("") +
      `<button data-skip style="display:none">PULAR P/ PÓDIO ⏭</button>`;
    this.top.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => this.hooks.setSpeed(Number(b.dataset.speed))),
    );
    this.top.querySelector("[data-skip]")!.addEventListener("click", () => this.hooks.skip());
    if (!host) this.top.title = "Só o host controla a velocidade";
  }

  private mine(): CarState[] {
    return this.race.cars.filter((c) => c.team.id === this.hooks.myTeamId);
  }

  private laps(kg: number) {
    // inverso de kg(): mostra quantas voltas completas esse combustível garante
    return Math.max(0, Math.floor((kg - 1.5) / (this.cons * 1.02) + 0.05));
  }

  private kg(laps: number) {
    return laps <= 0 ? 0 : Math.min(FUEL_MAX, Math.ceil(laps * this.cons * 1.02 + 1.5));
  }

  private buildCards() {
    const wrap = this.el.querySelector(".team")!;
    for (const c of this.mine()) {
      this.cardState.set(c.id, { next: c.compound === "H" ? "M" : "H", fuelLaps: null, planOpen: false, planSig: "", dueApplied: false });
      const card = document.createElement("div");
      card.className = "driver panel";
      card.style.borderTopColor = c.team.color;
      card.title = "Clique no card pra seguir esse piloto";
      card.innerHTML = `
        <div class="top">
          <div class="p"></div>
          <div class="nm">${esc(c.driver.name)}<small>${esc(c.team.name)}</small></div>
          <span class="tyreslot"></span>
        </div>
        <div class="mini-line"></div>
        <div class="stats">
          <div>Última<b class="last"></b></div>
          <div>Melhor<b class="best"></b></div>
          <div>À frente<b class="int"></b></div>
        </div>
        <div class="wlabel" style="font-size:12px;color:var(--muted)"></div>
        <div class="wear"><i></i></div>
        <div class="flabel" style="font-size:12px;color:var(--muted);margin:-4px 0 6px"></div>
        <div class="row2"><span class="lbl">Ritmo</span><div class="seg pace">
          ${(["push", "normal", "conserve"] as PaceMode[]).map((m) => `<button data-pace="${m}">${PACE[m].label}</button>`).join("")}
        </div></div>
        <div class="row2"><span class="lbl">Motor</span><div class="seg engine">
          ${(["rich", "normal", "lean"] as EngineMode[]).map((m) => `<button data-engine="${m}">${ENGINE[m].label}</button>`).join("")}
        </div></div>
        <div class="row2"><span class="lbl">Pneu</span><div class="seg next">
          ${ALL_COMPOUNDS.map((t) => `<button class="t${t}" data-next="${t}" title="${COMPOUNDS[t].label}">${t}</button>`).join("")}
        </div></div>
        <div class="fuelrow"><span class="lbl" style="width:46px">Comb.</span>
          <span class="stepper"><button data-fuel="-1">−</button><b class="fval"></b><button data-fuel="1">+</button></span>
          <button class="btn small" data-fuelauto>até o fim</button>
        </div>
        <button class="boxbtn"></button>
        <div class="planhead" style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px;color:var(--muted)">
          <span class="plansum"></span><button class="btn small" data-plantoggle>editar plano</button>
        </div>
        <div class="planedit" style="display:none"></div>`;
      const cs = this.cardState.get(c.id)!;
      const rearm = () => {
        // se já chamou pro box, atualiza o que vai fazer na parada
        if (c.boxRequest && c.pit !== "stopped" && c.pit !== "leaving")
          this.hooks.send({ type: "box", carId: c.id, compound: cs.next, fuel: this.fuelFor(c) });
        this.update();
      };
      // clicar em qualquer lugar do card (fora dos botões) segue o piloto
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button, input")) return;
        this.hooks.setFollow(c.id);
      });
      card.querySelectorAll<HTMLButtonElement>("[data-pace]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "pace", carId: c.id, mode: b.dataset.pace as PaceMode })),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "engine", carId: c.id, mode: b.dataset.engine as EngineMode })),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-next]").forEach((b) =>
        b.addEventListener("click", () => {
          cs.next = b.dataset.next as Compound;
          rearm();
        }),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-fuel]").forEach((b) =>
        b.addEventListener("click", () => {
          const now = cs.fuelLaps ?? this.laps(this.fuelFor(c));
          cs.fuelLaps = Math.max(0, Math.min(this.laps(FUEL_MAX), now + Number(b.dataset.fuel)));
          rearm();
        }),
      );
      card.querySelector("[data-fuelauto]")!.addEventListener("click", () => {
        cs.fuelLaps = null;
        rearm();
      });
      card.querySelector(".boxbtn")!.addEventListener("click", () => {
        if (c.pit !== "none" || c.finished || c.retired) return;
        if (c.boxRequest) this.hooks.send({ type: "cancelBox", carId: c.id });
        else this.hooks.send({ type: "box", carId: c.id, compound: cs.next, fuel: this.fuelFor(c) });
        this.update();
      });
      card.querySelector("[data-plantoggle]")!.addEventListener("click", () => {
        cs.planOpen = !cs.planOpen;
        cs.planSig = "";
        this.update();
      });
      // editor do plano (delegação: o conteúdo é redesenhado)
      card.querySelector(".planedit")!.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
        if (!b) return;
        const plan: PlannedStop[] = c.plan.slice(c.planIdx).map((s) => ({ ...s }));
        const i = Number(b.dataset.i);
        const st = plan[i];
        if (b.dataset.act === "lap" && st) st.lap = Math.max(c.lap + 1, Math.min(this.race.laps - 1, st.lap + Number(b.dataset.d)));
        if (b.dataset.act === "fuel" && st) st.fuel = this.kg(Math.max(0, this.laps(st.fuel) + Number(b.dataset.d)));
        if (b.dataset.act === "tyre" && st) st.compound = b.dataset.c as Compound;
        if (b.dataset.act === "del") plan.splice(i, 1);
        if (b.dataset.act === "add") {
          const last = plan[plan.length - 1]?.lap ?? c.lap + 1;
          const lap = Math.min(this.race.laps - 1, Math.max(c.lap + 2, last + Math.max(2, Math.round(this.race.laps * 0.25))));
          plan.push({ lap, compound: cs.next, fuel: this.kg(this.race.laps - lap) });
        }
        this.hooks.send({ type: "plan", carId: c.id, plan });
        // mostra na hora, sem esperar o servidor
        c.plan = plan.filter((s) => s.lap > c.lap).sort((a, b2) => a.lap - b2.lap);
        c.planIdx = 0;
        cs.planSig = "";
        this.update();
      });
      wrap.appendChild(card);
      this.cards.set(c.id, card);
    }
  }

  /** combustível (kg) pra colocar: o escolhido, ou o necessário pra terminar */
  private fuelFor(c: CarState): number {
    const cs = this.cardState.get(c.id)!;
    if (cs.fuelLaps !== null) return this.kg(cs.fuelLaps);
    const need = this.race.consumption(c) * this.race.lapsLeft(c) * 1.04 + 1.5 - c.fuel;
    return Math.max(0, Math.min(FUEL_MAX - c.fuel + this.race.consumption(c), Math.ceil(need)));
  }

  private renderPlan(c: CarState, card: HTMLElement, cs: CardState) {
    const upcoming = c.plan.slice(c.planIdx);
    const next = upcoming[0];
    card.querySelector(".plansum")!.textContent = next
      ? `Plano: box na volta ${next.lap} · ${COMPOUNDS[next.compound].label} · comb. p/ ${this.laps(next.fuel)} voltas${upcoming.length > 1 ? ` (+${upcoming.length - 1})` : ""}`
      : "Plano: sem paradas planejadas";
    card.querySelector<HTMLElement>("[data-plantoggle]")!.textContent = cs.planOpen ? "fechar" : "editar plano";
    const box = card.querySelector<HTMLElement>(".planedit")!;
    box.style.display = cs.planOpen ? "" : "none";
    const sig = JSON.stringify([upcoming, cs.planOpen, c.lap]);
    if (!cs.planOpen || sig === cs.planSig) return;
    cs.planSig = sig;
    box.innerHTML =
      `<div class="stops" style="margin-top:4px">` +
      upcoming
        .map(
          (s, i) => `<div class="stop" style="grid-template-columns:auto 1fr;padding:6px">
            <b>Parada ${i + 1}</b>
            <span style="display:flex;justify-content:space-between;align-items:center">
              <span>volta <span class="stepper"><button data-act="lap" data-i="${i}" data-d="-1">−</button><b>${s.lap}</b><button data-act="lap" data-i="${i}" data-d="1">+</button></span></span>
              <button class="btn small" data-act="del" data-i="${i}">cancelar</button></span>
            <span>Pneu</span><div class="seg">${ALL_COMPOUNDS.map(
              (t) => `<button class="t${t} ${t === s.compound ? "on" : ""}" data-act="tyre" data-i="${i}" data-c="${t}">${t}</button>`,
            ).join("")}</div>
            <span>Comb.</span><span class="stepper"><button data-act="fuel" data-i="${i}" data-d="-1">−</button><b>${this.laps(s.fuel)} voltas</b><button data-act="fuel" data-i="${i}" data-d="1">+</button></span>
          </div>`,
        )
        .join("") +
      `</div><button class="btn small" data-act="add" style="margin-top:6px">+ ADICIONAR PARADA</button>`;
  }

  update() {
    const race = this.race;
    const order = race.ordered();
    const follow = this.hooks.getFollow();
    const speed = this.hooks.getSpeed();
    const my = this.hooks.myTeamId;

    this.top.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.classList.toggle("on", Number(b.dataset.speed) === speed),
    );
    this.top.querySelector<HTMLElement>("[data-skip]")!.style.display = race.checkered && this.hooks.isHost ? "" : "none";

    // ---- faixas: safety car / última volta / bandeirada ----
    const leader = order[0];
    const sc = race.sc;
    this.banner.className = "banner";
    if (sc.active && !race.checkered) {
      this.banner.classList.add("sc");
      if (sc.onTrack) this.banner.classList.add("clickable");
      this.banner.textContent = sc.onTrack
        ? `${sc.lapsLeft <= 1 ? "SAFETY CAR · ENTRA NESTA VOLTA" : "SAFETY CAR"}${follow === "SC" ? "" : " · clique pra ver"}`
        : "RELARGADA NA LINHA!";
    } else if (!race.checkered && race.phase === "racing" && leader.lap === race.laps - 1) {
      this.banner.classList.add("last");
      this.banner.textContent = "ÚLTIMA VOLTA";
    }
    if (race.checkered) {
      this.checkeredSeen ??= performance.now();
      const showFlag = performance.now() - this.checkeredSeen < 5000;
      this.flag.classList.toggle("on", showFlag);
      if (!showFlag) {
        this.banner.className = "banner last";
        this.banner.textContent = "VOLTA DE DESACELERAÇÃO · PILOTOS VOLTANDO PRO BOX";
      }
    }
    this.boardHead.classList.toggle("sc", sc.active && !race.checkered);

    // ---- classificação ----
    const gaps = order.map((c) => race.gapToLeader(c));
    const fl = race.fastestLap;
    this.el.querySelector(".board .lapc")!.textContent = race.checkered ? "🏁 FINAL" : `VOLTA ${race.currentLap()}/${race.laps}`;
    this.el.querySelector(".board .hl")!.textContent = sc.active && !race.checkered ? "SAFETY CAR" : "POS";
    this.board.innerHTML = order
      .map((c, i) => {
        let gap: string;
        let cls = "";
        if (c.retired) {
          gap = "OUT";
          cls = "out";
        } else if (c.pit !== "none" && c.pit !== "parked" && !c.finished) {
          gap = "BOX";
          cls = "pit";
        } else if (c.spin > 0) {
          gap = "RODOU";
          cls = "out";
        } else if (i === 0) gap = race.phase === "lights" ? "" : c.finished ? "🏁" : "Líder";
        else if (gaps[i].laps > 0) gap = `+${gaps[i].laps} V`;
        else gap = `+${gaps[i].seconds.toFixed(1)}`;
        if (race.phase === "lights") gap = "";
        const lt = c.lastLap;
        const ltCls = lt && fl && Math.abs(lt - fl.time) < 1e-6 ? "fl" : lt && c.bestLap && Math.abs(lt - c.bestLap) < 1e-6 ? "pb" : "";
        return `<div class="row ${c.team.id === my ? "player" : ""} ${c.id === follow ? "follow" : ""}" data-car="${c.id}" title="${esc(c.team.name)}">
          <span class="pos">${c.position}</span>
          <span class="bar" style="background:${c.team.color}"></span>
          <span class="name">${surname(c.driver.name)}</span>
          <span class="gap ${cls}">${gap}</span>
          <span class="lt ${ltCls}">${lt ? fmtShort(lt) : ""}</span>
          ${tyreIcon(c.compound, `${COMPOUNDS[c.compound].label} · ${c.tyreLaps} voltas`)}
        </div>`;
      })
      .join("");

    // ---- info ----
    const fc = race.cars.find((c) => c.id === follow);
    const flCar = fl ? race.cars.find((c) => c.id === fl.carId) : null;
    const rainTxt = race.rain > 0.6 ? "🌧 Chuva forte" : race.rain > 0 ? "🌦 Chuva" : race.wet > 0.05 ? "☁ Secando" : "☀ Seco";
    this.info.innerHTML = `
      <span>Volta</span><span>${race.currentLap()} / ${race.laps}</span>
      <span>Tempo</span><span>${race.phase === "lights" ? "--" : fmtClock(race.time)}</span>
      <span>Melhor</span><span>${fl && flCar ? `${flCar.driver.short} ${fmtLap(fl.time)}` : "--"}</span>
      <span>Clima</span><span>${rainTxt}</span>
      <span>Pista</span><span class="weather"><span class="wetbar"><i style="width:${Math.round(race.wet * 100)}%"></i></span>${Math.round(race.wet * 100)}%</span>
      <span style="grid-column:1/-1;color:var(--muted);font-size:11px;line-height:1.3">${esc(wetLabel(race.wet))} · Previsão: ${esc(forecastText(race.weather))}</span>`;
    this.spd.innerHTML = fc
      ? `${Math.round(fc.v * 3.6)} <small>KM/H ${fc.driver.short}</small>`
      : `${Math.round(race.sc.v * 3.6)} <small>KM/H SAFETY CAR</small>`;

    // ---- feed (só eventos gerais ou da minha equipe) ----
    if (race.events.length !== this.feedCount) {
      this.feedCount = race.events.length;
      this.feed.innerHTML = race.events
        .filter((e) => !e.teamId || e.teamId === my)
        .slice(-6)
        .reverse()
        .map((e) => `<div class="${e.important ? "imp" : ""}">${esc(e.text)}</div>`)
        .join("");
    }

    // ---- cards do jogador ----
    for (const [id, card] of this.cards) {
      const c = race.cars.find((x) => x.id === id)!;
      const cs = this.cardState.get(id)!;
      const idx = order.indexOf(c);
      card.classList.toggle("follow", id === follow);
      // chegou a volta da parada planejada: já deixa pneu e combustível do plano escolhidos
      if (c.planDue && !cs.dueApplied) {
        const st = c.plan[c.planIdx];
        if (st) {
          cs.next = st.compound;
          cs.fuelLaps = this.laps(st.fuel);
        }
        cs.dueApplied = true;
      } else if (!c.planDue) cs.dueApplied = false;
      card.querySelector(".mini-line")!.innerHTML =
        `${tyreIcon(c.compound)} ${Math.round((1 - Math.min(1, c.wear)) * 100)}% · comb. ${(c.fuel / race.consumption(c)).toFixed(1)} v` +
        (c.planDue ? ` · <b style="color:var(--warn)">PLANO: BOX</b>` : "");
      card.querySelector(".p")!.textContent = c.retired ? "OUT" : `P${c.position}`;
      card.querySelector(".tyreslot")!.innerHTML = tyreIcon(c.compound);
      card.querySelector(".last")!.textContent = c.lastLap ? fmtLap(c.lastLap) : "--";
      card.querySelector(".best")!.textContent = c.bestLap ? fmtLap(c.bestLap) : "--";
      card.querySelector(".int")!.textContent =
        idx <= 0 ? "--" : gaps[idx].laps > 0 ? `+${gaps[idx].laps} V` : `+${Math.max(0, gaps[idx].seconds - gaps[idx - 1].seconds).toFixed(1)}s`;
      const wearPct = Math.min(1, c.wear);
      const bar = card.querySelector<HTMLElement>(".wear i")!;
      bar.style.width = `${(1 - wearPct) * 100}%`;
      bar.style.background = wearPct > 0.8 ? "var(--soft)" : wearPct > 0.6 ? "var(--warn)" : "var(--ok)";
      const dryKinds = new Set(c.usedCompounds.filter((x) => x === "S" || x === "M" || x === "H")).size;
      const ruleOk = dryKinds >= 2 || c.usedCompounds.some((x) => x === "I" || x === "W");
      card.querySelector(".wlabel")!.textContent =
        `Pneu ${COMPOUNDS[c.compound].label} · ${c.tyreLaps} ${c.tyreLaps === 1 ? "volta" : "voltas"} · ${Math.round((1 - wearPct) * 100)}% de borracha` +
        (ruleOk ? "" : " · falta usar o 2º tipo de pneu!");
      const cons = race.consumption(c);
      const fuelLaps = c.fuel / cons;
      const left = race.lapsLeft(c);
      const short = fuelLaps < left && !c.finished;
      const fl2 = card.querySelector<HTMLElement>(".flabel")!;
      fl2.textContent = `Combustível pra ${fuelLaps.toFixed(1)} voltas (${c.fuel.toFixed(0)} kg) · faltam ${left.toFixed(1)}${short ? "" : " ✓ chega"}`;
      fl2.style.color = short && fuelLaps < 3 ? "var(--soft)" : short ? "var(--warn)" : "var(--muted)";
      card.querySelectorAll<HTMLButtonElement>("[data-pace]").forEach((b) => b.classList.toggle("on", b.dataset.pace === c.pace));
      card.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => b.classList.toggle("on", b.dataset.engine === c.engine));
      const next = c.boxRequest ?? cs.next;
      card.querySelectorAll<HTMLButtonElement>("[data-next]").forEach((b) => b.classList.toggle("on", b.dataset.next === next));
      const fuelShown = c.boxRequest ? c.boxFuel : this.fuelFor(c);
      card.querySelector(".fval")!.textContent = `p/ ${this.laps(fuelShown)} v`;
      card.querySelector<HTMLElement>("[data-fuelauto]")!.classList.toggle("primary", cs.fuelLaps === null);
      this.renderPlan(c, card, cs);

      const box = card.querySelector<HTMLButtonElement>(".boxbtn")!;
      box.className = "boxbtn";
      box.disabled = false;
      if (c.retired) {
        box.textContent = `FORA: ${c.retireReason ?? ""}`.toUpperCase();
        box.disabled = true;
      } else if (c.finished) {
        box.textContent = c.pit === "parked" ? "🏁 NA GARAGEM" : "🏁 FINALIZOU · VOLTANDO PRO BOX";
        box.disabled = true;
      } else if (c.pit === "stopped") {
        box.textContent = `TROCANDO PNEUS / ABASTECENDO... ${Math.max(0, c.pitTimer).toFixed(1)}s`;
        box.classList.add("inpit");
      } else if (c.pit !== "none") {
        box.textContent = "NO PIT LANE";
        box.classList.add("inpit");
      } else if (c.boxRequest) {
        box.textContent = `BOX, BOX! (${COMPOUNDS[c.boxRequest].label}, comb. p/ ${this.laps(c.boxFuel)} v) · cancelar`;
        box.classList.add("armed");
      } else if (c.planDue) {
        box.textContent = `PLANO: PARAR NESTA VOLTA? (${COMPOUNDS[cs.next].label}, comb. p/ ${this.laps(this.fuelFor(c))} v)`;
        box.classList.add("suggest");
      } else {
        box.textContent = race.sc.active ? "CHAMAR PRO BOX (safety car = parada barata!)" : "CHAMAR PRO BOX";
      }
    }
  }
}

function surname(n: string): string {
  const parts = n.split(" ");
  return esc(`${parts[0][0]}. ${parts.slice(1).join(" ")}`);
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 1:08.4 */
function fmtShort(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}
