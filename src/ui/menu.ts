import { esc, storeGet, storeSet } from "./common";
import type { ChampSave } from "../net/room";
import { CIRCUITS } from "../sim/track";
import { account } from "../net/account";
import { statsHtml } from "./login";

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

export function showMenu(root: HTMLElement, onChoose: (c: MenuChoice) => void, onLogout?: () => void) {
  const name = account.profile?.name ?? storeGet("pwm.name");
  const team = account.profile?.team_name ?? storeGet("pwm.team");
  const save = loadJson<ChampSave>("pwm.champ");
  const sess = loadJson<Session>("pwm.session");
  const ch = save?.v === 1 ? save.champ : null;
  const cont =
    ch || sess
      ? `<div class="box resumebox" style="margin-top:12px">
        ${ch ? `<div class="resumerow"><div><b>CAMPEONATO SALVO</b><div class="hint" style="margin:2px 0 0">${esc(save!.name)} · próxima etapa ${ch.round + 2}/${ch.rounds.length}: ${esc(CIRCUITS[ch.rounds[ch.round + 1]]?.name ?? "")}</div></div>
          <div class="row-btns"><button class="btn" id="m-drop">DESCARTAR</button><button class="btn primary" id="m-resume">CONTINUAR ▶</button></div></div>` : ""}
        ${sess ? `<div class="resumerow"><div><b>SALA ONLINE ${esc(sess.code)}</b><div class="hint" style="margin:2px 0 0">A conexão caiu? Volte pro mesmo lugar (a IA cuidou do seu carro enquanto isso).</div></div>
          <div class="row-btns"><button class="btn" id="m-forget">ESQUECER</button><button class="btn primary" id="m-rejoin">VOLTAR PRA SALA ▶</button></div></div>` : ""}
      </div>`
      : "";
  root.innerHTML = `
    <div class="screen"><div class="wrap" style="max-width:720px">
      <h1 class="title">PIT WALL <span>MANAGER</span></h1>
      <p class="sub">Você é o engenheiro-chefe. Os pilotos correm, você decide o acerto e a estratégia.</p>
      ${account.profile ? `<div class="box accountbox"><div class="accounthead"><div><h3 style="margin:0">OLÁ, ${esc(account.profile.name.toUpperCase())}</h3>
          <div class="hint" style="margin:2px 0 0">${account.profile.team_name ? `Equipe ${esc(account.profile.team_name)}` : "Equipe com o nome original"}</div></div>
          <div class="row-btns" style="margin:0"><button class="btn small" id="m-edit">EDITAR PERFIL</button><button class="btn small" id="m-logout">SAIR DA CONTA</button></div></div>${statsHtml()}</div>` : ""}
      <div class="box" id="m-profile" ${account.profile ? "hidden" : ""}>
        <h3>${account.profile ? "EDITAR PERFIL" : "SEU PERFIL"}</h3>
        <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="m-name" maxlength="18" placeholder="Ex.: André" value="${esc(name)}"></label>
        <label class="fld"><span>Nome da equipe (opcional)</span><input class="txt" id="m-team" maxlength="24" placeholder="Ex.: Kustela Racing" value="${esc(team)}"></label>
      </div>
      ${cont}
      <div class="cols" style="margin-top:12px">
        <div class="box">
          <h3>SOLO</h3>
          <p class="hint" style="margin-top:0">Você contra 9 equipes da IA, cada uma com um engenheiro sorteado (bom ou ruim).</p>
          <button class="btn primary" id="m-solo">JOGAR SOLO ▶</button>
        </div>
        <div class="box">
          <h3>ONLINE</h3>
          <p class="hint" style="margin-top:0">Crie uma sala e passe o código pros amigos. As equipes que sobrarem ficam com a IA.</p>
          <button class="btn primary" id="m-create">CRIAR SALA</button>
          <div style="display:flex;gap:6px;margin-top:10px">
            <input class="txt" id="m-code" maxlength="4" placeholder="CÓDIGO" style="text-transform:uppercase;width:120px">
            <button class="btn" id="m-join">ENTRAR</button>
          </div>
        </div>
      </div>
    </div></div>`;
  const get = () => {
    const n = root.querySelector<HTMLInputElement>("#m-name")!.value.trim();
    const t = root.querySelector<HTMLInputElement>("#m-team")!.value.trim();
    storeSet("pwm.name", n);
    storeSet("pwm.team", t);
    if (n) account.setNames(n, t);
    if (account.profile) return { name: account.profile.name || "Engenheiro", teamName: account.profile.team_name };
    return { name: n || "Engenheiro", teamName: t };
  };
  root.querySelector("#m-resume")?.addEventListener("click", () => onChoose({ mode: "resume", ...get(), save: save! }));
  root.querySelector("#m-rejoin")?.addEventListener("click", () => onChoose({ mode: "rejoin", ...get(), code: sess!.code, token: sess!.token }));
  root.querySelector("#m-drop")?.addEventListener("click", () => {
    storeSet("pwm.champ", "");
    showMenu(root, onChoose);
  });
  root.querySelector("#m-forget")?.addEventListener("click", () => {
    storeSet("pwm.session", "");
    showMenu(root, onChoose);
  });
  root.querySelector("#m-logout")?.addEventListener("click", () => onLogout?.());
  // logado: o perfil fica escondido e abre no "editar perfil"
  root.querySelector("#m-edit")?.addEventListener("click", () => {
    const box = root.querySelector<HTMLElement>("#m-profile")!;
    if (box.hidden) {
      box.hidden = false;
      root.querySelector<HTMLInputElement>("#m-name")!.focus();
      root.querySelector("#m-edit")!.textContent = "SALVAR PERFIL";
    } else {
      get();
      showMenu(root, onChoose, onLogout);
    }
  });
  root.querySelector("#m-solo")!.addEventListener("click", () => onChoose({ mode: "solo", ...get() }));
  root.querySelector("#m-create")!.addEventListener("click", () => onChoose({ mode: "create", ...get() }));
  const join = () => {
    const code = root.querySelector<HTMLInputElement>("#m-code")!.value.trim().toUpperCase();
    if (code.length === 4) onChoose({ mode: "join", code, ...get() });
  };
  root.querySelector("#m-join")!.addEventListener("click", join);
  root.querySelector("#m-code")!.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && join());
}
