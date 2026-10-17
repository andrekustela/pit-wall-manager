// Quantas vezes um carro passa reto atacando a corrida toda x ritmo normal x poupando.
import { Race } from "../src/sim/race";
import { FUEL_MAX } from "../src/sim/types";

for (const mode of ["push", "normal", "conserve"] as const) {
  let offs = 0, outs = 0, races = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const probe = new Race({ seed, laps: 15, trackIndex: seed % 6, humanTeams: [], setups: {} });
    const ids = probe.cars.filter((c) => c.team.id === "vor").map((c) => c.id);
    const setups = Object.fromEntries(ids.map((id) => [id, { tyre: "H", fuel: FUEL_MAX, plan: [] }]));
    const r = new Race({ seed, laps: 15, trackIndex: seed % 6, humanTeams: ["vor"], setups } as never);
    for (const id of ids) r.command({ type: "pace", carId: id, mode });
    const cars = ids.map((id) => r.cars.find((c) => c.id === id)!);
    const was = cars.map(() => false);
    while (r.phase !== "finished" && r.time < 4000) {
      r.step(0.05);
      cars.forEach((c, i) => {
        const now = c.offTrack > 0;
        if (now && !was[i]) offs++;
        was[i] = now;
      });
    }
    for (const c of cars) {
      if (/brita|muro/.test(c.retireReason ?? "")) outs++;
      races++;
    }
  }
  console.log(`${mode.padEnd(8)}: ${(offs / races).toFixed(2)} saídas por corrida, abandonou por isso em ${((outs / races) * 100).toFixed(0)}% das corridas`);
}
