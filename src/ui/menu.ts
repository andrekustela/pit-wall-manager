import { esc, storeGet, storeSet } from "./common";
import type { ChampSave } from "../net/room";
import { CIRCUITS } from "../sim/track";
import { account } from "../net/account";
import { statsHtml } from "./login";
import { mountInstallButton } from "./install";
import { deleteSave, listSaves, renameSave } from "./saves";
import { confirmDialog } from "./confirm";
import { showRanking } from "./ranking";
import { editMyLivery } from "./liveryEditor";
import { getLivery } from "./liveryStore";
import { emblemSvg } from "../render/emblem";

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
  const saves = listSaves();
  const sess = loadJson<Session>("pwm.session");
  const champRows = saves
    .map((s) => {
      const ch = s.champ;
      const done = ch.results.length;
      const next = ch.rounds[ch.results.length]; // a próxima é a primeira que ainda não correu
      const when = s.updated ? new Date(s.updated).toLocaleDateString("pt-BR") : "";
      const status = ch.finished
        ? `🏆 Concluído · ${ch.rounds.length} etapas`
        : `Etapa ${done} de ${ch.rounds.length} feita · próxima: ${esc(CIRCUITS[next]?.name ?? "")}`;
      return `<div class="resumerow champrow" data-cid="${esc(ch.id)}"><div><b>${esc(ch.name ?? "Campeonato")}</b>${s.online ? ` <span class="onlinetag">🌐 ONLINE · ${(s.players ?? []).map((p) => esc(p.name)).join(", ")}</span>` : ""}
          <div class="hint" style="margin:2px 0 0">${status} · ${esc(s.name)}${s.teamName ? ` (${esc(s.teamName)})` : ""}${when ? ` · ${when}` : ""}</div></div>
          <div class="row-btns"><button class="btn small" data-crename>RENOMEAR</button><button class="btn small" data-cdel>APAGAR</button>
          <button class="btn small primary" data-cplay title="${s.online && !ch.finished ? "Cria uma sala nova com este campeonato; os amigos entram pelo código e voltam pra equipe deles" : ""}">${ch.finished ? "VER TROFÉUS ▶" : s.online ? "CONTINUAR ONLINE ▶" : "CONTINUAR ▶"}</button></div></div>`;
    })
    .join("");
  const cont = `${saves.length ? `<div class="box resumebox" style="margin-top:12px"><h3 style="margin:0 0 4px">MEUS CAMPEONATOS</h3>${champRows}</div>` : ""}
    ${sess ? `<div class="box resumebox" style="margin-top:12px"><div class="resumerow"><div><b>SALA ONLINE ${esc(sess.code)}</b><div class="hint" style="margin:2px 0 0">A conexão caiu? Volte pro mesmo lugar (a IA cuidou do seu carro enquanto isso).</div></div>
          <div class="row-btns"><button class="btn" id="m-forget">ESQUECER</button><button class="btn primary" id="m-rejoin">VOLTAR PRA SALA ▶</button></div></div></div>` : ""}`;
  root.innerHTML = `
    <div class="screen"><div class="wrap" style="max-width:720px">
      <div class="menuhead"><img class="menulogo" src="/brand/logo.png" alt="Pit Wall Manager"><div id="m-install"></div></div>
      <p class="sub">Você é o engenheiro-chefe. Os pilotos correm, você decide o acerto e a estratégia.</p>
      ${account.profile ? `<div class="box accountbox"><div class="accounthead"><div class="accname">${getLivery() ? emblemSvg(getLivery()!.emblem, 52) : ""}<div><h3 style="margin:0">OLÁ, ${esc(account.profile.name.toUpperCase())}</h3>
          <div class="hint" style="margin:2px 0 0">${account.profile.team_name ? `Equipe ${esc(account.profile.team_name)}` : "Equipe com o nome original"}</div></div></div>
          <div class="row-btns" style="margin:0"><button class="btn small primary" id="m-rank">🏆 RANKING</button><button class="btn small" id="m-livery">🎨 PINTURA E EMBLEMA</button><button class="btn small" id="m-edit">EDITAR PERFIL</button><button class="btn small" id="m-logout">SAIR DA CONTA</button></div></div>${statsHtml()}</div>` : ""}
      <div class="box" id="m-profile" ${account.profile ? "hidden" : ""}>
        <h3>${account.profile ? "EDITAR PERFIL" : "SEU PERFIL"}</h3>
        <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="m-name" maxlength="18" placeholder="Ex.: André" value="${esc(name)}"></label>
        <label class="fld"><span>Nome da equipe (opcional)</span><input class="txt" id="m-team" maxlength="24" placeholder="Ex.: Kustela Racing" value="${esc(team)}"></label>
        ${account.profile ? "" : `<button class="btn small" id="m-livery">🎨 PINTURA E EMBLEMA</button>`}
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
  // meus campeonatos: continuar, renomear, apagar
  root.querySelectorAll<HTMLElement>(".champrow").forEach((row) => {
    const id = row.dataset.cid!;
    const save = saves.find((s) => s.champ.id === id)!;
    row.querySelector("[data-cplay]")!.addEventListener("click", () => onChoose({ mode: "resume", ...get(), save }));
    row.querySelector("[data-crename]")!.addEventListener("click", () => {
      const n = window.prompt("Novo nome do campeonato:", save.champ.name ?? "");
      if (n !== null && n.trim()) {
        renameSave(id, n);
        showMenu(root, onChoose, onLogout);
      }
    });
    row.querySelector("[data-cdel]")!.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "Apagar campeonato", icon: "🗑", text: `Apagar "${save.champ.name ?? "Campeonato"}"? Não dá pra desfazer.`, ok: "APAGAR", danger: true });
      if (!ok) return;
      deleteSave(id);
      showMenu(root, onChoose, onLogout);
    });
  });
  root.querySelector("#m-rejoin")?.addEventListener("click", () => onChoose({ mode: "rejoin", ...get(), code: sess!.code, token: sess!.token }));
  root.querySelector("#m-forget")?.addEventListener("click", () => {
    storeSet("pwm.session", "");
    showMenu(root, onChoose);
  });
  root.querySelector("#m-logout")?.addEventListener("click", () => onLogout?.());
  root.querySelector("#m-rank")?.addEventListener("click", () => void showRanking());
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
  root.querySelector("#m-livery")?.addEventListener("click", () => editMyLivery(storeGet("pwm.lastTeam") || "", account.profile?.team_name || storeGet("pwm.team"), undefined, () => showMenu(root, onChoose, onLogout)));
  mountInstallButton(root.querySelector<HTMLElement>("#m-install")!);
  root.querySelector("#m-solo")!.addEventListener("click", () => onChoose({ mode: "solo", ...get() }));
  root.querySelector("#m-create")!.addEventListener("click", () => onChoose({ mode: "create", ...get() }));
  const join = () => {
    const code = root.querySelector<HTMLInputElement>("#m-code")!.value.trim().toUpperCase();
    if (code.length === 4) onChoose({ mode: "join", code, ...get() });
  };
  root.querySelector("#m-join")!.addEventListener("click", join);
  root.querySelector("#m-code")!.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && join());
  // veio por um link de convite (?sala=CODE): código já preenchido e o botão em destaque
  const invite = new URLSearchParams(location.search).get("sala")?.trim().toUpperCase();
  if (invite && /^[A-Z]{4}$/.test(invite)) {
    const inp = root.querySelector<HTMLInputElement>("#m-code")!;
    inp.value = invite;
    const jb = root.querySelector<HTMLButtonElement>("#m-join")!;
    jb.classList.add("primary");
    jb.textContent = `ENTRAR NA SALA ${invite} ▶`;
    inp.closest(".box")?.classList.add("invited");
  }
}
