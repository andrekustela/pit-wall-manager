// mede a agressividade da largada: trocas de posição e toques na 1ª volta
import { Race } from "../src/sim/race";
let swaps = 0, touches = 0, n = 12;
for (let i = 0; i < n; i++) {
  const r = new Race({ seed: 500 + i * 31, laps: 20, trackIndex: i % 3, humanTeams: [], setups: {} });
  const grid = new Map(r.cars.map((c) => [c.id, c.position]));
  while (r.phase !== "racing") r.step(0.05);
  while (r.leader().lap < 1) r.step(0.05);
  swaps += r.cars.reduce((a, c) => a + Math.abs(c.position - grid.get(c.id)!), 0) / 2;
  touches += r.stats.touches + r.stats.damages + r.stats.spins + r.stats.crashes;
}
console.log(`1ª volta (média de ${n} corridas): posições trocadas ${(swaps / n).toFixed(1)}, incidentes ${(touches / n).toFixed(1)}`);
