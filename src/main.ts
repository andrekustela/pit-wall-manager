import "./fonts.css";
import "./styles.css";
import { enterScreen, isCovered, revealScreen, wipe } from "./ui/transition";
import { showCalendar } from "./ui/calendar";
import { showLoading } from "./ui/loading";
import { teamVoice } from "./audio/voice";
import { parseCommand, voiceCmd, type VoiceAction } from "./audio/voiceCmd";
import { pickSlot, radioAI, type AIAction } from "./audio/radioAI";
import { carStatusText } from "./ui/radioContext";
import { car3dReady } from "./render/car3d";
import { DriverRequests } from "./ui/requests";
import { applyEditor } from "./ui/editorData";

/** título da tela de carregamento no começo do fim de semana */
function weekendLabel(l: LobbyState): string {
  const ch = l.champ;
  if (!ch) return "FIM DE SEMANA";
  return `${ch.name ? ch.name.toUpperCase() + " · " : ""}ETAPA ${ch.round + 1} DE ${ch.rounds.length}`;
}
import { saveLocalLap } from "./ui/records";
import { sound } from "./audio/sound";
import { music } from "./audio/music";
import { HelpWidget, reportFrame, type HelpTab } from "./ui/help";
import { LocalConnection, WsConnection, type Connection } from "./net/connection";
import type { LobbyState, Phase, ServerMsg } from "./net/protocol";
import { Minimap, Renderer } from "./render/renderer";
import { Race, type RaceOptions } from "./sim/race";
import { COMPOUNDS, ENGINE, PACE, type EngineMode, type PaceMode } from "./sim/types";
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
import { mergeCloudSaves, putSave, type SaveMap, onSaveWarn } from "./ui/saves";
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
  /** muda a câmera pra um carro (desliga o modo TV) */
  setFollow: (id: string) => void;
  /** liga/desliga o modo TV (devolve se ficou ligado) */
  toggleTv: () => boolean;
  onKey: (e: KeyboardEvent) => void;
}

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
/** modo de teste: ?auto passa sozinho pelas fases (solo) */
const AUTO = params.has("auto");
/** teste: ?auto&hold=practice|strategy para nessa tela (pra ver/capturar) */
const HOLD = params.get("hold");

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

  /** mensagem do comando de voz no feed da corrida */
  voiceNote(text: string) {
    this.view?.hud.note(text);
  }

  /** linha fixa do comando de voz no feed da corrida */
  voicePin(text: string | null) {
    this.view?.hud.pin(text);
  }

  /** está numa corrida (com a pista na tela)? */
  inRace(): boolean {
    return !!this.view;
  }

  /** está numa tela de jogo (não no menu/login)? */
  inGame(): boolean {
    return !!this.conn && this.screenPhase !== "menu";
  }

  /** botão ⌂: volta pro menu (pergunta antes; campeonato fica salvo) */
  async exitToMenu() {
    if (!this.inGame()) return;
    const l = this.lobby;
    const text = l?.champ
      ? "O campeonato fica salvo: você continua de onde parou em Modo solo / Modo online."
      : l && !l.solo
        ? "Você sai da sala online (a IA assume o seu carro)."
        : "Este jogo vai ser encerrado.";
    // host numa sala online: também dá pra encerrar a corrida/fim de semana de todo mundo (voltam pro lobby)
    const host = !!l && !l.solo && l.hostId === l.you && l.phase !== "lobby";
    const ok = await confirmDialog({
      title: "Voltar ao menu",
      icon: "⌂",
      text: host ? `${text}
Ou encerre pra todos: a sala inteira volta pro lobby (o resultado não vale).` : text,
      ok: host ? "SÓ EU SAIO" : "IR PRO MENU",
      cancel: "CONTINUAR JOGANDO",
      alt: host ? "ENCERRAR PRA TODOS" : undefined,
      onAlt: () => this.conn?.send({ t: "abort" }),
    });
    if (ok && this.inGame()) {
      this.autoSetup = null;
      this.leave();
    }
  }

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
      showLogin(app, async (guest) => {
        this.guest = guest;
        // campeonatos salvos na nuvem entram na lista do navegador (o mais novo vence) antes do menu abrir
        mergeCloudSaves((await account.loadChamps().catch(() => ({}))) as SaveMap);
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
    // teste: ?auto&once só entra no jogo da primeira vez (pra dar pra ver a volta pro menu)
    if (AUTO && !(params.has("once") && this.autoOnce)) {
      this.autoOnce = true;
      this.connect({ mode: "solo", name: "Teste", teamName: "Equipe Teste" });
    }
  }
  private autoOnce = false;

  /** jogo solo montado no menu (tipo, pista, regras): começa direto, sem a tela de lobby */
  /** pedidos de autorização do piloto no rádio (na corrida) */
  private requests: DriverRequests | null = null;
  private autoSetup: SoloSetup | null = null;
  private autoRunning = false;

  private connect(c: MenuChoice, retry = 0) {
    // campeonato online salvo: cria uma sala nova no servidor com ele (os amigos entram pelo código)
    const onlineResume = c.mode === "resume" && !!c.save?.online;
    const local = c.mode === "solo" || (c.mode === "resume" && !onlineResume);
    const conn: Connection = local ? new LocalConnection(c.name, c.teamName, c.save) : new WsConnection();
    this.conn = conn;
    conn.onMessage = (m) => {
      if (this.conn !== conn) return; // conexão já encerrada (ex.: fim do jogo voltando pro menu): ignora o que ainda chegar
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
        if (AUTO && HOLD !== "practice") conn.send({ t: "ready", ready: true });
        break;
      case "quali":
        this.screen = new QualiScreen(app, conn, l, this.quali!.results, this.quali!.wet);
        if (AUTO) setTimeout(() => conn.send({ t: "ready", ready: true }), 300);
        break;
      case "strategy":
        this.screen = new StrategyScreen(app, conn, l, this.quali!.results);
        if (AUTO && HOLD !== "strategy") setTimeout(() => conn.send({ t: "ready", ready: true }), 300);
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
    // rádio: 1º e 2º piloto da equipe (ordem fixa da equipe, cada um com sua voz)
    const teamCars = race.cars.filter((c) => c.team.id === my);
    teamVoice.drivers = () => teamCars.map((c) => ({ id: c.id, short: c.driver.short, name: c.driver.name }));
    // 📻 no nome de quem está falando (classificação e card do piloto)
    teamVoice.onTalk = (id) => {
      document.querySelectorAll<HTMLElement>("[data-talk]").forEach((el) => delete el.dataset.talk);
      if (id) document.querySelectorAll<HTMLElement>(`[data-car="${id}"], .driver.panel[data-id="${id}"]`).forEach((el) => (el.dataset.talk = "1"));
    };
    const isHost = this.lobby?.hostId === this.lobby?.you;
    const conn = this.conn!;
    const view = { race, follow: mine[0]?.id ?? race.cars[0].id, speed } as RaceView;
    // modo TV: a câmera corta sozinha pra disputa mais apertada (escolher um piloto desliga)
    let tv = false, tvSwitch = 0;
    const follow = (id: string) => {
      view.follow = id;
      view.renderer.followId = id;
      view.hud.update();
    };
    const setFollow = (id: string) => {
      if (tv) {
        tv = false;
        view.hud.setTv(false);
      }
      follow(id);
    };
    view.setFollow = setFollow;
    const toggleTv = () => {
      tv = !tv;
      tvSwitch = 0;
      view.hud.note(tv ? "📺 Modo TV ligado: a câmera segue as disputas" : "📺 Modo TV desligado");
      return tv;
    };
    view.toggleTv = toggleTv;
    const tvPick = () => {
      if (!tv || race.time - tvSwitch < 7) return;
      const order = race.ordered().filter((c) => !c.retired && !c.finished && c.pit === "none");
      const gapOf = (i: number) => (race.dist(order[i - 1]) - race.dist(order[i])) / Math.max(25, order[i].v);
      // a atual ainda está brigando: fica nela
      const cur = order.findIndex((c) => c.id === view.follow);
      if (cur > 0 && gapOf(cur) < 1.3) return;
      let best = -1, score = Infinity;
      for (let i = 1; i < order.length; i++) {
        const g = gapOf(i);
        if (g < 1.2 && g + i * 0.04 < score) {
          score = g + i * 0.04;
          best = i;
        }
      }
      const id = best > 0 ? order[best].id : order[0]?.id;
      if (id && id !== view.follow) {
        tvSwitch = race.time;
        follow(id);
      }
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
    // largada: tela de carregamento sempre (fica até a pista estar desenhável). No solo a corrida
    // espera parada até o "Vamos começar!"; online ela não segura os outros e some sozinha
    if (!AUTO) {
      const solo = !!this.lobby?.solo;
      if (solo && isHost) setSpeed(0);
      void showLoading({
        trackIndex: opts.trackIndex,
        laps: opts.laps,
        label: this.lobby?.champ ? `LARGADA · ${weekendLabel(this.lobby)}` : "LARGADA",
        ready: () => view.renderer.trackReady,
        play: solo,
      }).then(() => {
        if (solo && isHost && this.view === view) setSpeed(speed || 1);
      });
    }
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
      toggleTv,
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
      // atalhos do piloto seguido: B box, Q/W/E ritmo, Z/X/C motor
      const slot = teamVoice.drivers().findIndex((d) => d.id === view.follow);
      const fc = race.cars.find((c) => c.id === view.follow);
      if (slot >= 0 && fc && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const k = e.code;
        if (k === "KeyB") this.act(view, { kind: fc.boxRequest ? "cancelBox" : "box", slot }, slot);
        const pace = { KeyQ: "push", KeyW: "normal", KeyE: "conserve" }[k] as PaceMode | undefined;
        if (pace) this.act(view, { kind: "pace", slot, mode: pace }, slot);
        const eng = { KeyZ: "rich", KeyX: "normal", KeyC: "lean" }[k] as EngineMode | undefined;
        if (eng) this.act(view, { kind: "engine", slot, mode: eng }, slot);
      }
      if (e.code === "KeyT") view.hud.setTv(toggleTv());
      if (e.key === "Tab" && mine.length) {
        e.preventDefault();
        const i = mine.findIndex((c) => c.id === view.follow);
        setFollow(mine[(i + 1) % mine.length].id);
      }
    };
    window.addEventListener("keydown", view.onKey);
    // comando de voz: o engenheiro executa pelos mesmos botões do card do piloto
    voiceCmd.onCommand = (a, heard) => this.voiceCommand(view, a, heard);
    this.requests?.destroy();
    this.requests = AUTO ? null : new DriverRequests(race, (a, slot) => this.act(view, a, slot), (t) => view.hud.note(t));

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
      this.requests?.tick(my);
      tvPick();
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

  /** executa uma ordem num piloto (clica no botão certo do card); devolve o que foi feito e a resposta no rádio */
  act(view: RaceView, a: Exclude<VoiceAction, { kind: "yes" } | { kind: "no" }>, slot: number): { what: string; ack: string } | null {
    const id = teamVoice.drivers()[slot]?.id;
    const car = view.race.cars.find((c) => c.id === id);
    const card = id ? document.querySelector<HTMLElement>(`.driver.panel[data-id="${id}"]`) : null;
    if (!car || !card) return null;
    const click = (sel: string) => card.querySelector<HTMLButtonElement>(sel)?.click();
    switch (a.kind) {
      case "box":
        if (!car.boxRequest) click(".boxbtn");
        return { what: "box nesta volta", ack: "ok_box" };
      case "cancelBox":
        if (car.boxRequest) click(".boxbtn");
        return { what: "cancelar o box", ack: "ok_cancela" };
      case "tyre":
        click(`[data-next="${a.compound}"]`);
        if (a.box && !car.boxRequest) click(".boxbtn");
        return { what: `pneu ${COMPOUNDS[a.compound].label}${a.box ? " e box" : ""}`, ack: a.box ? "ok_box" : "ok_pneu" };
      case "pace":
        click(`[data-pace="${a.mode}"]`);
        return { what: `ritmo ${PACE[a.mode].label}`, ack: a.mode === "push" ? "ok_atacar" : a.mode === "conserve" ? "ok_poupar" : "ok_normal" };
      case "engine":
        click(`[data-engine="${a.mode}"]`);
        return { what: `motor ${ENGINE[a.mode].label}`, ack: a.mode === "rich" ? "ok_rico" : a.mode === "lean" ? "ok_pobre" : "ok_motor_normal" };
      case "order":
        click(`[data-order="${a.mode}"]`);
        // a ordem vira rádio na corrida e o piloto responde por lá
        return { what: a.mode === "letPass" ? "deixar o companheiro passar" : a.mode === "hold" ? "manter posições" : "liberados", ack: "" };
    }
  }

  /** comando de voz reconhecido: responde um pedido do piloto (sim/não) ou executa a ordem */
  private voiceCommand(view: RaceView, a: VoiceAction | null, heard: string) {
    if (this.view !== view) return;
    // IA do rádio ligada: a frase inteira vai pra ela (menos "sim/não" a um pedido e ordem curtinha,
    // que já resolvem na hora)
    // câmera por voz ("seguir Hamilton", "câmera no Verstappen", "modo TV"): precisa do ditado livre
    if (radioAI.ready && this.voiceCamera(view, heard)) return;
    if (radioAI.ready && heard.trim()) {
      const short = heard.trim().split(/s+/).length <= 3;
      const yn = a?.kind === "yes" || a?.kind === "no";
      if (yn && this.requests?.answer(a.kind === "yes")) return;
      if (!(short && a && !yn)) return void this.askAI(view, heard);
    }
    if (a?.kind === "yes" || a?.kind === "no") {
      if (!this.requests?.answer(a.kind === "yes")) view.hud.note(`🎙 Você: "${heard}" (nenhum pedido pra responder)`);
      return;
    }
    const cars = teamVoice.drivers();
    const followSlot = cars.findIndex((d) => d.id === view.follow);
    const slot = a?.slot ?? (followSlot >= 0 ? followSlot : 0);
    const r = a ? this.act(view, a, slot) : null;
    if (!r) {
      view.hud.note(heard ? `🎙 Você: "${heard}" (não entendi)` : "🎙 Não ouvi nada");
      teamVoice.sayId("nao_entendi", slot);
      return;
    }
    view.hud.note(`🎙 Você → P${slot + 1}: ${r.what}`);
    if (r.ack) teamVoice.sayId(r.ack, slot);
  }

  /** fala gravada com a IA ligada: o Whisper transcreve e segue como um comando de voz normal */
  async hearAI(pcm: Float32Array, rate: number, vosk: string) {
    const view = this.view;
    if (!view) return;
    if (pcm.length < rate * 0.3) return void view.hud.note("🎙 Não ouvi nada");
    this.voicePin("🎙 Entendendo o que você falou...");
    let heard = vosk;
    try {
      heard = (await radioAI.hear(pcm, rate)) || vosk;
    } catch {
      /* Whisper falhou: fica o que o Vosk ouviu */
    } finally {
      this.voicePin(null);
    }
    if (this.view !== view) return;
    // o Whisper às vezes "ouve" frases de legenda no silêncio
    if (!heard.trim() || /^(obrigad|legenda|\[|\()/i.test(heard.trim())) return void view.hud.note("🎙 Não entendi, fala de novo?");
    this.voiceCommand(view, parseCommand(heard), heard);
  }

  /** reação do piloto a um evento, escrita pela IA e na voz dele; false = não deu (toca a fala pronta) */
  async aiReact(event: string, slot: number): Promise<boolean> {
    const view = this.view;
    if (!view || radioAI.state !== "ready") return false;
    const race = view.race;
    const cars = teamVoice.drivers().map((d) => race.cars.find((c) => c.id === d.id)!).filter(Boolean);
    const car = cars[slot];
    if (!car) return false;
    try {
      const drivers = cars.map((c) => ({ id: c.id, name: c.driver.name, short: c.driver.short, style: c.driver.profile?.style, status: () => carStatusText(race, c) }));
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000));
      const r = await Promise.race([radioAI.react(event, slot, drivers, car.team.name), timeout]);
      if (!r || this.view !== view) return false;
      teamVoice.sayUrl(await radioAI.voice(r.text, slot), slot, r.text);
      return true;
    } catch {
      return false;
    }
  }

  /** "seguir Hamilton", "câmera no Verstappen", "mostra o líder", "segue o safety car", "modo TV" */
  private voiceCamera(view: RaceView, heard: string): boolean {
    const t = ` ${heard.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")} `;
    if (/ (modo )?tv /.test(t) && / (modo|liga|desliga|tv) /.test(t) && !/ segu/.test(t)) {
      view.hud.note(view.toggleTv() ? "📺 Modo TV ligado (por voz)" : "📺 Modo TV desligado (por voz)");
      return true;
    }
    // "câmera/mostra/foca": o nome em qualquer lugar; "segue/seguir": o nome logo depois do verbo
    // ("seguir Hamilton", "segue o Verstappen"; "Senna, segue assim" é conversa, não câmera)
    const cam = / (camera|mostra\w*|foca\w*|olha\w*) /.test(t);
    const seg = / segu\w* (?:o |a |no |na )?([a-z0-9]+) /.exec(t);
    if (!cam && !seg) return false;
    const race = view.race;
    let car = / (lider|primeiro colocado|ponta) /.test(t) ? race.leader() : null;
    if (/ safety( car)? /.test(t) && race.sc.active && race.sc.onTrack) {
      view.setFollow("SC");
      view.hud.note("🎥 Câmera no safety car");
      return true;
    }
    if (!car) {
      const all = race.cars.filter((c) => !c.retired);
      const i = pickSlot(cam ? heard : seg![1], all.map((c) => ({ name: c.driver.name, short: c.driver.short })));
      car = i >= 0 ? all[i] : null;
    }
    if (!car) return false;
    view.setFollow(car.id);
    view.hud.note(`🎥 Câmera em ${car.driver.name} (P${car.position})`);
    return true;
  }

  /** conversa com a IA do rádio: quem você chamou responde com uma fala nova, na voz dele */
  private async askAI(view: RaceView, heard: string) {
    const race = view.race;
    const mine = teamVoice.drivers();
    const cars = mine.map((d) => race.cars.find((c) => c.id === d.id)!).filter(Boolean);
    if (!cars.length) return;
    const named = pickSlot(heard, cars.map((c) => ({ name: c.driver.name, short: c.driver.short })));
    const followSlot = mine.findIndex((d) => d.id === view.follow);
    const slot = named >= 0 ? named : followSlot >= 0 ? followSlot : 0;
    const car = cars[slot] ?? cars[0];
    view.hud.note(`🎙 Você → ${car.driver.short}: "${heard}"`);
    this.voicePin(`📻 ${car.driver.short} pensando...`);
    teamVoice.hold = true;
    try {
      const drivers = cars.map((c) => ({ id: c.id, name: c.driver.name, short: c.driver.short, style: c.driver.profile?.style, status: () => carStatusText(race, c) }));
      const r = await radioAI.ask(heard, slot, drivers, car.team.name);
      if (this.view !== view) return;
      const done = this.aiAct(view, r.action, slot);
      view.hud.note(`📻 ${car.driver.short}: "${r.text}"${done ? ` (${done})` : ""}`);
      try {
        teamVoice.sayUrl(await radioAI.voice(r.text, slot), slot, r.text);
      } catch {
        /* sem a voz: fica só o texto no feed */
      }
    } catch (e) {
      view.hud.note(`📻 A IA do rádio não respondeu (${String((e as Error)?.message ?? e).slice(0, 60)})`);
    } finally {
      teamVoice.hold = false;
      this.voicePin(null);
    }
  }

  /** ação que a IA entendeu na sua fala -> a mesma ordem dos botões do card */
  private aiAct(view: RaceView, act: AIAction, slot: number): string | null {
    const map: Partial<Record<AIAction, Exclude<VoiceAction, { kind: "yes" } | { kind: "no" }>>> = {
      box: { kind: "box", slot },
      cancelar_box: { kind: "cancelBox", slot },
      atacar: { kind: "pace", slot, mode: "push" },
      normal: { kind: "pace", slot, mode: "normal" },
      poupar: { kind: "pace", slot, mode: "conserve" },
      motor_rico: { kind: "engine", slot, mode: "rich" },
      motor_normal: { kind: "engine", slot, mode: "normal" },
      motor_pobre: { kind: "engine", slot, mode: "lean" },
      deixar_passar: { kind: "order", slot, mode: "letPass" },
      manter: { kind: "order", slot, mode: "hold" },
      livre: { kind: "order", slot, mode: "none" },
    };
    const a = map[act];
    return a ? (this.act(view, a, slot)?.what ?? null) : null;
  }

  private teardown() {
    this.requests?.destroy();
    this.requests = null;
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
  mergeCloudSaves((await account.loadChamps().catch(() => ({}))) as SaveMap);
  applyEditor(); // nomes de pistas/pilotos do Editor
  const appInst = new App();
  car3dReady(); // já vai carregando o carro 3D (prévias do editor e do lobby)
  onSaveWarn((msg) => toast(msg)); // gravação do campeonato falhou (sem espaço): avisa
  if (location.search.includes("debug")) (window as unknown as { __app: App }).__app = appInst;
  // tela de abertura (do index.html): completa a logo e some
  const boot = document.getElementById("boot");
  if (boot) {
    const wait = Math.max(0, 1600 - performance.now());
    setTimeout(() => {
      boot.classList.add("done");
      setTimeout(() => {
        boot.classList.add("out");
        setTimeout(() => boot.remove(), 450);
      }, 420);
    }, wait);
  }
  new HelpWidget(
    () => appInst.helpTab(),
    () => appInst.exitToMenu(),
    () => appInst.inGame(),
  );
  // áudio só é liberado depois de um clique; aproveita pra fazer o "tic" dos botões
  document.addEventListener("pointerdown", (e) => {
    sound.unlock();
    music.unlock();
    if ((e.target as HTMLElement).closest("button")) sound.click();
  }, true);
  appInst.menu();
  // comando de voz: segura V e fala (só na corrida, com o 🎙 ligado). O aviso fica no feed da corrida
  const renderInd = () => {
    const st = voiceCmd.state;
    appInst.voicePin(
      st === "listening"
        ? radioAI.ready
          ? "🎙🤖 OUVINDO com a IA: fale livre e solte o V"
          : "🎙 OUVINDO comandos (P1 box, P2 atacar...). Solte o V"
        : st === "loading" ? "🎙 Preparando o comando de voz..." : null,
    );
    if (st === "error") toast(`🎙 ${voiceCmd.error}`);
  };
  voiceCmd.onChange(renderInd);
  voiceCmd.free = () => radioAI.ready;
  // com a IA ligada, quem ouve a frase é o Whisper (o Vosk fica de reserva)
  voiceCmd.capture = () => radioAI.ready;
  voiceCmd.onAudio = (pcm, rate, vosk) => void appInst.hearAI(pcm, rate, vosk);
  // com a IA ligada, as reações do seu piloto (ultrapassagem, toque, box lento...) também saem dela;
  // se ela estiver ocupada ou demorar, toca a fala pronta
  teamVoice.aiReact = (event, slot) => appInst.aiReact(event, slot);
  // IA do rádio: andamento do download no canto e aviso quando fica pronta (ou falha)
  let aiWas = radioAI.state;
  radioAI.onChange(() => {
    const st = radioAI.state;
    if (st === "loading") appInst.voicePin(`🤖 Preparando a IA do rádio... ${radioAI.progress}`);
    else if (aiWas === "loading") {
      appInst.voicePin(null);
      if (st === "ready") toast("🤖 IA do rádio pronta: segure V e fale com seus pilotos");
    }
    if (st === "error" && aiWas !== "error") toast(`🤖 ${radioAI.error}`);
    aiWas = st;
  });
  // IA do rádio que você deixou ligada: já vai carregando (o navegador guardou o modelo)
  if (radioAI.wanted && radioAI.supported) void radioAI.enable();
  const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest?.("input, textarea");
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyV" || e.repeat || typing(e) || !appInst.inRace()) return;
    if (voiceCmd.state === "off") return appInst.voiceNote("🎙 Ligue o comando de voz no botão 🎙 (canto da tela) e segure V pra falar");
    e.preventDefault();
    voiceCmd.startListening();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyV") voiceCmd.stopListening();
  });
  window.addEventListener("blur", () => voiceCmd.stopListening());

  // ?radio: demonstração das falas gravadas do rádio (um clique libera o som e começa)
  if (location.search.includes("radio")) {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:16px;top:16px;z-index:200;max-width:520px;padding:12px 16px;background:#0b0e15ee;border:1px solid #333;color:#e9edf5;font:15px/1.5 sans-serif";
    box.textContent = "📻 Clique em qualquer lugar pra ouvir as falas do rádio";
    document.body.appendChild(box);
    document.addEventListener("click", () => {
      sound.unlock();
      setTimeout(() => void teamVoice.demo((t) => (box.textContent = "📻 " + t)), 300);
    }, { once: true, capture: true });
  }
})();
