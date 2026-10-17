// Roda várias corridas só com IA e mostra a média de ultrapassagens, toques, batidas etc.
// uso: npx tsx scripts/balance.ts [corridas] [voltas]
import { Race } from "../src/sim/race";
const N = Number(process.argv[2] ?? 12);
const laps = Number(process.argv[3] ?? 20);
const sum: Record<string, number> = {};
let wetRaces = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = new Race({ seed: 1000 + i * 7919, laps, trackIndex: i % 3, humanTeams: [], setups: {} });
  let maxWet = 0;
  let overlap = 0;
  for (let k = 0; k < 20 * 60 * 120 && r.phase !== "finished"; k++) {
    r.step(0.05);
    maxWet = Math.max(maxWet, r.wet);
    // tempo com carros sobrepostos na pista (o que parece "atravessar")
    if (k % 4 === 0) {
      const on = r.cars.filter((c) => c.pit === "none" && !c.retired && Math.abs(c.lateral) < 9.5);
      for (let a = 0; a < on.length; a++)
        for (let b = a + 1; b < on.length; b++) {
          let d = r.track.wrap(on[b].s - on[a].s);
          if (d > r.track.L / 2) d -= r.track.L;
          if (Math.abs(d) < 5.6 * 0.8 && Math.abs(on[b].lateral - on[a].lateral) < 2.3 * 0.7) overlap += 0.2;
        }
    }
  }
  if (maxWet > 0.3) wetRaces++;
  for (const [k, v] of Object.entries(r.stats)) sum[k] = (sum[k] ?? 0) + v;
  const pits = r.cars.reduce((a, c) => a + c.pitStops, 0);
  sum.pitStops = (sum.pitStops ?? 0) + pits;
  sum.finishers = (sum.finishers ?? 0) + r.cars.filter((c) => !c.retired).length;
  sum.overlapSec = (sum.overlapSec ?? 0) + overlap;
  console.log(`corrida ${i + 1} pista ${i % 3} ${maxWet > 0.3 ? "CHUVA" : "seco "}: ${JSON.stringify(r.stats)} paradas ${pits} sobreposição ${overlap.toFixed(1)}s`);
}
console.log(`\nMÉDIA por corrida (${N} corridas de ${laps} voltas, ${wetRaces} com chuva, ${((Date.now() - t0) / 1000).toFixed(0)}s):`);
for (const [k, v] of Object.entries(sum)) console.log(`  ${k}: ${(v / N).toFixed(1)}`);
