// Carro de teste da IA: acha o traçado mais rápido de cada pista (rota ideal) com o otimizador de
// src/sim/lineOpt.ts (o mesmo que o editor de traçado usa no navegador). Saída: src/sim/racingLines.ts
// uso: npx tsx scripts/racing-line.ts [iterações por pista, padrão 25000] [só a pista N]
import { writeFileSync } from "node:fs";
import { ACTIVE_TRACKS, CIRCUITS, getTrack } from "../src/sim/track";
import { STEP, geometryOf, optimizeLine } from "../src/sim/lineOpt";

const ITERS = Number(process.argv[2] ?? 25000);
const ONLY = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

const out: Record<string, { o: number[]; gain: number; lap: number }> = {};
const list = ONLY !== null ? [ONLY] : ACTIVE_TRACKS;
const t0 = Date.now();
for (const i of list) {
  const r = optimizeLine(geometryOf(getTrack(i)), ITERS);
  const name = CIRCUITS[i].name;
  out[name] = { o: r.o, gain: r.gain, lap: r.lap };
  console.log(`${name.padEnd(20)} meio ${r.center.toFixed(2)}s -> traçado ${r.lap.toFixed(2)}s (ganho ${r.gain.toFixed(2)}s) [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}
if (ONLY === null) {
  writeFileSync(
    "src/sim/racingLines.ts",
    `// GERADO por scripts/racing-line.ts — traçado ideal de cada pista achado pelo carro de teste da IA.
// o = distância até o meio da pista (m, + = direita) a cada ${STEP} m a partir da largada; gain = segundos ganhos sobre o meio.
export const LINE_STEP = ${STEP};
export const RACING_LINES: Record<string, { o: number[]; gain: number; lap: number }> = ${JSON.stringify(out)};
`,
  );
  console.log("gravado src/sim/racingLines.ts");
}
