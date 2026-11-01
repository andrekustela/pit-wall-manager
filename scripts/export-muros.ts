// Gera public/autodromos/<pista>.muros.json: só as barreiras (linhas e peças) do autódromo AUTOMÁTICO de cada pista
// ativa, pro servidor online bater nos mesmos muros que o jogo usa no 3D (server/index.ts: Room.wallsFor). A pista
// que tiver .pecas.json (autódromo feito no editor) usa ele no lugar. Rodar de novo quando mudar o gerador do
// autódromo (track3d.ts) ou as pistas. Precisa do `npm run dev -- --port 5179` aberto.
// uso: npx tsx scripts/export-muros.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CIRCUITS } from "../src/sim/track";
import { slugOf } from "../src/sim/walls";

const page = resolve("scripts/export-muros.page.js").replace(/\/g, "/");
const get = join(mkdtempSync(join(tmpdir(), "muros-")), "get.js");
writeFileSync(get, "JSON.stringify(window.__muros)");
const out = execFileSync("npx", ["tsx", "scripts/shot.ts", "http://localhost:5179/", join(tmpdir(), "muros-shot"), `wait:2500;evalfile:${page};evalfile:${get.replace(/\/g, "/")}`], { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
const line = out.split("\n").find((l) => l.includes("get.js =>"));
if (!line) throw new Error("o navegador não devolveu as barreiras:\n" + out.slice(0, 2000));
const d = JSON.parse(JSON.parse(line.slice(line.indexOf("=> ") + 3))) as Record<string, { pista: string; linhas: unknown[]; pecas: unknown[]; erro?: string }>;
let n = 0;
for (const t of CIRCUITS) {
  if (t.standby || t.mod) continue;
  const s = slugOf(t.name), v = d[s];
  if (!v || v.erro) {
    console.log(`faltou ${t.name}${v?.erro ? `: ${v.erro}` : ""}`);
    continue;
  }
  writeFileSync(`public/autodromos/${s}.muros.json`, JSON.stringify({ pista: v.pista, linhas: v.linhas, pecas: v.pecas }));
  n++;
}
console.log(`${n} arquivos .muros.json gravados (matar os Edge headless depois)`);
