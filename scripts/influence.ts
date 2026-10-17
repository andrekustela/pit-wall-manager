// mede quanto o piloto e o acerto influenciam o tempo de volta (carros iguais)
import { LEGEND_POOL, toDriver } from "../src/sim/drivers";
import { getTrack } from "../src/sim/track";
import { BASE_SLACK, carProfile, makeConditions, optimalTuning } from "../src/sim/tuning";
import type { Tuning } from "../src/sim/types";
const sorted = [...LEGEND_POOL].sort((a, b) => b.pace - a.pace);
const best = toDriver(sorted[0], "vor"), worst = toDriver(sorted[sorted.length - 1], "vor");
console.log(`piloto (velocidade ${sorted[0].pace} x ${sorted[sorted.length - 1].pace}): ${(worst.skill - best.skill).toFixed(2)} s/volta`);
let sum = { def: 0, small: 0, big: 0 }, n = 0;
for (let i = 0; i < 3; i++) for (let seed = 1; seed <= 20; seed++) {
  const t = getTrack(i);
  const cond = makeConditions(seed * 97, t);
  const d = toDriver(LEGEND_POOL[seed % 100], "vor");
  const opt = optimalTuning(t, cond, d);
  const lap = (tu: Tuning) => carProfile(t, tu, cond, d).lap - opt.lap;
  const o = opt.tuning;
  const off = (k: number) => ({ fw: o.fw + k, rw: o.rw - k, h: o.h + Math.abs(k) / 2, sf: o.sf + k, sr: o.sr - k });
  sum.def += lap({ fw: 50, rw: 50, h: 50, sf: 50, sr: 50 });
  sum.small += lap(off(5));
  sum.big += lap(off(15));
  n++;
}
console.log(`acerto: padrão 50s ${(sum.def / n).toFixed(2)} s · erro pequeno (±5) ${(sum.small / n).toFixed(2)} s · erro médio (±15) ${(sum.big / n).toFixed(2)} s por volta (média)`);
void BASE_SLACK;
