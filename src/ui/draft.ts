// Sorteio dos pilotos (aparece quando o fim de semana começa): revela os 2
// pilotos da sua equipe e depois mostra quem caiu em cada equipe.
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { esc, natBadge, teamDrivers, teamName } from "./common";
import { driverCardHtml } from "./driverCard";

export function showDraft(lobby: LobbyState, onSwap?: (carId: string) => void, onDone?: () => void) {
  const me = lobby.players.find((p) => p.id === lobby.you)!;
  const myTeam = TEAMS.find((t) => t.id === me.teamId)!;
  const mine = teamDrivers(lobby, myTeam.id);
  const canSwap = !!onSwap && !lobby.swapUsed?.includes(myTeam.id);
  const m = document.createElement("div");
  m.className = "helpmodal draft";
  m.innerHTML = `<div class="helpbox panel draftbox">
    <div class="helphead"><b>🎲 SORTEIO DOS PILOTOS</b><span class="hint" style="margin:0">sorteados da base de 100 pilotos</span></div>
    <div class="draftgrid"><div>
    <p class="hint" style="margin-top:0">Seus pilotos na <b style="color:#fff">${esc(teamName(lobby, myTeam.id))}</b>:</p>
    <div class="draft-mine">${mine
      .map(
        (d, i) => `<div><div class="flip" data-i="${i}"><div class="flip-back">?</div><div class="flip-front">${driverCardHtml(d, teamName(lobby, myTeam.id), myTeam.color)}</div></div>
          ${canSwap ? `<button class="btn small swapbtn" data-swap="${d.id}">🎲 TROCAR PELO RESERVA</button>` : ""}</div>`,
      )
      .join("")}</div></div>
    <div><h3 style="margin:0 0 6px;font-family:var(--pix);font-size:12px;color:var(--muted)">AS OUTRAS EQUIPES</h3>
    <div class="draft-others">${TEAMS.filter((t) => t.id !== myTeam.id)
      .map(
        (t) => `<div class="dteam" style="border-left:4px solid ${t.color}"><b>${esc(teamName(lobby, t.id))}</b>
        ${teamDrivers(lobby, t.id).map((d) => `<span>${natBadge(d)} ${esc(d.name)} <i>${d.rating}</i> <small>${esc(d.style)}</small></span>`).join("")}</div>`,
      )
      .join("")}</div></div></div>
    ${canSwap ? `<p class="hint">Não gostou de algum? Você pode <b>trocar 1 piloto pelo reserva</b>, uma vez só. O reserva é surpresa: pode ser melhor ou pior.</p>` : ""}
    <button class="go" data-go style="margin-top:8px">VAMOS PRO TREINO ▶</button>
  </div>`;
  document.body.appendChild(m);
  // revela as cartas uma de cada vez
  m.querySelectorAll<HTMLElement>(".flip").forEach((el, i) => setTimeout(() => el.classList.add("on"), 500 + i * 700));
  m.querySelectorAll<HTMLElement>(".dteam").forEach((el, i) => setTimeout(() => el.classList.add("on"), 1800 + i * 90));
  m.querySelectorAll<HTMLButtonElement>("[data-swap]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = mine.find((x) => x.id === b.dataset.swap)!;
      if (!confirm(`Trocar ${d.name} pelo piloto reserva?

O reserva é surpresa: pode ser melhor ou pior. Só dá pra trocar UMA vez${lobby.champ ? " no campeonato todo" : ""}.`)) return;
      m.remove();
      onSwap!(d.id); // a revelação aparece quando a sala confirmar
    }),
  );
  m.querySelector("[data-go]")!.addEventListener("click", () => {
    m.remove();
    onDone?.();
  });
}
