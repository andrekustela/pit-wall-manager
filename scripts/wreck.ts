// Carro destruído parado no meio da pista logo depois da largada: os de trás acham por onde passar?
// uso: npx tsx scripts/wreck.ts [pista] [seed]
import { makeEngineers } from "../src/sim/entrants";
import { Race } from "../src/sim/race";
import { runQualifying } from "../src/sim/weekend";

const trackIndex = Number(process.argv[2] ?? 71), seed = Number(process.argv[3] ?? 3);
const engineers = makeEngineers(seed, {});
const w = { seed, trackIndex, laps: 6, equalCars: false, teamNames: {}, engineers };
const q = runQualifying(w, {});
const race = new Race({ ...w, humanTeams: [], tunings: q.tunings, grid: q.grid, setups: {} });
const R = race as unknown as { retire(c: unknown, why: string): void; deploySafetyCar(): void };
let wreck: (typeof race.cars)[number] | null = null, wreckD = 0;
for (let n = 0; n < 20 * 120; n++) {
  race.step(1 / 20);
  // 4 s depois da largada: o 5º colocado bate e para no meio da pista
  if (!wreck && race.phase === "racing" && race.time > Number(process.env.T ?? 4)) {
    wreck = race.ordered()[Number(process.env.P ?? 4)];
    R.retire(wreck, "Acidente");
    wreck.v = 0;
    wreck.lateral = 0;
    wreckD = race.dist(wreck);
    if (process.env.SC) R.deploySafetyCar();
    console.log(`bateu: ${wreck.driver.short} parado em s=${wreck.s.toFixed(0)}, sc=${race.sc.active}`);
  }
  if (wreck && n % 200 === 0) {
    const behind = race.cars.filter((c) => c !== wreck && !c.retired && race.dist(c) < wreckD && race.dist(c) > wreckD - 200);
    const passed = race.cars.filter((c) => c !== wreck && !c.retired && race.dist(c) > wreckD).length;
    console.log(`t=${race.time.toFixed(0)}s sc=${race.sc.active ? "sim" : "não"} passaram ${passed}, presos atrás (até 200 m): ${behind.length} ${behind.map((c) => `${c.driver.short}:${c.v.toFixed(0)}m/s lat ${c.lateral.toFixed(1)}`).join(" ")}`);
  }
}
