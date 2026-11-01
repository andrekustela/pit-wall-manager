// Compara as pistas oficiais (inventadas) com as reais (mods), pelo perfil de velocidade da volta ideal:
// curvas por tipo (pela velocidade mínima), freadas fortes, retas, troca de direção, curvas seguidas (complexos).
// uso: npx tsx scripts/track-stats.ts [detalhe | complexos]   (detalhe = pista por pista; complexos = o vocabulário das reais)
import { CIRCUITS, Track } from "../src/sim/track";
import { complexesOf, trackStats, type Stats } from "./trackStatsLib";

const detail = process.argv[2] === "detalhe";
type St = Stats;
const stats = trackStats;

const groups: Record<string, St[]> = { oficiais: [], reais: [] };
CIRCUITS.forEach((def, i) => {
  if (def.standby || def.mod) return;
  const g = def.pack === "real" ? "reais" : "oficiais";
  try {
    groups[g].push(stats(new Track(def)));
  } catch {
    /* pista com problema: fica de fora */
  }
  void i;
});
const avg = (l: St[], k: keyof St) => (l.reduce((s, x) => s + (x[k] as number), 0) / l.length).toFixed(2);
const keys: (keyof St)[] = ["km", "lap", "corners", "perKm", "hair", "slow", "med", "fast", "brakes", "longest", "full", "flips", "complex", "variety"];
console.log("média".padEnd(10) + keys.map((k) => String(k).padStart(8)).join(""));
for (const [g, l] of Object.entries(groups)) console.log(`${g} (${l.length})`.padEnd(10) + keys.map((k) => avg(l, k).padStart(8)).join(""));
if (process.argv[2] === "complexos") {
  // o vocabulário que sai das reais
  const all = CIRCUITS.filter((d) => d.pack === "real").flatMap((d) => complexesOf(new Track(d)));
  const by = (f: (c: (typeof all)[number]) => boolean) => all.filter(f).length;
  console.log(`\ncomplexos das reais: ${all.length} (1 curva: ${by((c) => c.bends.length === 1)}, 2: ${by((c) => c.bends.length === 2)}, 3+: ${by((c) => c.bends.length >= 3)}; lentos <35 m: ${by((c) => c.minR < 35)}, médios: ${by((c) => c.minR >= 35 && c.minR < 90)}, rápidos: ${by((c) => c.minR >= 90)})`);
  for (const c of all.slice(0, 25)) console.log(c.bends.map((b, i) => `${b.deg > 0 ? "R" : "L"}${Math.abs(b.deg)}/${b.r}${i < c.gaps.length ? ` S${c.gaps[i]}` : ""}`).join(" "));
}
if (detail)
  for (const [g, l] of Object.entries(groups)) {
    console.log(`\n${g}`);
    for (const s of l) console.log(s.name.slice(0, 30).padEnd(31) + keys.map((k) => (typeof s[k] === "number" ? (s[k] as number).toFixed(k === "full" || k === "km" ? 2 : 0) : "").padStart(7)).join(""));
  }
