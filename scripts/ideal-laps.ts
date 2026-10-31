// Tempo de volta ideal de cada pista (pra conferir que mexer no traçado não mudou a física).
// uso: npx tsx scripts/ideal-laps.ts > antes.json ; (muda) ; npx tsx scripts/ideal-laps.ts antes.json
import { readFileSync } from "node:fs";
import { ACTIVE_TRACKS, CIRCUITS, getTrack } from "../src/sim/track";

const now: Record<string, number> = {};
for (const i of ACTIVE_TRACKS) now[CIRCUITS[i].name] = getTrack(i).idealLap;
const ref = process.argv[2];
if (!ref) console.log(JSON.stringify(now));
else {
  const old = JSON.parse(readFileSync(ref, "utf8")) as Record<string, number>;
  let worst = 0;
  for (const [n, t] of Object.entries(now)) {
    if (!(n in old)) continue;
    const d = ((t - old[n]) / old[n]) * 100;
    worst = Math.max(worst, Math.abs(d));
    if (Math.abs(d) > 0.2) console.log(`${n}: ${old[n].toFixed(2)} -> ${t.toFixed(2)} s (${d.toFixed(2)}%)`);
  }
  console.log(`maior diferença: ${worst.toFixed(2)}%`);
}
