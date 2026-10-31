// Mede o "balanço" lateral dos carros na simulação: quantas vezes por minuto cada carro inverte o lado
// pra onde está indo (vai e volta), e o que estava acontecendo na hora.
// uso: npx tsx scripts/wobble.ts [pista] [voltas] [seed]   (AMP=0.03 conta balanço a partir de 3 cm)
import { makeEngineers } from "../src/sim/entrants";
import { Race } from "../src/sim/race";
import { runQualifying } from "../src/sim/weekend";

const trackIndex = Number(process.argv[2] ?? 0), laps = Number(process.argv[3] ?? 4), seed = Number(process.argv[4] ?? 7);
const amp = Number(process.env.AMP ?? 0.15);
const engineers = makeEngineers(seed, { fal: "Teste" });
const w = { seed, trackIndex, laps, equalCars: false, teamNames: { fal: "Equipe Teste" }, engineers };
const q = runQualifying(w, {});
const race = new Race({ ...w, humanTeams: [], tunings: q.tunings, grid: q.grid, setups: {} });
const dt = 1 / 20;
type S = { dir: number; mark: number; t: number };
const st = new Map<string, S>();
const why: Record<string, number> = {};
/** onde (a cada 100 m) aconteceu o vai e volta de quem só seguia o traçado */
const where: Record<number, number> = {};
let flips = 0, time = 0;
while (race.phase !== "finished" && time < 60 * 12) {
  const before = new Map(race.cars.map((c) => [c.id, c.lateral]));
  race.step(dt);
  if (race.phase !== "racing") continue;
  time += dt;
  for (const c of race.cars) {
    if (c.pit !== "none" || c.spin > 0 || c.retired || c.offTrack > 0) continue;
    const dl = c.lateral - before.get(c.id)!;
    let s = st.get(c.id);
    if (!s) st.set(c.id, (s = { dir: 0, mark: c.lateral, t: time }));
    if (Math.abs(dl) < 1e-4) continue;
    const dir = Math.sign(dl);
    if (dir !== s.dir) {
      // inverteu: conta se a ida durou pouco (< 1,2 s) e andou mais que `amp` (balanço, não troca de faixa)
      // (RETA=1: só nas retas, onde não tem motivo pra ir e voltar; nas chicanes o vai e volta é de verdade)
      const onStraight = !process.env.RETA || race.track.isStraight(c.s);
      if (onStraight && s.dir !== 0 && time - s.t < Number(process.env.WIN ?? 1.2) && Math.abs(c.lateral - s.mark) > amp) {
        flips++;
        const L = race.track.L, ahead = race.cars.some((o) => o !== c && o.pit === "none" && !o.retired && ((o.s - c.s + L) % L) > 0 && ((o.s - c.s + L) % L) < 80);
        const side = race.cars.some((o) => o !== c && o.pit === "none" && !o.retired && Math.abs(((o.s - c.s + L * 1.5) % L) - L / 2) < 8);
        const k = c.overtaking ? "ultrapassando" : c.defendTill > race.time ? "defendendo" : c.yieldTill > race.time ? "cedendo" : side ? "carro do lado" : ahead ? "fila (carro até 80 m)" : "sozinho";
        why[k] = (why[k] ?? 0) + 1;
        if (k === process.env.ONDE) {
          const b = Math.floor(c.s / 100) * 100;
          where[b] = (where[b] ?? 0) + 1;
        }
      }
      s.dir = dir;
      s.mark = c.lateral;
      s.t = time;
    }
  }
}
console.log(`${race.track.name}: ${(time / 60).toFixed(1)} min, ${flips} vai-e-volta (${((flips / (time / 60)) / race.cars.length).toFixed(2)} por carro por minuto)`, why);
if (process.env.ONDE) {
  const t = race.track;
  for (const [b, n] of Object.entries(where).sort((x, y) => y[1] - x[1]).slice(0, 8)) {
    const s = Number(b), line = [0, 25, 50, 75].map((d) => t.lineAt(s + d).toFixed(1)).join(" ");
    console.log(`s ${b}-${s + 100}: ${n} | vel ${t.speedAt(s + 50).toFixed(0)} m/s | traçado ${line} | curvatura ${(t.curvature[Math.floor(s + 50) % t.L] * 1000).toFixed(2)}`);
  }
}
