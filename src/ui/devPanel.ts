// Painel de desenvolvimento dos carros (no pódio e na sede, entre as etapas do
// campeonato). Cada piloto tem o seu carro, com evolução e pontos próprios.
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { DEV_AREAS, DEV_MAX, NO_DEV, devCost, devLapGain } from "../sim/development";
import { CIRCUITS, getTrack } from "../sim/track";
import { ENGINE_REPAIR_COST, ENGINE_REPAIR_GAIN } from "../sim/championship";
import { profileOf } from "../sim/drivers";
import { esc, teamName } from "./common";

export function devPanelHtml(lobby: LobbyState): string {
  const ch = lobby.champ;
  if (!ch || ch.finished || !ch.dev) return "";
  return `<h2>DESENVOLVIMENTO DOS CARROS</h2><div class="box devbox" id="devbox">${devInner(lobby)}</div>`;
}

/** motor do carro: saúde e a revisão (gasta pontos de desenvolvimento do carro) */
function engineHtml(lobby: LobbyState, id: string, pts: number): string {
  const ch = lobby.champ!;
  if (!ch.engines) return "";
  const h = ch.engines[id] ?? 1;
  const cls = h > 0.6 ? "ok" : h > 0.35 ? "warn" : "bad";
  const full = h >= 0.999;
  const dead = h <= 0.02;
  const can = !full && !dead && pts >= ENGINE_REPAIR_COST;
  const after = Math.min(100, Math.round((h + ENGINE_REPAIR_GAIN) * 100));
  const label = full ? "MOTOR INTEIRO" : dead ? "QUEBRADO (TROCA NO TREINO)" : `REVISAR · ${ENGINE_REPAIR_COST} pts (vai a ${after}%)`;
  return `<div class="engrow"><span>MOTOR</span><div class="engbar"><i class="${cls}" style="width:${Math.round(h * 100)}%"></i></div><b class="${cls}">${Math.round(h * 100)}%</b>
    <button class="btn small ${can ? "primary" : ""}" data-repair="${id}" ${can ? "" : "disabled"}>${label}</button></div>`;
}

/** um carro: pontos, as três áreas, o que deu nos investimentos e o motor */
function carHtml(lobby: LobbyState, id: string, color: string): string {
  const ch = lobby.champ!;
  const lv = ch.dev[id] ?? NO_DEV;
  const pts = ch.devPts[id] ?? 0;
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
      <button class="btn ${can ? "primary" : ""}" data-dev="${a.id}" data-car="${id}" ${can ? "" : "disabled"}>${max ? "NO MÁXIMO" : `INVESTIR · ${cost} pt${cost > 1 ? "s" : ""}`}</button>
    </div>`;
  }).join("");
  const log = (ch.devLog[id] ?? [])
    .map((e) => {
      const label = DEV_AREAS.find((a) => a.id === e.area)!.label;
      return e.gain === 0
        ? `<span class="bad">✗ ${label}: não rendeu nada</span>`
        : e.gain === 2
          ? `<span class="great">★ ${label}: achou algo grande, +2 níveis!</span>`
          : `<span class="good">✓ ${label}: +1 nível</span>`;
    })
    .join("");
  return `<div class="devcar" style="border-left-color:${color}">
      <div class="devtop"><div><b class="devcarname">${esc(profileOf(id)?.name ?? id)}</b></div>
        <div><span class="devpts">${pts}</span> ponto${pts === 1 ? "" : "s"} deste carro</div>
        ${track ? `<div class="hint" style="margin:0">Em ${esc(CIRCUITS[next].name)}: −${gain.toFixed(2).replace(".", ",")} s por volta</div>` : ""}</div>
      <div class="devcards">${cards}</div>
      ${log ? `<div class="devlog">${log}</div>` : ""}
      ${engineHtml(lobby, id, pts)}
    </div>`;
}

export function devInner(lobby: LobbyState): string {
  const ch = lobby.champ!;
  const me = lobby.players.find((p) => p.id === lobby.you)!;
  const team = me.teamId ?? "";
  const color = me.livery?.base ?? TEAMS.find((t) => t.id === team)?.color ?? "#fff";
  const cars = (lobby.lineup[team] ?? []).map((id) => carHtml(lobby, id, color)).join("");
  // rivais: evolução de cada carro
  const rivals = TEAMS.flatMap((t) => (lobby.lineup[t.id] ?? []).map((id) => ({ t, id, d: ch.dev[id] ?? ch.dev[t.id] ?? NO_DEV })))
    .map((x) => ({ ...x, sum: x.d.aero + x.d.engine + x.d.chassis }))
    .sort((a, b) => b.sum - a.sum)
    .map(
      ({ t, id, d }) =>
        `<div class="${t.id === team ? "mine" : ""}"><span class="tdot" style="background:${t.color}"></span>${esc(profileOf(id)?.name ?? id)} <span class="hint" style="margin:0">${esc(teamName(lobby, t.id))}</span><span class="lv">A${d.aero} M${d.engine} C${d.chassis}</span></div>`,
    )
    .join("");
  return `<p class="hint" style="margin-top:0">Cada piloto tem o seu carro e os seus pontos. Cada etapa dá de 3 a 6 pontos pra cada carro (quem está atrás no campeonato de pilotos ganha mais). Cada investimento pode subir 1 nível, 2 ou não render nada. Reservas de motor da equipe: ${ch.spares?.[team] ?? 0}.</p>
    <div class="devcars">${cars}</div>
    <details class="devrivals"><summary>Desenvolvimento de todos os carros (A = aerodinâmica, M = motor, C = chassi)</summary><div>${rivals}</div></details>`;
}
