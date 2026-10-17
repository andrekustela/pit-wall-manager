import { engineerLabel } from "../sim/entrants";
import { fmtLap, type Race } from "../sim/race";
import { esc, tyreIcon } from "./common";

export function resultsTable(race: Race, myTeamId: string): string {
  const order = race.ordered();
  const winner = order[0];
  const fl = race.fastestLap;
  const rows = order
    .map((c) => {
      const g = race.gapToLeader(c);
      const eng = race.engineers[c.team.id];
      const gap = c.retired
        ? `<span style="color:var(--soft)">${esc(c.retireReason ?? "Abandono")}</span>`
        : c === winner
          ? fmtLap(c.finishTime ?? race.time)
          : g.laps > 0
            ? `+${g.laps} volta${g.laps > 1 ? "s" : ""}`
            : `+${g.seconds.toFixed(3)}s`;
      return `<tr class="${c.team.id === myTeamId ? "player" : ""}">
        <td>${c.retired ? "—" : c.position}</td>
        <td><span style="display:inline-block;width:4px;height:14px;background:${c.team.color};vertical-align:middle;margin-right:8px"></span>${esc(c.driver.name)}</td>
        <td>${esc(c.team.name)}<div style="color:var(--muted);font-size:12px">${esc(eng?.name ?? "")} · ${engineerLabel(eng?.quality ?? null)}</div></td>
        <td class="num">${gap}${c.penalty ? ` <span style="color:var(--warn)">(+${c.penalty}s)</span>` : ""}</td>
        <td>${c.pitStops}</td>
        <td>${c.usedCompounds.map((t) => tyreIcon(t)).join(" ")}</td>
        <td class="num">${c.bestLap ? fmtLap(c.bestLap) : "--"}${fl?.carId === c.id ? " ⏱" : ""}</td>
        <td style="color:var(--muted)" title="Asa diant. / asa tras. / altura / susp. diant. / susp. tras.">${c.tuning.fw}/${c.tuning.rw}/${c.tuning.h}/${c.tuning.sf}/${c.tuning.sr}</td>
      </tr>`;
    })
    .join("");
  return `<table class="results">
    <tr><th>POS</th><th>PILOTO</th><th>EQUIPE · ENGENHEIRO</th><th>TEMPO</th><th>PARADAS</th><th>PNEUS</th><th>MELHOR VOLTA</th><th>ACERTO</th></tr>
    ${rows}
  </table>`;
}
