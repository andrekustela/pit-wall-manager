import { esc, storeGet, storeSet } from "./common";
import type { ChampSave } from "../net/room";
import { CIRCUITS } from "../sim/track";
import { account } from "../net/account";
import { statsHtml } from "./login";
import { deleteSave, listSaves, renameSave } from "./saves";
import { confirmDialog } from "./confirm";
import { fillRanking } from "./ranking";
import { editMyLivery } from "./liveryEditor";
import { getLivery } from "./liveryStore";
import { emblemSvg } from "../render/emblem";
import { LAP_OPTIONS } from "../net/protocol";
import { champRounds } from "../sim/championship";
import { mountTrackPicker } from "./trackPicker";
import { backdropMemo, mountMenuBackdrop, releaseStripe, type StripeLock } from "./menuBg";
import { showFriends } from "./friends";
import { coverScreen } from "./transition";
import { startLogoFx } from "./logoFx";
import { getRecPrefs, loadRecords, setRecPrefs, type RecMode, type RecScope, type TrackRecord } from "./records";
import { fmtLap } from "../sim/race";

/** sessão online guardada pra voltar pra sala se a conexão cair */
export interface Session {
  code: string;
  token: string;
}

export function loadJson<T>(k: string): T | null {
  try {
    const s = storeGet(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export interface MenuChoice {
  mode: "solo" | "create" | "join" | "rejoin" | "resume";
  name: string;
  teamName: string;
  code?: string;
  token?: string;
  save?: ChampSave;
  /** jogo solo montado no menu: começa direto (sem a tela de lobby) */
  setup?: SoloSetup;
}

/** jogo solo escolhido no menu */
export interface SoloSetup {
  kind: "corrida" | "fds" | "campeonato";
  /** carro (vaga) que a equipe do jogador usa */
  teamId: string;
  trackIndex: number;
  laps: number;
  realDrivers: boolean;
  equalCars: boolean;
  champPct: number;
  champName: string;
}

/** últimas escolhas do jogo solo (o formulário já abre com elas) */
interface SoloPrefs {
  track: number; // -1 = sorteada
  laps: number;
  realDrivers: boolean;
  equalCars: boolean;
  champPct: number;
}
function soloPrefs(): SoloPrefs {
  const d: SoloPrefs = { track: -1, laps: LAP_OPTIONS[1] ?? LAP_OPTIONS[0], realDrivers: true, equalCars: false, champPct: 30 };
  const x = loadJson<Partial<SoloPrefs>>("pwm.soloCfg") ?? {};
  return {
    track: typeof x.track === "number" && (x.track === -1 || CIRCUITS[x.track]) ? x.track : d.track,
    laps: LAP_OPTIONS.includes(x.laps as number) ? (x.laps as number) : d.laps,
    realDrivers: x.realDrivers ?? d.realDrivers,
    equalCars: x.equalCars ?? d.equalCars,
    champPct: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].includes(x.champPct as number) ? (x.champPct as number) : d.champPct,
  };
}

type Panel = "solo" | "online" | "carreira" | "solo-tipo" | "cfg-corrida" | "cfg-fds" | "cfg-camp" | null;
/** pra onde o "voltar" leva em cada vista */
const PARENT: Record<string, Panel> = { solo: null, online: null, carreira: null, "solo-tipo": "solo", "cfg-corrida": "solo-tipo", "cfg-fds": "solo-tipo", "cfg-camp": "solo-tipo" };
/** painel aberto (continua aberto quando o menu é redesenhado, ex.: depois de renomear) */
let openPanel: Panel = null;


/** rodando dentro do programa de PC (.exe)? (a ponte do Electron avisa) */
const isDesktop = () => !!(window as unknown as { pwmDesktop?: unknown }).pwmDesktop;
/** download do programa de PC (Releases do GitHub: sempre a versão mais nova) — botão em "em breve" por enquanto */
export const DOWNLOAD_URL = "https://github.com/andrekustela/pit-wall-manager/releases/latest/download/PitWallManager.exe";

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function showMenu(root: HTMLElement, onChoose: (c: MenuChoice) => void, onLogout?: () => void) {
  const redraw = () => showMenu(root, onChoose, onLogout);
  const saves = listSaves();
  const liv = getLivery();
  const myName = () => account.profile?.name || storeGet("pwm.name") || "";
  const myTeam = () => (account.profile ? account.profile.team_name : storeGet("pwm.team"));
  const get = () => ({ name: myName() || "Engenheiro", teamName: myTeam() });
  // veio por um link de convite (?sala=CODE): abre o modo online com o código preenchido
  const inv = new URLSearchParams(location.search).get("sala")?.trim().toUpperCase();
  const invite = inv && /^[A-Z]{4}$/.test(inv) ? inv : null;
  if (invite && !openPanel) openPanel = "online";

  // pista do fundo: sorteada (as próximas também vêm sorteadas, a cada volta)
  // (a memória faz o menu redesenhado — ex.: salvar o perfil — continuar a mesma pista e a mesma volta)
  const bgTrack = backdropMemo.v?.idx ?? Math.floor(Math.random() * CIRCUITS.length);
  if (!backdropMemo.v) backdropMemo.v = { idx: bgTrack, t0: performance.now() };

  const champRows = (list: typeof saves) => list
    .map((s) => {
      const ch = s.champ;
      const done = ch.results.length;
      const next = ch.rounds[ch.results.length]; // a próxima é a primeira que ainda não correu
      const when = s.updated ? new Date(s.updated).toLocaleDateString("pt-BR") : "";
      const pct = Math.round((done / Math.max(1, ch.rounds.length)) * 100);
      const status = ch.finished ? `🏆 Concluído · ${ch.rounds.length} etapas` : `Etapa ${done} de ${ch.rounds.length} · próxima: ${esc(CIRCUITS[next]?.name ?? "")}`;
      return `<div class="m2champ" data-cid="${esc(ch.id)}">
          <div class="m2champtop"><b>${esc(ch.name ?? "Campeonato")}</b>${s.online ? `<span class="onlinetag">🌐 ONLINE · ${(s.players ?? []).map((p) => esc(p.name)).join(", ")}</span>` : ""}</div>
          <div class="m2bar"><i style="width:${pct}%"></i></div>
          <div class="hint" style="margin:4px 0 8px">${status} · ${esc(s.name)}${s.teamName ? ` (${esc(s.teamName)})` : ""}${when ? ` · ${when}` : ""}</div>
          <div class="row-btns" style="margin:0"><button class="btn small primary" data-cplay title="${s.online && !ch.finished ? "Cria uma sala nova com este campeonato; os amigos entram pelo código e voltam pra equipe deles" : ""}">${ch.finished ? "VER TROFÉUS ▶" : s.online ? "CONTINUAR ONLINE ▶" : "CONTINUAR ▶"}</button>
            <button class="btn small" data-crename>RENOMEAR</button><button class="btn small" data-cdel>APAGAR</button></div></div>`;
    })
    .join("");
  const soloSaves = saves.filter((s) => !s.online);
  const onlineSaves = saves.filter((s) => s.online);

  root.innerHTML = `
    <div class="screen menu2">
      <canvas class="menubg"></canvas>
      <div class="m2stripe"></div>
      <div class="m2top">
        ${isDesktop() ? "" : `<span class="m2dl soon" title="O programa pra Windows chega em breve">⬇ <span>BAIXAR PRO PC</span><em>EM BREVE</em></span>`}
        <button class="m2friends" id="m-friends" title="Amigos">👥 <span>AMIGOS</span>${account.profile?.friends?.length ? `<em>${account.profile.friends.length}</em>` : ""}</button>
      </div>
      <div class="m2">
        <div class="m2left">
          <div class="m2logowrap"><img class="m2logo" src="/brand/logo.png" alt="Pit Wall Manager"></div>
          <p class="m2tag">A estratégia de corrida é sua. <b>Você é o engenheiro-chefe.</b></p>
          <div class="m2stage" id="m-stage"></div>
        </div>
      </div>
      <div class="m2trackname"><span>PISTA EM DESTAQUE</span><b id="m-trackname">${esc((CIRCUITS[bgTrack]?.name ?? "").toUpperCase())}</b><div class="m2trackrec" id="m-trackrec"></div></div>
    </div>`;

  // a faixa vermelha é uma só: o fundo e o menu revezam (o clique do jogador tem prioridade)
  const lock: StripeLock = { owner: null };
  // ----- fundo: pista troca a cada volta, com a faixa varrendo e o nome deslizando -----
  const stripe = root.querySelector<HTMLElement>(".m2stripe")!;
  const nameEl = root.querySelector<HTMLElement>("#m-trackname")!;
  const recEl = root.querySelector<HTMLElement>("#m-trackrec")!;
  // recordes de volta (do jeito que o jogador escolheu no perfil): começa só com os locais e completa quando o ranking chegar
  let recs: (t: number) => TrackRecord[] = () => [];
  let shown = bgTrack;
  const recHtml = (idx: number) => {
    const r = recs(idx)[0];
    if (!r) return `<span class="none">sem tempo nesta pista ainda</span>`;
    const when = r.at ? new Date(r.at).toLocaleDateString("pt-BR") : "";
    return `<span class="t">⏱ ${fmtLap(r.time)}</span><span>${esc(r.who)}${when ? ` · ${when}` : ""}</span>`;
  };
  void loadRecords().then((f) => {
    recs = f;
    if (recEl.isConnected) recEl.innerHTML = recHtml(shown);
  });
  mountMenuBackdrop(root.querySelector<HTMLCanvasElement>(".menubg")!, bgTrack, stripe, (idx) => {
    shown = idx;
    const out = nameEl.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-8px)", opacity: 0 }], { duration: 160, easing: "ease-out", fill: "forwards" });
    recEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
    out.onfinish = () => {
      nameEl.textContent = (CIRCUITS[idx]?.name ?? "").toUpperCase();
      recEl.innerHTML = recHtml(idx);
      recEl.animate([{ transform: "translateY(8px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 300, delay: 80, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
      nameEl.animate([{ transform: "translateY(10px)", opacity: 0, filter: "blur(2px)" }, { transform: "translateY(0)", opacity: 1, filter: "blur(0)" }], {
        duration: 260,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "forwards",
      });
    };
  }, (idx) => recs(idx).map((r) => r.who), lock, backdropMemo.v.t0, (idx, t0) => (backdropMemo.v = { idx, t0 }));

  // ----- vistas da coluna da esquerda: menu inicial ou um dos modos -----
  const homeHtml = () => `
    <div class="m2acc">
      ${liv ? emblemSvg(liv.emblem, 46) : `<div class="m2noemb">${esc((myName() || "?").slice(0, 1).toUpperCase())}</div>`}
      <div class="m2accinfo"><div class="m2hi">${myName() ? `OLÁ, ${esc(myName().toUpperCase())}` : "ENGENHEIRO SEM NOME"}</div>
        <div class="m2team">${myTeam() ? esc(myTeam()) : "Equipe com o nome original"}${account.profile ? "" : " · sem conta"}</div></div>
      <button class="m2gear" id="m-edit" title="Editar perfil e pintura">⚙</button>
    </div>
    <nav class="m2nav">
      <button class="m2btn mode" data-panel="solo"><b>MODO SOLO</b><span>Você contra 9 equipes da IA${soloSaves.length ? ` · ${soloSaves.length} campeonato${soloSaves.length > 1 ? "s" : ""}` : ""}</span><i>▶</i></button>
      <button class="m2btn mode" data-panel="online"><b>MODO ONLINE</b><span>Jogue com os amigos${onlineSaves.length ? ` · ${onlineSaves.length} campeonato${onlineSaves.length > 1 ? "s" : ""}` : ""}</span><i>▶</i></button>
      <button class="m2btn mode" data-panel="carreira"><b>CARREIRA E RANKING</b><span>${account.profile ? "Suas estatísticas e o ranking entre amigos" : "Precisa de conta"}</span><i>▶</i></button>
    </nav>`;
  const head = (t: string) => `<div class="m2vhead"><button class="m2back" data-back>◀ VOLTAR</button><b>${t}</b></div>`;
  const panelHtml = (p: Panel) => {
    if (p === "solo")
      return `${head("MODO SOLO")}
        <button class="m2btn hot" id="m-solo"><b>NOVO JOGO SOLO</b><span>Fim de semana avulso ou campeonato novo (escolha nas regras)</span><i>▶</i></button>
        <h3 class="m2psub">SEUS CAMPEONATOS SOLO</h3>
        <div class="m2plist">${champRows(soloSaves) || `<p class="hint">Nenhum ainda. Em <b>Novo jogo solo</b>, ligue "Campeonato" nas regras.</p>`}</div>`;
    if (p === "online")
      return `${head("MODO ONLINE")}
        <button class="m2btn hot" id="m-create"><b>CRIAR SALA</b><span>Você é o host: passe o código pros amigos</span><i>▶</i></button>
        <div class="m2join"><input class="txt" id="m-code" maxlength="4" placeholder="CÓDIGO"><button class="m2btn small" id="m-join"><b>ENTRAR NUMA SALA</b><i>▶</i></button></div>
        <h3 class="m2psub">SEUS CAMPEONATOS ONLINE</h3>
        <div class="m2plist">${champRows(onlineSaves) || `<p class="hint">Nenhum ainda. Quem cria a sala com "Campeonato" ligado fica com o campeonato salvo e pode continuar depois.</p>`}</div>`;
    if (p === "solo-tipo")
      return `${head("NOVO JOGO SOLO")}
        <p class="hint" style="margin:0 0 4px">Sua equipe: <b>${esc(myTeam() || "nome original")}</b>${myTeam() ? "" : " (dá pra dar um nome na ⚙)"}</p>
        <button class="m2btn" data-panel="cfg-corrida"><b>CORRIDA ÚNICA</b><span>Direto pra estratégia e pra corrida (grid sorteado pelo ritmo)</span><i>▶</i></button>
        <button class="m2btn" data-panel="cfg-fds"><b>FIM DE SEMANA</b><span>Treino livre, classificação Q1/Q2/Q3, estratégia e corrida</span><i>▶</i></button>
        <button class="m2btn" data-panel="cfg-camp"><b>CAMPEONATO</b><span>Várias etapas, pontos, evolução do carro, mecânicos e troféus</span><i>▶</i></button>`;
    if (p === "cfg-corrida" || p === "cfg-fds" || p === "cfg-camp") {
      const sp = soloPrefs();
      const camp = p === "cfg-camp";
      const toggle = (k: string, on: boolean, t: string, d: string) =>
        `<label class="toggle m2tog"><input type="checkbox" data-opt="${k}" ${on ? "checked" : ""}><span><b>${t}</b><br><span class="hint" style="margin:0">${d}</span></span></label>`;
      return `${head(p === "cfg-corrida" ? "CORRIDA ÚNICA" : p === "cfg-fds" ? "FIM DE SEMANA" : "CAMPEONATO")}
        ${camp
          ? `<label class="fld"><span>Nome do campeonato</span><input class="txt" data-opt="champName" maxlength="40" placeholder="Ex.: Temporada ${new Date().getFullYear()}"></label>
             <div class="fld"><span>Quantas pistas</span><div class="seg pctseg" data-seg="champPct">${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((x) => `<button data-v="${x}" class="${x === sp.champPct ? "on" : ""}" title="${champRounds(x)} etapas">${x}%</button>`).join("")}</div>
             <span class="hint" style="margin:4px 0 0" data-rounds>${champRounds(sp.champPct)} etapas, em pistas sorteadas</span></div>`
          : `<div class="fld"><span>Pista</span><div data-tpick></div></div>`}
        <div class="fld"><span>Voltas da corrida</span><div class="seg" data-seg="laps">${LAP_OPTIONS.map((n) => `<button data-v="${n}" class="${n === sp.laps ? "on" : ""}">${n} VOLTAS</button>`).join("")}</div></div>
        ${toggle("realDrivers", sp.realDrivers, "Lendas da F1", "Pilotos reais de todas as eras. Desligado = fictícios.")}
        ${toggle("equalCars", sp.equalCars, "Carros iguais", "Todo mundo com o mesmo carro: ganha quem acerta e decide melhor.")}
        <button class="m2btn hot" id="m-start" data-kind="${p === "cfg-corrida" ? "corrida" : p === "cfg-fds" ? "fds" : "campeonato"}"><b>COMEÇAR</b><span>${camp ? "1ª etapa: treino livre" : p === "cfg-fds" ? "Começa pelo treino livre" : "Vai direto pra estratégia"}</span><i>▶</i></button>`;
    }
    if (p === "carreira")
      return `${head("CARREIRA E RANKING")}
        <div class="seg m2ptabs"><button data-ctab="carreira" class="on">SUA CARREIRA</button><button data-ctab="ranking">RANKING</button></div>
        <div class="m2pbody" id="m-cbody">${account.profile ? statsHtml() : `<p class="hint">Sem conta as estatísticas não ficam salvas. Entre com uma conta (e-mail ou Google) pela tela inicial pra ter carreira, ranking e amigos.</p>`}</div>`;
    return "";
  };

  const bindView = (el: HTMLElement) => {
    el.querySelectorAll<HTMLElement>("[data-panel]").forEach((bt) => bt.addEventListener("click", () => show(bt.dataset.panel as Panel)));
    el.querySelector("[data-back]")?.addEventListener("click", () => show(openPanel ? PARENT[openPanel] ?? null : null));
    el.querySelector("#m-edit")?.addEventListener("click", () => showProfileEditor(redraw, onLogout));
    el.querySelector("#m-solo")?.addEventListener("click", () => show("solo-tipo"));
    // formulário do jogo solo
    el.querySelectorAll<HTMLElement>("[data-seg]").forEach((seg) =>
      seg.addEventListener("click", (e) => {
        const bt = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
        if (!bt) return;
        seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === bt));
        const r = el.querySelector<HTMLElement>("[data-rounds]");
        if (r && seg.dataset.seg === "champPct") r.textContent = `${champRounds(Number(bt.dataset.v))} etapas, em pistas sorteadas`;
      }),
    );
    // pista: lista com busca que só aceita uma pista que existe
    const tpHost = el.querySelector<HTMLElement>("[data-tpick]");
    const tp = tpHost ? mountTrackPicker(tpHost, soloPrefs().track) : null;
    el.querySelector("#m-start")?.addEventListener("click", (e) => {
      const kind = (e.currentTarget as HTMLElement).dataset.kind as SoloSetup["kind"];
      const segV = (k: string, d: number) => Number(el.querySelector<HTMLElement>(`[data-seg=${k}] .on`)?.dataset.v ?? d);
      const chk = (k: string) => !!el.querySelector<HTMLInputElement>(`[data-opt=${k}]`)?.checked;
      const sp = soloPrefs();
      const prefs: SoloPrefs = {
        track: tp ? tp.get() : sp.track,
        laps: segV("laps", sp.laps),
        realDrivers: chk("realDrivers"),
        equalCars: chk("equalCars"),
        champPct: segV("champPct", sp.champPct),
      };
      storeSet("pwm.soloCfg", JSON.stringify(prefs));
      const setup: SoloSetup = {
        kind,
        teamId: storeGet("pwm.myCar") || "fal",
        trackIndex: prefs.track >= 0 ? prefs.track : Math.floor(Math.random() * CIRCUITS.length),
        laps: prefs.laps,
        realDrivers: prefs.realDrivers,
        equalCars: prefs.equalCars,
        champPct: prefs.champPct,
        champName: el.querySelector<HTMLInputElement>("[data-opt=champName]")?.value.trim() ?? "",
      };
      choose({ mode: "solo", ...get(), setup });
    });
    el.querySelector("#m-create")?.addEventListener("click", () => choose({ mode: "create", ...get() }));
    const codeInp = el.querySelector<HTMLInputElement>("#m-code");
    if (codeInp) {
      const join = () => {
        const code = codeInp.value.trim().toUpperCase();
        if (code.length === 4) return choose({ mode: "join", code, ...get() });
        codeInp.focus();
        if (!reduceMotion())
          codeInp.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: 260, easing: "ease-out" });
      };
      el.querySelector("#m-join")!.addEventListener("click", join);
      codeInp.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && join());
      if (invite) {
        codeInp.value = invite;
        const jb = el.querySelector<HTMLElement>("#m-join")!;
        jb.classList.add("hot");
        jb.querySelector("b")!.textContent = `ENTRAR NA SALA ${invite}`;
      }
    }
    el.querySelectorAll<HTMLElement>(".m2champ").forEach((row) => {
      const id = row.dataset.cid!;
      const save = saves.find((x) => x.champ.id === id)!;
      row.querySelector("[data-cplay]")!.addEventListener("click", () => choose({ mode: "resume", ...get(), save }));
      row.querySelector("[data-crename]")!.addEventListener("click", () => {
        const n = window.prompt("Novo nome do campeonato:", save.champ.name ?? "");
        if (n !== null && n.trim()) {
          renameSave(id, n);
          redraw();
        }
      });
      row.querySelector("[data-cdel]")!.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "Apagar campeonato", icon: "🗑", text: `Apagar "${save.champ.name ?? "Campeonato"}"? Não dá pra desfazer.`, ok: "APAGAR", danger: true });
        if (!ok) return;
        deleteSave(id);
        redraw();
      });
    });
    el.querySelectorAll<HTMLElement>("[data-ctab]").forEach((bt) =>
      bt.addEventListener("click", () => {
        el.querySelectorAll("[data-ctab]").forEach((x) => x.classList.toggle("on", x === bt));
        const body = el.querySelector<HTMLElement>("#m-cbody")!;
        if (bt.dataset.ctab === "ranking") {
          if (account.profile) void fillRanking(body, (account.profile.friends?.length ?? 0) > 0);
          else body.innerHTML = `<p class="hint">O ranking é entre jogadores com conta. Entre com uma conta pela tela inicial.</p>`;
        } else body.innerHTML = account.profile ? statsHtml() : `<p class="hint">Sem conta as estatísticas não ficam salvas.</p>`;
      }),
    );
  };

  /**
   * Troca a vista da esquerda. A faixa vermelha sai do lugar dela e varre a coluna
   * da direita pra esquerda: atrás dela (à direita) já é a vista nova, na frente
   * (à esquerda) ainda a antiga — igual à troca de pista do fundo.
   */
  const stage = root.querySelector<HTMLElement>("#m-stage")!;
  const VIEW_MS = 560;
  const TAN = Math.tan((18 * Math.PI) / 180);
  const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let busy = false;
  /** clique que chegou durante uma animação (vale o último) */
  let pending: { v: Panel } | null = null;
  const runPending = () => {
    const p = pending;
    pending = null;
    if (p) show(p.v);
  };
  const show = (v: Panel, animate = true) => {
    // faixa ocupada: guarda o clique; se for a troca de pista, pede pra ela acabar rápido
    if (animate && !reduceMotion() && (busy || lock.owner === "bg")) {
      pending = { v };
      if (lock.owner === "bg") {
        lock.free = runPending;
        lock.rush?.();
      }
      return;
    }
    openPanel = v;
    const neu = document.createElement("div");
    neu.className = v ? "m2view m2pview" : "m2view";
    neu.innerHTML = v ? panelHtml(v) : homeHtml();
    bindView(neu);
    const old = stage.firstElementChild as HTMLElement | null;
    if (!old || !animate || reduceMotion()) {
      stage.replaceChildren(neu);
      return;
    }
    busy = true;
    lock.owner = "menu";
    neu.classList.add("swapping");
    stage.appendChild(neu);
    const fly = document.createElement("div");
    fly.className = "m2stripe m2fly";
    root.querySelector(".menu2")!.appendChild(fly);
    stripe.style.opacity = "0";
    const W = window.innerWidth, H = window.innerHeight;
    const endTx = -(W * 0.375 + H * TAN * 0.6 + 80); // até a faixa sair pela esquerda
    // ida (pra esquerda): a faixa vai apagando a vista antiga; volta (pra direita): a nova vai aparecendo atrás dela
    const BACK_MS = 640;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    neu.style.clipPath = "polygon(0 0, 0 0, 0 0)";
    const t0 = performance.now();
    const edge = (el: HTMLElement, tx: number) => {
      // borda = centro da faixa (inclinada), em coordenadas do elemento, no topo e no pé dele
      const xc = (y: number) => W * (0.33 + 0.045) + tx - TAN * (y - H * 0.55);
      const r = stage.getBoundingClientRect();
      return [xc(r.top) - r.left, xc(r.top + el.offsetHeight) - r.left];
    };
    const step = (now: number) => {
      const t = now - t0;
      if (t < VIEW_MS) {
        const tx = endTx * easeIO(t / VIEW_MS);
        fly.style.transform = `translateX(${tx}px) skewX(-18deg)`;
        const [a, b] = edge(old, tx);
        old.style.clipPath = `polygon(-20% 0, ${a}px 0, ${b}px 100%, -20% 100%)`;
        return void requestAnimationFrame(step);
      }
      if (old.isConnected) old.remove();
      const k = Math.min(1, (t - VIEW_MS) / BACK_MS);
      const tx = endTx * (1 - easeOut(k));
      fly.style.transform = `translateX(${tx}px) skewX(-18deg)`;
      const [a, b] = edge(neu, tx);
      neu.style.clipPath = `polygon(-20% 0, ${a}px 0, ${b}px 100%, -20% 100%)`;
      if (k < 1) return void requestAnimationFrame(step);
      neu.classList.remove("swapping");
      neu.style.clipPath = "";
      fly.remove();
      stripe.style.opacity = "";
      busy = false;
      releaseStripe(lock);
      runPending();
    };
    requestAnimationFrame(step);
  };
  show(openPanel, false);

  // ----- escolher uma opção: o menu sai pra esquerda antes de trocar de tela -----
  const choose = (c: MenuChoice) => {
    if (busy || lock.owner) return; // a faixa está ocupada: espera a animação acabar
    root.querySelector<HTMLElement>(".m2left")!.style.pointerEvents = "none";
    lock.owner = "menu";
    stripe.style.opacity = "0"; // a faixa que cobre a tela sai do lugar desta
    void coverScreen().then(() => onChoose(c));
  };

  root.querySelector("#m-friends")!.addEventListener("click", () => showFriends(redraw));
  startLogoFx(root.querySelector<HTMLElement>(".m2logowrap")!);
}

/** editar perfil (engrenagem): nome, equipe, pintura e sair da conta */
function showProfileEditor(onDone: () => void, onLogout?: () => void) {
  const name = account.profile?.name ?? storeGet("pwm.name");
  const team = account.profile?.team_name ?? storeGet("pwm.team");
  const rp = getRecPrefs();
  if (!account.profile) rp.scope = "meu"; // sem conta só dá pra ver os próprios tempos
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel profbox">
      <div class="helphead"><b>⚙ EDITAR PERFIL</b><button class="btn small" data-x>✕</button></div>
      <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="p-name" maxlength="18" placeholder="Ex.: André" value="${esc(name)}"></label>
      <label class="fld"><span>Nome da equipe (vazio = nome original)</span><input class="txt" id="p-team" maxlength="24" placeholder="Ex.: Kustela Racing" value="${esc(team)}"></label>
      <button class="m2btn small profliv" data-liv><b>🎨 PINTURA DO CARRO E EMBLEMA</b><i>▶</i></button>
      <h3 class="m2psub">RECORDES NO MENU</h3>
      <p class="hint" style="margin:-2px 0 8px">Embaixo do nome da pista aparece o melhor tempo e, na pista, os 3 melhores.</p>
      <div class="fld"><span>Contar tempos de</span><div class="seg" data-recmode>
        <button data-v="todos" class="${rp.mode === "todos" ? "on" : ""}">TODOS OS MODOS</button><button data-v="online" class="${rp.mode === "online" ? "on" : ""}">SÓ ONLINE</button></div></div>
      <div class="fld" style="margin:0"><span>Mostrar o melhor tempo</span><div class="seg" data-recscope>
        <button data-v="meu" class="${rp.scope === "meu" ? "on" : ""}">SÓ MEU</button><button data-v="amigos" class="${rp.scope === "amigos" ? "on" : ""}" ${account.profile ? "" : "disabled"}>DOS AMIGOS</button><button data-v="todos" class="${rp.scope === "todos" ? "on" : ""}" ${account.profile ? "" : "disabled"}>DE TODOS</button></div></div>
      ${account.profile ? `<p class="hint" style="margin:12px 0 0">Conta: ${esc(account.user?.email ?? "")} · código de amigo <b>${account.friendCode()}</b></p>` : `<p class="hint" style="margin:12px 0 0">Sem conta: o perfil fica só neste navegador.</p>`}
      <div class="row-btns" style="justify-content:space-between;margin-top:14px">
        ${account.profile ? `<button class="btn" data-logout>SAIR DA CONTA</button>` : "<span></span>"}
        <div class="row-btns" style="margin:0"><button class="btn" data-x>CANCELAR</button><button class="btn primary" data-save>SALVAR</button></div>
      </div></div>`;
  document.body.appendChild(m);
  const close = () => {
    m.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    if (e.key === "Enter" && (e.target as HTMLElement).matches("input")) save();
  };
  const save = () => {
    const n = m.querySelector<HTMLInputElement>("#p-name")!.value.trim();
    const t = m.querySelector<HTMLInputElement>("#p-team")!.value.trim();
    storeSet("pwm.name", n);
    storeSet("pwm.team", t);
    if (n) account.setNames(n, t);
    const pick = (sel: string) => m.querySelector<HTMLElement>(`${sel} .on`)?.dataset.v;
    setRecPrefs({ mode: (pick("[data-recmode]") as RecMode) ?? rp.mode, scope: (pick("[data-recscope]") as RecScope) ?? rp.scope });
    close();
    onDone();
  };
  window.addEventListener("keydown", onKey, true);
  m.querySelector<HTMLInputElement>("#p-name")!.focus();
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    const seg = t.closest<HTMLButtonElement>("[data-recmode] button, [data-recscope] button");
    if (seg && !seg.disabled) seg.parentElement!.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === seg));
    if (t.closest("[data-save]")) return save();
    if (t.closest("[data-logout]")) {
      close();
      onLogout?.();
    }
    if (t.closest("[data-liv]"))
      editMyLivery(storeGet("pwm.lastTeam") || "", m.querySelector<HTMLInputElement>("#p-team")!.value.trim() || team, undefined, () => {
        close();
        onDone();
      });
  });
}
