import { esc, storeGet, storeSet } from "./common";
import type { ChampSave } from "../net/room";
import { CIRCUITS } from "../sim/track";
import { account } from "../net/account";
import { statsHtml } from "./login";
import { mountInstallButton } from "./install";
import { deleteSave, listSaves, renameSave } from "./saves";
import { confirmDialog } from "./confirm";
import { fillRanking } from "./ranking";
import { editMyLivery } from "./liveryEditor";
import { getLivery } from "./liveryStore";
import { emblemSvg } from "../render/emblem";
import { mountMenuBackdrop, trackIndexByName } from "./menuBg";
import { showFriends } from "./friends";

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
}

type Panel = "solo" | "online" | "carreira" | null;
/** painel aberto (continua aberto quando o menu é redesenhado, ex.: depois de renomear) */
let openPanel: Panel = null;

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function showMenu(root: HTMLElement, onChoose: (c: MenuChoice) => void, onLogout?: () => void) {
  const redraw = () => showMenu(root, onChoose, onLogout);
  const saves = listSaves();
  const sess = loadJson<Session>("pwm.session");
  const liv = getLivery();
  const myName = () => account.profile?.name || storeGet("pwm.name") || "";
  const myTeam = () => (account.profile ? account.profile.team_name : storeGet("pwm.team"));
  const get = () => ({ name: myName() || "Engenheiro", teamName: myTeam() });
  // veio por um link de convite (?sala=CODE): abre o modo online com o código preenchido
  const inv = new URLSearchParams(location.search).get("sala")?.trim().toUpperCase();
  const invite = inv && /^[A-Z]{4}$/.test(inv) ? inv : null;
  if (invite && !openPanel) openPanel = "online";

  // pista do fundo: a próxima etapa do campeonato em andamento, senão Interlagos
  const live = saves.find((s) => !s.champ.finished);
  const bgTrack = live ? live.champ.rounds[live.champ.results.length] ?? trackIndexByName("Interlagos") : trackIndexByName("Interlagos");

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
        <div id="m-install"></div>
        <button class="m2friends" id="m-friends" title="Amigos">👥 <span>AMIGOS</span>${account.profile?.friends?.length ? `<em>${account.profile.friends.length}</em>` : ""}</button>
      </div>
      <div class="m2">
        <div class="m2left">
          <div class="m2logowrap"><img class="m2logo" src="/brand/logo.png" alt="Pit Wall Manager"></div>
          <p class="m2tag">A estratégia de corrida é sua. <b>Você é o engenheiro-chefe.</b></p>
          <div class="m2acc">
            ${liv ? emblemSvg(liv.emblem, 46) : `<div class="m2noemb">${esc((myName() || "?").slice(0, 1).toUpperCase())}</div>`}
            <div class="m2accinfo"><div class="m2hi">${myName() ? `OLÁ, ${esc(myName().toUpperCase())}` : "ENGENHEIRO SEM NOME"}</div>
              <div class="m2team">${myTeam() ? esc(myTeam()) : "Equipe com o nome original"}${account.profile ? "" : " · sem conta"}</div></div>
            <button class="m2gear" id="m-edit" title="Editar perfil e pintura">⚙</button>
          </div>
          <nav class="m2nav">
            <button class="m2btn mode ${openPanel === "solo" ? "on" : ""}" data-panel="solo"><b>MODO SOLO</b><span>Você contra 9 equipes da IA${soloSaves.length ? ` · ${soloSaves.length} campeonato${soloSaves.length > 1 ? "s" : ""}` : ""}</span><i>▶</i></button>
            <button class="m2btn mode ${sess ? "alert" : ""}" data-panel="online"><b>MODO ONLINE</b><span>${sess ? `Conexão caiu: volte pra sala ${esc(sess.code)}` : `Jogue com os amigos${onlineSaves.length ? ` · ${onlineSaves.length} campeonato${onlineSaves.length > 1 ? "s" : ""}` : ""}`}</span><i>▶</i></button>
            <button class="m2btn mode" data-panel="carreira"><b>CARREIRA E RANKING</b><span>${account.profile ? "Suas estatísticas e o ranking entre amigos" : "Precisa de conta"}</span><i>▶</i></button>
          </nav>
        </div>
        <div class="m2right"><div class="m2panel" id="m-panel" hidden></div></div>
      </div>
      <div class="m2trackname"><span>PISTA EM DESTAQUE</span><b id="m-trackname">${esc((CIRCUITS[bgTrack]?.name ?? "").toUpperCase())}</b></div>
    </div>`;

  // ----- fundo: pista troca a cada volta, com a faixa varrendo e o nome deslizando -----
  const stripe = root.querySelector<HTMLElement>(".m2stripe")!;
  const nameEl = root.querySelector<HTMLElement>("#m-trackname")!;
  mountMenuBackdrop(root.querySelector<HTMLCanvasElement>(".menubg")!, bgTrack, stripe, (idx) => {
    const out = nameEl.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-8px)", opacity: 0 }], { duration: 160, easing: "ease-out", fill: "forwards" });
    out.onfinish = () => {
      nameEl.textContent = (CIRCUITS[idx]?.name ?? "").toUpperCase();
      nameEl.animate([{ transform: "translateY(10px)", opacity: 0, filter: "blur(2px)" }, { transform: "translateY(0)", opacity: 1, filter: "blur(0)" }], {
        duration: 260,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "forwards",
      });
    };
  });

  // ----- painéis (campeonatos / carreira e ranking) -----
  const panel = root.querySelector<HTMLElement>("#m-panel")!;
  const panelHtml = (p: Panel) => {
    if (p === "solo")
      return `<div class="m2phead"><b>MODO SOLO</b><button class="btn small" data-pclose>✕</button></div>
        <button class="m2btn hot" id="m-solo"><b>NOVO JOGO SOLO</b><span>Fim de semana avulso ou campeonato novo (escolha nas regras)</span><i>▶</i></button>
        <h3 class="m2psub">SEUS CAMPEONATOS SOLO</h3>
        <div class="m2plist">${champRows(soloSaves) || `<p class="hint">Nenhum ainda. Em <b>Novo jogo solo</b>, ligue "Campeonato" nas regras.</p>`}</div>`;
    if (p === "online")
      return `<div class="m2phead"><b>MODO ONLINE</b><button class="btn small" data-pclose>✕</button></div>
        ${sess ? `<button class="m2btn rejoin" id="m-rejoin"><b>VOLTAR PRA SALA ${esc(sess.code)}</b><span>A conexão caiu? A IA cuidou do seu carro enquanto isso.</span><i>▶</i></button>
          <button class="btn small" id="m-forget" style="margin:6px 0 4px">ESQUECER ESSA SALA</button>` : ""}
        <button class="m2btn hot" id="m-create"><b>CRIAR SALA</b><span>Você é o host: passe o código pros amigos</span><i>▶</i></button>
        <div class="m2join"><input class="txt" id="m-code" maxlength="4" placeholder="CÓDIGO"><button class="m2btn small" id="m-join"><b>ENTRAR NUMA SALA</b><i>▶</i></button></div>
        <h3 class="m2psub">SEUS CAMPEONATOS ONLINE</h3>
        <div class="m2plist">${champRows(onlineSaves) || `<p class="hint">Nenhum ainda. Quem cria a sala com "Campeonato" ligado fica com o campeonato salvo e pode continuar depois.</p>`}</div>`;
    if (p === "carreira")
      return `<div class="m2phead"><b>CARREIRA E RANKING</b><button class="btn small" data-pclose>✕</button></div>
        <div class="seg m2ptabs"><button data-ctab="carreira" class="on">SUA CARREIRA</button><button data-ctab="ranking">RANKING</button></div>
        <div class="m2pbody" id="m-cbody">${account.profile ? statsHtml() : `<p class="hint">Sem conta as estatísticas não ficam salvas. Entre com uma conta (e-mail ou Google) pela tela inicial pra ter carreira, ranking e amigos.</p>`}</div>`;
    return "";
  };
  const bindPanel = () => {
    panel.querySelector("[data-pclose]")?.addEventListener("click", () => setPanel(null));
    panel.querySelector("#m-solo")?.addEventListener("click", () => choose({ mode: "solo", ...get() }));
    panel.querySelector("#m-create")?.addEventListener("click", () => choose({ mode: "create", ...get() }));
    panel.querySelector("#m-rejoin")?.addEventListener("click", () => choose({ mode: "rejoin", ...get(), code: sess!.code, token: sess!.token }));
    panel.querySelector("#m-forget")?.addEventListener("click", () => {
      storeSet("pwm.session", "");
      redraw();
    });
    const codeInp = panel.querySelector<HTMLInputElement>("#m-code");
    if (codeInp) {
      const join = () => {
        const code = codeInp.value.trim().toUpperCase();
        if (code.length === 4) return choose({ mode: "join", code, ...get() });
        codeInp.focus();
        if (!reduceMotion())
          codeInp.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: 260, easing: "ease-out" });
      };
      panel.querySelector("#m-join")!.addEventListener("click", join);
      codeInp.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && join());
      if (invite) {
        codeInp.value = invite;
        const jb = panel.querySelector<HTMLElement>("#m-join")!;
        jb.classList.add("hot");
        jb.querySelector("b")!.textContent = `ENTRAR NA SALA ${invite}`;
      }
    }
    panel.querySelectorAll<HTMLElement>(".m2champ").forEach((row) => {
      const id = row.dataset.cid!;
      const save = saves.find((s) => s.champ.id === id)!;
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
    panel.querySelectorAll<HTMLElement>("[data-ctab]").forEach((b) =>
      b.addEventListener("click", () => {
        panel.querySelectorAll("[data-ctab]").forEach((x) => x.classList.toggle("on", x === b));
        const body = panel.querySelector<HTMLElement>("#m-cbody")!;
        if (b.dataset.ctab === "ranking") {
          if (account.profile) void fillRanking(body, (account.profile.friends?.length ?? 0) > 0);
          else body.innerHTML = `<p class="hint">O ranking é entre jogadores com conta. Entre com uma conta pela tela inicial.</p>`;
        } else body.innerHTML = account.profile ? statsHtml() : `<p class="hint">Sem conta as estatísticas não ficam salvas.</p>`;
      }),
    );
  };
  const setPanel = (p: Panel, animate = true) => {
    const was = openPanel;
    openPanel = was === p ? null : p;
    root.querySelectorAll<HTMLElement>("[data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === openPanel));
    const show = () => {
      if (!openPanel) {
        panel.hidden = true;
        return;
      }
      panel.innerHTML = panelHtml(openPanel);
      panel.hidden = false;
      bindPanel();
      if (animate && !reduceMotion())
        panel.animate([{ transform: "translateX(28px)", opacity: 0, filter: "blur(3px)" }, { transform: "translateX(0)", opacity: 1, filter: "blur(0)" }], {
          duration: 260,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        });
    };
    // fecha o anterior rapidinho antes de abrir o outro
    if (was && !panel.hidden && animate && !reduceMotion()) {
      const a = panel.animate([{ transform: "translateX(0)", opacity: 1 }, { transform: "translateX(16px)", opacity: 0 }], { duration: 140, easing: "ease-out" });
      a.onfinish = show;
    } else show();
  };
  root.querySelectorAll<HTMLElement>("[data-panel]").forEach((b) => b.addEventListener("click", () => setPanel(b.dataset.panel as Panel)));
  if (openPanel) {
    const p = openPanel;
    openPanel = null;
    setPanel(p, false);
  }

  // ----- escolher uma opção: o menu sai pra esquerda antes de trocar de tela -----
  const choose = (c: MenuChoice) => {
    const left = root.querySelector<HTMLElement>(".m2left");
    if (!left || reduceMotion()) return onChoose(c);
    left.style.pointerEvents = "none";
    const a = left.animate([{ transform: "translateX(0)", opacity: 1 }, { transform: "translateX(-40px)", opacity: 0 }], { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
    panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
    a.onfinish = () => onChoose(c);
  };

  root.querySelector("#m-friends")!.addEventListener("click", () => showFriends(redraw));
  root.querySelector("#m-edit")!.addEventListener("click", () => showProfileEditor(redraw, onLogout));
  mountInstallButton(root.querySelector<HTMLElement>("#m-install")!);

}

/** editar perfil (engrenagem): nome, equipe, pintura e sair da conta */
function showProfileEditor(onDone: () => void, onLogout?: () => void) {
  const name = account.profile?.name ?? storeGet("pwm.name");
  const team = account.profile?.team_name ?? storeGet("pwm.team");
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel profbox">
      <div class="helphead"><b>⚙ EDITAR PERFIL</b><button class="btn small" data-x>✕</button></div>
      <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="p-name" maxlength="18" placeholder="Ex.: André" value="${esc(name)}"></label>
      <label class="fld"><span>Nome da equipe (vazio = nome original)</span><input class="txt" id="p-team" maxlength="24" placeholder="Ex.: Kustela Racing" value="${esc(team)}"></label>
      <button class="m2btn small profliv" data-liv><b>🎨 PINTURA DO CARRO E EMBLEMA</b><i>▶</i></button>
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
    close();
    onDone();
  };
  window.addEventListener("keydown", onKey, true);
  m.querySelector<HTMLInputElement>("#p-name")!.focus();
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
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
