import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { getTrack } from "../sim/track";
import { COMPOUNDS, type Compound } from "../sim/types";

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
export function updateWaitBar(lobby: LobbyState | null) {
  let el = document.querySelector<HTMLElement>(".waitbar");
  const me = lobby?.players.find((p) => p.id === lobby.you);
  const waiting = lobby?.players.filter((p) => !p.ready) ?? [];
  const show = !!lobby && !lobby.solo && lobby.phase !== "lobby" && lobby.phase !== "race" && !!me?.ready && waiting.length > 0;
  if (!show) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = "waitbar";
    document.body.appendChild(el);
  }
  el.textContent = `Pronto! Esperando: ${waiting.map((p) => p.name).join(", ")}`;
}

/** desenha a silhueta da pista num canvas */
export function drawTrackThumb(cv: HTMLCanvasElement, trackIndex: number, color = "#e9edf5") {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 220, h = cv.clientHeight || 90;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  const t = getTrack(trackIndex);
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
