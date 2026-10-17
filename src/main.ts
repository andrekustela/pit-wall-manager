import "./styles.css";
import { sound } from "./audio/sound";
import { HelpWidget, reportFrame, type HelpTab } from "./ui/help";
import { LocalConnection, WsConnection, type Connection } from "./net/connection";
import type { LobbyState, Phase, ServerMsg } from "./net/protocol";
import { Minimap, Renderer } from "./render/renderer";
import { Race, type RaceOptions } from "./sim/race";
import type { QualiResult } from "./sim/weekend";
import { storeSet, toast } from "./ui/common";
import { Hud, SPEEDS } from "./ui/hud";
import { LobbyScreen } from "./ui/lobby";
import { showMenu, type MenuChoice } from "./ui/menu";
import { PodiumScreen } from "./ui/podium";
import { PracticeScreen } from "./ui/practice";
import { QualiScreen } from "./ui/quali";
import { StrategyScreen } from "./ui/strategy";
import { showDraft } from "./ui/draft";

interface Screen {
  update?(lobby: LobbyState): void;
  destroy(): void;
}

interface RaceView {
  race: Race;
  renderer: Renderer;
  hud: Hud;
  minimap: Minimap;
  follow: string;
  speed: number;
  raf: number;
  onKey: (e: KeyboardEvent) => void;
}

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
/** modo de teste: ?auto passa sozinho pelas fases (solo) */
const AUTO = params.has("auto");

class App {
  private conn: Connection | null = null;
  private lobby: LobbyState | null = null;
  private screen: Screen | null = null;
  private screenPhase: Phase | "menu" | null = null;
  private quali: { results: QualiResult[]; wet: number } | null = null;
  private view: RaceView | null = null;
  private lastRace: Race | null = null;
  private soundEvents = 0;
  private draftSeen = -1;

  helpTab(): HelpTab {
    const p = this.screenPhase;
    return p === "practice" ? "treino" : p === "strategy" || p === "quali" ? "estrategia" : p === "race" ? "corrida" : "jogo";
  }

  menu() {
    this.teardown();
    this.screenPhase = "menu";
    showMenu(app, (c) => this.connect(c));
    if (AUTO) this.connect({ mode: "solo", name: "Teste", teamName: "Equipe Teste" });
  }

  private connect(c: MenuChoice, retry = 0) {
    const local = c.mode === "solo" || c.mode === "resume";
    const conn: Connection = local ? new LocalConnection(c.name, c.teamName, c.save) : new WsConnection();
    this.conn = conn;
    conn.onMessage = (m) => {
      if (m.t === "lobby" && !m.lobby.solo && m.lobby.token) {
        retry = 0;
        storeSet("pwm.session", JSON.stringify({ code: m.lobby.code, token: m.lobby.token }));
      }
      this.onMessage(m);
    };
    conn.onClose = (reason) => {
      if (this.conn !== conn) return;
      this.conn = null;
      // caiu no meio do fim de semana: tenta voltar sozinho algumas vezes
      const l = this.lobby;
      if (l && !l.solo && l.token && l.phase !== "lobby" && retry < 6) {
        toast(retry === 0 ? "Conexão caiu. Reconectando..." : `Reconectando... (${retry + 1}/6)`);
        setTimeout(() => this.connect({ mode: "rejoin", name: c.name, teamName: c.teamName, code: l.code, token: l.token }, retry + 1), 1500 + retry * 1000);
        return;
      }
      toast(reason);
      this.lobby = null;
      this.menu();
    };
    // telas antigas guardam a conexão velha: redesenha tudo ao voltar
    if (c.mode === "rejoin") this.screenPhase = null;
    if (c.mode === "rejoin") conn.send({ t: "rejoin", code: c.code!, token: c.token! });
    if (c.mode === "create") conn.send({ t: "create", name: c.name, teamName: c.teamName });
    if (c.mode === "join") conn.send({ t: "join", code: c.code!, name: c.name, teamName: c.teamName });
  }

  private leave() {
    const c = this.conn;
    this.conn = null;
    c?.close();
    if (this.lobby && !this.lobby.solo) storeSet("pwm.session", "");
    this.lobby = null;
    this.menu();
  }

  private myTeam(): string {
    return this.lobby?.players.find((p) => p.id === this.lobby!.you)?.teamId ?? "";
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case "error":
        toast(m.msg);
        if (/não existe mais|voltar pra essa sala/.test(m.msg)) storeSet("pwm.session", "");
        if (!this.lobby) this.leave();
        break;
      case "lobby":
        this.lobby = m.lobby;
        this.syncScreen();
        break;
      case "practice":
        (this.screen as PracticeScreen | null)?.onPractice?.(m);
        break;
      case "quali":
        this.quali = { results: m.results, wet: m.wet };
        this.syncScreen();
        break;
      case "start":
        this.startRace(m.opts, m.speed);
        break;
      case "snap":
        if (this.view) {
          this.view.race.applySnapshot(m.snap);
          this.view.speed = m.speed;
          this.view.renderer.onSnapshot(m.speed);
        }
        break;
      case "end":
        this.lastRace = this.view?.race ?? null;
        if (this.lastRace) this.lastRace.telemetry = m.tele;
        break;
    }
  }

  /** mostra a tela da fase atual (ou só atualiza se já estiver nela) */
  private syncScreen() {
    const l = this.lobby!;
    if (l.phase === this.screenPhase) {
      this.screen?.update?.(l);
      return;
    }
    if (l.phase === "race") return; // a corrida começa com a mensagem "start"
    if (l.phase === "quali" && !this.quali) return; // espera os tempos
    this.teardown();
    this.screenPhase = l.phase;
    const conn = this.conn!;
    switch (l.phase) {
      case "lobby":
        this.quali = null;
        this.screen = new LobbyScreen(app, conn, l, () => this.leave());
        if (AUTO) conn.send({ t: "startWeekend" });
        break;
      case "practice":
        this.quali = null;
        this.screen = new PracticeScreen(app, conn, l);
        // pilotos acabaram de ser sorteados (fim de semana novo ou 1ª etapa do campeonato)
        if (l.weekend && this.draftSeen !== l.weekend.seed && (!l.champ || l.champ.round === 0)) {
          this.draftSeen = l.weekend.seed;
          if (!AUTO) showDraft(l, (carId) => conn.send({ t: "swapDriver", carId }));
        }
        if (AUTO) conn.send({ t: "ready", ready: true });
        break;
      case "quali":
        this.screen = new QualiScreen(app, conn, l, this.quali!.results, this.quali!.wet);
        if (AUTO) setTimeout(() => conn.send({ t: "ready", ready: true }), 300);
        break;
      case "strategy":
        this.screen = new StrategyScreen(app, conn, l, this.quali!.results);
        if (AUTO) setTimeout(() => conn.send({ t: "ready", ready: true }), 300);
        break;
      case "podium":
        if (this.lastRace) {
          this.screen = new PodiumScreen(app, conn, this.lastRace, l);
          sound.fanfare();
        }
        break;
    }
    window.scrollTo(0, 0);
  }

  private startRace(opts: RaceOptions, speed: number) {
    this.teardown();
    this.screenPhase = "race";
    app.innerHTML = `<canvas id="view"></canvas>`;
    const race = new Race(opts);
    const my = this.myTeam();
    const mine = race.cars.filter((c) => c.team.id === my).sort((a, b) => a.position - b.position);
    const isHost = this.lobby?.hostId === this.lobby?.you;
    const conn = this.conn!;
    const view = { race, follow: mine[0]?.id ?? race.cars[0].id, speed } as RaceView;
    const setFollow = (id: string) => {
      view.follow = id;
      view.renderer.followId = id;
      view.hud.update();
    };
    view.renderer = new Renderer(app.querySelector<HTMLCanvasElement>("#view")!, race, view.follow, setFollow);
    let prevSpeed = 1;
    const setSpeed = (s: number) => {
      if (!isHost) return;
      if (s === 0 && view.speed !== 0) prevSpeed = view.speed;
      conn.send({ t: "speed", speed: s });
      view.speed = s;
    };
    view.hud = new Hud(app, race, {
      myTeamId: my,
      isHost,
      getFollow: () => view.follow,
      setFollow,
      getSpeed: () => view.speed,
      setSpeed,
      send: (cmd) => conn.send({ t: "cmd", cmd }),
      skip: () => conn.send({ t: "skip" }),
      exit: () => (isHost ? conn.send({ t: "abort" }) : this.leave()),
    });
    view.minimap = new Minimap(view.hud.minimapCanvas, race, setFollow);
    view.onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpeed(view.speed === 0 ? prevSpeed : 0);
      }
      const n = Number(e.key);
      if (n >= 1 && n <= SPEEDS.length) setSpeed(SPEEDS[n - 1]);
      if (e.key === "m" || e.key === "M") view.hud.toggleCompact();
      if (e.key === "+" || e.key === "=") view.renderer.zoomIn();
      if (e.key === "-" || e.key === "_") view.renderer.zoomOut();
      if (e.key === "Tab" && mine.length) {
        e.preventDefault();
        const i = mine.findIndex((c) => c.id === view.follow);
        setFollow(mine[(i + 1) % mine.length].id);
      }
    };
    window.addEventListener("keydown", view.onKey);

    let lastT = performance.now();
    let hudT = 0;
    const frame = (now: number) => {
      const gap = (now - lastT) / 1000;
      const realDt = gap > 0.5 ? 0.6 : Math.min(0.1, gap);
      lastT = now;
      // o safety car saiu da pista: câmera volta pro líder
      if (view.follow === "SC" && !(race.sc.active && race.sc.onTrack)) setFollow(race.leader().id);
      view.renderer.draw(realDt, view.speed);
      reportFrame(now);
      sound.update(race, view.follow, view.speed);
      if (race.events.length > this.soundEvents) {
        // voltando de aba minimizada (frame muito atrasado): não despeja os sons acumulados
        if (realDt < 0.5) sound.events(race.events.slice(this.soundEvents), my);
        this.soundEvents = race.events.length;
      }
      view.minimap.draw(view.follow);
      hudT += realDt;
      if (hudT > 0.1) {
        hudT = 0;
        view.hud.update();
      }
      view.raf = requestAnimationFrame(frame);
    };
    view.hud.update();
    this.soundEvents = 0;
    sound.startRace();
    view.raf = requestAnimationFrame(frame);
    this.view = view;
    // depuração: ?debug expõe a corrida na tela (window.__view)
    if (params.has("debug")) (window as unknown as { __view: RaceView }).__view = view;
    if (AUTO && params.get("speed")) setSpeed(Number(params.get("speed")));
  }

  private teardown() {
    this.screen?.destroy();
    this.screen = null;
    if (this.view) {
      sound.stopRace();
      cancelAnimationFrame(this.view.raf);
      window.removeEventListener("keydown", this.view.onKey);
      this.view.renderer.destroy();
      this.view.hud.destroy();
      this.view = null;
    }
    app.innerHTML = "";
  }
}

(async () => {
  await document.fonts?.ready;
  const appInst = new App();
  new HelpWidget(() => appInst.helpTab());
  // áudio só é liberado depois de um clique; aproveita pra fazer o "tic" dos botões
  document.addEventListener("pointerdown", (e) => {
    sound.unlock();
    if ((e.target as HTMLElement).closest("button")) sound.click();
  }, true);
  appInst.menu();
})();
