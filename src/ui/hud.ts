import { fmtLap, fuelPerLap, tyreTempLabel, type Race } from "../sim/race";
import {
  ALL_COMPOUNDS,
  COMPOUNDS,
  ENGINE,
  FAULTS,
  FUEL_MAX,
  PACE,
  type CarState,
  type Command,
  type Compound,
  type EngineMode,
  type PaceMode,
  type PlannedStop,
  type TeamOrder,
} from "../sim/types";
import { forecastText } from "../sim/weather";
import { confirmDialog } from "./confirm";
import { OnboardCam } from "../render/onboard";
import { bindParts, partsListHtml, statusSvg, updateStatus } from "./carStatus";
import { esc, storeGet, storeSet, tyreIcon, wetLabel } from "./common";

export const SPEEDS = [1, 2, 4, 8, 16];

export interface HudHooks {
  myTeamId: string;
  /** modo online: mostra o engenheiro (jogador) ao lado dos pilotos dele */
  online?: boolean;
  isHost: boolean;
  getFollow(): string;
  setFollow(id: string): void;
  getSpeed(): number; // 0 = pausado
  setSpeed(s: number): void;
  send(cmd: Command): void;
  skip(): void;
  exit(): void;
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
  /** linhas da classificação (fixas por carro: só mudam de lugar quando a ordem muda, aí deslizam) */
  private rowEls = new Map<string, HTMLElement & { _h?: string }>();
  private boardSig = "";
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
      <div class="board panel"><div class="head"><span class="hl">POS</span><span class="lapc"></span><button class="boardmin" title="Minimizar/expandir posições (tecla P)"></button></div>
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
    this.el.querySelector(".boardmin")!.addEventListener("click", () => this.toggleBoard());
    this.applyBoard();
    // pointerdown: a tabela é redesenhada várias vezes por segundo e o "click" se perdia
    this.board.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
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
  private boardMini = storeGet("pwm.boardmini") === "1";

  /** tabela de posições minimizada: só posição, sigla e gap */
  toggleBoard() {
    this.boardMini = !this.boardMini;
    storeSet("pwm.boardmini", this.boardMini ? "1" : "0");
    const board = this.el.querySelector<HTMLElement>(".board")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const w0 = board.getBoundingClientRect().width;
    this.applyBoard();
    if (reduce) return;
    // a largura vai do tamanho antigo pro novo (em vez de pular) e as linhas entram em cascata,
    // com um desfoque curto que esconde a troca das colunas
    const w1 = board.getBoundingClientRect().width;
    board.animate([{ width: `${w0}px` }, { width: `${w1}px` }], { duration: 380, easing: "cubic-bezier(0.77, 0, 0.175, 1)" });
    const head = board.querySelector<HTMLElement>(".head");
    head?.animate([{ opacity: 0.4, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 300, easing: "ease-out" });
    const dir = this.boardMini ? 10 : -10;
    board.querySelectorAll<HTMLElement>(".colhead, .rows .row").forEach((r, i) =>
      r.animate([{ opacity: 0, transform: `translateX(${dir}px)`, filter: "blur(2px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], {
        duration: 320,
        delay: 60 + Math.min(i, 20) * 14,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "backwards",
      }),
    );
  }

  private applyBoard() {
    this.el.querySelector(".board")!.classList.toggle("compactb", this.boardMini);
    const b = this.el.querySelector(".boardmin")!;
    b.textContent = this.boardMini ? "▸" : "◂";
  }

  toggleCompact() {
    this.compact = !this.compact;
    storeSet("pwm.compact", this.compact ? "1" : "0");
    this.applyCompact(true);
  }

  private animT: ReturnType<typeof setTimeout> | null = null;

  /** minimiza/expande o painel deslizando (a câmera da pista acompanha, ver coverHeight) */
  private applyCompact(animate = false) {
    const team = this.el.querySelector<HTMLElement>(".team")!;
    this.el.querySelector(".teamtoggle")!.textContent = this.compact ? "▲ EXPANDIR PAINEL (M)" : "▼ MINIMIZAR PAINEL (M)";
    if (!animate) {
      team.classList.toggle("compact", this.compact);
      return;
    }
    if (this.animT) clearTimeout(this.animT);
    const from = team.offsetHeight;
    // mede a altura final com o conteúdo do outro modo
    team.style.height = "";
    team.classList.toggle("compact", this.compact);
    const to = team.offsetHeight;
    // expandindo: conteúdo grande já aparece e vai sendo revelado; minimizando: o grande desce e só no fim vira o compacto
    if (this.compact) team.classList.remove("compact");
    team.style.overflow = "hidden";
    team.style.height = `${from}px`;
    void team.offsetHeight;
    team.style.transition = "height .38s cubic-bezier(.3,.8,.3,1)";
    team.style.height = `${Math.max(to, this.compact ? to : 0)}px`;
    this.animT = setTimeout(() => {
      team.classList.toggle("compact", this.compact);
      team.style.transition = "";
      team.style.height = "";
      team.style.overflow = "";
      this.animT = null;
    }, 400);
  }

  /** quanto da tela (de baixo pra cima) o painel cobre agora, em px */
  coverHeight(): number {
    const w = this.el.querySelector<HTMLElement>(".teamwrap");
    if (!w) return 0;
    return Math.max(0, window.innerHeight - w.getBoundingClientRect().top);
  }

  destroy() {
    this.closeOnboard();
    this.el.remove();
  }

  // ---------- câmera onboard ----------

  private cam: OnboardCam | null = null;
  private smallAcc = 0;
  private smallTurn = 0;
  private smallLast = new Map<string, number>();
  private full: { el: HTMLElement; cv: HTMLCanvasElement; id: string; onKey: (e: KeyboardEvent) => void } | null = null;

  /** chamado a cada quadro pela tela da corrida */
  drawOnboard(dt: number, interp: Map<string, { s: number; lat: number }>) {
    this.cam ??= new OnboardCam(this.race);
    const paint = (cv: HTMLCanvasElement, id: string, dpr: number, step: number) => {
      const car = this.race.cars.find((c) => c.id === id);
      if (!car) return;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const p = interp.get(id);
      this.cam!.draw(g, w, h, car, p?.s ?? car.s, p?.lat ?? car.lateral, step, interp);
    };
    if (this.full) {
      paint(this.full.cv, this.full.id, Math.min(2, window.devicePixelRatio || 1), dt);
      this.fullInfo();
      return;
    }
    // telinhas pequenas: uma por vez, ~15 quadros por segundo cada, sem alta resolução
    // (a corrida em si precisa do quadro inteiro pra rodar a 144 Hz)
    const mine = this.mine();
    if (!mine.length) return;
    this.smallAcc += dt;
    if (this.smallAcc < 1 / (15 * mine.length)) return;
    this.smallAcc = 0;
    this.smallTurn = (this.smallTurn + 1) % mine.length;
    const c = mine[this.smallTurn];
    const now = performance.now();
    const last = this.smallLast.get(c.id) ?? now - 66;
    this.smallLast.set(c.id, now);
    const cv = this.el.querySelector<HTMLCanvasElement>(`.driver[data-id="${c.id}"] [data-onboard] canvas`);
    if (cv) paint(cv, c.id, 1, Math.min(0.2, (now - last) / 1000));
  }

  private openOnboard(id: string) {
    this.closeOnboard();
    const el = document.createElement("div");
    el.className = "onfull";
    el.innerHTML = `<canvas></canvas><div class="oninfo"></div><button class="btn small onclose">✕ FECHAR (ESC)</button><div class="onpanel"></div>`;
    document.body.appendChild(el);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.closeOnboard();
      } else if (e.key === "Tab") {
        // alterna entre os seus carros
        e.preventDefault();
        e.stopPropagation();
        const mine = this.mine();
        const i = mine.findIndex((c) => c.id === this.full?.id);
        if (this.full && mine.length) {
          this.full.id = mine[(i + 1) % mine.length].id;
          this.dockCard(this.full.id);
          this.hooks.setFollow(this.full.id);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    // fecha clicando na imagem ou no botão (o painel do carro funciona normal)
    el.querySelector("canvas")!.addEventListener("click", () => this.closeOnboard());
    el.querySelector(".onclose")!.addEventListener("click", () => this.closeOnboard());
    this.full = { el, cv: el.querySelector("canvas")!, id, onKey };
    this.dockCard(id);
    this.hooks.setFollow(id);
  }

  /** o card do carro vai pra tela cheia (com todos os controles) e volta depois */
  private docked: { card: HTMLElement; parent: HTMLElement; next: Node | null } | null = null;

  private dockCard(id: string) {
    this.undockCard();
    const card = this.cards.get(id);
    if (!card || !this.full) return;
    this.docked = { card, parent: card.parentElement!, next: card.nextSibling };
    this.full.el.querySelector(".onpanel")!.appendChild(card);
  }

  private undockCard() {
    const d = this.docked;
    if (!d) return;
    d.parent.insertBefore(d.card, d.next && d.next.parentNode === d.parent ? d.next : null);
    this.docked = null;
  }

  private closeOnboard() {
    if (!this.full) return;
    this.undockCard();
    window.removeEventListener("keydown", this.full.onKey, true);
    this.full.el.remove();
    this.full = null;
  }

  private fullInfo() {
    const f = this.full!;
    const c = this.race.cars.find((x) => x.id === f.id);
    if (!c) return;
    const lap = Math.min(this.race.laps, Math.max(1, c.lap + 1));
    f.el.querySelector(".oninfo")!.innerHTML = `<b style="border-color:${c.team.color}">P${c.position}</b><span>${esc(c.driver.name)}</span><span>VOLTA ${lap}/${this.race.laps}</span><span>${Math.round(c.v * 3.6)} KM/H</span>${this.mine().length > 1 ? "<span class=hint>Tab troca de carro</span>" : ""}`;
  }

  private buildTopbar() {
    const host = this.hooks.isHost;
    this.top.innerHTML =
      [0, ...SPEEDS].map((s) => `<button data-speed="${s}" ${host ? "" : "disabled"}>${s === 0 ? "❚❚" : `${s}x`}</button>`).join("") +
      `<button data-skip style="display:none">PULAR P/ PÓDIO ⏭</button><button data-exit title="${host ? "Encerrar a corrida e voltar pro lobby" : "Sair da sala"}">✕ SAIR</button>`;
    this.top.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => this.hooks.setSpeed(Number(b.dataset.speed))),
    );
    this.top.querySelector("[data-skip]")!.addEventListener("click", () => this.hooks.skip());
    this.top.querySelector("[data-exit]")!.addEventListener("click", async () => {
      const ok = await confirmDialog(
        host
          ? { title: "SAIR DA CORRIDA", icon: "✕", text: "Encerrar a corrida e voltar pro lobby?\nO resultado não vale (e o campeonato é cancelado).", ok: "ENCERRAR", danger: true }
          : { title: "SAIR DA SALA", icon: "✕", text: "Sair da sala?\nA IA assume a sua equipe até o fim da corrida.", ok: "SAIR", danger: true },
      );
      if (ok) this.hooks.exit();
    });
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
      card.dataset.id = c.id;
      card.style.borderTopColor = c.team.color;
      card.title = "Clique no card pra seguir esse piloto";
      card.innerHTML = `
        <div class="statuscol"><div class="onbox" data-onboard title="Câmera onboard: clique pra tela cheia"><canvas></canvas><span>ONBOARD</span><i>⛶</i></div>${statusSvg()}${partsListHtml()}</div>
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
        <div class="faultlabel"></div>
        <div class="row2"><span class="lbl">Ritmo</span><div class="seg pace">
          ${(["push", "normal", "conserve"] as PaceMode[]).map((m) => `<button data-pace="${m}">${PACE[m].label}</button>`).join("")}
        </div></div>
        <div class="row2"><span class="lbl">Motor</span><div class="seg engine">
          ${(["rich", "normal", "lean"] as EngineMode[]).map((m) => `<button data-engine="${m}">${ENGINE[m].label}</button>`).join("")}
        </div></div>
        <div class="row2"><span class="lbl">Equipe</span><div class="seg order">
          <button data-order="letPass" title="Este carro abre espaço e deixa o companheiro de equipe passar">Deixar passar</button><button data-order="hold" title="Os dois carros da equipe não brigam entre si">Manter</button><button data-order="none" title="Os dois podem brigar normalmente">Livre</button>
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
      bindParts(card, c.id, (cmd) => this.hooks.send(cmd));
      card.querySelector("[data-onboard]")!.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openOnboard(c.id);
      });
      const rearm = () => {
        // se já chamou pro box, atualiza o que vai fazer na parada
        if (c.boxRequest && c.pit !== "stopped" && c.pit !== "leaving")
          this.hooks.send({ type: "box", carId: c.id, compound: cs.next, fuel: this.fuelFor(c) });
        this.update();
      };
      // clicar em qualquer lugar do card (fora dos botões) segue o piloto
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button, input, label")) return;
        this.hooks.setFollow(c.id);
      });
      card.querySelectorAll<HTMLButtonElement>("[data-pace]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "pace", carId: c.id, mode: b.dataset.pace as PaceMode })),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "engine", carId: c.id, mode: b.dataset.engine as EngineMode })),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-order]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "order", carId: c.id, mode: b.dataset.order as TeamOrder })),
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
    // ordem mudou? (mede onde cada linha estava pra deslizar até o lugar novo)
    const sig = order.map((c) => c.id).join(",");
    const reordered = sig !== this.boardSig;
    const before = reordered && this.boardSig ? new Map([...this.rowEls].map(([id, el]) => [id, el.getBoundingClientRect().top])) : null;
    const prevPos = reordered ? new Map(this.boardSig.split(",").map((id, i) => [id, i])) : null;
    order.forEach((c, i) => {
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
        const html = `          <span class="pos">${c.position}</span>
          <span class="bar" style="background:${c.team.color}"></span>
          <span class="code">${esc(c.driver.short)}</span>
          <span class="name">${surname(c.driver.name)}${this.hooks.online && c.isHuman ? ` <span class="eng">(${esc(race.engineers[c.team.id]?.name ?? "")})</span>` : ""}</span>
          <span class="gap ${cls}">${gap}</span>
          <span class="lt ${ltCls}">${lt ? fmtShort(lt) : ""}</span>
          ${tyreIcon(c.compound, `${COMPOUNDS[c.compound].label} · ${c.tyreLaps} voltas`)}`;
      let el = this.rowEls.get(c.id);
      if (!el) {
        el = document.createElement("div");
        el.dataset.car = c.id;
        this.rowEls.set(c.id, el);
      }
      const rowCls = `row ${c.team.id === my ? "player" : ""} ${c.id === follow ? "follow" : ""}`;
      if (el.className !== rowCls) el.className = rowCls;
      if (el.title !== c.team.name) el.title = c.team.name;
      if (el._h !== html) {
        el.innerHTML = html;
        el._h = html;
      }
    });
    if (reordered) {
      for (const c of order) this.board.appendChild(this.rowEls.get(c.id)!);
      this.boardSig = sig;
      if (before && prevPos && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        order.forEach((c, i) => {
          const el = this.rowEls.get(c.id)!;
          const was = before.get(c.id);
          const dy = was === undefined ? 0 : was - el.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) return;
          // desliza da posição antiga pra nova (ease-out forte)
          el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 420, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
          // ganhou posição = verde, perdeu = vermelho (curto, volta ao normal)
          const gained = (prevPos.get(c.id) ?? i) > i;
          const col = gained ? "59,209,111" : "255,59,59";
          el.animate([{ boxShadow: `inset 0 0 0 999px rgba(${col},.32)` }, { boxShadow: `inset 0 0 0 999px rgba(${col},0)` }], { duration: 900, easing: "ease-out" });
          // carro da sua equipe ganhou posição: o "P" do painel dele dá um pulinho
          if (gained && c.team.id === my) {
            const pEl = this.el.querySelector<HTMLElement>(`.driver[data-id="${c.id}"] .p`);
            pEl?.animate([{ transform: "scale(1.35)", color: "#3bd16f" }, { transform: "scale(1)" }], { duration: 480, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
          }
        });
      }
    }
    // carros que saíram da lista (não acontece numa corrida, mas por garantia)
    if (this.rowEls.size > order.length) for (const [id, el] of this.rowEls) if (!sig.includes(id)) { el.remove(); this.rowEls.delete(id); }

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
      updateStatus(card.querySelector(".statuscol")!, c, race);
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
      // temperatura do pneu (frio / ideal / quente) e ar sujo
      const tt = tyreTempLabel(c.tyreTemp ?? 0.6);
      const ttTxt = tt === "frio" ? "🥶 pneu frio" : tt === "quente" ? "🔥 pneu quente" : "🌡 temperatura ideal";
      card.querySelector(".wlabel")!.innerHTML =
        esc(`Pneu ${COMPOUNDS[c.compound].label} · ${c.tyreLaps} ${c.tyreLaps === 1 ? "volta" : "voltas"} · ${Math.round((1 - wearPct) * 100)}% de borracha`) +
        ` · <span class="tt ${tt}" title="Temperatura do pneu: ${Math.round((c.tyreTemp ?? 0) * 100)}%">${ttTxt}</span>` +
        (c.dirtyAir && !c.finished ? ` · <span class="tt dirty" title="Colado atrás de outro carro: perde aderência nas curvas e o pneu esquenta">💨 ar sujo</span>` : "") +
        (ruleOk ? "" : " · falta usar o 2º tipo de pneu!") +
        (c.damage > 0 ? ` · ⚠ dano: +${c.damage.toFixed(1)}s/volta` : "");
      const cons = race.consumption(c);
      const fuelLaps = c.fuel / cons;
      const left = race.lapsLeft(c);
      const short = fuelLaps < left && !c.finished;
      const fl2 = card.querySelector<HTMLElement>(".flabel")!;
      fl2.textContent = `Combustível pra ${fuelLaps.toFixed(1)} voltas (${c.fuel.toFixed(0)} kg) · faltam ${left.toFixed(1)}${short ? "" : " ✓ chega"}`;
      fl2.style.color = short && fuelLaps < 3 ? "var(--soft)" : short ? "var(--warn)" : "var(--muted)";
      const fault = c.fault && !c.retired ? FAULTS[c.fault] : null;
      card.querySelector(".faultlabel")!.textContent = fault ? `⚠ ${fault.label} (+${c.faultPen.toFixed(1)}s/volta) · ${fault.fix}` : "";
      card.querySelectorAll<HTMLButtonElement>("[data-pace]").forEach((b) => {
        b.classList.toggle("on", b.dataset.pace === c.pace);
        b.disabled = !!c.engineSave && b.dataset.pace === "push";
        b.title = b.disabled ? "Desligado enquanto poupa o motor" : "";
      });
      card.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => {
        b.classList.toggle("on", b.dataset.engine === c.engine);
        b.disabled = !!c.engineSave && b.dataset.engine === "rich";
        b.title = b.disabled ? "Desligado enquanto poupa o motor" : "";
      });
      const mate = race.cars.find((o) => o !== c && o.team.id === c.team.id);
      const mateBehind = !!mate && !mate.retired && !mate.finished && race.dist(mate) < race.dist(c);
      card.querySelectorAll<HTMLButtonElement>("[data-order]").forEach((b) => {
        const m = b.dataset.order;
        b.classList.toggle("on", m === c.order);
        b.disabled = c.retired || c.finished || !mate || mate.retired || (m === "letPass" && !mateBehind && c.order !== "letPass");
      });
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
