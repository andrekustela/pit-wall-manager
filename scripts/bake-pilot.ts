// "Assa" o piloto em pé da prévia da aba PILOTO (editor de pintura): roda viewer3dScene.bakePilot no Edge
// headless (o jogo aberto em `npm run dev`) e grava public/piloto/pe.png (a foto cinza-clara), pe_q.png e
// pe_m.png (o que cada pixel é: ver bakePilot). Rodar de novo quando mudar o piloto, o capacete ou os desenhos.
// uso: npx tsx scripts/bake-pilot.ts [url do jogo]
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const url = process.argv[2] ?? "http://localhost:5179/";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const prof = join(tmpdir(), `pwm-bake-${port}`);
mkdirSync(prof, { recursive: true });
const proc = spawn(EDGE, ["--headless=new", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--window-size=800,800", "about:blank"]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = (code: number) => {
  proc.kill();
  try {
    rmSync(prof, { recursive: true, force: true });
  } catch {
    /* o Edge ainda segura a pasta: fica pra limpeza do sistema */
  }
  process.exit(code);
};

let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  await wait(200);
  try {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch {
    /* ainda subindo */
  }
}
if (!wsUrl) {
  console.error("Edge não abriu");
  done(1);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") console.error("EXCEÇÃO:", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const cmd = (method: string, params: object = {}) =>
  new Promise<any>((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await cmd("Runtime.enable");
await cmd("Page.enable");
await cmd("Page.navigate", { url });
await wait(6000);
const r = await cmd("Runtime.evaluate", {
  expression: `import("/src/render/viewer3dScene.ts").then((m) => m.bakePilot()).then((b) => JSON.stringify(b))`,
  awaitPromise: true,
  returnByValue: true,
});
const val = r.result?.result?.value;
if (!val) {
  console.error("falhou:", r.result?.exceptionDetails?.exception?.description ?? JSON.stringify(r).slice(0, 400));
  ws.close();
  done(1);
}
const b = JSON.parse(val) as { shade: string; q: string; m: string; w: number; h: number };
const out = "public/piloto";
for (const [name, data] of [["pe.png", b.shade], ["pe_q.png", b.q], ["pe_m.png", b.m]] as const) {
  writeFileSync(join(out, name), Buffer.from(data.split(",")[1], "base64"));
  console.log(`gravado ${out}/${name}`);
}
console.log(`${b.w} x ${b.h}`);
ws.close();
done(0);
