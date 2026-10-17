// Teste da carreira: termina uma temporada (1 etapa), mercado, renovar/contratar e temporada 2.
import { Room } from "../src/net/room";
import type { LobbyState, ServerMsg } from "../src/net/protocol";

let lobby: LobbyState | null = null;
const r = new Room("SOLO", (_p, m: ServerMsg) => {
  if (m.t === "lobby") lobby = m.lobby;
}, true);
const id = r.join("Teste", "Equipe")!;
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
const ok = (cond: boolean, what: string) => {
  if (!cond) throw new Error("FALHOU: " + what);
  console.log("ok:", what);
};
r.handle(id, { t: "options", laps: 10, champ: true, champPct: 10, champName: "Carreira Teste" });
r.handle(id, { t: "startWeekend" });
await wait(50);
const ch = (r as unknown as { champ: { rounds: number[] } }).champ;
ch.rounds = ch.rounds.slice(0, 1); // temporada de 1 etapa (teste rápido)
for (let i = 0; i < 3; i++) r.handle(id, { t: "ready", ready: true });
ok(r.phase === "race", "corrida da temporada 1");
r.handle(id, { t: "speed", speed: 16 });
const t0 = Date.now();
while (r.phase !== "podium" && Date.now() - t0 < 200000) await wait(100);
ok(r.phase === "podium", "pódio");
r.handle(id, { t: "ready", ready: true });
await wait(20);
const L = () => lobby!;
ok(r.phase === "hq" && !!L().champ?.finished, "sede com a temporada encerrada");
ok((L().champ!.market ?? []).length === 6, "mercado aberto com 6 pilotos livres");
const team = L().players[0].teamId!;
const [d1, d2] = L().lineup[team];
ok(L().champ!.contracts?.[d1] !== undefined, `contratos existem (${d1}: ${L().champ!.contracts![d1]})`);
const ptsBefore = L().champ!.devPts[team] ?? 0;
L().champ!.devPts[team] = 20; // sem esperar ganhar pontos
(r as unknown as { champ: { devPts: Record<string, number> } }).champ.devPts[team] = 20;
r.handle(id, { t: "renewDriver", carId: d1 });
await wait(10);
const newGuy = L().champ!.market![0];
r.handle(id, { t: "signDriver", outId: d2, inId: newGuy });
await wait(10);
ok(L().lineup[team].includes(newGuy) && !L().lineup[team].includes(d2), `contratou ${newGuy} no lugar de ${d2}`);
const devBefore = JSON.stringify(L().champ!.dev[team] ?? {});
r.handle(id, { t: "newSeason" });
await wait(10);
ok((L().champ!.season ?? 1) === 2 && !L().champ!.finished, "temporada 2 começou");
ok((L().champ!.past ?? []).length === 1, "temporada 1 guardada no histórico");
console.log(`   evolução antes ${devBefore} -> depois ${JSON.stringify(L().champ!.dev[team] ?? {})}`);
r.handle(id, { t: "ready", ready: true });
await wait(20);
ok(r.phase === "practice" && L().champ!.round === 0, "1ª etapa da temporada 2 (treino)");
ok(L().lineup[team].includes(newGuy), "o piloto contratado continua na equipe (sem sorteio novo)");
console.log("TUDO OK (pontos antes do teste:", ptsBefore, ")");
r.dispose();
process.exit(0);
