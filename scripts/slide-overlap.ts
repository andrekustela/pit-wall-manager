// teste: carro escorregando atravessando outro? força rodadas no pelotão e mede quanto um entra no outro
// (retângulos virados de verdade: boxesTouch; encolhe os dois até pararem de se tocar = quanto entrou)
import { Race, boxesTouch } from "../src/sim/race";
let worst = 0, samples = 0, deep = 0;
for (let i = 0; i < 6; i++) {
  const r = new Race({ seed: 77 + i * 131, laps: 3, trackIndex: i % 3, humanTeams: [], setups: {} });
  const R = r as unknown as { startSlide(c: unknown, m: string): void; rel(a: unknown, b: unknown): number; yawOf(c: unknown): number };
  for (let k = 0; k < 20 * 90 && r.phase !== "finished"; k++) {
    r.step(0.05);
    if (r.phase === "racing" && k % 100 === 50) {
      const run = r.cars.filter((c) => !c.retired && !c.slide && c.pit === "none");
      for (const c of run) if (run.some((o) => o !== c && Math.abs(R.rel(c, o)) < 8 && Math.abs(o.lateral - c.lateral) < 3)) { R.startSlide(c, "spin"); break; }
    }
    for (const a of r.cars) {
      if (!a.slide || a.slide.mode === "rejoin" || a.pit !== "none") continue;
      for (const b of r.cars) {
        if (b === a || b.pit !== "none" || Math.abs(R.rel(a, b)) > 8) continue;
        const hit = (m: number) => boxesTouch(R.rel(a, b), b.lateral - a.lateral, R.yawOf(a), R.yawOf(b), -m, -m);
        if (!hit(0)) continue;
        let pen = 0;
        while (pen < 2.4 && hit(pen / 2 + 0.01)) pen += 0.02;
        samples++;
        worst = Math.max(worst, pen);
        if (pen > 0.8) deep++;
      }
    }
  }
}
console.log(`amostras sobrepostas ${samples}, mais de 80 cm dentro: ${deep}, pior ${worst.toFixed(2)} m`);
