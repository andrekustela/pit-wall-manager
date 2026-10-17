// Painel de desenvolvimento do carro (no pódio, entre as etapas do campeonato).
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
  return `<h2>DESENVOLVIMENTO DO CARRO</h2><div class="box devbox" id="devbox">${devInner(lobby)}</div>`;
}

/** motores da equipe: saúde de cada um e a revisão (gasta pontos de desenvolvimento) */
function enginesHtml(lobby: LobbyState, team: string, pts: number): string {
  const ch = lobby.champ!;
  if (!ch.engines) return "";
  const rows = (lobby.lineup[team] ?? [])
    .map((id) => {
      const h = ch.engines[id] ?? 1;
      const cls = h > 0.6 ? "ok" : h > 0.35 ? "warn" : "bad";
      const full = h >= 0.999;
      const dead = h <= 0.02;
      const can = !full && !dead && pts >= ENGINE_REPAIR_COST;
      const after = Math.min(100, Math.round((h + ENGINE_REPAIR_GAIN) * 100));
      const label = full ? "MOTOR INTEIRO" : dead ? "QUEBRADO (TROCA NO TREINO)" : `REVISAR · ${ENGINE_REPAIR_COST} pts (vai a ${after}%)`;
      return `<div class="engrow"><span>${esc(profileOf(id)?.name ?? id)}</span><div class="engbar"><i class="${cls}" style="width:${Math.round(h * 100)}%"></i></div><b class="${cls}">${Math.round(h * 100)}%</b>
        <button class="btn small ${can ? "primary" : ""}" data-repair="${id}" ${can ? "" : "disabled"}>${label}</button></div>`;
    })
    .join("");
  return `<div class="devengines"><b>MOTORES</b><span class="hint" style="margin:0 0 0 8px">O desgaste passa de uma etapa pra outra. Revisar usa pontos de desenvolvimento em vez de evoluir o carro. Reservas da equipe: ${ch.spares?.[team] ?? 0}.</span>${rows}</div>`;
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
    ${enginesHtml(lobby, team, pts)}
    <details class="devrivals"><summary>Desenvolvimento das equipes (A = aerodinâmica, M = motor, C = chassi)</summary><div>${rivals}</div></details>`;
}
