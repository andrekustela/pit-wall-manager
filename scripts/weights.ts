// Quanto cada coisa decide o resultado da corrida (só IA, muitas corridas): carro, piloto, estratégia
// (qualidade do engenheiro da IA), largada e sorte. Correlação de Spearman com a posição final e quanto
// da variação da posição cada um explica (regressão linear com as três ao mesmo tempo).
// uso: npx tsx scripts/weights.ts [corridas] [voltas]
import { makeEngineers } from "../src/sim/entrants";
import { Race } from "../src/sim/race";
import { ACTIVE_TRACKS, CIRCUITS } from "../src/sim/track";
import { runQualifying } from "../src/sim/weekend";

const N = Number(process.argv[2] ?? 40), laps = Number(process.argv[3] ?? 20);
type Row = { pos: number; car: number; drv: number; eng: number; grid: number; dnf: boolean; wet: boolean; why?: string };
const rows: Row[] = [];
for (let r = 0; r < N; r++) {
  const seed = 1000 + r * 7, trackIndex = ACTIVE_TRACKS.filter((i) => !CIRCUITS[i].mod)[r % 30];
  const engineers = makeEngineers(seed, {});
  const w = { seed, trackIndex, laps, equalCars: false, teamNames: {}, engineers };
  const q = runQualifying(w, {});
  const race = new Race({ ...w, humanTeams: [], tunings: q.tunings, grid: q.grid, setups: {} });
  let n = 0, wet = false;
  while (race.phase !== "finished" && n < 20 * 60 * 90) {
    race.step(1 / 20);
    if (race.wet > 0.3) wet = true;
    n++;
  }
  const order = race.ordered();
  for (const c of race.cars)
    rows.push({ pos: order.indexOf(c) + 1, car: c.team.carPace, drv: c.driver.skill, eng: race.quality(c.team.id), grid: q.grid.indexOf(c.id) + 1, dnf: !!c.retired, wet, why: c.retireReason ?? undefined });
  process.stdout.write(".");
}
console.log();

const rank = (v: number[]) => {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(v.length);
  idx.forEach(([, i], k) => (out[i] = k));
  return out;
};
const corr = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
};
const spear = (a: number[], b: number[]) => corr(rank(a), rank(b));
// (sinal: carro e piloto são "segundos a mais" = pior; engenheiro é qualidade = melhor. Tudo virado pra
// "maior = ajuda a ganhar")
const fin = rows.filter((x) => !x.dnf);
const P = fin.map((x) => -x.pos), C = fin.map((x) => -x.car), D = fin.map((x) => -x.drv), E = fin.map((x) => x.eng), G = fin.map((x) => -x.grid);
console.log(`${N} corridas, ${rows.length} carros, ${rows.length - fin.length} abandonos (${((1 - fin.length / rows.length) * 100).toFixed(0)}%), ${rows.filter((x) => x.wet).length / 20} com chuva`);
const whys: Record<string, number> = {};
for (const x of rows) if (x.dnf) whys[x.why ?? "?"] = (whys[x.why ?? "?"] ?? 0) + 1;
console.log("abandonos por motivo:", JSON.stringify(whys));
console.log(`correlação com a posição final (1 = decide tudo, 0 = nada):`);
console.log(`  carro ${spear(P, C).toFixed(2)} · piloto ${spear(P, D).toFixed(2)} · engenheiro (estratégia da IA) ${spear(P, E).toFixed(2)} · posição de largada ${spear(P, G).toFixed(2)}`);

// regressão linear (variáveis padronizadas): alvo ~ fatores. Devolve R² e a parte de cada fator no explicado
const z = (v: number[]) => {
  const m = v.reduce((s, x) => s + x, 0) / v.length, sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1;
  return v.map((x) => (x - m) / sd);
};
function regress(target: number[], factors: number[][]) {
  const X = factors.map(z), y = z(target), k = X.length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X[i].reduce((s, x, t) => s + x * X[j][t], 0))), bv = X.map((xi) => xi.reduce((s, x, t) => s + x * y[t], 0));
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const f = A[j][i] / A[i][i];
      for (let q = i; q < k; q++) A[j][q] -= f * A[i][q];
      bv[j] -= f * bv[i];
    }
  const beta = new Array<number>(k);
  for (let i = k - 1; i >= 0; i--) beta[i] = (bv[i] - A[i].slice(i + 1).reduce((s, a, q) => s + a * beta[i + 1 + q], 0)) / A[i][i];
  const pred = y.map((_, t) => beta.reduce((s, b, i) => s + b * X[i][t], 0));
  const r2 = 1 - y.reduce((s, v, t) => s + (v - pred[t]) ** 2, 0) / y.reduce((s, v) => s + v * v, 0);
  // parte de cada um no que é explicado (beta × correlação; soma = R²)
  const share = beta.map((b, i) => b * corr(X[i], y));
  return { r2, share: share.map((s) => s / r2) };
}
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fr = regress(P, [C, D, E]);
console.log(`posição final: carro+piloto+engenheiro explicam ${pct(fr.r2)}; o resto (${pct(1 - fr.r2)}) é a corrida (largada, batidas, safety car, chuva, brigas, ruído)`);
console.log(`  dentro do explicado: carro ${pct(fr.share[0])} · piloto ${pct(fr.share[1])} · engenheiro ${pct(fr.share[2])}`);
const gr = regress(G, [C, D, E]);
console.log(`posição de largada: carro+piloto+engenheiro explicam ${pct(gr.r2)} (o resto é o sorteio da classificação)`);
console.log(`  dentro do explicado: carro ${pct(gr.share[0])} · piloto ${pct(gr.share[1])} · engenheiro ${pct(gr.share[2])}`);
const wr = regress(P, [G, C, D, E]);
console.log(`posição final com a largada junto: explicam ${pct(wr.r2)}; largada ${pct(wr.share[0])} · carro ${pct(wr.share[1])} · piloto ${pct(wr.share[2])} · engenheiro ${pct(wr.share[3])}`);
const gained = fin.map((x) => x.grid - x.pos);
console.log(`posições ganhas/perdidas na corrida: média |${(gained.reduce((s, x) => s + Math.abs(x), 0) / gained.length).toFixed(1)}| por carro`);
const spread = (v: number[]) => (Math.max(...v) - Math.min(...v)).toFixed(2);
console.log(`faixas: carro ${spread(rows.map((x) => x.car))} s/volta · piloto ${spread(rows.map((x) => x.drv))} s/volta · engenheiro ${spread(rows.map((x) => x.eng))} (0..1)`);
