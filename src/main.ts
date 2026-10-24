import "./fonts.css";
import "./styles.css";
import { enterScreen, isCovered, revealScreen, wipe } from "./ui/transition";
import { showCalendar } from "./ui/calendar";
import { saveLocalLap } from "./ui/records";
import { sound } from "./audio/sound";
import { music } from "./audio/music";
import { HelpWidget, reportFrame, type HelpTab } from "./ui/help";
import { LocalConnection, WsConnection, type Connection } from "./net/connection";
import type { LobbyState, Phase, ServerMsg } from "./net/protocol";
import { Minimap, Renderer } from "./render/renderer";
import { Race, type RaceOptions } from "./sim/race";
import type { QualiResult } from "./sim/weekend";
import { storeSet, toast, updateWaitBar } from "./ui/common";
import { Hud, SPEEDS } from "./ui/hud";
import { LobbyScreen } from "./ui/lobby";
import { type SoloSetup, showMenu, type MenuChoice } from "./ui/menu";
import { PodiumScreen } from "./ui/podium";
import { PracticeScreen } from "./ui/practice";
import { QualiScreen } from "./ui/quali";
import { StrategyScreen } from "./ui/strategy";
import { showDraft } from "./ui/draft";
import { HqScreen } from "./ui/hq";
import { ReplayRecorder, showReplay } from "./render/replay";
import { getLivery } from "./ui/liveryStore";
import { ChatWidget } from "./ui/chat";
import { confirmDialog } from "./ui/confirm";
import { account } from "./net/account";
import { showLogin } from "./ui/login";
import { setupInstall } from "./ui/install";
import { mergeCloudSaves, putSave, type SaveMap } from "./ui/saves";
import { POINTS, standings } from "./sim/championship";

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
  private chat: ChatWidget | null = null;
  /** gravação da corrida em andamento (replay) e a da última corrida */
  private replay = new ReplayRecorder();
  private lastReplay: ReplayRecorder | null = null;
  /** escolheu jogar sem conta nesta visita */
  private guest = false;
  private recorded = -1;

  helpTab(): HelpTab {
    const p = this.screenPhase;
    return p === "practice" ? "treino" : p === "strategy" || p === "quali" ? "estrategia" : p === "race" ? "corrida" : "jogo";
  }

  menu() {
    this.teardown();
    music.setPlaying(true);
    // com contas ligadas, pede login (ou "jogar sem conta")
    // tela de entrada logo de cara (login ou "jogar sem conta")
    if (!account.user && !this.guest && !AUTO) {
      this.screenPhase = "menu";
      showLogin(app, (guest) => {
        this.guest = guest;
        // campeonatos salvos na nuvem entram na lista do navegador (o mais novo vence)
        mergeCloudSaves(account.profile?.champs as SaveMap | null);
        if (account.profile) {
          storeSet("pwm.name", account.profile.name);
          storeSet("pwm.team", account.profile.team_name);
        }
        this.menu();
      });
      return;
    }
    if (this.screenPhase && this.screenPhase !== "menu") wipe(); // voltando do jogo pro menu
    this.screenPhase = "menu";
    showMenu(app, (c) => this.connect(c), async () => {
      await account.signOut();
      this.guest = false;
      this.menu();
    });
    if (isCovered()) revealScreen(true); // a faixa para no lugar dela no menu
    if (AUTO) this.connect({ mode: "solo", name: "Teste", teamName: "Equipe Teste" });
  }

  /** jogo solo montado no menu (tipo, pista, regras): começa direto, sem a tela de lobby */
  private autoSetup: SoloSetup | null = null;
  private autoRunning = false;

  private connect(c: MenuChoice, retry = 0) {
    // campeonato online salvo: cria uma sala nova no servidor com ele (os amigos entram pelo código)
    const onlineResume = c.mode === "resume" && !!c.save?.online;
    const local = c.mode === "solo" || (c.mode === "resume" && !onlineResume);
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
    // v = versão do jogo: o servidor recusa se estiver desatualizado (evita sala quebrada)
    const v = __BUILD__;
    if (c.mode === "rejoin") conn.send({ t: "rejoin", code: c.code!, token: c.token!, v });
    if (c.mode === "create" || onlineResume) conn.send({ t: "create", name: c.name, teamName: c.teamName, v, resume: onlineResume ? c.save : undefined });
    if (c.mode === "join") conn.send({ t: "join", code: c.code!, name: c.name, teamName: c.teamName, v });
    // a pintura do carro/emblema do jogador vai junto
    const liv = getLivery();
    if (liv) conn.send({ t: "livery", livery: liv });
    // solo montado no menu: equipe, regras e já começa
    this.autoSetup = c.setup ?? null;
    this.autoRunning = false;
    if (c.setup) {
      const s = c.setup;
      conn.send({ t: "team", teamId: s.teamId });
      conn.send({ t: "profile", name: c.name, teamName: c.teamName });
      conn.send({
        t: "options",
        laps: s.laps,
        trackIndex: s.trackIndex,
        realDrivers: s.realDrivers,
        equalCars: s.equalCars,
        champ: s.kind === "campeonato",
        champPct: s.champPct,
        champName: s.champName,
        quick: s.kind === "corrida",
      });
      conn.send({ t: "startWeekend" });
    }
  }

  private leave() {
    const c = this.conn;
    this.conn = null;
    c?.close();
    if (this.lobby && !this.lobby.solo) storeSet("pwm.session", "");
    this.chat?.destroy();
    this.chat = null;
    this.lobby = null;
    this.menu();
  }

  private myTeam(): string {
    return this.lobby?.players.find((p) => p.id === this.lobby!.you)?.teamId ?? "";
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case "error":
        if (/Aperte F5/.test(m.msg)) {
          // jogo desatualizado ou servidor atualizando: oferece recarregar na hora
          storeSet("pwm.session", "");
          void confirmDialog({ title: "Jogo atualizado", icon: "🔄", text: m.msg, ok: "RECARREGAR AGORA", cancel: "DEPOIS" }).then((ok) => ok && location.reload());
          if (!this.lobby) this.leave();
          break;
        }
        toast(m.msg);
        if (/não existe mais|voltar pra essa sala/.test(m.msg)) storeSet("pwm.session", "");
        if (!this.lobby) this.leave();
        break;
      case "chat":
        this.chat?.add(m.line);
        break;
      case "champSave":
        // campeonato online: o host guarda (dá pra retomar numa sala nova se o servidor reiniciar)
        putSave(m.save);
        break;
      case "lobby":
        this.lobby = m.lobby;
        // chat só no online
        if (!m.lobby.solo && !this.chat) this.chat = new ChatWidget((text) => this.conn?.send({ t: "chat", text }), () => this.lobby?.you ?? "");
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
          this.replay.add(this.view.race); // grava pro replay
        }
        break;
      case "end":
        this.lastRace = this.view?.race ?? null;
        if (this.lastRace) this.lastRace.telemetry = m.tele;
        this.lastReplay = this.replay;
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
    // jogo montado no menu: não mostra o lobby (nem antes de começar, nem no fim: volta pro menu)
    if (l.phase === "lobby" && this.autoSetup) {
      if (this.autoRunning) {
        this.autoSetup = null;
        this.autoRunning = false;
        this.leave();
      }
      return;
    }
    if (this.autoSetup) this.autoRunning = true;
    if (l.phase === "race") return; // a corrida começa com a mensagem "start"
    if (l.phase === "quali" && !this.quali) return; // espera os tempos
    this.teardown();
    this.screenPhase = l.phase;
    wipe(); // cobre na hora (ou já veio coberta pela faixa do menu); revela no fim, com a tela nova montada
    music.setPlaying(true); // fora da corrida: trilha tocando
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
        if (l.weekend && this.draftSeen !== l.weekend.seed) {
          this.draftSeen = l.weekend.seed;
          const draft = !l.champ || (l.champ.round === 0 && (l.champ.season ?? 1) === 1);
          const openDraft = () => draft && !AUTO && showDraft(l, (carId) => conn.send({ t: "swapDriver", carId }));
          // começo de temporada do campeonato: primeiro o calendário (pistas sorteadas), depois o sorteio dos pilotos
          if (l.champ && l.champ.round === 0 && !AUTO) showCalendar(l.champ, openDraft);
          else openDraft();
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
          this.recordStats(l, this.lastRace);
          const race = this.lastRace, rec = this.lastReplay;
          this.screen = new PodiumScreen(app, conn, race, l, rec && rec.frames.length > 4 ? () => showReplay(race, rec, this.myTeam()) : undefined);
          sound.fanfare();
        }
        break;
      case "hq":
        // sede da equipe (entre as etapas do campeonato)
        if (l.champ) this.screen = new HqScreen(app, conn, l);
        if (AUTO) setTimeout(() => conn.send({ t: "ready", ready: true }), 300);
        break;
    }
    window.scrollTo(0, 0);
    updateWaitBar(l); // online: painel de quem já está pronto
    revealScreen();
    enterScreen(app);
  }

  /** soma a corrida nas estatísticas da conta (melhor carro da sua equipe) */
  private recordStats(l: LobbyState, race: Race) {
    if (this.recorded === race.opts.seed) return;
    this.recorded = race.opts.seed;
    const my = this.myTeam();
    const order = race.ordered();
    const mine = order.map((c, i) => ({ c, i })).filter((x) => x.c.team.id === my);
    // melhor volta da sua equipe: recorde no navegador (vale também sem conta)
    const bestCar = mine.map((x) => x.c).filter((c) => c.bestLap).sort((a, b) => a.bestLap! - b.bestLap!)[0];
    if (bestCar) saveLocalLap(race.opts.trackIndex, bestCar.bestLap!, bestCar.driver.name, !l.solo);
    if (!account.profile) return;
    const fin = mine.filter((x) => !x.c.retired).map((x) => x.i + 1);
    const points = mine.reduce((a, x) => a + (x.c.retired ? 0 : (POINTS[x.i] ?? 0)), 0);
    const ch = l.champ;
    let title = false;
    if (ch?.finished) {
      const ids = race.cars.map((c) => c.id);
      const top = standings(ch.driverPts, ids, ch.results, (d) => race.cars.find((c) => c.id === d)!.team.id)[0];
      title = race.cars.find((c) => c.id === top.id)?.team.id === my;
    }
    account.recordRace({
      finish: fin.length ? Math.min(...fin) : null,
      pole: race.opts.grid?.[0] !== undefined && race.cars.find((c) => c.id === race.opts.grid![0])?.team.id === my,
      points,
      champDone: !!ch?.finished,
      title,
      online: !l.solo,
      // melhor volta da sua equipe (vira recorde no ranking se for a sua melhor ali)
      lap: bestCar ? { track: race.opts.trackIndex, time: bestCar.bestLap!, driver: bestCar.driver.name } : undefined,
    });
  }

  private startRace(opts: RaceOptions, speed: number) {
    this.replay = new ReplayRecorder();
    music.setPlaying(false); // na corrida, só o som dos carros
    this.teardown();
    this.screenPhase = "race";
    wipe();
    app.innerHTML = `<canvas id="view"></canvas>`;
    revealScreen();
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
    view.renderer.showEngineers = !this.lobby?.solo;
    let prevSpeed = 1;
    const setSpeed = (s: number) => {
      if (!isHost) return;
      if (s === 0 && view.speed !== 0) prevSpeed = view.speed;
      conn.send({ t: "speed", speed: s });
      view.speed = s;
    };
    view.hud = new Hud(app, race, {
      myTeamId: my,
      online: !this.lobby?.solo,
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
      if (e.key === "p" || e.key === "P") view.hud.toggleBoard();
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
      view.hud.drawOnboard(realDt, view.renderer.interp);
      view.renderer.setBottomInset(view.hud.coverHeight() * 0.85);
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
  setupInstall();
  await document.fonts?.ready;
  await account.restore().catch(() => false);
  mergeCloudSaves(account.profile?.champs as SaveMap | null);
  const appInst = new App();
  new HelpWidget(() => appInst.helpTab());
  // áudio só é liberado depois de um clique; aproveita pra fazer o "tic" dos botões
  document.addEventListener("pointerdown", (e) => {
    sound.unlock();
    music.unlock();
    if ((e.target as HTMLElement).closest("button")) sound.click();
  }, true);
  appInst.menu();
})();
