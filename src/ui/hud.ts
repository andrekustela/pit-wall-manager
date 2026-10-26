import { confirmDialog } from "./confirm";
import { fmtLap, fuelPerLap, tyreTempLabel, type Race } from "../sim/race";
import { mountWavingFlag } from "./checkerFlag";
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
  /** liga/desliga o modo TV (câmera corta sozinha pras disputas); devolve se ficou ligado */
  toggleTv?(): boolean;
}

interface CardState {
  next: Compound;
  /** voltas de combustível pra colocar; null = automático (o necessário pra terminar) */
  fuelLaps: number | null;
  planOpen: boolean;
  planSig: string;
  dueApplied: boolean;
  /** aba do card: pilotagem (ritmo, motor, ordens) ou box (pneu, combustível, peças, plano) */
  tab: "race" | "box";
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

  /** botão do modo TV aceso/apagado */
  setTv(on: boolean) {
    this.top.querySelector("[data-tv]")?.classList.toggle("on", on);
  }

  /** mensagem sua no feed (some em 8 s) */
  note(text: string) {
    this.notes.push({ text, at: performance.now() });
    while (this.notes.length > 2) this.notes.shift();
    this.feedCount = -1;
  }

  /** linha fixa no topo do feed (null tira) */
  pin(text: string | null) {
    if (this.pinned === text) return;
    this.pinned = text;
    this.feedCount = -1;
  }
  private top: HTMLElement;
  private spd: HTMLElement;
  private banner: HTMLElement;
  private flag: HTMLElement;
  private cards = new Map<string, HTMLElement>();
  private cardState = new Map<string, CardState>();
  private feedCount = -1;
  /** linhas só desta tela no feed (ex.: o que o comando de voz entendeu), somem sozinhas */
  private notes: { text: string; at: number }[] = [];
  /** linha fixa no topo do feed (ex.: "🎙 OUVINDO...") */
  private pinned: string | null = null;
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
      <div class="checkered"><canvas class="flag"></canvas><div class="txt">BANDEIRA QUADRICULADA</div></div>
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
    mountWavingFlag(this.flag.querySelector("canvas")!);
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

  /** minimiza/expande o painel. Troca na hora e só anima transparência e posição (mexer na altura a
   * cada quadro fazia o navegador recalcular a página inteira e a corrida engasgava) */
  private applyCompact(animate = false) {
    const team = this.el.querySelector<HTMLElement>(".team")!;
    this.el.querySelector(".teamtoggle")!.textContent = this.compact ? "▲ EXPANDIR PAINEL (M)" : "▼ MINIMIZAR PAINEL (M)";
    team.classList.toggle("compact", this.compact);
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      team.animate([{ opacity: 0.25, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.23, 1, .32, 1)" });
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
      [0, ...SPEEDS].map((s, i) => `<button data-speed="${s}" ${host ? "" : "disabled"} title="${s === 0 ? "Pausar (Espaço)" : `${s}x (tecla ${i})`}">${s === 0 ? "❚❚" : `${s}x`}</button>`).join("") +
      // sair da corrida: botão ⌂ do canto
      `<button data-tv title="Modo TV: a câmera corta sozinha pras disputas (T)">📺 TV</button><button data-skip style="display:none">PULAR P/ PÓDIO ⏭</button>`;
    this.top.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => this.hooks.setSpeed(Number(b.dataset.speed))),
    );
    this.top.querySelector("[data-skip]")!.addEventListener("click", () => this.hooks.skip());
    const tv = this.top.querySelector<HTMLButtonElement>("[data-tv]")!;
    tv.addEventListener("click", () => this.setTv(this.hooks.toggleTv?.() ?? false));
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
      this.cardState.set(c.id, { next: c.compound === "H" ? "M" : "H", fuelLaps: null, planOpen: false, planSig: "", dueApplied: false, tab: "race" });
      const card = document.createElement("div");
      card.className = "driver panel";
      card.dataset.id = c.id;
      card.style.borderTopColor = c.team.color;
      card.innerHTML = `
        <div class="statuscol"><div class="onbox" data-onboard title="Câmera onboard: clique pra tela cheia"><canvas></canvas><span>ONBOARD</span><i>⛶</i></div>${statusSvg()}<div class="stats colstats"><div>Última<b class="last"></b></div><div>Melhor<b class="best"></b></div></div>${partsListHtml()}<button class="btn small retirebtn" data-retire title="O carro entra no box e vai pra garagem (sai da corrida)">🏳 ABANDONAR</button></div>
        <div class="top">
          <div class="p"></div>
          <div class="nm" title="Clique no card pra seguir esse piloto">${esc(c.driver.name)}<small>${esc(c.team.name)} · <span class="lapn"></span></small></div>
          <div class="gapsbox" title="Distância pro carro da frente e pro de trás"><div><span>FRENTE</span><b class="gf"></b></div><div><span>ATRÁS</span><b class="gb"></b></div></div>
        </div>
        <div class="mini-line chips"></div>
        <div class="calert" hidden></div>
        <div class="ctabs"><button data-tab="race" title="Ritmo, motor e ordens de equipe: atacar, defender, poupar">⚔ PILOTAGEM</button><button data-tab="box" title="Pneu, combustível, peças e plano de paradas">🔧 BOX</button></div>
        <div class="pane" data-pane="race">
        <div class="row2"><span class="lbl">Ritmo</span><div class="seg pace">
          ${(["push", "normal", "conserve"] as PaceMode[]).map((m, i) => `<button data-pace="${m}" title="Atalho: ${"QWE"[i]} (no piloto seguido)">${PACE[m].label}<kbd>${"QWE"[i]}</kbd></button>`).join("")}
        </div></div>
        <div class="row2"><span class="lbl">Motor</span><div class="seg engine">
          ${(["rich", "normal", "lean"] as EngineMode[]).map((m, i) => `<button data-engine="${m}" title="Atalho: ${"ZXC"[i]} (no piloto seguido)">${ENGINE[m].label}<kbd>${"ZXC"[i]}</kbd></button>`).join("")}
        </div></div>
        <div class="row2"><span class="lbl">Equipe</span><div class="seg order">
          <button data-order="letPass" title="Este carro abre espaço e deixa o companheiro de equipe passar">Deixar passar</button><button data-order="hold" title="Os dois carros da equipe não brigam entre si">Manter</button><button data-order="none" title="Os dois podem brigar normalmente">Livre</button>
        </div></div>
        </div>
        <div class="pane" data-pane="box">
        <div class="row2"><span class="lbl">Pneu</span><div class="seg next">
          ${ALL_COMPOUNDS.map((t) => `<button class="t${t}" data-next="${t}" title="${COMPOUNDS[t].label}">${t}</button>`).join("")}
        </div></div>
        <div class="fuelrow"><span class="lbl" style="width:46px">Comb.</span>
          <span class="stepper"><button data-fuel="-1">−</button><b class="fval"></b><button data-fuel="1">+</button></span>
          <button class="btn small" data-fuelauto>até o fim</button>
        </div>
        <div class="planhead" style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:12px;color:var(--muted)">
          <span class="plansum"></span><button class="btn small" data-plantoggle>editar plano</button>
        </div>
        <div class="planedit" style="display:none"></div>
        </div>
        <div class="boxrow"><button class="boxbtn"></button></div>
        <div hidden><div class="wlabel"></div><div class="wear"><i></i></div><div class="flabel"></div><div class="faultlabel"></div></div>`;
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
      card.querySelector("[data-retire]")!.addEventListener("click", async () => {
        if (c.finished || c.retired) return;
        if (c.retireAtBox) {
          this.hooks.send({ type: "retire", carId: c.id, on: false });
          this.update();
          return;
        }
        const ok = await confirmDialog({
          title: "ABANDONAR",
          icon: "🏳",
          text: `Tirar ${c.driver.name} da corrida?\n\nEle entra no box na próxima passagem e vai pra garagem. Dá pra desistir até ele entrar no box.`,
          ok: "ABANDONAR",
        });
        if (ok) this.hooks.send({ type: "retire", carId: c.id, on: true });
        this.update();
      });
      const setTab = (t: CardState["tab"]) => {
        cs.tab = t;
        this.applyTab(card, cs);
      };
      card.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab as CardState["tab"])));
      this.applyTab(card, cs);
      // botão do alerta: a ação certa pro problema mais urgente
      card.querySelector(".calert")!.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
        if (!b) return;
        const a = b.dataset.act;
        if (a === "box" && c.pit === "none" && !c.boxRequest) this.hooks.send({ type: "box", carId: c.id, compound: cs.next, fuel: this.fuelFor(c) });
        if (a === "save") {
          this.hooks.send({ type: "engine", carId: c.id, mode: "lean" });
          this.hooks.send({ type: "pace", carId: c.id, mode: "conserve" });
        }
        if (a === "cool") this.hooks.send({ type: "pace", carId: c.id, mode: "conserve" });
        if (a === "push") this.hooks.send({ type: "pace", carId: c.id, mode: "push" });
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

  /** topo do card: distâncias, chips (pneu, combustível, danos), um alerta por vez e o resumo da parada */
  private renderTop(c: CarState, card: HTMLElement, cs: CardState, idx: number, order: CarState[], gaps: { laps: number; seconds: number }[]) {
    const race = this.race;
    const set = (sel: string, html: string) => {
      const el = card.querySelector<HTMLElement>(sel)!;
      if (el.innerHTML !== html) el.innerHTML = html;
    };
    const num = (x: number) => x.toFixed(1).replace(".", ",");
    set(".lapn", c.finished ? "🏁" : `volta ${Math.min(race.laps, Math.max(1, c.lap + 1))}/${race.laps}`);
    // diferença pro da frente e pro de trás (verde/amarelo = a menos de 1 s, zona de DRS)
    const gapTo = (i: number, j: number) => {
      const a = gaps[i], b = gaps[j];
      return b.laps > a.laps ? `${b.laps - a.laps} V` : `${num(Math.max(0, b.seconds - a.seconds))} s`;
    };
    const live = !c.retired && race.phase !== "lights" && idx >= 0;
    const ahead = live && idx > 0 ? order[idx - 1] : null;
    const behind = live && idx < order.length - 1 && !order[idx + 1].retired ? order[idx + 1] : null;
    const close = (i: number, j: number) => gaps[i].laps === gaps[j].laps && gaps[j].seconds - gaps[i].seconds < 1;
    set(".gf", ahead ? `<em class="${close(idx - 1, idx) ? "up" : ""}">−${gapTo(idx - 1, idx)}</em> ${esc(ahead.driver.short)}` : "--");
    set(".gb", behind ? `<em class="${close(idx, idx + 1) ? "dn" : ""}">+${gapTo(idx, idx + 1)}</em> ${esc(behind.driver.short)}` : "--");

    // chips: pneu, combustível e danos
    const wear = Math.min(1, c.wear), rubber = Math.round((1 - wear) * 100);
    const tCol = wear > 0.8 ? "var(--soft)" : wear > 0.6 ? "var(--warn)" : "var(--ok)";
    const fuelLaps = c.fuel / race.consumption(c), left = race.lapsLeft(c);
    // com parada planejada (reabastece nela), basta chegar até lá
    const next = upcomingStop(c);
    // box chamado (ou no pit): reabastece agora, só precisa chegar no box
    const need = c.boxRequest || c.pit !== "none" ? Math.min(left, 0.5) : next ? Math.min(left, Math.max(0.5, left - (race.laps - next.lap))) : left;
    const fuelOk = fuelLaps >= need || c.finished;
    const fCol = fuelOk ? "var(--ok)" : fuelLaps < 3 ? "var(--soft)" : "var(--warn)";
    const fault = c.fault && !c.retired ? FAULTS[c.fault] : null;
    const dmgChip = fault
      ? `<span class="chip bad" title="${esc(fault.fix)}">⚠ ${esc(fault.label.toUpperCase())}</span>`
      : c.damage > 0.05
        ? `<span class="chip bad" title="Estimativa de quanto o dano custa por volta: depende da pista (travada sofre mais com asa quebrada), da chuva e do ritmo (atacando perde menos, mas erra mais). Cada volta varia">DANO ~${num(race.damageLoss(c))} s/V</span>`
        : `<span class="chip good">SEM DANOS</span>`;
    set(
      ".chips",
      `<span class="chip" title="${esc(COMPOUNDS[c.compound].label)} · ${c.tyreLaps} voltas · ${rubber}% de borracha">${tyreIcon(c.compound)}${esc(COMPOUNDS[c.compound].label.toUpperCase())} · ${c.tyreLaps} V <span class="cbar"><i style="width:${rubber}%;background:${tCol}"></i></span>${rubber}%</span>` +
        `<span class="chip" title="Combustível pra ${num(fuelLaps)} voltas · ${next && need < left ? `próxima parada em ${num(need)}` : `faltam ${num(left)}`}">⛽ ${num(fuelLaps)} V <span class="cbar"><i style="width:${Math.min(100, (fuelLaps / Math.max(1, need)) * 100)}%;background:${fCol}"></i></span></span>` +
        dmgChip,
    );

    // um alerta por vez: o mais urgente, já com o botão certo
    const canBox = c.pit === "none" && !c.boxRequest && !c.finished && !c.retired;
    const dryKinds = new Set(c.usedCompounds.filter((x) => x === "S" || x === "M" || x === "H")).size;
    const ruleOk = dryKinds >= 2 || c.usedCompounds.some((x) => x === "I" || x === "W");
    const tt = tyreTempLabel(c.tyreTemp ?? 0.6);
    type Alert = { lvl: string; t: string; sub?: string; act?: string; btn?: string };
    let al: Alert | null = null;
    if (c.retired || c.finished || race.phase === "lights") al = null;
    else if (fault && fault.pen > 5 && canBox) al = { lvl: "bad", t: `⚠ ${fault.label}: +${c.faultPen.toFixed(0)} s por volta`, sub: fault.fix, act: "box", btn: "BOX AGORA" };
    else if (c.damage > 0.6 && canBox) {
      // conselho pelo jeito do piloto: quem segura bem o carro quebrado pode atacar
      const adv = race.dmgAdvice(c), who = c.driver.short;
      const sub =
        adv === "push"
          ? `${who} segura bem o carro quebrado: atacar perde menos tempo`
          : adv === "conserve"
            ? `${who} sofre com o carro quebrado${race.wet > 0.5 ? " na chuva" : ""}: poupe ou pare no box`
            : `Estimado, varia por volta. Atacar perde menos, mas escapa mais`;
      al = { lvl: "bad", t: `⚠ Carro danificado: ~${num(race.damageLoss(c))} s por volta`, sub, act: "box", btn: "BOX AGORA" };
    }
    else if (!fuelOk && fuelLaps < need - 0.3) {
      const saving = c.engine === "lean";
      al = {
        lvl: fuelLaps < 3 ? "bad" : "warn",
        t: `⛽ Falta combustível pra ${num(need - fuelLaps)} voltas${need < left ? " (até a parada)" : ""}`,
        sub: saving ? "Já está poupando: talvez precise parar" : "Mistura pobre e ritmo de poupar economizam",
        act: saving ? (canBox ? "box" : undefined) : "save",
        btn: saving ? "BOX AGORA" : "POUPAR",
      };
    } else if (c.planDue && canBox) al = { lvl: "warn", t: "📋 Plano: parar nesta volta", sub: `${COMPOUNDS[cs.next].label}, combustível pra ${this.laps(this.fuelFor(c))} voltas`, act: "box", btn: "BOX AGORA" };
    else if (race.sc.active && race.sc.onTrack && canBox && left > 3) al = { lvl: "info", t: "🚨 Safety car: parada barata!", sub: "Todo mundo está devagar: perde bem menos tempo no box", act: "box", btn: "BOX AGORA" };
    else if (wear > 0.75 && canBox) al = { lvl: wear > 0.88 ? "bad" : "warn", t: `🛞 Pneu no fim: ${rubber}% de borracha`, sub: next ? `O plano era parar na volta ${next.lap}` : "Sem parada planejada", act: "box", btn: "BOX AGORA" };
    else if (!ruleOk && left < 8 && canBox) al = { lvl: "warn", t: "🛞 Falta usar o 2º tipo de pneu", sub: "É obrigatório usar dois tipos de pneu seco", act: "box", btn: "BOX AGORA" };
    else if (tt === "quente" && c.pace === "push") al = { lvl: "info", t: "🔥 Pneu quente: desgastando mais", sub: "Tirar um pouco o pé esfria", act: "cool", btn: "POUPAR" };
    else if (tt === "frio" && c.pace !== "push" && !race.sc.active) al = { lvl: "info", t: "🥶 Pneu frio: pouca aderência", sub: "Atacar uma volta esquenta", act: "push", btn: "ATACAR" };
    // sem problema: a faixa fica com um resumo calmo (os dois cards ficam sempre do mesmo tamanho)
    if (!al) {
      const upc = upcomingStop(c);
      const t = c.retired
        ? `Fora da corrida: ${c.retireReason ?? ""}`
        : c.finished
          ? `🏁 Terminou em P${c.position}`
          : race.phase === "lights"
            ? `🚦 No grid: a largada já vai sair${upcomingStop(c) ? ` · plano: box na volta ${upcomingStop(c)!.lap}` : ""}`
            : c.boxRequest
              ? `📻 Box chamado: entra nesta volta (${COMPOUNDS[c.boxRequest].label})`
              : c.pit !== "none"
                ? "No pit lane"
                : upc
                  ? `✓ Tudo certo · plano: box na volta ${upc.lap} (${COMPOUNDS[upc.compound].label})`
                  : "✓ Tudo certo · sem parada planejada";
      al = { lvl: "calm", t };
    }
    const box = card.querySelector<HTMLElement>(".calert")!;
    box.hidden = false;
    {
      const cls = `calert ${al.lvl}`;
      if (box.className !== cls) box.className = cls;
      const tip = al.sub ? `${al.t}: ${al.sub}` : al.t;
      if (box.title !== tip) box.title = tip;
      set(".calert", `<div class="t">${esc(al.t)}${al.sub ? `<small>${esc(al.sub)}</small>` : ""}</div>${al.act ? `<button data-act="${al.act}">${al.btn}</button>` : ""}`);
    }
  }

  /** troca a aba de dentro do card (o card não muda de tamanho) */
  private applyTab(card: HTMLElement, cs: CardState) {
    card.querySelectorAll<HTMLElement>(".pane").forEach((f) => (f.hidden = f.dataset.pane !== cs.tab));
    card.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === cs.tab));
    card.classList.toggle("tabbox", cs.tab === "box");
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
      const rowCls = `row ${c.team.id === my ? "player mine" : c.isHuman ? "player human" : ""} ${c.id === follow ? "follow" : ""}`;
      if (!el.style.getPropertyValue("--tc")) el.style.setProperty("--tc", c.team.color);
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
    const now = performance.now();
    if (this.notes.length && now - this.notes[0].at > 8000) {
      this.notes = this.notes.filter((n) => now - n.at <= 8000);
      this.feedCount = -1;
    }
    if (race.events.length !== this.feedCount) {
      this.feedCount = race.events.length;
      const mine = [...this.notes].reverse().map((n) => `<div class="me">${esc(n.text)}</div>`);
      this.feed.innerHTML =
        (this.pinned ? `<div class="me pin">${esc(this.pinned)}</div>` : "") +
        mine.join("") +
        race.events
          .filter((e) => !e.teamId || e.teamId === my)
          .slice(-(6 - mine.length))
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
      updateStatus(card, c, race);
      // chegou a volta da parada planejada: já deixa pneu e combustível do plano escolhidos
      if (c.planDue && !cs.dueApplied) {
        const st = c.plan[c.planIdx];
        if (st) {
          cs.next = st.compound;
          cs.fuelLaps = this.laps(st.fuel);
        }
        cs.dueApplied = true;
      } else if (!c.planDue) cs.dueApplied = false;
      this.renderTop(c, card, cs, idx, order, gaps);
      card.querySelector(".p")!.textContent = c.retired ? "OUT" : `P${c.position}`;
      card.querySelector(".last")!.textContent = c.lastLap ? fmtLap(c.lastLap) : "--";
      card.querySelector(".best")!.textContent = c.bestLap ? fmtLap(c.bestLap) : "--";
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
        (c.damage > 0 ? ` · ⚠ dano: ~${race.damageLoss(c).toFixed(1)}s/volta` : "");
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

      const rb = card.querySelector<HTMLButtonElement>("[data-retire]")!;
      rb.hidden = c.retired || c.finished;
      rb.textContent = c.retireAtBox ? "✕ DESISTIR DO ABANDONO" : "🏳 ABANDONAR";
      rb.classList.toggle("primary", !!c.retireAtBox);
      const box = card.querySelector<HTMLButtonElement>(".boxbtn")!;
      box.className = "boxbtn";
      box.disabled = false;
      if (c.retireAtBox && !c.retired) {
        box.textContent = "🏳 ABANDONANDO: INDO PRO BOX";
        box.disabled = true;
      } else if (c.retired) {
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
        box.textContent = `BOX, BOX! ${COMPOUNDS[c.boxRequest].label} · comb. p/ ${this.laps(c.boxFuel)} v · cancelar`;
        box.classList.add("armed");
      } else if (c.planDue) {
        box.textContent = `PLANO: PARAR NESTA VOLTA? (${COMPOUNDS[cs.next].label}, comb. p/ ${this.laps(this.fuelFor(c))} v)`;
        box.classList.add("suggest");
      } else {
        box.textContent = "CHAMAR PRO BOX";
      }
    }
  }
}

/** próxima parada planejada (ou null) */
function upcomingStop(c: CarState): PlannedStop | null {
  return c.plan[c.planIdx] ?? null;
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
