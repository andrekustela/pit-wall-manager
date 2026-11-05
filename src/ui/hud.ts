import { confirmDialog } from "./confirm";
import { keyName, type Action } from "./keys";
import { COMPLAIN_SECS, fmtLap, fuelPerLap, tyreTempLabel, type Race } from "../sim/race";
import { mountWavingFlag } from "./checkerFlag";
import {
  ALL_COMPOUNDS,
  COMPOUNDS,
  ENGINE,
  FAULTS,
  FIGHT_LAPS,
  OT_CHARGES,
  OT_SECS,
  MOOD_START,
  MOOD_BAD,
  MOOD_GOOD,
  FUEL_MAX,
  PACE,
  type CarState,
  type Command,
  type Compound,
  type EngineMode,
  type FightMode,
  type PaceMode,
  type PlannedStop,
  MAX_STOPS,
  nextStopLap,
  stopLapRange,
  type TeamOrder,
} from "../sim/types";
import { forecastText } from "../sim/weather";
import { OnboardCam } from "../render/onboard";
import { gfx } from "../render/gfx";
import { sound } from "../audio/sound";
import { bindParts, carIssues, dmgIcon, partsListHtml, statusSvg, updateStatus, type Severity } from "./carStatus";
import { esc, storeGet, storeSet, tyreIcon, wetLabel } from "./common";
import { icon } from "./icons";
import { loadStrat, runStrat, saveStrat, STRAT_RULES, stratHtml, type StratState } from "./strategies";

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
  /** câmera TV (MultiCam) liga/desliga; devolve se ficou ligada */
  toggleMultiCam?(): boolean;
}

interface CardState {
  next: Compound;
  /** voltas de combustível pra colocar; null = automático (o necessário pra terminar) */
  fuelLaps: number | null;
  planOpen: boolean;
  planSig: string;
  dueApplied: boolean;
  /** aba do card: pilotagem (ritmo, motor, ordens) ou box (pneu, combustível, peças, plano) */
  tab: "race" | "info" | "car" | "box" | "strat";
  /** 1º ou 2º carro da equipe (as estratégias ficam salvas por posição) */
  slot: number;
  /** aba ESTRATÉGIA: regras ligadas e seus números */
  strat: StratState;
  /** se parar agora, volta em que posição (pra faixa de aviso) */
  rejoin?: number | null;
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
  setMultiCam(on: boolean) {
    this.top.querySelector("[data-multicam]")?.classList.toggle("on", on);
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
      <div class="raceinfo panel"><div class="head"><span>CORRIDA</span><button class="infomin" title="Resumir/expandir o quadro da corrida"></button></div><div class="body"></div></div>
      <div class="feed"></div><button class="feedmin" title="Resumir/expandir as mensagens"></button>
      <div class="teamwrap"><div class="team"></div><div class="seg teamtoggle" title="Tamanho do painel (tecla M troca)"><button data-lv="0">COMPLETO</button><button data-lv="1">COMPACTO</button><button data-lv="2">MÍNIMO</button><button data-lv="3">OCULTO</button></div></div>
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
    // CORRIDA e mensagens: resumir numa linha (fica guardado)
    const setMini = () => {
      this.el.querySelector(".raceinfo")!.classList.toggle("resumo", this.infoMini);
      this.feed.classList.toggle("resumo", this.feedMini);
      this.el.querySelector(".infomin")!.textContent = this.infoMini ? "▸" : "◂";
      this.el.querySelector(".feedmin")!.textContent = this.feedMini ? "▾" : "▴";
      this.feedCount = -1;
    };
    this.el.querySelector(".infomin")!.addEventListener("click", () => {
      this.infoMini = !this.infoMini;
      storeSet("pwm.infomini", this.infoMini ? "1" : "0");
      setMini();
      this.update();
      this.el.querySelector(".raceinfo .body")!.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.23, 1, .32, 1)" });
    });
    this.el.querySelector(".feedmin")!.addEventListener("click", () => {
      this.feedMini = !this.feedMini;
      storeSet("pwm.feedmini", this.feedMini ? "1" : "0");
      setMini();
      this.update();
      this.feed.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.23, 1, .32, 1)" });
    });
    setMini();
    this.applyBoard();
    // pointerdown: a tabela é redesenhada várias vezes por segundo e o "click" se perdia
    this.board.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-car]");
      if (row) this.hooks.setFollow(row.dataset.car!);
    });

    this.buildTopbar();
    this.buildCards();
    this.el.querySelector(".teamtoggle")!.addEventListener("click", (e) => {
      const lv = (e.target as HTMLElement).closest<HTMLElement>("[data-lv]")?.dataset.lv;
      if (lv !== undefined && Number(lv) !== this.level) this.setLevel(Number(lv));
    });
    this.applyCompact();
  }

  /** painel dos pilotos (tecla M): 0 completo, 1 compacto (abas com botões curtos), 2 mínimo (nome + botões rápidos), 3 oculto */
  /** o modo fica guardado POR TELA (notebook e monitor grande podem ter modos diferentes) */
  private levelKey = `pwm.compact.${screen.width}x${screen.height}`;
  private level = Math.max(0, Math.min(3, Number(storeGet(this.levelKey) || storeGet("pwm.compact")) || 0));
  private boardMini = storeGet("pwm.boardmini") === "1";
  private infoMini = storeGet("pwm.infomini") === "1";
  private feedMini = storeGet("pwm.feedmini") === "1";

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

  /** tecla M: troca rápida (atalho de teclado não espera animação: só um fade curto) */
  toggleCompact() {
    this.setLevel((this.level + 1) % 4, true);
  }

  private setLevel(lv: number, quick = false) {
    this.level = lv;
    storeSet(this.levelKey, String(this.level));
    storeSet("pwm.compact", String(this.level));
    this.applyCompact(true, quick);
  }

  /** minimiza/expande o painel. Troca na hora e só anima transparência e posição (mexer na altura a
   * cada quadro fazia o navegador recalcular a página inteira e a corrida engasgava) */
  /** a bolinha do seletor COMPLETO · COMPACTO · MÍNIMO · OCULTO desliza até o modo escolhido */
  private movePill(animate: boolean) {
    const seg = this.el.querySelector<HTMLElement>(".teamtoggle")!, on = seg.querySelector<HTMLElement>(`[data-lv="${this.level}"]`);
    let pill = seg.querySelector<HTMLElement>(".pill");
    if (!pill) {
      pill = document.createElement("i");
      pill.className = "pill";
      seg.prepend(pill);
    }
    if (!on) return;
    pill.style.transition = animate ? "" : "none";
    pill.style.width = `${on.offsetWidth}px`;
    pill.style.transform = `translateX(${on.offsetLeft}px)`;
  }

  private applyCompact(animate = false, quick = false) {
    const team = this.el.querySelector<HTMLElement>(".team")!;
    const cards = [...team.querySelectorAll<HTMLElement>(".driver.panel")];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // animação anterior ainda rodando (clicou rápido): para onde está e mede dali (o retângulo já inclui o deslocamento)
    for (const c of cards) for (const a of c.getAnimations({ subtree: true })) if (a.id === "modo") a.cancel();
    const before = cards.map((c) => c.getBoundingClientRect());
    const wasHidden = team.classList.contains("hid");
    this.el.querySelectorAll<HTMLElement>(".teamtoggle [data-lv]").forEach((b) => b.classList.toggle("on", Number(b.dataset.lv) === this.level));
    this.movePill(animate);
    const set = () => {
      team.classList.toggle("compact", this.level === 1);
      team.classList.toggle("names", this.level === 2);
      team.classList.toggle("hid", this.level === 3);
      if (this.level !== 2) cards.forEach((c) => c.classList.remove("pop"));
    };
    const ease = "cubic-bezier(0.23, 1, 0.32, 1)", morph = "cubic-bezier(0.77, 0, 0.175, 1)";
    // OCULTO: os cards SAEM descendo (o mesmo caminho por onde voltam) e só depois somem
    if (this.level === 3) {
      if (!animate || wasHidden || reduce) return set();
      const outs = cards.map((c, i) => {
        const a = c.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(16px)" }], { duration: 180, easing: ease, delay: i * 30, fill: "forwards" });
        a.id = "modo";
        return a;
      });
      void Promise.all(outs.map((a) => a.finished)).then(() => {
        if (this.level !== 3) return;
        set();
        outs.forEach((a) => a.cancel());
      }).catch(() => {});
      return;
    }
    set();
    if (!animate) return;
    const run = (el: Element, k: Keyframe[], o: KeyframeAnimationOptions) => (el.animate(k, o).id = "modo");
    // tecla M ou "reduzir movimento": só um fade curto, sem mexer em tamanho e lugar
    if (quick || reduce) {
      cards.forEach((c) => run(c, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 150, easing: ease }));
      return;
    }
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hud-zoom")) || 1;
    cards.forEach((c, i) => {
      const a = c.getBoundingClientRect(), b = before[i], delay = i * 40;
      if (wasHidden || !b.width) {
        run(c, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: ease, delay, fill: "backwards" });
        return;
      }
      // FLIP: o card começa com o tamanho e o lugar antigos (recorte do que cresceu + deslocamento) e se transforma
      // no novo com curva de "morph" (ease-in-out forte); o que diminuiu é revelado no fim pelo fade do conteúdo
      const top = Math.max(0, a.height - b.height) / z, side = Math.max(0, a.width - b.width) / 2 / z;
      const dx = (b.left + b.width / 2 - (a.left + a.width / 2)) / z, dy = (b.bottom - a.bottom) / z;
      const sy = Math.max(0.94, Math.min(1, b.height / a.height));
      run(
        c,
        [
          { clipPath: `inset(${top.toFixed(1)}px ${(side - 12).toFixed(1)}px -12px ${(side - 12).toFixed(1)}px)`, transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` },
          { clipPath: "inset(-44px -12px -12px -12px)", transform: "none" },
        ],
        { duration: 280, easing: morph, delay },
      );
      // o conteúdo: some rápido e volta em cascata de cima pra baixo, depois que a forma já andou metade
      [...c.querySelectorAll<HTMLElement>(":scope > *")].forEach((k, n) =>
        run(k, [{ opacity: 0, transform: `translateY(${(4 * sy).toFixed(1)}px)` }, { opacity: 1, transform: "none" }], { duration: 200, easing: ease, delay: delay + 110 + Math.min(n, 6) * 18, fill: "backwards" }),
      );
    });
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
      `<button data-tv title="Modo TV: a câmera corta sozinha pras disputas (T)">📺 TV</button><button data-multicam title="TV (MultiCam): a câmera troca sozinha de ângulo, como na transmissão (5)">🎥 MULTICAM</button><button data-skip style="display:none">PULAR P/ PÓDIO ⏭</button>`;
    this.top.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => this.hooks.setSpeed(Number(b.dataset.speed))),
    );
    this.top.querySelector("[data-skip]")!.addEventListener("click", () => this.hooks.skip());
    const tv = this.top.querySelector<HTMLButtonElement>("[data-tv]")!;
    tv.addEventListener("click", () => this.setTv(this.hooks.toggleTv?.() ?? false));
    this.top.querySelector("[data-multicam]")?.addEventListener("click", () => this.setMultiCam(this.hooks.toggleMultiCam?.() ?? false));
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
    for (const [slot, c] of this.mine().entries()) {
      this.cardState.set(c.id, { next: c.compound === "H" ? "M" : "H", fuelLaps: null, planOpen: false, planSig: "", dueApplied: false, tab: "race", slot, strat: loadStrat(slot) });
      const card = document.createElement("div");
      card.className = "driver panel";
      card.dataset.id = c.id;
      card.style.borderTopColor = c.team.color;
      card.innerHTML = `
        <div class="statuscol"><div class="onbox" data-onboard title="Câmera onboard: clique pra tela cheia"><canvas></canvas><span>ONBOARD</span><i>⛶</i></div>${statusSvg()}<div class="uc"><span class="uct"></span><span class="ucf"></span><span class="ucd"></span></div><div class="stats colstats"><div>Última<b class="last"></b></div><div>Melhor<b class="best"></b></div></div>${partsListHtml()}</div>
        <div class="top">
          <div class="p"></div>
          <div class="nm" title="Clique no card pra seguir esse piloto">${esc(c.driver.name)}<span class="mood"></span><small>${esc(c.team.name)} · <span class="lapn"></span></small></div>
          <div class="gapsbox" title="Distância pro carro da frente e pro de trás"><div><span>FRENTE</span><b class="gf"></b></div><div><span>ATRÁS</span><b class="gb"></b></div></div>
        </div>
        <div class="mini-line chips"></div>
        <div class="calert" hidden></div>
        <div class="battle idle"><span class="bt-s bt-a" title="Carro da frente"></span><button data-fight="atk" title="Atacar o da frente por ${FIGHT_LAPS} voltas: mais chance de passar, mas arrisca erro e toque (tecla ${keyName("atacar")})">ATACAR</button><span class="bt-s bt-b" title="Carro de trás"></span><button data-fight="def" title="Defender a posição por ${FIGHT_LAPS} voltas: fecha a porta, fica um pouco mais lento e arrisca toque (tecla ${keyName("defender")})">DEFENDER</button><button class="otb" data-ot title="Modo ultrapassagem: potência extra da bateria por alguns segundos (tecla ${keyName("ultrapassagem")})">⚡ <span class="otn"></span></button></div>
        <div class="ctabs"><button data-tab="race" title="Ritmo, motor, ultrapassagem e ordens de equipe">${icon("piloto")}<span class="tl">PILOTO</span></button><button data-tab="box" title="Pneu, combustível e plano de paradas">${icon("box")}<span class="tl">BOX</span></button><button data-tab="car" title="Danos, problemas mecânicos e motor (e abandonar)">${icon("carro")}<span class="tl">CARRO</span></button><button data-tab="info" title="Ritmo comparado com os rivais, pneus deles e chuva chegando">${icon("info")}<span class="tl">INFO</span></button><button data-tab="strat" title="Regras que o piloto segue sozinho (liga/desliga)">${icon("estrategia")}<span class="tl">ESTRATÉGIA</span></button></div>
        <div class="cpane" data-cpane="race">
          <div class="cq"><span class="cl" title="Ritmo: Atacar (mais rápido, gasta mais pneu) · Normal · Poupar (mais lento, poupa pneu)">Rit</span><span class="seg cseg">${(["push", "normal", "conserve"] as PaceMode[]).map((m, i) => `<button data-pace="${m}" title="Ritmo: ${PACE[m].label} (${["mais rápido, gasta mais pneu", "equilíbrio", "mais lento, poupa pneu"][i]})">${"ANP"[i]}</button>`).join("")}</span>
            <span class="cl" title="Motor (mistura): Rica (mais rápido, gasta mais combustível) · Normal · Pobre (mais lento, economiza)">Mot</span><span class="seg cseg">${(["rich", "normal", "lean"] as EngineMode[]).map((m, i) => `<button data-engine="${m}" title="Motor: ${ENGINE[m].label} (${["mais rápido, gasta mais combustível", "equilíbrio", "mais lento, economiza combustível"][i]})">${"RNP"[i]}</button>`).join("")}</span>
            <span class="cl" title="Modo ultrapassagem: Auto (o piloto usa as cargas) · Manual (só quando você aperta o ⚡)">Ult</span><span class="seg cseg"><button data-otauto="1" title="Ultrapassagem: o piloto decide">Au</button><button data-otauto="0" title="Ultrapassagem: só quando você aperta o ⚡">Ma</button></span></div>
          <div class="cq"><span class="cl" title="Ordem de equipe: deixar o companheiro passar, manter as posições ou livre pra brigar">Eqp</span><span class="seg cseg"><button data-order="letPass" title="Deixar o companheiro passar">Deixar</button><button data-order="hold" title="Manter as posições">Manter</button><button data-order="none" title="Livre pra brigar">Livre</button></span></div>
        </div>
        <div class="cpane" data-cpane="box">
          <div class="cq"><span class="seg cseg next">${ALL_COMPOUNDS.map((t) => `<button class="t${t}" data-next="${t}" title="${COMPOUNDS[t].label}">${tyreIcon(t, COMPOUNDS[t].label)}</button>`).join("")}</span>
            <span class="stepper">${icon("fuel")}<button data-fuel="-1">−</button><b class="fval"></b><button data-fuel="1">+</button></span></div>
          <div class="cq"><span class="plansum"></span></div>
        </div>
        <div class="pane" data-pane="strat"><div class="stratlist">${stratHtml()}</div></div>
        <div class="pane" data-pane="info"><div class="infolist"></div></div>
        <div class="pane" data-pane="car"><div class="carlist"></div><button class="btn small retirebtn" data-retire title="O carro entra no box e vai pra garagem (sai da corrida)">🏳 ABANDONAR</button></div>
        <div class="pane" data-pane="race">
        <div class="trio">
          ${dialHtml("pace", "Ritmo", "Ritmo = tempo × pneu", (["push", "normal", "conserve"] as PaceMode[]).map((m, i) => [m, PACE[m].label, (["ritmoAtacar", "ritmoNormal", "ritmoPoupar"] as const)[i]]))}
          ${dialHtml("engine", "Motor", "Motor = tempo × combustível", (["rich", "normal", "lean"] as EngineMode[]).map((m, i) => [m, ENGINE[m].label, (["motorRica", "motorNormal", "motorPobre"] as const)[i]]))}
          <div class="otcell"><div class="dial two otctl"><div class="opts"><i class="otring"></i><i class="thumb"></i><span class="pips"></span><button data-otauto="1" title="O piloto decide quando usar as cargas (colado no da frente, a menos de 0,6 s)">Auto</button><button data-otauto="0" title="Só quando você aperta o ⚡ (embaixo do botão)">Manual</button><button class="otgo" data-ot>⚡</button></div><span class="cl">Ultrapassagem</span></div></div>
        </div>
        <div class="row2"><span class="lbl">Equipe</span><div class="seg order">
          <button data-order="letPass" title="Este carro abre espaço e deixa o companheiro de equipe passar">Deixar passar</button><button data-order="hold" title="Os dois carros da equipe não brigam entre si">Manter</button><button data-order="none" title="Os dois podem brigar normalmente">Livre</button>
        </div></div>
        </div>
        <div class="pane" data-pane="box">
        <div class="row2"><span class="lbl">Pneu</span><div class="seg next">
          ${ALL_COMPOUNDS.map((t) => `<button class="t${t}" data-next="${t}" title="${COMPOUNDS[t].label}">${tyreIcon(t, COMPOUNDS[t].label)}</button>`).join("")}
        </div></div>
        <div class="fuelrow"><span class="lbl" style="width:46px">Comb.</span>
          <span class="stepper"><button data-fuel="-1">−</button><b class="fval"></b><button data-fuel="1">+</button></span>
          <button class="btn small" data-fuelauto>até o fim</button>
        </div>
        <div class="pwin" title="Janela de parada: em verde as voltas boas pra parar (pelo desgaste do pneu e o combustível); traço branco = agora, amarelo = parada planejada"><span class="lbl">${icon("tempo")}Janela</span><div class="pwbar"><i class="pw-w"></i><i class="pw-p"></i><i class="pw-n"></i></div><small class="pwtxt"></small></div>
        <div class="rejoin"></div>
        <div class="planhead" style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;font-size:12px;color:var(--muted)">
          <span class="plansum"></span><span class="pb"><button class="btn small" data-pb="-2" title="Plano B: antecipar a próxima parada 2 voltas (responder ao undercut)">◀ 2</button><button class="btn small" data-pb="2" title="Plano B: esticar a próxima parada 2 voltas">2 ▶</button></span><button class="btn small" data-plantoggle>editar</button>
        </div>
        <div class="planedit" style="display:none"></div>
        </div>
        <div class="boxrow"><button class="boxbtn"></button></div>
        <div class="quick"><button data-fight="atk" title="Atacar o da frente (tecla ${keyName("atacar")})">ATK</button><button data-fight="def" title="Defender (tecla ${keyName("defender")})">DEF</button><button class="otb" data-ot title="Modo ultrapassagem">⚡ <span class="otn"></span></button><button data-pacecycle title="Ritmo: clique pra trocar (Atacar, Normal, Poupar)">Rit <b class="pcur"></b></button><button data-boxq title="Chamar para o box / cancelar">BOX</button></div>
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
        if ((e.target as HTMLElement).closest("button, input, label, .dial")) return;
        this.hooks.setFollow(c.id);
      });
      // MÍNIMO: o Ritmo alterna Atacar → Normal → Poupar; o BOX rápido usa o botão de box de verdade
      card.querySelector("[data-pacecycle]")!.addEventListener("click", () => {
        const seq: PaceMode[] = ["push", "normal", "conserve"];
        this.hooks.send({ type: "pace", carId: c.id, mode: seq[(seq.indexOf(c.pace) + 1) % 3] });
      });
      card.querySelector("[data-boxq]")!.addEventListener("click", () => card.querySelector<HTMLButtonElement>(".boxbtn")!.click());
      card.querySelectorAll<HTMLButtonElement>("[data-pace]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "pace", carId: c.id, mode: b.dataset.pace as PaceMode })),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "engine", carId: c.id, mode: b.dataset.engine as EngineMode })),
      );
      // botões giratórios: clicar ou arrastar em qualquer lugar do botão escolhe a posição pela direção a partir
      // do centro (não só em cima do texto); clica no botão da posição, então atalhos/voz seguem iguais
      card.querySelectorAll<HTMLElement>(".dial .opts").forEach((o) => {
        let cur = -1;
        const pick = (e: PointerEvent) => {
          const r = o.getBoundingClientRect();
          const a = (Math.atan2(e.clientX - (r.left + r.width / 2), r.top + (39 / o.offsetHeight) * r.height - e.clientY) * 180) / Math.PI;
          const bs = [...o.querySelectorAll<HTMLButtonElement>("button:not(.otgo)")];
          const angs = bs.length === 2 ? [-50, 50] : [-62, 0, 62];
          const i = angs.reduce((best, x, k) => (Math.abs(a - x) < Math.abs(a - angs[best]) ? k : best), 0);
          if (i === cur || bs[i].disabled) return;
          cur = i;
          bs[i].click();
        };
        o.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest(".otgo")) return;
          e.preventDefault();
          try {
            o.setPointerCapture(e.pointerId);
          } catch {
            /* ponteiro sintético (teste) */
          }
          cur = [...o.querySelectorAll("button:not(.otgo)")].findIndex((b) => b.classList.contains("on"));
          pick(e);
          o.onpointermove = (ev) => {
            if (o.hasPointerCapture(ev.pointerId)) pick(ev);
          };
        });
        // (o clique em cima do texto já foi tratado no pointerdown)
        o.addEventListener("click", (e) => e.target !== o && e.detail > 0 && !(e.target as HTMLElement).closest(".otgo") && e.stopPropagation(), true);
      });
      card.querySelectorAll<HTMLButtonElement>("[data-fight]").forEach((b) =>
        b.addEventListener("click", () => {
          const m = b.dataset.fight as FightMode;
          this.hooks.send({ type: "fight", carId: c.id, mode: c.fight === m ? null : m });
          this.update();
        }),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-ot]").forEach((b) =>
        b.addEventListener("click", () => {
          this.hooks.send({ type: "ot", carId: c.id });
          this.update();
        }),
      );
      card.querySelectorAll<HTMLButtonElement>("[data-otauto]").forEach((b) =>
        b.addEventListener("click", () => this.hooks.send({ type: "otAuto", carId: c.id, on: b.dataset.otauto === "1" })),
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
      // (no MÍNIMO a aba abre num balão em cima do card, sem mudar o tamanho dele; clicar de novo fecha)
      card.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
        b.addEventListener("click", () => {
          const t = b.dataset.tab as CardState["tab"];
          if (this.level === 2) card.classList.toggle("pop", !(card.classList.contains("pop") && cs.tab === t));
          setTab(t);
        }),
      );
      card.querySelector(".ucd")!.addEventListener("click", () => setTab("car"));
      this.applyTab(card, cs);
      // botão do alerta: a ação certa pro problema mais urgente
      card.querySelector(".calert")!.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
        if (!b) return;
        const a = b.dataset.act;
        if (a === "box" && c.pit === "none" && !c.boxRequest) this.hooks.send({ type: "box", carId: c.id, compound: cs.next, fuel: this.fuelFor(c) });
        // (o ritmo não mexe no combustível: só a mistura pobre economiza)
        if (a === "save") this.hooks.send({ type: "engine", carId: c.id, mode: "lean" });
        if (a === "complain") this.hooks.send({ type: "complain", carId: c.id });
        if (a === "cool") this.hooks.send({ type: "pace", carId: c.id, mode: "conserve" });
        if (a === "push") this.hooks.send({ type: "pace", carId: c.id, mode: "push" });
        this.update();
      });
      // Plano B: antecipa/estica a próxima parada sem abrir o editor
      card.querySelectorAll<HTMLButtonElement>("[data-pb]").forEach((b) =>
        b.addEventListener("click", () => {
          const plan: PlannedStop[] = c.plan.slice(c.planIdx).map((s) => ({ ...s }));
          if (!plan[0]) return;
          const [lo, hi] = stopLapRange(plan, 0, c.lap + 1, this.race.laps);
          plan[0].lap = Math.max(lo, Math.min(hi, plan[0].lap + Number(b.dataset.pb)));
          this.hooks.send({ type: "plan", carId: c.id, plan });
          c.plan = plan.filter((s) => s.lap > c.lap).sort((a, b2) => a.lap - b2.lap);
          c.planIdx = 0;
          cs.planSig = "";
          this.update();
        }),
      );
      // ESTRATÉGIA: liga/desliga e o número de cada regra (fica salvo pro carro)
      card.querySelector(".stratlist")!.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
        if (!b) return;
        const on = b.dataset.stOn, vId = b.dataset.stV;
        if (on && cs.strat[on]) {
          cs.strat[on].on = !cs.strat[on].on;
          cs.strat[on].fired = false;
        }
        const p = vId ? STRAT_RULES.find((r) => r.id === vId)?.param : undefined;
        if (vId && p) cs.strat[vId].v = Math.max(p.min, Math.min(p.max, cs.strat[vId].v + Number(b.dataset.d) * p.step));
        saveStrat(cs.slot, cs.strat);
        this.update();
      });
      // INFO: chuva chegando → box pro intermediário
      card.querySelector(".infolist")!.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-inter]");
        if (!b || c.pit !== "none" || c.boxRequest) return;
        cs.next = "I";
        this.hooks.send({ type: "box", carId: c.id, compound: "I", fuel: this.fuelFor(c) });
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
        if (b.dataset.act === "lap" && st) {
          const [lo, hi] = stopLapRange(plan, i, c.lap + 1, this.race.laps);
          st.lap = Math.max(lo, Math.min(hi, st.lap + Number(b.dataset.d)));
        }
        if (b.dataset.act === "fuel" && st) st.fuel = this.kg(Math.max(0, this.laps(st.fuel) + Number(b.dataset.d)));
        if (b.dataset.act === "tyre" && st) st.compound = b.dataset.c as Compound;
        if (b.dataset.act === "close") {
          cs.planOpen = false;
          cs.planSig = "";
          this.update();
          return;
        }
        if (b.dataset.act === "del") plan.splice(i, 1);
        if (b.dataset.act === "add") {
          // (só se couber: cada parada a MIN_STINT voltas da anterior, antes da última volta)
          const lap = nextStopLap(plan, c.lap + 1, this.race.laps);
          if (lap !== null && plan.length < MAX_STOPS) plan.push({ lap, compound: cs.next, fuel: this.kg(this.race.laps - lap) });
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
    // humor do piloto (bravo erra mais e pede pra sair do "Manter"; feliz anda um pouco mais)
    const md = c.mood ?? MOOD_START, face = md < MOOD_BAD ? "bravo" : md > MOOD_GOOD ? "feliz" : "normal";
    set(".mood", `<span class="md-${face}" title="Humor: ${face === "bravo" ? "irritado (erra mais)" : face === "feliz" ? "feliz (anda um pouco mais)" : "normal"}">${icon(face)}</span>`);
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
    // dano: um ícone por cor que existir (verde = tudo certo); a lista fica na aba 🩺 CARRO
    const issues = carIssues(c, race);
    const sevs = [...new Set(issues.map((x) => x.sev))].sort((a, b) => a - b) as Severity[];
    const dmgTip = issues.length ? issues.map((x) => x.t).join(" · ") : "Carro sem problemas";
    const dmgIcons = `<span class="dmgs" title="${esc(dmgTip)} (detalhes na aba CARRO)">${(sevs.length ? sevs : [0 as Severity]).map((s) => dmgIcon(s)).join("")}</span>`;
    // embaixo do carro: um triângulo por problema (3 amarelos = 3 triângulos), do mais grave pro mais leve
    const dmgAll = `<span class="dmgs all" title="${esc(dmgTip)} (detalhes na aba CARRO)">${(issues.length ? issues.map((x) => x.sev) : [0 as Severity]).map((s) => dmgIcon(s)).join("")}</span>`;
    // temperatura do pneu (azul frio, verde ideal, vermelho quente)
    const tLab = tyreTempLabel(c.tyreTemp ?? 0.6), tTemp = `<span class="ttemp ${tLab}" title="Pneu ${tLab} (${Math.round((c.tyreTemp ?? 0.6) * 100)}%)">${icon("temp")}</span>`;
    set(
      ".chips",
      `<span class="chip" title="${esc(COMPOUNDS[c.compound].label)} · ${c.tyreLaps} voltas · ${rubber}% de borracha">${tyreIcon(c.compound)}${esc(COMPOUNDS[c.compound].label.toUpperCase())} · ${c.tyreLaps} V <span class="cbar"><i style="width:${rubber}%;background:${tCol}"></i></span>${rubber}%${tTemp}</span>` +
        `<span class="chip" title="Combustível pra ${num(fuelLaps)} voltas · ${next && need < left ? `próxima parada em ${num(need)}` : `faltam ${num(left)}`}">${icon("fuel")} ${num(fuelLaps)} V <span class="cbar"><i style="width:${Math.min(100, (fuelLaps / Math.max(1, need)) * 100)}%;background:${fCol}"></i></span></span>` +
        `<span class="chip">${dmgIcons}</span>`,
    );
    // embaixo do carro (completo): ícone do pneu + %, combustível em voltas e o dano
    set(".uct", `${tyreIcon(c.compound, `${COMPOUNDS[c.compound].label} · ${c.tyreLaps} voltas · ${rubber}% de borracha`)}<b style="color:${tCol}">${rubber}%</b>${tTemp}`);
    set(".ucf", `<span title="Combustível pra ${num(fuelLaps)} voltas">${icon("fuel")}</span><b style="color:${fCol}">${num(fuelLaps)} V</b>`);
    set(".ucd", dmgAll);
    set(
      ".carlist",
      (issues.length ? issues : [{ sev: 0 as Severity, t: "Tudo certo com o carro", sub: "Sem danos, sem problemas mecânicos" }])
        .map((x) => `<div class="crow">${dmgIcon(x.sev)}<span><b>${esc(x.t)}</b><small>${esc(x.sub)}</small></span></div>`)
        .join("") +
        `<div class="crow info">${icon("temp")}<span><b>Pneu ${tyreTempLabel(c.tyreTemp ?? 0.6)} (${Math.round((c.tyreTemp ?? 0.6) * 100)}%)</b><small>Frio: pouca aderência · quente: gasta mais</small></span></div>` +
        `<div class="crow info">${icon("vento")}<span><b>${c.dirtyAir && !c.finished ? "Ar sujo" : "Ar limpo"}</b><small>${c.dirtyAir && !c.finished ? "Colado atrás de outro: perde aderência nas curvas e esquenta o pneu" : "Sem carro colado na frente"}</small></span></div>`,
    );

    // briga: a faixa fica sempre no lugar (o card não muda de tamanho); acende com alguém a menos de 1 s
    // ou com ATACAR/DEFENDER ligado
    const racing = live && !c.finished && c.pit === "none" && race.phase === "racing" && !race.sc.active;
    const ga = ahead && close(idx - 1, idx) ? gaps[idx].seconds - gaps[idx - 1].seconds : 99;
    const gb = behind && close(idx, idx + 1) ? gaps[idx + 1].seconds - gaps[idx].seconds : 99;
    const bt = card.querySelector<HTMLElement>(".battle")!;
    // cada lado fixo: o da frente junto do ATACAR, o de trás junto do DEFENDER (nada troca de lugar)
    const nearA = racing && ga < 1, nearB = racing && gb < 1;
    const showBt = nearA || nearB || (racing && !!c.fight);
    bt.classList.toggle("idle", !showBt);
    const fLeft = Math.max(1, Math.ceil((c.fightTill - race.dist(c)) / race.track.L));
    set(".bt-a", nearA ? `▲ ${esc(ahead!.driver.short)} <b>${num(ga)}</b>` : "▲ —");
    set(".bt-b", nearB ? `▼ ${esc(behind!.driver.short)} <b>${num(gb)}</b>` : "▼ —");
    card.querySelector(".bt-a")!.classList.toggle("off", !nearA);
    card.querySelector(".bt-b")!.classList.toggle("off", !nearB);
    bt.classList.toggle("pulse", showBt && !c.fight);
    card.querySelectorAll<HTMLButtonElement>("[data-fight]").forEach((b) => {
      const m = b.dataset.fight, on = c.fight === m;
      // sem carro daquele lado o botão apaga (a não ser que a briga já esteja ligada: aí dá pra desligar)
      b.disabled = !racing || (!on && !(m === "atk" ? nearA : nearB));
      b.classList.toggle("on", on);
      // (voltas que faltam num selo no canto: o botão não muda de largura)
      const l = on ? `${fLeft}V` : "";
      if (b.dataset.l !== l) b.dataset.l = l;
    });
    // modo ultrapassagem
    const otOn = race.otOn(c);
    card.querySelectorAll(".otn").forEach((e) => (e.textContent = String(c.ot)));
    // MÍNIMO: ritmo atual no botão que alterna e o BOX armado
    set(".pcur", "ANP"[["push", "normal", "conserve"].indexOf(c.pace)] ?? "N");
    card.querySelector("[data-boxq]")!.classList.toggle("armed", !!c.boxRequest);
    // (no AUTO quem aciona é o piloto: o ⚡ só aperta no MANUAL; a carga é bateria, não gasta combustível)
    const otTip = otOn ? `Ultrapassagem ligada: ${OT_SECS} s com a bateria` : c.ot <= 0 ? "Sem cargas de bateria" : c.lap < 1 && !c.otAuto ? "Libera na volta 2" : c.otAuto ? "No AUTO o piloto usa sozinho: passe pro MANUAL pra apertar" : `Usar uma carga da bateria agora: ${OT_SECS} s de potência extra, não gasta combustível (tecla ${keyName("ultrapassagem")})`;
    card.querySelectorAll<HTMLButtonElement>("[data-ot]").forEach((b) => {
      b.disabled = c.otAuto || (!otOn && (c.ot <= 0 || !racing || c.lap < 1));
      b.classList.toggle("live", otOn);
      if (b.title !== otTip) b.title = otTip;
    });
    // as cargas em arco embaixo do botão, metade de cada lado do ⚡ (apagam da direita pra esquerda)
    set(".pips", Array.from({ length: OT_CHARGES }, (_, n) => { const h = OT_CHARGES / 2, a = ((n < h ? -(85 + n * 25) : 85 + (OT_CHARGES - 1 - n) * 25) * Math.PI) / 180; return `<i class="${n < c.ot ? "" : n === c.ot ? "used just" : "used"}" style="left:${(46 + 26 * Math.sin(a) - 4.5).toFixed(1)}px;top:${(39 - 26 * Math.cos(a) - 2).toFixed(1)}px;--r:${((a * 180) / Math.PI).toFixed(0)}deg"></i>`; }).join(""));
    // a borda amarela do botão = o que sobra da volta de impulso (vai se consumindo)
    const otc = card.querySelector<HTMLElement>(".otctl")!;
    otc.classList.toggle("on", otOn);
    otc.style.setProperty("--otp", otOn ? Math.max(0, Math.min(1, (c.otTill - race.time) / OT_SECS)).toFixed(3) : "0");
    setDial(card.querySelector<HTMLElement>(".otctl")!, c.otAuto ? "auto" : "manual", c.otAuto ? 0 : 1);
    card.querySelectorAll<HTMLButtonElement>("[data-otauto]").forEach((b) => b.classList.toggle("on", (b.dataset.otauto === "1") === c.otAuto));

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
    else if (c.incident && race.time - c.incident.t < COMPLAIN_SECS && !c.retired) {
      // toque com outro carro: dá pra reclamar na direção de prova (por pouco tempo)
      const o = race.cars.find((x) => x.id === c.incident!.with);
      al = { lvl: "info", t: `Toque com ${o?.driver.short ?? "outro carro"}: reclamar?`, sub: `Se ele causou, leva 5 s · ${Math.ceil(COMPLAIN_SECS - (race.time - c.incident.t))} s pra decidir`, act: "complain", btn: "RECLAMAR" };
    }
    else if (!fuelOk && fuelLaps < need - 0.3) {
      const saving = c.engine === "lean";
      al = {
        lvl: fuelLaps < 3 ? "bad" : "warn",
        t: `⛽ Falta combustível pra ${num(need - fuelLaps)} voltas${need < left ? " (até a parada)" : ""}`,
        sub: saving ? "Já está poupando: talvez precise parar" : "Mistura pobre economiza combustível",
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
                  ? `✓ Parada em ${upc.lap - c.lap <= 1 ? "1 volta" : `${upc.lap - c.lap} voltas`} (${COMPOUNDS[upc.compound].label})${cs.rejoin ? ` · parando agora: P${cs.rejoin}` : ""}`
                  : `✓ Sem parada planejada${cs.rejoin ? ` · parando agora: P${cs.rejoin}` : ""}`;
      al = { lvl: "calm", t };
    }
    const box = card.querySelector<HTMLElement>(".calert")!;
    box.hidden = false;
    {
      const cls = `calert ${al.lvl}`;
      if (box.className !== cls) box.className = cls;
      const tip = al.sub ? `${al.t} · ${al.sub}` : al.t;
      if (box.title !== tip) box.title = tip;
      // (MÍNIMO: sem a faixa, o card pinta a borda na cor do aviso e o texto aparece no mouse)
      if (card.dataset.alert !== al.lvl) card.dataset.alert = al.lvl;
      const ctip = al.lvl === "calm" ? "" : tip;
      if (card.title !== ctip) card.title = ctip;
      set(".calert", `<div class="t">${esc(al.t)}${al.sub ? `<small>${esc(al.sub)}</small>` : ""}</div>${al.act ? `<button data-act="${al.act}">${al.btn}</button>` : ""}`);
    }
  }

  /** troca a aba de dentro do card (o card não muda de tamanho) */
  private applyTab(card: HTMLElement, cs: CardState) {
    const was = card.dataset.tab;
    card.querySelectorAll<HTMLElement>(".pane").forEach((f) => (f.hidden = f.dataset.pane !== cs.tab));
    card.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === cs.tab));
    card.classList.toggle("tabbox", cs.tab === "box");
    card.dataset.tab = cs.tab;
    if (was && was !== cs.tab && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      for (const el of [card.querySelector<HTMLElement>(`.pane[data-pane="${cs.tab}"]`), card.querySelector<HTMLElement>(`.cpane[data-cpane="${cs.tab}"]`), card.querySelector<HTMLElement>(".statuscol")])
        el?.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.23, 1, .32, 1)" });
  }

  private lapHist = new Map<string, { last: number | null; laps: number[] }>();

  /** ritmo recente (média das últimas voltas limpas; volta de box/safety car fica de fora) */
  private pace(c: CarState): number | null {
    const laps = this.lapHist.get(c.id)?.laps ?? [];
    if (!laps.length) return null;
    const best = Math.min(...laps), clean = laps.filter((t) => t < best * 1.04).slice(-3);
    return clean.reduce((a, b) => a + b, 0) / clean.length;
  }

  /** aba INFO (rivais, ritmo comparado, chuva) e a parte de estratégia do BOX (janela, onde volta, Plano B) */
  private renderStrategy(c: CarState, card: HTMLElement, cs: CardState, idx: number, order: CarState[], gaps: { laps: number; seconds: number }[]) {
    const race = this.race;
    const set = (sel: string, html: string) => {
      const el = card.querySelector<HTMLElement>(sel)!;
      if (el.innerHTML !== html) el.innerHTML = html;
    };
    const num = (x: number) => x.toFixed(1).replace(".", ",");
    const live = !c.retired && !c.finished && idx >= 0 && race.phase !== "lights";
    const my = this.pace(c);
    const lapT = my ?? c.lastLap ?? c.targetLap;
    const total = (i: number) => gaps[i].laps * lapT + gaps[i].seconds;

    // ---- INFO: o da frente e o de trás (pneu, distância, quem ganha tempo e quando alcança) ----
    const rival = (o: CarState | undefined, j: number, front: boolean) => {
      if (!live || !o || o.retired) return `<div class="irow off">${front ? "▲" : "▼"} —</div>`;
      const gap = Math.abs(total(j) - total(idx)), op = this.pace(o);
      let trend = `<small>ritmo: falta 1 volta</small>`;
      if (race.sc.active) trend = `<small>safety car</small>`;
      else if (my !== null && op !== null) {
        const d = op - my; // > 0: eu sou mais rápido
        // previsão em faixas (o número exato pulava: distância ÷ diferença pequena), só com diferença que conta
        const when = (closing: number) =>
          gap < 0.6 ? "colado" : (() => {
            const n = gap / closing;
            return n > race.lapsLeft(c) ? (front ? "não pega" : "não chega") : `${front ? "pega" : "chega"} em ${n <= 2 ? "1–2" : n <= 5 ? "3–5" : "6+"} V`;
          })();
        trend =
          Math.abs(d) < 0.15
            ? `<b>mesmo ritmo</b>`
            : front
              ? d > 0
                ? `<b class="good">ganha ${num(d)}/v</b><small>${when(d)}</small>`
                : `<b class="bad">perde ${num(-d)}/v</b>`
              : d < 0
                ? `<b class="bad">ele ganha ${num(-d)}/v</b><small>${when(-d)}</small>`
                : `<b class="good">abre ${num(d)}/v</b>`;
      }
      return `<div class="irow"><span class="iw">${front ? "▲" : "▼"} ${esc(o.driver.short)}</span>${tyreIcon(o.compound, `${COMPOUNDS[o.compound].label} · ${o.tyreLaps} voltas`)}<span class="it">${o.tyreLaps}V</span><span class="ig">${num(gap)} s</span>${trend}</div>`;
    };
    const f = race.weather.forecast, nowLap = race.currentLap();
    const dry = c.compound === "S" || c.compound === "M" || c.compound === "H";
    const rainTxt =
      race.rain > 0
        ? `Chovendo · pista ${Math.round(race.wet * 100)}% molhada`
        : f && f.to >= nowLap
          ? f.from > nowLap
            ? `Chuva em ~${f.from - nowLap} voltas (${f.chance}%)`
            : `Chuva pode chegar a qualquer volta (${f.chance}%)`
          : race.wet > 0.05
            ? `Secando · pista ${Math.round(race.wet * 100)}% molhada`
            : "Sem chuva prevista";
    const interBtn = live && dry && (race.rain > 0.2 || race.wet > 0.3) && c.pit === "none" && !c.boxRequest ? `<button data-inter title="Chama pro box e põe intermediário">BOX INTER</button>` : "";
    set(
      ".infolist",
      rival(idx > 0 ? order[idx - 1] : undefined, idx - 1, true) +
        rival(idx < order.length - 1 ? order[idx + 1] : undefined, idx + 1, false) +
        `<div class="irow you"><span class="iw">${icon("tempo")}Você</span><span>${my !== null ? `ritmo ${fmtLap(my)}` : "ritmo: falta 1 volta"}</span></div>` +
        `<div class="irow rain">${icon("chuva")}<span>${rainTxt}</span>${interBtn}</div>`,
    );

    // ---- BOX: janela de parada (desgaste e combustível) ----
    const L = race.laps, pct = (lap: number) => `${Math.max(0, Math.min(100, (lap / L) * 100)).toFixed(1)}%`;
    const rate = c.tyreLaps > 0 ? c.wear / c.tyreLaps : 0;
    const fuelEnd = c.lap + c.fuel / race.consumption(c);
    const at = (w: number) => (rate > 0 ? c.lap + Math.max(0, (w - c.wear) / rate) : L);
    const w0 = Math.min(L, at(0.6)), w1 = Math.min(L, at(0.8), fuelEnd);
    const wEl = card.querySelector<HTMLElement>(".pw-w")!;
    wEl.style.left = pct(Math.min(w0, w1));
    wEl.style.width = `${Math.max(1.5, ((Math.max(w1, w0) - Math.min(w0, w1)) / L) * 100).toFixed(1)}%`;
    card.querySelector<HTMLElement>(".pw-n")!.style.left = pct(c.lap);
    const next = upcomingStop(c);
    const pEl = card.querySelector<HTMLElement>(".pw-p")!;
    pEl.hidden = !next;
    if (next) pEl.style.left = pct(next.lap);
    set(".pwtxt", !live ? "" : rate <= 0 ? "falta 1 volta" : w0 >= L && fuelEnd >= L ? "vai até o fim" : `V${Math.ceil(Math.min(w0, w1))}–${Math.max(Math.ceil(Math.min(w0, w1)), Math.floor(Math.max(w0, w1)))}`);

    // ---- BOX: se parar agora, onde volta ----
    let rj = "";
    cs.rejoin = null;
    if (live && c.pit === "none") {
      const loss = race.pitLossEstimate(c, this.fuelFor(c));
      const mine = total(idx) + loss;
      let pos = 1, fT = -Infinity;
      let front = null as CarState | null;
      order.forEach((o, j) => {
        if (o === c || o.retired || o.finished) return;
        const t = total(j);
        if (t < mine) {
          pos++;
          if (t > fT) [fT, front] = [t, o];
        }
      });
      cs.rejoin = pos;
      rj = `Se parar agora: volta em <b>P${pos}</b>${front ? `, atrás do ${esc(front.driver.short)}` : ""} <small>(perde ~${Math.round(loss)} s)</small>`;
    }
    set(".rejoin", rj);
    card.querySelectorAll<HTMLButtonElement>("[data-pb]").forEach((b) => (b.disabled = !next || !live));
  }

  /** aba ESTRATÉGIA: mostra as regras e executa as ligadas (mesmos comandos dos botões) */
  private renderStrat(c: CarState, card: HTMLElement, cs: CardState, idx: number, order: CarState[], gaps: { laps: number; seconds: number }[]) {
    const race = this.race;
    for (const r of STRAT_RULES) {
      const row = card.querySelector<HTMLElement>(`[data-sr="${r.id}"]`)!, s = cs.strat[r.id];
      row.classList.toggle("on", s.on);
      const t = r.text(s.v), el = row.querySelector<HTMLElement>(".st")!;
      if (el.innerHTML !== t) el.innerHTML = t;
      const sh = r.short(s.v), es = row.querySelector<HTMLElement>(".ss")!;
      if (es.innerHTML !== sh) es.innerHTML = sh;
    }
    if (idx < 0) return;
    const near = (i: number, j: number) => (gaps[i] && gaps[j] && gaps[i].laps === gaps[j].laps ? Math.abs(gaps[j].seconds - gaps[i].seconds) : 99);
    const ga = idx > 0 && !order[idx - 1].retired ? near(idx - 1, idx) : 99;
    const gb = idx < order.length - 1 && !order[idx + 1].retired ? near(idx, idx + 1) : 99;
    const left = race.lapsLeft(c), fuelLaps = c.fuel / race.consumption(c), next = upcomingStop(c);
    const need = next ? Math.min(left, Math.max(0.5, left - (race.laps - next.lap))) : left;
    const { cmds, note } = runStrat(cs.strat, { race, c, ga, gb, fuelShort: fuelLaps < need - 0.3, fuelFor: this.fuelFor(c), nextStop: next });
    for (const cmd of cmds) this.hooks.send(cmd);
    for (const n of note) this.note(`Estratégia · ${c.driver.short}: ${n}`);
  }

  private renderPlan(c: CarState, card: HTMLElement, cs: CardState) {
    const upcoming = c.plan.slice(c.planIdx);
    const next = upcoming[0];
    const sum = next
      ? `Box V${next.lap} · ${COMPOUNDS[next.compound].label} · ${this.laps(next.fuel)}V comb.${upcoming.length > 1 ? ` (+${upcoming.length - 1})` : ""}`
      : "Sem paradas planejadas";
    card.querySelectorAll(".plansum").forEach((e) => (e.textContent = sum));
    card.querySelector<HTMLElement>("[data-plantoggle]")!.textContent = cs.planOpen ? "fechar" : "editar";
    const box = card.querySelector<HTMLElement>(".planedit")!;
    box.style.display = cs.planOpen ? "" : "none";
    const sig = JSON.stringify([upcoming, cs.planOpen, c.lap]);
    if (!cs.planOpen || sig === cs.planSig) return;
    cs.planSig = sig;
    // (abre por cima das informações do BOX, no lugar delas; cada parada a MIN_STINT voltas da anterior)
    const canAdd = upcoming.length < MAX_STOPS && nextStopLap(upcoming, c.lap + 1, this.race.laps) !== null;
    box.innerHTML =
      `<div class="pehead"><b>Plano de paradas</b><span><button class="btn small" data-act="add" ${canAdd ? "" : 'disabled title="Não cabe mais parada: no máximo 5, e cada uma pelo menos 2 voltas depois da anterior"'}>+ PARADA</button><button class="btn small" data-act="close">✓ pronto</button></span></div><div class="stops">` +
      upcoming
        .map((s, i) => {
          const [lo, hi] = stopLapRange(upcoming, i, c.lap + 1, this.race.laps);
          return `<div class="stop pe">
            <b title="Parada ${i + 1}">${i + 1}ª</b>
            <span class="stepper"><button data-act="lap" data-i="${i}" data-d="-1" ${s.lap <= lo ? "disabled" : ""}>−</button><b>V${s.lap}</b><button data-act="lap" data-i="${i}" data-d="1" ${s.lap >= hi ? "disabled" : ""}>+</button></span>
            <div class="seg pet">${ALL_COMPOUNDS.map((t) => `<button class="t${t} ${t === s.compound ? "on" : ""}" data-act="tyre" data-i="${i}" data-c="${t}" title="${COMPOUNDS[t].label}">${tyreIcon(t, COMPOUNDS[t].label)}</button>`).join("")}</div>
            <span class="stepper">${icon("fuel")}<button data-act="fuel" data-i="${i}" data-d="-1">−</button><b>${this.laps(s.fuel)}V</b><button data-act="fuel" data-i="${i}" data-d="1">+</button></span>
            <button class="btn small" data-act="del" data-i="${i}" title="Cancelar esta parada">✕</button>
          </div>`;
        })
        .join("") +
      `</div>`;
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
          // ganhou posição = verde, perdeu = vermelho (curto, volta ao normal; "reduzir flashes": mais fraco)
          const gained = (prevPos.get(c.id) ?? i) > i;
          const col = gained ? "59,209,111" : "255,59,59";
          const calm = !!gfx().calm;
          el.animate([{ boxShadow: `inset 0 0 0 999px rgba(${col},${calm ? 0.12 : 0.32})` }, { boxShadow: `inset 0 0 0 999px rgba(${col},0)` }], { duration: 900, easing: "ease-out" });
          // seu carro: a linha dá um pulinho elástico e toca o som (sobe ou desce)
          if (c.team.id === my && race.phase === "racing") {
            if (!calm) el.animate([{ transform: `translateY(${dy}px) scale(1)` }, { transform: "translateY(0) scale(1.06)", offset: 0.55 }, { transform: "translateY(0) scale(1)" }], { duration: 520, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", composite: "replace" });
            sound.position(gained);
            // o card do piloto pisca: verde passou, vermelho foi passado ("reduzir flashes": mais fraco)
            this.cards.get(c.id)?.animate([{ boxShadow: `inset 0 0 0 2px rgba(${col},${calm ? 0.45 : 0.95}), 0 0 ${calm ? 6 : 18}px rgba(${col},${calm ? 0.25 : 0.6})` }, { boxShadow: "inset 0 0 0 2px rgba(0,0,0,0), 0 0 0 rgba(0,0,0,0)" }], { duration: 700, easing: "ease-out" });
          }
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
    // (resumido: uma linha só, volta · tempo · clima)
    if (this.infoMini) this.info.innerHTML = `<span class="oneline">V ${race.currentLap()}/${race.laps} · ${race.phase === "lights" ? "--" : fmtClock(race.time)} · ${rainTxt}${race.wet > 0.05 ? ` ${Math.round(race.wet * 100)}%` : ""}</span>`;
    else this.info.innerHTML = `
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
      // (resumido: só a última mensagem, numa linha)
      const mine = (this.feedMini ? [] : [...this.notes].reverse()).map((n) => `<div class="me">${esc(n.text)}</div>`);
      this.feed.innerHTML =
        (this.pinned ? `<div class="me pin">${esc(this.pinned)}</div>` : "") +
        mine.join("") +
        race.events
          .filter((e) => !e.teamId || e.teamId === my)
          .slice(-((this.feedMini ? 1 : 6) - Math.min(mine.length, this.feedMini ? 0 : mine.length)))
          .reverse()
          .map((e) => `<div class="${e.important ? "imp" : ""}">${esc(e.text)}</div>`)
          .join("");
    }

    // últimas voltas de cada carro (pro ritmo comparado da aba INFO; o cliente não recebe a telemetria)
    for (const c of race.cars) {
      const h = this.lapHist.get(c.id) ?? { last: null, laps: [] };
      if (c.lastLap !== null && c.lastLap !== h.last) {
        h.laps = [...h.laps, c.lastLap].slice(-4);
        h.last = c.lastLap;
      }
      this.lapHist.set(c.id, h);
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
        // (a dica original fica guardada; desligado, explica por quê)
        b.dataset.tip ??= b.title;
        b.title = b.disabled ? "Desligado enquanto poupa o motor" : b.dataset.tip;
      });
      card.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => {
        b.classList.toggle("on", b.dataset.engine === c.engine);
        b.disabled = !!c.engineSave && b.dataset.engine === "rich";
        // (a dica original fica guardada; desligado, explica por quê)
        b.dataset.tip ??= b.title;
        b.title = b.disabled ? "Desligado enquanto poupa o motor" : b.dataset.tip;
      });
      setDial(card.querySelector<HTMLElement>('[data-dial="pace"]')!, c.pace, ["push", "normal", "conserve"].indexOf(c.pace));
      setDial(card.querySelector<HTMLElement>('[data-dial="engine"]')!, c.engine, ["rich", "normal", "lean"].indexOf(c.engine));
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
      card.querySelectorAll(".fval").forEach((e) => (e.textContent = `p/ ${this.laps(fuelShown)} v`));
      card.querySelector<HTMLElement>("[data-fuelauto]")!.classList.toggle("primary", cs.fuelLaps === null);
      this.renderPlan(c, card, cs);
      this.renderStrategy(c, card, cs, idx, order, gaps);
      this.renderStrat(c, card, cs, idx, order, gaps);

      const rb = card.querySelector<HTMLButtonElement>("[data-retire]")!;
      rb.hidden = c.retired || c.finished;
      rb.textContent = c.retireAtBox ? "✕ DESISTIR DO ABANDONO" : "🏳 ABANDONAR";
      rb.classList.toggle("primary", !!c.retireAtBox);
      const box = card.querySelector<HTMLButtonElement>(".boxbtn")!;
      box.className = "boxbtn";
      box.title = "";
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
        // (curto: pneu e combustível em ícone, cabe no botão da coluna do carro; clicar de novo cancela)
        const h = `BOX, BOX! ${tyreIcon(c.boxRequest, COMPOUNDS[c.boxRequest].label)}${icon("fuel")}${this.laps(c.boxFuel)}V`;
        if (box.innerHTML !== h) box.innerHTML = h;
        box.title = `Box chamado: ${COMPOUNDS[c.boxRequest].label}, combustível pra ${this.laps(c.boxFuel)} voltas. Clique pra cancelar`;
        box.classList.add("armed");
      } else if (c.planDue) {
        const h = `PLANO: BOX AGORA? ${tyreIcon(cs.next, COMPOUNDS[cs.next].label)}${icon("fuel")}${this.laps(this.fuelFor(c))}V`;
        if (box.innerHTML !== h) box.innerHTML = h;
        box.title = `O plano era parar nesta volta: ${COMPOUNDS[cs.next].label}, combustível pra ${this.laps(this.fuelFor(c))} voltas`;
        box.classList.add("suggest");
      } else {
        box.textContent = "BOX";
      }
    }
  }
}

/** botão giratório de 3 posições (Ritmo/Motor): os botões continuam data-pace/data-engine (atalhos e voz clicam neles) */
function dialHtml(key: "pace" | "engine", label: string, tip: string, opts: [string, string, Action][]): string {
  return `<div class="dial" data-dial="${key}" title="${tip}"><div class="opts"><i class="thumb"></i>${opts
    .map(([m, l, a]) => `<button data-${key}="${m}" title="${label}: ${l} (tecla ${keyName(a)} no piloto seguido)">${l}</button>`)
    .join("")}</div><span class="cl">${label}</span></div>`;
}

/** posição do botão giratório (índice do ponteiro e o valor, que pinta o ponteiro) */
function setDial(el: HTMLElement, v: string, idx: number) {
  if (el.dataset.v === v) return;
  el.dataset.v = v;
  el.querySelector<HTMLElement>(".opts")!.style.setProperty("--idx", String(idx));
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
