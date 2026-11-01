import { engineerLabel } from "../sim/entrants";
import { fmtLap, type Race } from "../sim/race";
import { esc, tyreIcon } from "./common";

/**
 * DESTAQUES DA CORRIDA (em cima da tabela): volta mais rápida, quem mais ganhou posições, mais ultrapassagens
 * (eventos "overtake" do feed), parada mais rápida, quem chegou e quantos abandonaram (e por quê)
 */
export function raceHighlights(race: Race, myTeamId: string): string {
  const cars = race.cars, by = (id: string) => cars.find((c) => c.id === id);
  const who = (c: (typeof cars)[number]) => `<b style="color:${c.team.id === myTeamId ? "var(--accent, #ffcc00)" : "inherit"}">${esc(c.driver.name)}</b>`;
  const card = (icon: string, title: string, body: string) => `<div class="hl"><span class="hi">${icon}</span><div><small>${title}</small><div>${body}</div></div></div>`;
  const out: string[] = [];
  const fl = race.fastestLap, flc = fl ? by(fl.carId) : null;
  if (fl && flc) out.push(card("⏱", "VOLTA MAIS RÁPIDA", `${who(flc)} · ${fmtLap(fl.time)}`));
  // (quem terminou: largou em grid, chegou em position)
  const gain = cars.filter((c) => !c.retired && c.grid).map((c) => ({ c, g: (c.grid ?? 0) - c.position })).sort((a, b) => b.g - a.g)[0];
  if (gain && gain.g > 0) out.push(card("📈", "QUEM MAIS GANHOU POSIÇÕES", `${who(gain.c)} · P${gain.c.grid} → P${gain.c.position} (+${gain.g})`));
  const passes = new Map<string, number>();
  for (const e of race.events) if (e.kind === "overtake" && e.carId) passes.set(e.carId, (passes.get(e.carId) ?? 0) + 1);
  const top = [...passes].sort((a, b) => b[1] - a[1])[0], tc = top ? by(top[0]) : null;
  if (top && tc) out.push(card("⚔", "MAIS ULTRAPASSAGENS", `${who(tc)} · ${top[1]}`));
  const stop = cars.filter((c) => c.bestStop && c.bestStop < 60).sort((a, b) => (a.bestStop ?? 99) - (b.bestStop ?? 99))[0];
  if (stop) out.push(card("⚡", "PARADA MAIS RÁPIDA", `${who(stop)} · ${stop.bestStop!.toFixed(1).replace(".", ",")} s`));
  const outs = cars.filter((c) => c.retired);
  out.push(
    card(
      outs.length ? "💥" : "🏁",
      "ABANDONOS",
      outs.length ? outs.map((c) => `${who(c)} <span style="color:var(--muted)">(${esc((c.retireReason ?? "Abandono").toLowerCase())})</span>`).join(", ") : "Todos chegaram",
    ),
  );
  return `<div class="highlights">${out.join("")}</div>`;
}

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
      const mine = c.team.id === myTeamId, human = !mine && c.isHuman;
      return `<tr class="${mine ? "player mine" : human ? "player human" : ""}" style="--tc:${c.team.color}">
        <td>${c.retired ? "—" : c.position}</td>
        <td><span style="display:inline-block;width:4px;height:14px;background:${c.team.color};vertical-align:middle;margin-right:8px"></span>${esc(c.driver.name)}${mine ? ` <em class="who me">VOCÊ</em>` : human ? ` <em class="who on">👤 ${esc(eng?.name ?? "")}</em>` : ""}</td>
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
