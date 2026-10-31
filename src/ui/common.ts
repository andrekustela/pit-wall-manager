import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { CIRCUITS, getTrack, isTrackBuilt } from "../sim/track";
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

/**
 * Desenha a silhueta da pista num canvas. `exact` = usa a pista montada do jogo
 * (largada no lugar certo; obrigatório quando algo anda por cima, como a volta de
 * teste do treino). Sem isso usa o traçado cru (bem mais rápido, pra grade de pistas).
 */
export function drawTrackThumb(cv: HTMLCanvasElement, trackIndex: number, color = "#e9edf5", exact = false) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 220, h = cv.clientHeight || 90;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  // traçado já desenhado em pontos densos: usa direto (montar a pista inteira é mais caro)
  const def = CIRCUITS[trackIndex];
  const built = exact || def.points.length <= 200 || isTrackBuilt(trackIndex);
  const t = built ? getTrack(trackIndex) : { pts: def.points.map(([x, y]) => ({ x, y })) };
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
  // largada: só com a pista montada (no traçado cru o começo não é a largada)
  if (built) {
    const s0 = t.pts[0], s1 = t.pts[Math.min(3, t.pts.length - 1)];
    g.save();
    g.translate(ox + (s0.x - minX) * sc, oy + (s0.y - minY) * sc);
    g.rotate(Math.atan2(s1.y - s0.y, s1.x - s0.x));
    g.fillStyle = "#000";
    g.fillRect(-2.5, -6, 5, 12);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++) {
        g.fillStyle = (r + c) % 2 ? "#111" : "#fff";
        g.fillRect(-2 + c * 2, -4 + r * 2, 2, 2);
      }
    g.restore();
  }
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

/** etiquetas da pista (rua, noturna, chuvosa...) pra mostrar em listas e cartões */
export function trackTags(trackIndex: number): { t: string; c: string; tip: string }[] {
  const d = CIRCUITS[trackIndex];
  if (!d) return [];
  const tags: { t: string; c: string; tip: string }[] = [];
  if (d.street) tags.push({ t: "RUA", c: "rua", tip: "Circuito de rua: muro colado na pista" });
  if (d.night) tags.push({ t: "NOTURNA", c: "noite", tip: "Corrida de noite, com refletores" });
  if (d.rainChance >= 0.4) tags.push({ t: "CHUVOSA", c: "chuva", tip: `Chance de chuva de ${Math.round(d.rainChance * 100)}%` });
  else if (d.rainChance <= 0.05) tags.push({ t: "SECA", c: "seca", tip: "Quase nunca chove" });
  if (d.marks?.t0 !== undefined || d.tunnelAt) tags.push({ t: "TÚNEL", c: "tunel", tip: "Tem um trecho coberto" });
  if (d.minHeight >= 6) tags.push({ t: "ONDULADA", c: "ond", tip: "Asfalto irregular: carro baixo bate no chão" });
  if ((d.overtake ?? 1) <= 0.8) tags.push({ t: "DIFÍCIL ULTRAPASSAR", c: "ultra-", tip: "Pouco espaço pra ultrapassar" });
  else if ((d.overtake ?? 1) >= 1.2) tags.push({ t: "FÁCIL ULTRAPASSAR", c: "ultra", tip: "Boas zonas de ultrapassagem" });
  if (d.targetLength >= 6000) tags.push({ t: "LONGA", c: "long", tip: `${(d.targetLength / 1000).toFixed(1).replace(".", ",")} km` });
  else if (d.targetLength <= 3800) tags.push({ t: "CURTA", c: "curta", tip: `${(d.targetLength / 1000).toFixed(1).replace(".", ",")} km` });
  return tags;
}

export function trackTagsHtml(trackIndex: number, max = 9): string {
  return trackTags(trackIndex)
    .slice(0, max)
    .map((x) => `<em class="ttag ${x.c}" title="${x.tip}">${x.t}</em>`)
    .join("");
}
