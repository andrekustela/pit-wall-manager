// Teste das ordens de equipe: o carro da frente deixa o companheiro passar; "manter" segura as posições.
// Conta só trocas na pista (os dois fora do box e perto um do outro).
import { Race } from "../src/sim/race";
import { TEAMS } from "../src/sim/data";

function run(mode: "letPass" | "hold" | "none", seed: number, team: string) {
  const r = new Race({ seed, laps: 14, trackIndex: 0, humanTeams: [], setups: {}, teamNames: {}, engineers: {} } as never);
  const [a, b] = r.cars.filter((c) => c.team.id === team);
  let given = -1;
  let first = -1;
  let swaps = 0;
  let prev = r.dist(a) > r.dist(b) ? a : b;
  while (r.phase !== "finished" && r.time < 3600) {
    r.step(1 / 20);
    const ahead = r.dist(a) > r.dist(b) ? a : b;
    const near = Math.abs(r.dist(a) - r.dist(b)) < 150;
    // dá a ordem quando estão perto (a partir da 2ª volta)
    if (given < 0 && r.cars[0].lap >= 2 && near && a.pit === "none" && b.pit === "none") {
      if (mode !== "none") r.command({ type: "order", carId: ahead.id, mode });
      given = r.time;
      prev = ahead;
    }
    if (given >= 0 && ahead !== prev) {
      if (a.pit === "none" && b.pit === "none" && !a.retired && !b.retired) {
        swaps++;
        if (first < 0) first = r.time - given;
      }
      prev = ahead;
    }
  }
  return given < 0 ? "nunca ficaram perto" : `${swaps} troca(s)${first >= 0 ? `, 1ª em ${first.toFixed(0)}s` : ""}`;
}
for (const seed of [11, 22, 33, 44, 55]) {
  const team = TEAMS[(seed / 11) % TEAMS.length].id;
  console.log(`seed ${seed} ${team}: deixar -> ${run("letPass", seed, team)} | manter -> ${run("hold", seed, team)} | livre -> ${run("none", seed, team)}`);
}
