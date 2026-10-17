// Conexão do cliente com a sala: local (solo, sala roda no navegador)
// ou WebSocket (online, sala roda no servidor). A interface é a mesma.
import type { ClientMsg, ServerMsg } from "./protocol";
import { Room, type ChampSave } from "./room";
import { putSave } from "../ui/saves";

export interface Connection {
  send(msg: ClientMsg): void;
  onMessage: (msg: ServerMsg) => void;
  onClose: (reason: string) => void;
  close(): void;
}

export class LocalConnection implements Connection {
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private room: Room;
  private id: string;

  constructor(name: string, teamName: string, resume?: ChampSave) {
    // entrega assíncrona, igual seria pela rede
    this.room = new Room("SOLO", (_pid, msg) => queueMicrotask(() => this.onMessage(msg)), true);
    // cada campeonato tem seu save (no navegador e na conta)
    this.room.onSave = (s) => {
      if (s) putSave(s);
    };
    this.id = this.room.join(resume?.name ?? name, resume?.teamName ?? teamName)!;
    if (resume) queueMicrotask(() => this.room.resume(this.id, resume));
    // depuração: ?debug expõe a sala no console (window.__room)
    if (location.search.includes("debug")) (window as unknown as { __room: Room }).__room = this.room;
  }

  send(msg: ClientMsg) {
    this.room.handle(this.id, msg);
  }

  close() {
    this.room.leave(this.id);
    this.room.dispose();
  }
}

export function serverUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL;
  if (env) return env;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

export class WsConnection implements Connection {
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private ws: WebSocket;
  private queue: string[] = [];
  private closedByUs = false;

  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(url = serverUrl()) {
    this.ws = new WebSocket(url);
    // sinal de vida: hospedagens grátis (Render) dormem sem tráfego de entrada
    this.keepAlive = setInterval(() => {
      fetch(new URL("/health", url.replace(/^ws/, "http")).toString()).catch(() => {});
    }, 4 * 60 * 1000);
    this.ws.onopen = () => {
      for (const m of this.queue) this.ws.send(m);
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch (err) {
        console.error(err);
      }
    };
    this.ws.onclose = () => {
      if (this.keepAlive) clearInterval(this.keepAlive);
      if (!this.closedByUs) this.onClose("Conexão com o servidor caiu.");
    };
    this.ws.onerror = () => {
      if (!this.closedByUs) this.onClose("Não consegui conectar no servidor online.");
    };
  }

  send(msg: ClientMsg) {
    const data = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  close() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.closedByUs = true;
    try {
      this.send({ t: "leave" });
    } catch {
      /* já caiu */
    }
    this.ws.close();
  }
}
