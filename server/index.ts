// Servidor do modo online: cria salas com código e liga cada WebSocket a uma
// Room (a mesma lógica que roda no navegador no modo solo). Também serve o
// build do jogo (dist/), então dá pra hospedar tudo num lugar só.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg, ServerMsg } from "../src/net/protocol";
import { Room } from "../src/net/room";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.cwd(), "dist");

const rooms = new Map<string, Room>();
/** versão publicada (commit no Render); o jogo do navegador manda a dele pra comparar */
const BUILD = process.env.RENDER_GIT_COMMIT ?? "dev";
const OUTDATED = "O jogo foi atualizado. Aperte F5 (ou feche e abra o app) pra carregar a versão nova.";
const sockets = new Map<string, WebSocket>(); // `${code}:${playerId}` -> ws

// ---------- HTTP (arquivos estáticos) ----------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Servidor do Pit Wall Manager no ar. (rode `npm run build` pra servir o jogo por aqui)");
    return;
  }
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = normalize(join(DIST, url));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
http.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ws")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

function makeRoom(): Room {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code: string;
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  while (rooms.has(code));
  const room = new Room(code, (pid, msg) => {
    const ws = sockets.get(`${code}:${pid}`);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });
  rooms.set(code, room);
  console.log(`sala ${code} criada`);
  return room;
}

wss.on("connection", (ws: WebSocket) => {
  let room: Room | null = null;
  let pid: string | null = null;
  const reply = (msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  const leave = () => {
    if (!room || !pid) return;
    sockets.delete(`${room.code}:${pid}`);
    room.leave(pid);
    if (room.isEmpty()) {
      room.dispose();
      rooms.delete(room.code);
      console.log(`sala ${room.code} fechada`);
    }
    room = null;
    pid = null;
  };

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      // jogo desatualizado (aba aberta de antes de uma atualização): pede pra recarregar
      if ((msg.t === "create" || msg.t === "join" || msg.t === "rejoin") && BUILD !== "dev" && msg.v && msg.v !== "dev" && msg.v !== BUILD)
        return reply({ t: "error", msg: OUTDATED });
      if (msg.t === "rejoin") {
        if (room) return;
        const r = rooms.get(String(msg.code ?? "").toUpperCase().trim());
        if (!r) return reply({ t: "error", msg: "A sala não existe mais (o servidor pode ter reiniciado numa atualização). Crie uma sala nova." });
        // registra o socket antes, porque o rejoin já manda o lobby e a corrida
        const target = [...r.players.values()].find((p) => p.token === msg.token);
        if (!target) return reply({ t: "error", msg: "Não deu pra voltar pra essa sala." });
        sockets.set(`${r.code}:${target.id}`, ws);
        r.rejoin(msg.token);
        room = r;
        pid = target.id;
        return;
      }
      if (msg.t === "create" || msg.t === "join") {
        if (room) return;
        const r = msg.t === "create" ? makeRoom() : rooms.get(String(msg.code ?? "").toUpperCase().trim());
        if (!r) return reply({ t: "error", msg: "Sala não encontrada. Confira o código; se o jogo acabou de ser atualizado, peça pro host criar a sala de novo e aperte F5." });
        if (r.phase !== "lobby") return reply({ t: "error", msg: "Essa sala já está no meio do fim de semana. Espere acabar." });
        const id = r.join(msg.name, msg.teamName);
        if (!id) return reply({ t: "error", msg: "Sala cheia." });
        sockets.set(`${r.code}:${id}`, ws);
        room = r;
        pid = id;
        // reenvia o lobby agora que o socket está registrado
        r.handle(id, { t: "profile", name: msg.name, teamName: msg.teamName });
        return;
      }
      if (msg.t === "leave") return leave();
      if (room && pid) room.handle(pid, msg);
    } catch (e) {
      console.error("erro tratando mensagem", e);
    }
  });

  // conexão caiu: guarda a vaga por 10 min (dá pra voltar); "leave" é saída de verdade
  ws.on("close", () => {
    if (!room || !pid) return;
    const r = room;
    sockets.delete(`${r.code}:${pid}`);
    r.disconnect(pid);
    room = null;
    pid = null;
    if (r.isEmpty()) {
      r.dispose();
      rooms.delete(r.code);
    } else if (r.isAbandoned()) {
      setTimeout(() => {
        if (r.isAbandoned() && rooms.get(r.code) === r) {
          r.dispose();
          rooms.delete(r.code);
          console.log(`sala ${r.code} fechada (todos saíram)`);
        }
      }, 10 * 60 * 1000);
    }
  });
});

http.listen(PORT, () => console.log(`Pit Wall Manager: servidor na porta ${PORT} (versão ${BUILD.slice(0, 7)})`));

// o Render desliga o servidor antigo numa atualização: avisa quem está jogando
// (as salas ficam só na memória e somem junto)
process.on("SIGTERM", () => {
  const msg: ServerMsg = { t: "error", msg: "O servidor está sendo atualizado agora e a sala vai fechar. Em 1 minuto, aperte F5 e crie a sala de novo." };
  for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  setTimeout(() => process.exit(0), 500);
});
