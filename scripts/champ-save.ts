// Teste do campeonato salvo: roda a 1ª etapa no solo, pega o save e continua numa sala nova.
import { Room, type ChampSave } from "../src/net/room";
import type { ServerMsg } from "../src/net/protocol";

let save: ChampSave | null = null;
let last: ServerMsg | null = null;
const r = new Room("SOLO", (_p, m) => (last = m), true);
r.onSave = (s) => (save = s);
const id = r.join("Teste", "Equipe")!;
r.handle(id, { t: "options", laps: 3, champ: true });
r.handle(id, { t: "startWeekend" });
for (const ph of ["practice", "quali", "strategy"]) {
  if (r.phase !== ph) throw new Error("fase " + r.phase);
  r.handle(id, { t: "ready", ready: true });
}
r.handle(id, { t: "speed", speed: 16 });
const t0 = Date.now();
while (r.phase !== "podium" && Date.now() - t0 < 170000) await new Promise((res) => setTimeout(res, 50));
if (!save) throw new Error("não salvou, fase " + r.phase + " " + (Date.now() - t0));
const s = JSON.parse(JSON.stringify(save)) as ChampSave;
r.handle(id, { t: "develop", area: "aero" });
r.handle(id, { t: "develop", area: "engine" });
const ch = s.champ;
console.log("motores", JSON.stringify(Object.fromEntries(Object.entries(ch.engines).slice(0, 6).map(([k, v]) => [k, +v.toFixed(2)]))), "reservas", JSON.stringify(ch.spares).slice(0, 60));
console.log("pontos dev", JSON.stringify(ch.devPts), "níveis", JSON.stringify(ch.dev));
console.log("salvo: etapa", s.champ.round, "resultados", s.champ.results.length, "time", s.teamId);
const r2 = new Room("SOLO", () => {}, true);
const id2 = r2.join("x", "y")!;
r2.resume(id2, s);
const lob = (r2 as unknown as { lobbyFor(i: string): import("../src/net/protocol").LobbyState }).lobbyFor(id2);
console.log("continuou (sede):", r2.phase, "etapa", lob.champ?.round, "pista", lob.weekend?.trackIndex, "mesmos pilotos", JSON.stringify(lob.lineup) === JSON.stringify(s.lineup));
r.dispose();
r2.dispose();
process.exit(0);
