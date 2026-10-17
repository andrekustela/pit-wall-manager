// Controla o Edge headless via DevTools Protocol pra testar o jogo de verdade.
// uso: npx tsx scripts/shot.ts <url> <pasta-saida> "<passos>"
// passos separados por ';':  wait:ms | shot:nome | eval:js | click:seletor
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const [url, outDir, steps = "wait:3000;shot:page"] = process.argv.slice(2);
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9300 + Math.floor(Math.random() * 500);
mkdirSync(outDir, { recursive: true });

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(outDir, ".profile")}`, "--window-size=1600,1000", "about:blank",
]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
if (!wsUrl) throw new Error("Edge não abriu");
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const logs: string[] = [];
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") logs.push(`EXCEÇÃO: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push(`console.error: ${m.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
});
const cmd = (method: string, params: object = {}) =>
  new Promise<any>((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await cmd("Runtime.enable");
await cmd("Page.enable");
await cmd("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await cmd("Page.navigate", { url });
await wait(1500);

for (const step of steps.split(";").map((s) => s.trim()).filter(Boolean)) {
  const [kind, ...rest] = step.split(":");
  const arg = rest.join(":");
  if (kind === "wait") await wait(Number(arg));
  else if (kind === "shot") {
    const r = await cmd("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${arg}.png`), Buffer.from(r.result.data, "base64"));
    console.log(`print: ${arg}.png`);
  } else if (kind === "eval" || kind === "click" || kind === "evalfile") {
    if (kind === "evalfile") {
      // roda um arquivo .js (pra códigos com ";" que não cabem num passo)
      const { readFileSync } = await import("node:fs");
      const r = await cmd("Runtime.evaluate", { expression: readFileSync(arg, "utf8"), awaitPromise: true, returnByValue: true });
      console.log(`evalfile ${arg} => ${JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description)}`);
      continue;
    }
    const expr = kind === "click" ? `((el) => el ? (el.click(), "ok") : "sem elemento")(document.querySelector(${JSON.stringify(arg)}))` : arg;
    const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value;
    if (v !== undefined) console.log(`${kind} ${arg.slice(0, 60)} => ${JSON.stringify(v)}`);
    if (r.result?.exceptionDetails) console.log(`ERRO em ${arg}: ${r.result.exceptionDetails.exception?.description}`);
  }
}
if (logs.length) console.log(logs.join("\n"));
ws.close();
proc.kill();
process.exit(0);
