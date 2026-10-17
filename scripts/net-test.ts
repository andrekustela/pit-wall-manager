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
  started = false;
  chats: string[] = [];
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
      else if (m.t === "start") this.started = true;
      else if (m.t === "chat") this.chats.push(m.line.name + ": " + m.line.text);
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
let b = new Bot("Beto");
await Promise.all([a.open(), b.open()]);
a.send({ t: "create", name: "Ana", teamName: "Ana Racing" });
await until(() => !!a.lobby?.code, "sala criada");
b.send({ t: "join", code: a.lobby!.code, name: "Beto", teamName: "Beto GP" });
await until(() => a.lobby?.players.length === 2 && !!b.lobby, "Beto entrou");
a.send({ t: "chat", text: "bora, Beto!" });
await until(() => b.chats.includes("Ana: bora, Beto!") && a.chats.length === 1, "chat chegou pros dois");
a.send({ t: "team", teamId: "vor" });
b.send({ t: "team", teamId: "vor" }); // deve dar erro se a Ana já pegou
await until(() => b.log.some((l) => l.includes("já foi escolhida")) || b.lobby!.players.find((p) => p.name === "Beto")!.teamId !== "vor", "equipe repetida bloqueada");
b.send({ t: "team", teamId: "neb" });
a.send({ t: "options", laps: 10, trackIndex: 1, equalCars: true });
await until(() => b.lobby?.laps === 10 && b.lobby.trackIndex === 1 && b.lobby.equalCars, "opções do host chegaram");
a.send({ t: "startWeekend" });
await until(() => a.lobby?.phase === "practice" && b.lobby?.phase === "practice", "treino livre");

// pilotos sorteados: pega os ids da escalação
const anaCar = a.lobby!.lineup["vor"][0];
const betoCar = a.lobby!.lineup["neb"][0];
const tun = { fw: 80, rw: 70, h: 60, sf: 40, sr: 45 };
for (let i = 0; i < 6; i++) a.send({ t: "practiceLap", carId: anaCar, tuning: tun });
b.send({ t: "practiceLap", carId: anaCar, tuning: tun }); // carro dos outros: ignorado
b.send({ t: "practiceLap", carId: betoCar, tuning: tun });
await until(() => a.practice === 5 && b.practice === 1, "voltas de treino (limite de 5, só no próprio carro)");

a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "quali" && !!a.qualiPole && !!b.qualiPole, "classificação");
console.log(`   pole: ${a.qualiPole}`);
a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "strategy", "estratégia");
a.send({ t: "setup", setups: { [anaCar]: { tyre: "S", fuel: 40, plan: [{ lap: 5, compound: "M", fuel: 50 }] } } });
a.send({ t: "ready", ready: true });
b.send({ t: "ready", ready: true });
await until(() => a.lobby?.phase === "race" && a.snaps > 0 && b.snaps > 0, "corrida começou e snapshots chegam pros dois");
b.send({ t: "speed", speed: 16 }); // Beto não é host: ignorado
// Beto cai no meio da corrida e volta com a senha
const tok = b.lobby!.token!;
b.ws.close();
await until(() => a.lobby?.players.find((p) => p.name === "Beto")?.connected === false, "Beto caiu (vaga guardada)");
const b2 = new Bot("Beto2");
await b2.open();
b2.send({ t: "rejoin", code: a.lobby!.code, token: "errado" });
await until(() => b2.log.some((l) => l.includes("voltar")), "senha errada recusada");
b2.send({ t: "rejoin", code: a.lobby!.code, token: tok });
await until(() => b2.started && b2.snaps > 0 && b2.lobby?.players.find((p) => p.name === "Beto")?.connected === true, "Beto voltou e recebeu a corrida");
b = b2;
a.send({ t: "speed", speed: 16 });
a.send({ t: "cmd", cmd: { type: "pace", carId: anaCar, mode: "push" } });
a.send({ t: "cmd", cmd: { type: "repair", carId: anaCar, parts: { fw: false } } });
a.send({ t: "cmd", cmd: { type: "engineSave", carId: anaCar, on: true } });
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
