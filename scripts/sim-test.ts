// Roda corridas inteiras sem render e imprime estatísticas.
// uso: npx tsx scripts/sim-test.ts <seed> <voltas> <pista> [equal]
import { makeEngineers } from "../src/sim/entrants";
import { Race, fmtLap, fuelPerLap } from "../src/sim/race";
import { runQualifying } from "../src/sim/weekend";

const seed = Number(process.argv[2] ?? 42);
const laps = Number(process.argv[3] ?? 20);
const trackIndex = Number(process.argv[4] ?? 0);
const equalCars = process.argv[5] === "equal";
const cons = fuelPerLap(laps);
const engineers = makeEngineers(seed, { fal: "Teste" });
const w = { seed, trackIndex, laps, equalCars, teamNames: { fal: "Equipe Teste" }, engineers };
const q = runQualifying(w, {});
const race = new Race({
  ...w,
  humanTeams: ["fal"],
  tunings: q.tunings,
  grid: q.grid,
  setups: {
    nav: { tyre: "M", fuel: cons * laps * 0.47 + 2, plan: [{ lap: Math.round(laps * 0.45), compound: "H", fuel: cons * laps * 0.56 + 2 }] },
    vol: { tyre: "S", fuel: cons * laps * 0.32 + 2, plan: [{ lap: Math.round(laps * 0.3), compound: "M", fuel: cons * laps * 0.72 + 2 }] },
  },
});
const t = race.track;
console.log(`${t.name} (${laps}v, ${equalCars ? "carros iguais" : "normal"}) | pole ${q.grid[0]} ${fmtLap(q.results[0].time)} | chuva quali ${q.wet} | spells ${JSON.stringify(race.weather.spells.map((s) => [s.start.toFixed(1), s.end.toFixed(1), s.intensity.toFixed(2)]))}`);

const dt = 1 / 20;
let steps = 0;
let scTime = 0;
let maxWet = 0;
while (race.phase !== "finished" && steps < 20 * 60 * 150) {
  race.step(dt);
  if (race.sc.active) scTime += dt;
  maxWet = Math.max(maxWet, race.wet);
  steps++;
}
const top = race.ordered().slice(0, 3).map((c) => `${c.driver.short}(${c.team.short},eng ${race.engineers[c.team.id].quality ?? "H"})`);
const dnf = race.cars.filter((c) => c.retired).map((c) => `${c.driver.short}:${c.retireReason}`);
const parked = race.cars.filter((c) => c.pit === "parked").length;
const ev = (s: string) => race.events.filter((e) => e.text.includes(s)).length;
console.log(
  `fim ${(race.time / 60).toFixed(1)}min | top3 ${top.join(" ")} | DNF ${dnf.join(",") || "-"} | SC ${ev("SAFETY CAR")}x ${scTime.toFixed(0)}s | rodadas ${ev("rodou")} | ` +
    `água máx ${maxWet.toFixed(2)} | pneus chuva ${race.cars.filter((c) => c.usedCompounds.some((x) => x === "I" || x === "W")).length} | garagem ${parked}/20`,
);
for (const id of ["nav", "vol"]) {
  const c = race.cars.find((x) => x.id === id)!;
  console.log(`  ${id}: P${c.position} paradas ${c.pitStops} [${c.usedCompounds.join(">")}] comb ${c.fuel.toFixed(1)} ${c.retired ? c.retireReason : ""}`);
}
