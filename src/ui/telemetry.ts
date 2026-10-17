// Telemetria pós-corrida: gráfico de posições, tempos de volta e stints de pneu.
// Tudo em SVG (escala bem e fica nítido em qualquer tela).
import { fmtLap, type LapRec, type Race } from "../sim/race";
import { COMPOUNDS, type CarState } from "../sim/types";
import { esc } from "./common";

const W = 900;
const PAD = { l: 34, r: 64, t: 12, b: 26 };

export function telemetryHtml(race: Race, myTeamId: string): string {
  const tele = race.telemetry;
  if (!Object.keys(tele).length) return "";
  return `<h2>TELEMETRIA</h2>
    <div class="box tele">
      <div class="seg teletabs">
        <button data-tt="pos" class="on">POSIÇÕES</button>
        <button data-tt="laps">TEMPOS DE VOLTA</button>
        <button data-tt="stints">PNEUS / PARADAS</button>
      </div>
      <div data-tp="pos">${positionsChart(race, myTeamId)}</div>
      <div data-tp="laps" hidden>${lapsChart(race, myTeamId)}</div>
      <div data-tp="stints" hidden>${stintsChart(race, myTeamId)}</div>
    </div>`;
}

/** liga as abas e o destaque ao passar o mouse */
export function bindTelemetry(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>(".tele");
  if (!box) return;
  box.querySelectorAll<HTMLButtonElement>("[data-tt]").forEach((b) =>
    b.addEventListener("click", () => {
      box.querySelectorAll("[data-tt]").forEach((x) => x.classList.toggle("on", x === b));
      box.querySelectorAll<HTMLElement>("[data-tp]").forEach((p) => (p.hidden = p.dataset.tp !== b.dataset.tt));
    }),
  );
  // passar o mouse num piloto (linha ou nome) destaca ele
  box.querySelectorAll<SVGElement>("[data-car]").forEach((el) => {
    const id = el.dataset.car!;
    el.addEventListener("mouseenter", () => box.querySelectorAll(`[data-car="${id}"]`).forEach((x) => x.classList.add("hl")));
    el.addEventListener("mouseleave", () => box.querySelectorAll(`[data-car="${id}"]`).forEach((x) => x.classList.remove("hl")));
  });
}

const laps = (race: Race) => Math.max(1, ...Object.values(race.telemetry).map((l) => l.length));

/** voltas com safety car (pela telemetria de quem andou mais) */
function scLaps(race: Race): number[] {
  const longest = Object.values(race.telemetry).reduce<LapRec[]>((a, b) => (b.length > a.length ? b : a), []);
  return longest.map((l, i) => (l.sc ? i + 1 : 0)).filter(Boolean);
}

function scBands(race: Race, x: (lap: number) => number, h: number) {
  return scLaps(race)
    .map((lap) => `<rect x="${x(lap - 0.5)}" y="${PAD.t}" width="${x(1) - x(0)}" height="${h - PAD.t - PAD.b}" fill="#ffd23b" opacity="0.1"/>`)
    .join("");
}

/** o 2º carro da equipe usa linha tracejada (mesma cor) */
function isSecond(race: Race, c: CarState) {
  return race.cars.find((o) => o.team.id === c.team.id) !== c;
}

function positionsChart(race: Race, my: string): string {
  const n = laps(race);
  const cars = race.ordered();
  const total = race.cars.length;
  const H = 30 + total * 17;
  const x = (lap: number) => PAD.l + (lap / n) * (W - PAD.l - PAD.r);
  const y = (pos: number) => PAD.t + ((pos - 1) / (total - 1)) * (H - PAD.t - PAD.b);
  const grid = race.opts.grid ?? [];
  let s = scBands(race, x, H);
  for (let p = 1; p <= total; p++)
    s += `<text x="${PAD.l - 8}" y="${y(p) + 4}" class="ax" text-anchor="end">${p}</text><line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(p)}" y2="${y(p)}" class="gl"/>`;
  for (let l = 0; l <= n; l += n > 30 ? 5 : n > 12 ? 2 : 1) s += `<text x="${x(l)}" y="${H - 8}" class="ax" text-anchor="middle">${l}</text>`;
  // os seus por cima
  const order = [...cars].sort((a, b) => Number(a.team.id === my) - Number(b.team.id === my));
  const finalPos = new Map(cars.map((c, i) => [c.id, i + 1]));
  for (const c of order) {
    const recs = race.telemetry[c.id] ?? [];
    const g = grid.indexOf(c.id);
    const pts = [[0, g >= 0 ? g + 1 : (recs[0]?.p ?? c.position)], ...recs.map((r, i) => [i + 1, r.p])];
    const mine = c.team.id === my;
    const d = pts.map(([l, p]) => `${x(l).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];
    s += `<g data-car="${c.id}" class="tl ${mine ? "mine" : ""}">
      <title>${esc(c.driver.name)} (${esc(c.team.name)})</title>
      <polyline points="${d}" stroke="${c.team.color}" ${isSecond(race, c) ? `stroke-dasharray="6 4"` : ""}/>
      ${recs.map((r, i) => (r.pit ? `<circle cx="${x(i + 1)}" cy="${y(r.p)}" r="3" fill="${c.team.color}"/>` : "")).join("")}
      ${c.retired ? `<text x="${x(last[0]) + 4}" y="${y(last[1]) + 4}" class="ax ret">✕</text>` : ""}
      <text x="${W - PAD.r + 6}" y="${y(finalPos.get(c.id)!) + 4}" class="lbl" style="fill:${c.team.color}">${esc(c.driver.short)}</text>
    </g>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="telesvg">${s}</svg>
    <p class="hint">Bolinha = parada no box · ✕ = abandono · faixa amarela = safety car · linha tracejada = 2º carro da equipe.</p>`;
}

function lapsChart(race: Race, my: string): string {
  const n = laps(race);
  const winner = race.ordered()[0];
  const show = race.cars.filter((c) => c.team.id === my);
  if (winner && !show.includes(winner)) show.push(winner);
  const H = 300;
  // escala sem as voltas lentas (box, safety car, 1ª volta)
  const clean = (c: CarState) => (race.telemetry[c.id] ?? []).filter((r, i) => i > 0 && !r.pit && !r.sc);
  const all = show.flatMap((c) => clean(c).map((r) => r.t)).sort((a, b) => a - b);
  if (!all.length) return `<p class="hint">Sem voltas suficientes.</p>`;
  // voltas muito lentas (entrada/saída do box, tráfego) não esticam a escala
  const med = all[Math.floor(all.length / 2)];
  const ts = all.filter((t) => t < med + 3 && t > med - 4);
  const lo = Math.min(...ts) - 0.3;
  const hi = Math.max(...ts) + 0.6;
  const x = (lap: number) => PAD.l + 20 + ((lap - 1) / Math.max(1, n - 1)) * (W - PAD.l - 20 - PAD.r);
  const y = (t: number) => PAD.t + ((Math.max(lo, Math.min(t, hi)) - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const fmtAx = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  let s = scBands(race, x, H);
  const step = hi - lo > 6 ? 1 : 0.5;
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step)
    s += `<line x1="${PAD.l + 20}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}" class="gl"/><text x="${PAD.l + 14}" y="${y(t) + 4}" class="ax" text-anchor="end">${fmtAx(t)}</text>`;
  for (let l = 1; l <= n; l += n > 30 ? 5 : n > 12 ? 2 : 1) s += `<text x="${x(l)}" y="${H - 8}" class="ax" text-anchor="middle">${l}</text>`;
  for (const c of show) {
    const recs = race.telemetry[c.id] ?? [];
    const d = recs.map((r, i) => `${x(i + 1).toFixed(1)},${y(r.t).toFixed(1)}`).join(" ");
    s += `<g data-car="${c.id}" class="tl mine"><title>${esc(c.driver.name)}</title>
      <polyline points="${d}" stroke="${c.team.color}" ${isSecond(race, c) ? `stroke-dasharray="6 4"` : ""}/>
      ${recs.map((r, i) => `<circle cx="${x(i + 1)}" cy="${y(r.t)}" r="${r.pit ? 4 : 2}" fill="${r.pit ? "#fff" : COMPOUNDS[r.c].color}" stroke="${c.team.color}"><title>${esc(c.driver.short)} · volta ${i + 1}: ${fmtLap(r.t)}${r.pit ? " (box)" : ""}${r.sc ? " (safety car)" : ""}</title></circle>`).join("")}
    </g>`;
  }
  // resumo de cada um
  const rows = show
    .map((c) => {
      const cl = clean(c).map((r) => r.t);
      const avg = cl.reduce((a, b) => a + b, 0) / Math.max(1, cl.length);
      const sd = Math.sqrt(cl.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, cl.length));
      return `<tr class="${c.team.id === my ? "player" : ""}" data-car="${c.id}"><td><span class="tdot" style="background:${c.team.color}"></span>${esc(c.driver.name)}${c === winner ? " 🏆" : ""}</td>
        <td class="num">${c.bestLap ? fmtLap(c.bestLap) : "--"}</td><td class="num">${cl.length ? fmtLap(avg) : "--"}</td><td class="num">±${sd.toFixed(2)}s</td><td>${c.pitStops}</td></tr>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="telesvg">${s}</svg>
    <p class="hint">Seus carros e o vencedor. Cor da bolinha = pneu da volta · bolinha branca = volta do box · faixa amarela = safety car · voltas muito lentas ficam presas na borda de baixo.</p>
    <table class="results"><tr><th>PILOTO</th><th>MELHOR</th><th>MÉDIA*</th><th>CONSTÂNCIA*</th><th>PARADAS</th></tr>${rows}</table>
    <p class="hint">* sem a 1ª volta, voltas de box e de safety car.</p>`;
}

function stintsChart(race: Race, my: string): string {
  const n = laps(race);
  const cars = race.ordered();
  const ROW = 18;
  const L = 150;
  const H = PAD.t + cars.length * ROW + PAD.b;
  const x = (lap: number) => L + (lap / n) * (W - L - 20);
  let s = "";
  for (let l = 0; l <= n; l += n > 30 ? 5 : n > 12 ? 2 : 1) s += `<text x="${x(l)}" y="${H - 8}" class="ax" text-anchor="middle">${l}</text>`;
  cars.forEach((c, i) => {
    const recs = race.telemetry[c.id] ?? [];
    const yy = PAD.t + i * ROW;
    const mine = c.team.id === my;
    s += `<g data-car="${c.id}" class="srow">
      ${mine ? `<rect x="0" y="${yy - 1}" width="${W}" height="${ROW}" fill="#ffffff" opacity="0.05"/>` : ""}
      <text x="${L - 8}" y="${yy + 12}" class="lbl ${mine ? "me" : ""}" text-anchor="end">${c.retired ? "—" : c.position}. ${esc(c.driver.name)}</text>`;
    // junta voltas seguidas no mesmo pneu
    let start = 0;
    for (let k = 1; k <= recs.length; k++) {
      const end = k === recs.length || recs[k].c !== recs[start].c || recs[k - 1].pit;
      if (!end) continue;
      const comp = recs[start].c;
      s += `<rect x="${x(start) + 1}" y="${yy + 2}" width="${Math.max(2, x(k) - x(start) - 2)}" height="${ROW - 6}" rx="3" fill="${COMPOUNDS[comp].color}" opacity="${mine ? 1 : 0.75}"><title>${esc(c.driver.short)}: ${COMPOUNDS[comp].label}, voltas ${start + 1}–${k} (${k - start})</title></rect>`;
      if (k - start >= 3) s += `<text x="${(x(start) + x(k)) / 2}" y="${yy + 12}" class="sl" text-anchor="middle">${comp} ${k - start}</text>`;
      start = k;
    }
    if (c.retired) s += `<text x="${x(recs.length) + 6}" y="${yy + 12}" class="ax ret">✕ ${esc(c.retireReason ?? "")}</text>`;
    s += `</g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="telesvg">${s}</svg>
    <p class="hint">${(["S", "M", "H", "I", "W"] as const).map((k) => `<span class="tdot" style="background:${COMPOUNDS[k].color}"></span>${COMPOUNDS[k].label}`).join(" &nbsp; ")}</p>`;
}
