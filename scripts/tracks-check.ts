// Confere as pistas: fecha direito, não se cruza (fora o oito), não fica colada nela mesma.
// uso: npx tsx scripts/tracks-check.ts [html-de-saída]
import { writeFileSync } from "node:fs";
import { CIRCUITS, Track } from "../src/sim/track";
import { turtle } from "../src/sim/trackShape";

const out = process.argv[2];
let html = `<body style="margin:0;background:#222;display:flex;flex-wrap:wrap;font:12px sans-serif;color:#fff">`;
let bad = 0;
CIRCUITS.forEach((def, i) => {
  const t = new Track(def);
  const info = def as { closeError?: number; autoTurn?: number };
  // pontos perto um do outro que estão longe ao longo da pista
  let close = Infinity;
  const pts = t.pts;
  const step = 6;
  for (let a = 0; a < t.L; a += step)
    for (let b = a + 160; b < t.L - 160 + a && b < t.L; b += step) {
      const d = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
      if (d < close) close = d;
    }
  const fig8 = def.name === "Suzuka";
  const err = (info.closeError ?? 0) / def.targetLength;
  const problems: string[] = [];
  if (!fig8 && close < 42) problems.push(`colada ${close.toFixed(0)}m`);

  if (info.autoTurn !== undefined && Math.abs(info.autoTurn) > 200) problems.push(`curva final ${info.autoTurn.toFixed(0)}°`);
  if (problems.length) bad++;
  console.log(`${String(i).padStart(2)} ${def.name.padEnd(22)} ${String(t.L).padStart(5)}m volta ${t.idealLap.toFixed(1)}s  perto ${close.toFixed(0)}m  erro ${(err * 100).toFixed(1)}%  final ${info.autoTurn?.toFixed(0) ?? "-"}°  ${problems.join(", ")}`);
  if (out) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs) - 60, y0 = Math.min(...ys) - 60, w = Math.max(...xs) - x0 + 60, h = Math.max(...ys) - y0 + 60;
    const d = pts.filter((_, k) => k % 4 === 0).map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(0)},${p.y.toFixed(0)}`).join("") + "Z";
    const s0 = t.pose(0, 0);
    html += `<div style="width:250px;padding:4px;${problems.length ? "background:#622" : ""}">${i} ${def.name} ${problems.join(", ")}<svg viewBox="${x0} ${y0} ${w} ${h}" width="250" height="200" style="background:#3a6"><path d="${d}" stroke="#333" stroke-width="18" fill="none"/><circle cx="${s0.x}" cy="${s0.y}" r="${Math.max(w, h) / 40}" fill="#fff"/></svg></div>`;
  }
});
console.log(`${CIRCUITS.length} pistas, ${bad} com problema`);
if (out) writeFileSync(out, html);
void turtle;
