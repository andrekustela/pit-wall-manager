import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { CIRCUITS, getTrack } from "../sim/track";
import { COMPOUNDS, type Compound } from "../sim/types";
import { profileOf, type DriverProfile } from "../sim/drivers";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function tyreIcon(c: Compound, title = COMPOUNDS[c].label): string {
  return `<span class="tyre ${c}" title="${esc(title)}"><b>${c}</b></span>`;
}

export function teamName(lobby: LobbyState | null, teamId: string): string {
  const custom = lobby?.weekend?.teamNames[teamId] ?? lobby?.players.find((p) => p.teamId === teamId)?.teamName;
  return custom || TEAMS.find((t) => t.id === teamId)!.name;
}

export function wetLabel(w: number): string {
  if (w < 0.05) return "Pista seca";
  if (w < 0.25) return "Pista úmida";
  if (w < 0.6) return "Pista molhada";
  return "Pista encharcada";
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(msg: string) {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el!.style.display = "none"), 3500);
}

/** barra "esperando os outros" nas fases com botão de pronto */
/** fase -> o que "pronto" quer dizer nela */
const READY_WHAT: Record<string, string> = {
  practice: "terminou o treino",
  quali: "viu a classificação",
  strategy: "fechou a estratégia",
  podium: "pronto pra seguir",
};

/**
 * Online: painel no canto de cima com cada jogador e se já apertou "pronto"
 * (a fase só avança quando todos apertam; quem caiu da conexão não segura ninguém).
 */
export function updateWaitBar(lobby: LobbyState | null) {
  let el = document.querySelector<HTMLElement>(".readyboard");
  const show = !!lobby && !lobby.solo && lobby.phase !== "lobby" && lobby.phase !== "race";
  if (!show) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = "readyboard panel";
    document.body.appendChild(el);
  }
  const ps = lobby!.players;
  const waiting = ps.filter((p) => !p.ready && p.connected);
  const rows = ps
    .map((p) => {
      const color = TEAMS.find((t) => t.id === p.teamId)?.color ?? "#555";
      const st = !p.connected ? `<span class="rs off">⚠ CAIU</span>` : p.ready ? `<span class="rs ok">✓ PRONTO</span>` : `<span class="rs wait">⏳ ${p.id === lobby!.you ? "VOCÊ" : "…"}</span>`;
      return `<div class="rrow ${p.id === lobby!.you ? "me" : ""}"><span class="rdot" style="background:${color}"></span><span class="rn">${esc(p.name)}</span>${st}</div>`;
    })
    .join("");
  const foot = waiting.length ? `Faltam ${waiting.length}: ${waiting.map((p) => esc(p.name)).join(", ")}` : "Todos prontos! Avançando…";
  el.innerHTML = `<div class="rhead">JOGADORES · ${esc(READY_WHAT[lobby!.phase] ?? "pronto")}</div>${rows}<div class="rfoot">${foot}</div>`;
}

/** desenha a silhueta da pista num canvas */
export function drawTrackThumb(cv: HTMLCanvasElement, trackIndex: number, color = "#e9edf5") {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 220, h = cv.clientHeight || 90;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  // traçado já desenhado em pontos densos: usa direto (montar a pista inteira é mais caro)
  const def = CIRCUITS[trackIndex];
  const t = def.points.length > 200 ? { pts: def.points.map(([x, y]) => ({ x, y })) } : getTrack(trackIndex);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of t.pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = 8;
  const sc = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
  const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2;
  g.beginPath();
  t.pts.forEach((p, i) => {
    const x = ox + (p.x - minX) * sc, y = oy + (p.y - minY) * sc;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  });
  g.closePath();
  g.lineJoin = "round";
  g.strokeStyle = "#000";
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.stroke();
  const s0 = t.pts[0];
  g.fillStyle = "#e8202a";
  g.fillRect(ox + (s0.x - minX) * sc - 2, oy + (s0.y - minY) * sc - 4, 4, 8);
  return { ox, oy, sc, minX, minY };
}

export function storeGet(k: string): string {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
export function storeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem storage */
  }
}

/** "Campeonato · Etapa 2 de 3 · " (ou vazio) */
export function champLabel(lobby: LobbyState | null): string {
  const ch = lobby?.champ;
  return ch ? `Campeonato · Etapa ${ch.round + 1} de ${ch.rounds.length} · ` : "";
}

/** botão "← VOLTAR" (só pro host/solo): volta uma etapa do fim de semana */
export function backButtonHtml(lobby: LobbyState, label: string): string {
  if (lobby.hostId !== lobby.you) return "";
  return `<button class="btn back-btn" data-back>← ${esc(label)}</button>`;
}

export function bindBackButton(root: HTMLElement, send: (msg: { t: "back" }) => void, confirmText?: string) {
  root.querySelector("[data-back]")?.addEventListener("click", async () => {
    if (confirmText) {
      const { confirmDialog } = await import("./confirm");
      if (!(await confirmDialog({ title: "VOLTAR", icon: "←", text: confirmText, ok: "VOLTAR" }))) return;
    }
    send({ t: "back" });
  });
}

/** pilotos (perfis) de uma equipe neste jogo */
export function teamDrivers(lobby: LobbyState, teamId: string): DriverProfile[] {
  const ids = lobby.weekend?.lineup?.[teamId] ?? lobby.lineup?.[teamId] ?? [];
  return ids.map((id) => profileOf(id)!).filter(Boolean);
}

/** equipe de um piloto neste jogo */
export function teamOfDriver(lobby: LobbyState, driverId: string): string {
  const lineup = lobby.weekend?.lineup ?? lobby.lineup ?? {};
  return Object.keys(lineup).find((t) => lineup[t].includes(driverId)) ?? "";
}

// ---------- dicas "?" (clique mostra um balão com a explicação) ----------
let tipInstalled = false;
export function tipButton(text: string, label = "?"): string {
  installTips();
  return `<button type="button" class="qtip" data-tip="${esc(text)}">${label}</button>`;
}

function installTips() {
  if (tipInstalled) return;
  tipInstalled = true;
  document.addEventListener("click", (e) => {
    const old = document.querySelector(".tipbox");
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (old && (!btn || old.getAttribute("data-for") === btn.dataset.tip)) {
      old.remove();
      if (!btn) return;
      return;
    }
    old?.remove();
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const box = document.createElement("div");
    box.className = "tipbox";
    box.setAttribute("data-for", btn.dataset.tip!);
    box.textContent = btn.dataset.tip!;
    document.body.appendChild(box);
    const r = btn.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    box.style.width = `${w}px`;
    box.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
    box.style.top = `${r.bottom + 8 + window.scrollY}px`;
  }, true);
}

/** ícone do clima: ☀ seco, 💧 úmido/molhado, 🌧 encharcado */
export function wetIcon(w: number): string {
  return w < 0.05 ? "☀" : w < 0.6 ? "💧" : "🌧";
}

/** etiqueta do país (o Windows não desenha emoji de bandeira, então vai a sigla) */
export function natBadge(p: { nat: string; country: string }): string {
  // emoji de bandeira = 2 "letras regionais"; converte de volta pra sigla (BR, IT...)
  const code = [...p.nat].map((ch) => String.fromCharCode((ch.codePointAt(0) ?? 0) - 0x1f1e6 + 65)).join("");
  return `<span class="natb" title="${esc(p.country)}">${esc(code)}</span>`;
}
