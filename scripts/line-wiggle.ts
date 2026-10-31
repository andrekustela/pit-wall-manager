// Procura ondulação no traçado ideal: picos e vales seguidos (vai e volta de lado) em pouca distância.
// uso: npx tsx scripts/line-wiggle.ts [índice da pista | all]
import { ACTIVE_TRACKS, CIRCUITS, getTrack } from "../src/sim/track";

const arg = process.argv[2] ?? "all";
const ids = arg === "all" ? ACTIVE_TRACKS : [Number(arg)];
const rows: [string, number, number][] = [];
for (const i of ids) {
  const t = getTrack(i);
  // extremos locais da lateral do traçado (a cada 1 m)
  const ext: [number, number][] = [];
  let prevD = 0;
  for (let s = 0; s < t.L; s += 1) {
    const d = t.lineAt(s + 1) - t.lineAt(s);
    if (Math.abs(d) < 1e-5) continue;
    if (prevD && Math.sign(d) !== Math.sign(prevD)) ext.push([s, t.lineAt(s)]);
    prevD = d;
  }
  // ondulação: dois extremos seguidos a menos de 250 m com pelo menos 0,3 m de diferença, numa reta
  let wig = 0;
  for (let k = 1; k < ext.length; k++) {
    const [s0, l0] = ext[k - 1], [s1, l1] = ext[k];
    if (s1 - s0 < 250 && Math.abs(l1 - l0) > 0.3 && t.isStraight((s0 + s1) / 2)) wig++;
  }
  rows.push([CIRCUITS[i].name, ext.length, wig]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [n, e, w] of rows.slice(0, 15)) console.log(`${n}: ${e} extremos, ${w} ondulações na reta`);
console.log("total de pistas:", rows.length, "com ondulação:", rows.filter((r) => r[2] > 0).length);
