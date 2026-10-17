// Teste de ponta a ponta do online: 2 clientes passam pelo fim de semana inteiro.
// uso: PORT=8799 npx tsx server/index.ts  (em outro terminal) e depois npx tsx scripts/net-test.ts 8799
import WebSocket from "ws";
import type { ClientMsg, LobbyState, ServerMsg } from "../src/net/protocol";

const port = process.argv[2] ?? "8799";
const url = `ws://localhost:${port}/ws`;

class Bot {
  ws: WebSocket;
  lobby: LobbyState | null = null;
  log: string[] = [];
  snaps = 0;
  practice = 0;
  qualiPole = "";
  ended = false;
  constructor(readonly name: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      if (m.t === "lobby") this.lobby = m.lobby;
      else if (m.t === "error") this.log.push(`ERRO: ${m.msg}`);
      else if (m.t === "practice") this.practice++;
      else if (m.t === "quali") this.qualiPole = m.results[0].carId;
      else if (m.t === "snap") this.snaps++;
      else if (m.t === "end") this.ended = true;
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once("open", () => r()));
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 10000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando: ${what}`);
    await wait(30);
  }
  console.log(`ok: ${what}`);
}

const a = new Bot("Ana");
const b = new Bot("Beto");
await Promise.all([a.open(), b.open()]);
a.send({ t: "create", name: "Ana", teamName: "Ana Racing" });
await until(() => !!a.lobby?.code, "sala criada");
b.send({ t: "join", code: a.lobby!.code, name: "Beto", teamName: "Beto GP" });
await until(() => a.lobby?.players.length === 2 && !!b.lobby, "Beto entrou");
a.send({ t: "team", teamId: "vor" });
b.send({ t: "team", teamId: "vor" }); // deve dar erro se a Ana já pegou
await until(() => b.log.some((l) => l.includes("já foi escolhida")) || b.lobby!.players.find((p) => p.name === "Beto")!.teamId !== "vor", "equipe repetida bloqueada");
b.send({ t: "team", teamId: "neb" });
a.send({ t: "options", laps: 10, trackIndex: 1, equalCars: true });
await until(() => b.lobby?.laps === 10 && b.lobby.trackIndex === 1 && b.lobby.equalCars, "opções do host chegaram");
a.send({ t: "startWeekend" });
await until(() => a.lobby?.phase === "practice" && b.lobby?.phase === "practice", "treino livre");

for (let i = 0; i < 6; i++) a.send({ t: "practiceLap", carId: "mor", tuning: { fw: 9, rw: 8, h: 7 } });
b.send({ t: "practiceLap", carId: "mor", tuning: { fw: 1, rw: 1, h: 1 } }); // carro dos outros: ignorado
b.send({ t: "practiceLap", carId: "oka", tuning: { fw: 5, rw: 5, h: 5 } });
await until(() => a.practice === 5 && b.practice === 1, "voltas de treino (limite de 5, só no próprio carro)");

a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "quali" && !!a.qualiPole && !!b.qualiPole, "classificação");
console.log(`   pole: ${a.qualiPole}`);
a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "strategy", "estratégia");
a.send({ t: "setup", setups: { mor: { tyre: "S", fuel: 40, plan: [{ lap: 5, compound: "M", fuel: 50 }] } } });
a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "race" && a.snaps > 0 && b.snaps > 0, "corrida começou e snapshots chegam pros dois");
b.send({ t: "speed", speed: 16 }); // Beto não é host: ignorado
a.send({ t: "speed", speed: 16 });
a.send({ t: "cmd", cmd: { type: "pace", carId: "mor", mode: "push" } });
await until(() => a.ended && b.ended, "corrida terminou", 240000);
await until(() => a.lobby?.phase === "podium", "pódio");
a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "lobby", "voltou pro lobby");
console.log(`snapshots recebidos: Ana ${a.snaps}, Beto ${b.snaps}`);
b.ws.close();
await until(() => a.lobby?.players.length === 1, "Beto saiu e a sala atualizou");
a.ws.close();
console.log("TUDO OK");
process.exit(0);
