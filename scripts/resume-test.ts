// Teste do campeonato online que sobrevive ao servidor reiniciar:
// joga a 1ª etapa, derruba o servidor, sobe de novo e retoma com o save do host.
// uso: npx tsx scripts/resume-test.ts
import { spawn, type ChildProcess } from "node:child_process";
import WebSocket from "ws";
import type { ClientMsg, LobbyState, ServerMsg } from "../src/net/protocol";
import type { ChampSave } from "../src/net/room";

const PORT = "8798";
const url = `ws://localhost:${PORT}/ws`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 20000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando: ${what}`);
    await wait(50);
  }
  console.log(`ok: ${what}`);
}

function startServer(): Promise<ChildProcess> {
  const p = spawn("npx", ["tsx", "server/index.ts"], { env: { ...process.env, PORT }, shell: true, stdio: "ignore" });
  return new Promise((res) => {
    const check = async () => {
      try {
        const r = await fetch(`http://localhost:${PORT}/health`);
        if (r.ok) return res(p);
      } catch {
        /* ainda subindo */
      }
      setTimeout(check, 300);
    };
    check();
  });
}

class Bot {
  ws!: WebSocket;
  lobby: LobbyState | null = null;
  save: ChampSave | null = null;
  ended = false;
  constructor(readonly name: string) {}
  async connect() {
    this.ws = new WebSocket(url);
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      if (m.t === "lobby") this.lobby = m.lobby;
      if (m.t === "champSave") this.save = m.save;
      if (m.t === "end") this.ended = true;
    });
    await new Promise((r) => this.ws.once("open", r));
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
}

let server = await startServer();
const host = new Bot("Ana"), guest = new Bot("Beto");
await host.connect();
await guest.connect();
host.send({ t: "create", name: "Ana", teamName: "Ana Racing" });
await until(() => !!host.lobby?.code, "sala criada");
guest.send({ t: "join", code: host.lobby!.code, name: "Beto", teamName: "Beto GP" });
await until(() => host.lobby?.players.length === 2, "Beto entrou");
host.send({ t: "team", teamId: "vor" });
guest.send({ t: "team", teamId: "neb" });
host.send({ t: "options", laps: 10, champ: true, champPct: 10, champName: "Copa Teste" });
await until(() => host.lobby?.champMode === true && guest.lobby?.players.find((p) => p.name === "Beto")?.teamId === "neb", "campeonato ligado, Beto na Nebula");
host.send({ t: "startWeekend" });
for (const ph of ["practice", "quali", "strategy"]) {
  await until(() => host.lobby?.phase === ph, `fase ${ph}`);
  host.send({ t: "ready", ready: true });
  guest.send({ t: "ready", ready: true });
}
await until(() => host.lobby?.phase === "race", "corrida");
host.send({ t: "speed", speed: 16 });
await until(() => host.ended, "1ª etapa terminou", 240000);
await until(() => !!host.save, "host recebeu o save do campeonato");
const save = host.save!;
console.log(`   save: "${save.champ.name}", ${save.champ.results.length} etapa(s), jogadores ${save.players?.map((p) => `${p.name}=${p.teamId}`).join(", ")}`);

// servidor reinicia (atualização): a sala some
console.log("-- derrubando o servidor --");
server.kill();
spawn("taskkill", ["/F", "/T", "/PID", String(server.pid)], { shell: true, stdio: "ignore" });
await wait(2500);
server = await startServer();
console.log("-- servidor de volta --");

const host2 = new Bot("Ana"), guest2 = new Bot("Beto");
await host2.connect();
await guest2.connect();
host2.send({ t: "create", name: "Ana", teamName: "Ana Racing", resume: save });
await until(() => !!host2.lobby?.resumed, "sala nova com o campeonato retomado");
console.log(`   esperando: ${host2.lobby!.resumed!.waiting.map((w) => w.name).join(", ")}`);
guest2.send({ t: "join", code: host2.lobby!.code, name: "Beto", teamName: "" });
await until(() => host2.lobby?.players.find((p) => p.name === "Beto")?.teamId === "neb", "Beto voltou pra Nebula (pelo nome)");
await until(() => host2.lobby?.resumed?.waiting.length === 0, "ninguém mais faltando");
host2.send({ t: "startWeekend" });
await until(() => host2.lobby?.phase === "hq", "foi pra sede da equipe");
host2.send({ t: "ready", ready: true });
guest2.send({ t: "ready", ready: true });
await until(() => host2.lobby?.phase === "practice" && host2.lobby.champ?.round === 1, "2ª etapa começou (treino)");
console.log(`   pontos mantidos: Ana ${host2.lobby!.champ!.teamPts.vor ?? 0}, Beto ${host2.lobby!.champ!.teamPts.neb ?? 0}`);
console.log("TUDO OK");
server.kill();
spawn("taskkill", ["/F", "/T", "/PID", String(server.pid)], { shell: true, stdio: "ignore" });
process.exit(0);
