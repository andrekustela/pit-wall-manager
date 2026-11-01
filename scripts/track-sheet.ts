// Folha com o desenho das pistas oficiais (pra conferir no olho): gera um .html com uma miniatura de cada.
// uso: npx tsx scripts/track-sheet.ts <saida.html> [arquivo de pistas antigo .ts pra comparar lado a lado]
import { readFileSync, writeFileSync } from "node:fs";
import { turtle } from "../src/sim/trackShape";
import { INVENTED, type InventedTrack } from "../src/sim/inventedTracks";

const [outFile, oldFile] = process.argv.slice(2);
const old: InventedTrack[] | null = oldFile ? JSON.parse(/INVENTED: InventedTrack\[\] = (\[.*\]);/s.exec(readFileSync(oldFile, "utf8"))![1]) : null;

function svg(t: InventedTrack, color: string) {
  const pts = turtle(t.shape).points;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = 200 / Math.max(x1 - x0, y1 - y0);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${((p[0] - x0) * s + 10).toFixed(1)},${((p[1] - y0) * s + 10).toFixed(1)}`).join("") + "Z";
  const [sx, sy] = [(pts[0][0] - x0) * s + 10, (pts[0][1] - y0) * s + 10];
  return `<svg width="220" height="220" viewBox="0 0 220 220"><path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/><circle cx="${sx}" cy="${sy}" r="5" fill="#fff"/></svg>`;
}
const cards = INVENTED.map(
  (t, i) => `<div class="c"><b>${i + 1}. ${t.name}</b><i>${t.style}</i><div class="r">${old ? svg(old[i], "#7a8296") : ""}${old && old[i].shape === t.shape ? "<em>igual</em>" : svg(t, "#4fd18b")}</div></div>`,
).join("");
writeFileSync(
  outFile,
  `<!doctype html><meta charset="utf-8"><style>body{background:#11151d;color:#dfe6f2;font:13px sans-serif;margin:10px}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.c{background:#1a2030;padding:6px}.c b{display:block}.c i{color:#8a93a6;font-size:11px}.r{display:flex;gap:4px;align-items:center}em{color:#8a93a6;width:220px;text-align:center}</style><div class="g">${cards}</div>`,
);
console.log(`gravado ${outFile}`);
