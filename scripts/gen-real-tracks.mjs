// Gera src/sim/realTracks.ts a partir dos traçados reais do bacinger/f1-circuits (MIT).
// uso: node scripts/gen-real-tracks.mjs <f1-circuits.geojson> <meta.json>
// meta.json = ficha das pistas atuais (chuva, ultrapassagem...), copiada pelo nome.
import fs from "node:fs";

const [geoPath, metaPath] = process.argv.slice(2);
const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));
const meta = new Map(JSON.parse(fs.readFileSync(metaPath, "utf8")).map((m) => [m.name, m]));

/** id do circuito -> nome usado no jogo (o mesmo das pistas desenhadas à mão) */
const NAMES = {
  "au-1953": "Albert Park", "bh-2002": "Bahrein", "cn-2004": "Xangai", "es-1991": "Barcelona-Catalunya",
  "mc-1929": "Monte Carlo", "ca-1978": "Montreal", "fr-1969": "Paul Ricard", "at-1969": "Red Bull Ring",
  "gb-1948": "Silverstone", "de-1932": "Hockenheim", "hu-1986": "Hungaroring", "be-1925": "Spa-Francorchamps",
  "it-1922": "Monza", "sg-2008": "Marina Bay", "ru-2014": "Sochi", "jp-1962": "Suzuka", "us-2012": "Austin (COTA)",
  "mx-1962": "Cidade do México", "br-1940": "Interlagos", "ae-2009": "Yas Marina", "it-1953": "Imola",
  "de-1927": "Nürburgring", "pt-2008": "Portimão", "it-1914": "Mugello", "my-1999": "Sepang", "tr-2005": "Istanbul Park",
  "nl-1948": "Zandvoort", "fr-1960": "Magny-Cours", "pt-1972": "Estoril", "br-1977": "Jacarepaguá", "sa-2021": "Jeddah",
  "us-2022": "Miami", "qa-2004": "Lusail", "es-2026": "Madring", "az-2016": "Baku", "us-2023": "Las Vegas",
  "us-1909": "Indianápolis", "ar-1952": "Buenos Aires", "za-1961": "Kyalami", "us-1956": "Watkins Glen",
};
/** pista que não existia no jogo: ficha nova */
const NEW = {
  Madring: { blurb: "Pista nova de Madri, entre ruas e parque, com a curva inclinada La Monumental.", minHeight: 5, balance: 0, rainChance: 0.15, grass: ["#7e8a3e", "#849042"], street: true, overtake: 0.8 },
};
/** o 1º ponto de cada traçado costuma ser a linha de largada (no sentido da corrida);
 * onde não é, a coordenada [lon, lat] da largada real vai aqui */
const START = { "mc-1929": [7.4206, 43.7347] };
/** escala do comprimento real (1 = tamanho oficial) */
const SCALE = 1;

/** reamostra o traçado fechado a cada "step" metros */
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      d += step;
    }
    carry = seg - (d - step);
  }
  if (Math.hypot(out.at(-1)[0] - out[0][0], out.at(-1)[1] - out[0][1]) < step * 0.5) out.pop();
  return out;
}
/** o GPS vem em quinas: reamostra a cada 4 m, suaviza (~gaussiana) e guarda um ponto a cada 20 m */
function smooth(pts) {
  let q = resample(pts, 4);
  const n = q.length;
  for (let pass = 0; pass < SMOOTH; pass++) {
    const r = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = q[(i - 1 + n) % n], b = q[i], c = q[(i + 1) % n];
      r[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    q = r;
  }
  return resample(q, 20).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}
/** passes de suavização (cada um espalha ~4 m; 40 passes ≈ desvio de 18 m) */
const SMOOTH = 40;

const out = [];
for (const f of geo.features) {
  const p = f.properties;
  const name = NAMES[p.id];
  if (!name) throw new Error("sem nome: " + p.id);
  const m = meta.get(name) ?? NEW[name];
  if (!m) throw new Error("sem ficha: " + name);
  let c = f.geometry.coordinates;
  if (c.length > 2 && c[0][0] === c.at(-1)[0] && c[0][1] === c.at(-1)[1]) c = c.slice(0, -1);
  const st = START[p.id];
  if (st) {
    let k = 0;
    c.forEach((q, i) => {
      if (Math.hypot(q[0] - st[0], q[1] - st[1]) < Math.hypot(c[k][0] - st[0], c[k][1] - st[1])) k = i;
    });
    c = c.slice(k).concat(c.slice(0, k));
  }
  // lon/lat -> metros (norte pra cima; y da tela cresce pra baixo)
  const lat0 = c.reduce((a, q) => a + q[1], 0) / c.length, lon0 = c.reduce((a, q) => a + q[0], 0) / c.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  let pts = c.map(([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0) * ky]);
  pts = smooth(pts);
  out.push({
    name,
    official: p.Name,
    blurb: m.blurb,
    minHeight: m.minHeight,
    balance: m.balance,
    rainChance: m.rainChance,
    grass: m.grass,
    ...(m.street ? { street: true } : {}),
    ...(m.night ? { night: true } : {}),
    ...(m.overtake !== undefined ? { overtake: m.overtake } : {}),
    targetLength: Math.round(p.length * SCALE),
    realStart: true,
    firstGP: p.firstgp,
    points: pts,
  });
}
out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

const body = out
  .map((t) => {
    const { points, ...rest } = t;
    const head = JSON.stringify(rest).slice(1, -1);
    return `  { ${head},\n    points: ${JSON.stringify(points)} },`;
  })
  .join("\n");
fs.writeFileSync(
  "src/sim/realTracks.ts",
  `// GERADO por scripts/gen-real-tracks.mjs — não editar à mão.
// Traçados reais: bacinger/f1-circuits (https://github.com/bacinger/f1-circuits), licença MIT,
// Copyright (c) 2019-2025 Tomislav Bacinger. Dados não oficiais, sem ligação com a Formula One.
import type { TrackDef } from "./track";

export const REAL_TRACKS: TrackDef[] = [
${body}
];
`,
);
console.log(out.length, "pistas;", out.map((t) => `${t.name}:${t.points.length}`).join(" "));
