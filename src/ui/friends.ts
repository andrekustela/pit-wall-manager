// Amigos: cada conta tem um código de 6 letras/números. Adiciona pelo código e
// vê o resumo de cada um (vem do ranking público).
import { account, type RankRow } from "../net/account";
import { emblemSvg } from "../render/emblem";
import { cleanLivery } from "../sim/livery";
import { esc } from "./common";

function ago(ms?: number): string {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return "agora há pouco";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

export function showFriends(onChange?: () => void) {
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel friendsbox"><div class="helphead"><b>👥 AMIGOS</b><button class="btn small" data-close>✕</button></div><div class="fbody"></div></div>`;
  document.body.appendChild(m);
  const close = () => {
    m.remove();
    window.removeEventListener("keydown", onKey, true);
    onChange?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-close]")) close();
  });
  const body = m.querySelector<HTMLElement>(".fbody")!;
  if (!account.profile) {
    body.innerHTML = `<p class="hint">Pra ter amigos você precisa entrar com uma conta (e-mail ou Google). Saia e entre pela tela inicial.</p>`;
    return;
  }

  let rows: RankRow[] = [];
  let msg = "";
  const render = () => {
    const ids = account.profile!.friends ?? [];
    const list = ids
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is RankRow => !!r)
      .map((r) => {
        const lv = cleanLivery(r.livery);
        return `<div class="frow">${lv ? emblemSvg(lv.emblem, 40) : `<div class="m2noemb small">${esc(r.name.slice(0, 1).toUpperCase())}</div>`}
          <div class="finfo"><b>${esc(r.name)}</b><span>${esc(r.team_name || "Equipe com o nome original")}${r.updated ? ` · visto ${ago(r.updated)}` : ""}</span></div>
          <div class="fstats"><span><b>${r.stats.titles}</b> títulos</span><span><b>${r.stats.wins}</b> vitórias</span><span><b>${r.stats.races}</b> corridas</span></div>
          <button class="btn small" data-rm="${esc(r.id)}" title="Tirar da lista">✕</button></div>`;
      })
      .join("");
    body.innerHTML = `<div class="fcode"><div><span class="hint" style="margin:0">SEU CÓDIGO DE AMIGO</span><div class="code">${account.friendCode()}</div></div>
        <button class="btn small" data-copy>📋 COPIAR</button></div>
      <p class="hint">Passe esse código pro seu amigo. Pra adicionar alguém, digite o código dele:</p>
      <div class="fadd"><input class="txt" data-code maxlength="6" placeholder="EX.: 7KQ2ZD"><button class="btn primary" data-add>ADICIONAR</button></div>
      ${msg ? `<p class="fmsg">${esc(msg)}</p>` : ""}
      <h3 style="margin:16px 0 8px">SEUS AMIGOS (${ids.length})</h3>
      <div class="flist">${list || `<p class="hint">Ninguém ainda.</p>`}</div>`;
    body.querySelector<HTMLInputElement>("[data-code]")!.focus();
  };
  const add = async () => {
    const inp = body.querySelector<HTMLInputElement>("[data-code]")!;
    const r = await account.addFriend(inp.value);
    if (typeof r === "string") msg = r;
    else {
      msg = `${r.name} agora é seu amigo!`;
      if (!rows.some((x) => x.id === r.id)) rows.push(r);
    }
    render();
  };
  body.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-add]")) void add();
    if (t.closest("[data-copy]")) {
      const b = t.closest<HTMLButtonElement>("[data-copy]")!;
      try {
        await navigator.clipboard.writeText(account.friendCode());
        b.textContent = "✓ COPIADO!";
      } catch {
        window.prompt("Copie:", account.friendCode());
      }
    }
    const rm = t.closest<HTMLElement>("[data-rm]");
    if (rm) {
      await account.removeFriend(rm.dataset.rm!);
      msg = "";
      render();
    }
  });
  body.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).matches("[data-code]") && (e as KeyboardEvent).key === "Enter") void add();
  });
  body.innerHTML = `<p class="hint">Carregando…</p>`;
  account
    .ranking()
    .then((r) => {
      rows = r ?? [];
      render();
    })
    .catch(() => {
      rows = [];
      render();
    });
}
