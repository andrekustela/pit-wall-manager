// Sorteio dos pilotos (aparece quando o fim de semana começa): revela os 2
// pilotos da sua equipe e depois mostra quem caiu em cada equipe.
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { esc, natBadge, teamDrivers, teamName } from "./common";
import { driverCardHtml } from "./driverCard";

export function showDraft(lobby: LobbyState, onDone?: () => void) {
  const me = lobby.players.find((p) => p.id === lobby.you)!;
  const myTeam = TEAMS.find((t) => t.id === me.teamId)!;
  const mine = teamDrivers(lobby, myTeam.id);
  const m = document.createElement("div");
  m.className = "helpmodal draft";
  m.innerHTML = `<div class="helpbox panel draftbox">
    <div class="helphead"><b>🎲 SORTEIO DOS PILOTOS</b><span class="hint" style="margin:0">sorteados da base de 100 pilotos</span></div>
    <div class="draftgrid"><div>
    <p class="hint" style="margin-top:0">Seus pilotos na <b style="color:#fff">${esc(teamName(lobby, myTeam.id))}</b>:</p>
    <div class="draft-mine">${mine
      .map((d, i) => `<div class="flip" data-i="${i}"><div class="flip-back">?</div><div class="flip-front">${driverCardHtml(d, teamName(lobby, myTeam.id), myTeam.color)}</div></div>`)
      .join("")}</div></div>
    <div><h3 style="margin:0 0 6px;font-family:var(--pix);font-size:12px;color:var(--muted)">AS OUTRAS EQUIPES</h3>
    <div class="draft-others">${TEAMS.filter((t) => t.id !== myTeam.id)
      .map(
        (t) => `<div class="dteam" style="border-left:4px solid ${t.color}"><b>${esc(teamName(lobby, t.id))}</b>
        ${teamDrivers(lobby, t.id).map((d) => `<span>${natBadge(d)} ${esc(d.name)} <i>${d.rating}</i> <small>${esc(d.style)}</small></span>`).join("")}</div>`,
      )
      .join("")}</div></div></div>
    <p class="hint">Não gostou? No treino você pode <b>trocar 1 piloto pelo reserva</b> (uma vez só). O reserva é surpresa: pode ser melhor ou pior.</p>
    <button class="go" data-go style="margin-top:8px">VAMOS PRO TREINO ▶</button>
  </div>`;
  document.body.appendChild(m);
  // revela as cartas uma de cada vez
  m.querySelectorAll<HTMLElement>(".flip").forEach((el, i) => setTimeout(() => el.classList.add("on"), 500 + i * 700));
  m.querySelectorAll<HTMLElement>(".dteam").forEach((el, i) => setTimeout(() => el.classList.add("on"), 1800 + i * 90));
  m.querySelector("[data-go]")!.addEventListener("click", () => {
    m.remove();
    onDone?.();
  });
}
