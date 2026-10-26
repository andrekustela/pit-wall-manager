// Entorno real de um autódromo (OpenStreetMap) no espaço da pista do jogo: public/autodromos/<arquivo>.json
// uso: npx tsx scripts/osm-track.ts <índice da pista> <traçado.geojson do bacinger> <consulta.osm.json> <saída.json>
// A pista do jogo é o traçado real suavizado (até ~18 m nas curvas fechadas) e esticado pro comprimento
// oficial; projetar o mapa direto desalinharia. Então cada ponto do mapa vira (onde na pista real, quanto
// de lado) e volta no mesmo lugar e na mesma distância da pista do jogo: tudo fica no lugar, nas curvas também.
// Dados: © colaboradores do OpenStreetMap (ODbL).
import { readFileSync, writeFileSync } from "node:fs";
import { getTrack } from "../src/sim/track";

const [idxArg, geoPath, osmPath, outPath] = process.argv.slice(2);
const track = getTrack(Number(idxArg));
const geo = JSON.parse(readFileSync(geoPath, "utf8"));
const osm = JSON.parse(readFileSync(osmPath, "utf8")) as { elements: { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };

// ---- traçado real no mesmo sistema do jogo (scripts/gen-real-tracks.mjs) ----
let c: [number, number][] = geo.features[0].geometry.coordinates;
if (c[0][0] === c.at(-1)![0] && c[0][1] === c.at(-1)![1]) c = c.slice(0, -1);
const lat0 = c.reduce((a, q) => a + q[1], 0) / c.length, lon0 = c.reduce((a, q) => a + q[0], 0) / c.length;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
const proj = (lon: number, lat: number): [number, number] => [(lon - lon0) * kx, -(lat - lat0) * ky];
let real = c.map(([lon, lat]) => proj(lon, lat));
// a escala do jogo (comprimento oficial)
const len = (p: [number, number][]) => p.reduce((a, q, i) => a + Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]), 0);
const k = track.L / len(real);
real = real.map(([x, y]) => [x * k, y * k]);

// pra cada vértice do traçado real, o ponto da pista do jogo mais perto (em s)
const game: [number, number][] = [];
for (let s = 0; s < track.L; s++) {
  const p = track.pose(s, 0);
  game.push([p.x, p.y]);
}
const sOf = real.map(([x, y]) => {
  let best = 0, bd = Infinity;
  for (let s = 0; s < game.length; s++) {
    const d = (game[s][0] - x) ** 2 + (game[s][1] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
});
const wrap = (s: number) => ((s % track.L) + track.L) % track.L;

/** ponto do mapa (já em metros) -> ponto no espaço da pista do jogo */
function warp([x, y]: [number, number]): [number, number] {
  let bi = 0, bt = 0, bd = Infinity;
  for (let i = 0; i < real.length; i++) {
    const a = real[i], b = real[(i + 1) % real.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    const d = (a[0] + dx * t - x) ** 2 + (a[1] + dy * t - y) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
      bt = t;
    }
  }
  const a = real[bi], b = real[(bi + 1) % real.length];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const fx = a[0] + dx * bt, fy = a[1] + dy * bt;
  // lado: normal "pra esquerda" do sentido da pista (igual nos dois traçados)
  const lat = ((x - fx) * -dy + (y - fy) * dx) / l;
  let s0 = sOf[bi], s1 = sOf[(bi + 1) % real.length];
  if (s1 < s0 - track.L / 2) s1 += track.L;
  const s = wrap(s0 + (s1 - s0) * bt);
  const p = track.pose(s, 0), q = track.pose(s + 1, 0);
  const gx = q.x - p.x, gy = q.y - p.y, gl = Math.hypot(gx, gy) || 1;
  const wx = p.x + (-gy / gl) * lat, wy = p.y + (gx / gl) * lat;
  // longe da pista o encaixe estica as coisas (o lado mais perto muda de trecho): vai passando pra
  // projeção direta (lá fora a pista do jogo e a real praticamente coincidem)
  const w = Math.max(0, Math.min(1, 1 - (Math.abs(lat) - 40) / 160));
  return [Math.round((x + (wx - x) * w) * 10) / 10, Math.round((y + (wy - y) * w) * 10) / 10];
}

// ---- o que vale desenhar, e como ----
type Kind = "pista" | "kart" | "rua" | "caminho" | "grama" | "bosque" | "arvores" | "agua" | "predio" | "arquibancada" | "cerca" | "muro" | "piscina" | "estacionamento";
function kindOf(t: Record<string, string>): Kind | null {
  if (t.highway === "raceway") return t.sport === "karting" ? "kart" : "pista";
  if (t.building === "grandstand" || t.leisure === "stadium") return "arquibancada";
  if (t.building) return "predio";
  if (t.leisure === "swimming_pool") return "piscina";
  if (t.natural === "water" || t.landuse === "reservoir" || t.landuse === "basin") return "agua";
  if (t.landuse === "forest" || t.natural === "wood" || t.natural === "scrub") return "bosque";
  if (t.natural === "tree_row") return "arvores";
  if (t.landuse === "grass" || t.leisure === "park" || t.landuse === "village_green" || t.landuse === "meadow" || t.leisure === "pitch") return "grama";
  if (t.amenity === "parking") return "estacionamento";
  if (t.barrier === "fence") return "cerca";
  if (t.barrier === "wall" || t.barrier === "retaining_wall") return "muro";
  if (t.highway && ["footway", "path", "steps", "pedestrian", "cycleway"].includes(t.highway)) return "caminho";
  if (t.highway) return "rua";
  return null;
}
const RAIO = 700; // m em volta da pista
const out: { k: Kind; p: [number, number][]; h?: number; fechado?: boolean; w?: number }[] = [];
for (const e of osm.elements) {
  if (e.type !== "way" || !e.geometry || !e.tags) continue;
  const kind = kindOf(e.tags);
  if (!kind) continue;
  const pts = e.geometry.map((g) => proj(g.lon, g.lat).map((v) => v * k) as [number, number]);
  // longe demais da pista: fica de fora
  if (!pts.some(([x, y]) => game.some((g, i) => i % 20 === 0 && (g[0] - x) ** 2 + (g[1] - y) ** 2 < RAIO * RAIO))) continue;
  const g = e.geometry;
  const fechado = g.length > 3 && g[0].lat === g.at(-1)!.lat && g[0].lon === g.at(-1)!.lon;
  const item: (typeof out)[number] = { k: kind, p: pts.map(warp) };
  if (fechado) item.fechado = true;
  if (kind === "predio" || kind === "arquibancada") {
    const lv = Number(e.tags["building:levels"]) || 0;
    item.h = Number(e.tags.height) || (lv ? lv * 3 : kind === "arquibancada" ? 14 : 6);
  }
  if (kind === "rua") item.w = { primary: 12, secondary: 10, tertiary: 8, residential: 7, service: 5 }[e.tags.highway] ?? 6;
  out.push(item);
}
const by: Record<string, number> = {};
for (const f of out) by[f.k] = (by[f.k] ?? 0) + 1;
writeFileSync(outPath, JSON.stringify({ pista: track.name, fonte: "© colaboradores do OpenStreetMap (ODbL)", escala: Number(k.toFixed(4)), itens: out }));
console.log(track.name, "escala", k.toFixed(4), JSON.stringify(by));
