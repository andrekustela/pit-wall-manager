// mede a largada: trocas de posição, incidentes e o quanto o pelotão fica pra trás na 1ª volta
import { Race } from "../src/sim/race";
let swaps = 0, inc = 0, g2 = 0, g5 = 0, g10 = 0;
const n = 15;
for (let i = 0; i < n; i++) {
  const r = new Race({ seed: 500 + i * 31, laps: 20, trackIndex: i % 3, humanTeams: [], setups: {} });
  const grid = new Map(r.cars.map((c) => [c.id, c.position]));
  while (r.phase !== "racing") r.step(0.05);
  while (r.leader().lap < 1) r.step(0.05);
  const o = r.ordered();
  swaps += r.cars.reduce((a, c) => a + Math.abs(c.position - grid.get(c.id)!), 0) / 2;
  inc += r.stats.touches + r.stats.damages + r.stats.spins + r.stats.crashes;
  g2 += r.gapToLeader(o[1]).seconds;
  g5 += r.gapToLeader(o[4]).seconds;
  g10 += r.gapToLeader(o[9]).seconds;
}
console.log(`1ª volta (${n} corridas): trocas ${(swaps / n).toFixed(1)} · incidentes ${(inc / n).toFixed(1)} · atrás do líder: P2 ${(g2 / n).toFixed(1)}s, P5 ${(g5 / n).toFixed(1)}s, P10 ${(g10 / n).toFixed(1)}s`);
