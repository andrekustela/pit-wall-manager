// Painel de desenvolvimento do carro (no pódio, entre as etapas do campeonato).
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { DEV_AREAS, DEV_MAX, NO_DEV, devCost, devLapGain } from "../sim/development";
import { CIRCUITS, getTrack } from "../sim/track";
import { esc, teamName } from "./common";

export function devPanelHtml(lobby: LobbyState): string {
  const ch = lobby.champ;
  if (!ch || ch.finished || !ch.dev) return "";
  return `<h2>DESENVOLVIMENTO DO CARRO</h2><div class="box devbox" id="devbox">${devInner(lobby)}</div>`;
}

export function devInner(lobby: LobbyState): string {
  const ch = lobby.champ!;
  const me = lobby.players.find((p) => p.id === lobby.you)!;
  const team = me.teamId ?? "";
  const lv = ch.dev[team] ?? NO_DEV;
  const pts = ch.devPts[team] ?? 0;
  const next = ch.rounds[ch.round + 1];
  const track = next !== undefined ? getTrack(next) : null;
  const gain = track ? devLapGain(track, lv) : 0;
  const cards = DEV_AREAS.map((a) => {
    const l = lv[a.id];
    const cost = devCost(l);
    const max = l >= DEV_MAX;
    const can = !max && pts >= cost;
    return `<div class="devcard">
      <b>${a.label}</b>
      <div class="pips">${Array.from({ length: DEV_MAX }, (_, i) => `<i class="${i < l ? "on" : ""}"></i>`).join("")}<span>nível ${l}</span></div>
      <p>${a.desc}</p>
      <button class="btn ${can ? "primary" : ""}" data-dev="${a.id}" ${can ? "" : "disabled"}>${max ? "NO MÁXIMO" : `INVESTIR · ${cost} pt${cost > 1 ? "s" : ""}`}</button>
    </div>`;
  }).join("");
  const log = (ch.devLog[team] ?? [])
    .map((e) => {
      const label = DEV_AREAS.find((a) => a.id === e.area)!.label;
      return e.gain === 0
        ? `<span class="bad">✗ ${label}: não rendeu nada</span>`
        : e.gain === 2
          ? `<span class="great">★ ${label}: achou algo grande, +2 níveis!</span>`
          : `<span class="good">✓ ${label}: +1 nível</span>`;
    })
    .join("");
  // rivais: nível total de cada equipe
  const rivals = TEAMS.map((t) => {
    const d = ch.dev[t.id] ?? NO_DEV;
    return { t, d, sum: d.aero + d.engine + d.chassis };
  })
    .sort((a, b) => b.sum - a.sum)
    .map(
      ({ t, d }) =>
        `<div class="${t.id === team ? "mine" : ""}"><span class="tdot" style="background:${t.color}"></span>${esc(teamName(lobby, t.id))}<span class="lv">A${d.aero} M${d.engine} C${d.chassis}</span></div>`,
    )
    .join("");
  return `<div class="devtop">
      <div><span class="devpts">${pts}</span> ponto${pts === 1 ? "" : "s"} pra investir</div>
      <div class="hint" style="margin:0">Cada etapa dá de 3 a 6 pontos (quem está atrás no campeonato ganha mais). Cada investimento pode subir 1 nível, 2 ou não render nada. O que sobrar fica pra próxima.${track ? ` Na próxima pista (${esc(CIRCUITS[next].name)}) seu carro ganha ${gain.toFixed(2).replace(".", ",")} s por volta.` : ""}</div>
    </div>
    <div class="devcards">${cards}</div>
    ${log ? `<div class="devlog">${log}</div>` : ""}
    <details class="devrivals"><summary>Desenvolvimento das equipes (A = aerodinâmica, M = motor, C = chassi)</summary><div>${rivals}</div></details>`;
}
