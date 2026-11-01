// Relevo real das pistas reais (mods): altitude do SRTM pelos blocos "Terrarium" públicos da AWS
// (s3.amazonaws.com/elevation-tiles-prod, sem chave). Gera public/autodromos/<slug>.relevo.json no formato
// do Terrain (src/render/terrain.ts: grade de alturas em décimos de metro, base64). Só o visual: a pista e
// o chão sobem e descem, a corrida não muda.
// uso: npx tsx scripts/osm-relief.ts <pasta com os <slug>.geojson do osm-batch> [nome da pista...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { CIRCUITS, getTrack } from "../src/sim/track";
import { slugOf } from "../src/sim/walls";
import { REAL_IDS } from "./realIds";

const [dir, ...only] = process.argv.slice(2);
if (!dir) throw new Error("falta a pasta dos .geojson");
const tileDir = join(dir, "tiles");
mkdirSync(tileDir, { recursive: true });
const Z = 13, MARGIN = 480, CELL = 16;

/** PNG 8 bits RGB/RGBA sem entrelaçamento -> pixels RGBA (o que os blocos Terrarium usam) */
function decodePng(buf: Buffer): { w: number; h: number; px: Uint8Array } {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = new Uint8Array(w * h * 4), cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < bpp ? cur[x * bpp + k] : 255;
    prev.set(cur);
  }
  return { w, h, px: out };
}

const tiles = new Map<string, { w: number; h: number; px: Uint8Array }>();
async function tile(x: number, y: number) {
  const key = `${Z}-${x}-${y}`;
  let t = tiles.get(key);
  if (t) return t;
  const f = join(tileDir, `${key}.png`);
  if (!existsSync(f)) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
    if (!r.ok) throw new Error(`bloco ${key}: ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  tiles.set(key, (t = decodePng(readFileSync(f))));
  return t;
}
/** altitude (m) num lat/lon, bilinear dentro do bloco */
async function elevation(lat: number, lon: number) {
  const n = 2 ** Z, fx = ((lon + 180) / 360) * n * 256;
  const lr = (lat * Math.PI) / 180, fy = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n * 256;
  const at = async (px: number, py: number) => {
    const t = await tile(Math.floor(px / 256), Math.floor(py / 256));
    const i = ((py % 256) * 256 + (px % 256)) * 4;
    return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
  };
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const [a, b, c, d] = await Promise.all([at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

for (let idx = 0; idx < CIRCUITS.length; idx++) {
  const def = CIRCUITS[idx];
  if (def.pack !== "real" || (only.length && !only.includes(def.name))) continue;
  const slug = slugOf(def.name), geoPath = join(dir, `${slug}.geojson`), allPath = join(dir, "f1-circuits.geojson");
  // (sem o arquivo da pista: pega o traçado no arquivo de todos os circuitos)
  const id = Object.keys(REAL_IDS).find((k) => REAL_IDS[k] === def.name);
  const feat = existsSync(geoPath)
    ? JSON.parse(readFileSync(geoPath, "utf8")).features[0]
    : existsSync(allPath) && id
      ? (JSON.parse(readFileSync(allPath, "utf8")) as { features: { properties: { id: string } }[] }).features.find((f) => f.properties.id === id)
      : null;
  if (!feat) {
    console.log(`${def.name}: sem traçado real`);
    continue;
  }
  // mesma projeção do osm-track.ts: em volta do meio do traçado real, na escala do jogo
  const geo = { features: [feat] };
  let c: [number, number][] = geo.features[0].geometry.coordinates;
  if (c[0][0] === c.at(-1)![0] && c[0][1] === c.at(-1)![1]) c = c.slice(0, -1);
  const lat0 = c.reduce((a, q) => a + q[1], 0) / c.length, lon0 = c.reduce((a, q) => a + q[0], 0) / c.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const real = c.map(([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0) * ky]);
  const len = real.reduce((a, q, i) => a + Math.hypot(q[0] - real[(i + 1) % real.length][0], q[1] - real[(i + 1) % real.length][1]), 0);
  const track = getTrack(idx), k = track.L / len;
  const toLatLon = (x: number, y: number): [number, number] => [lat0 - y / k / ky, lon0 + x / k / kx];
  // grade em volta da pista (com a folga do mapa)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let s = 0; s < track.L; s += 5) {
    const p = track.pose(s, 0);
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.y);
    z1 = Math.max(z1, p.y);
  }
  const gx = Math.floor((x0 - MARGIN) / CELL) * CELL, gz = Math.floor((z0 - MARGIN) / CELL) * CELL;
  const nx = Math.ceil((x1 - x0 + 2 * MARGIN) / CELL) + 1, nz = Math.ceil((z1 - z0 + 2 * MARGIN) / CELL) + 1;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [lat, lon] = toLatLon(gx + i * CELL, gz + j * CELL);
      h[j * nx + i] = await elevation(lat, lon);
    }
  // suaviza um pouco (o SRTM tem uns metros de ruído) e põe a pista perto do zero
  const sm = h.slice();
  for (let j = 1; j < nz - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      let s = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s += h[(j + b) * nx + i + a];
      sm[j * nx + i] = s / 9;
    }
  const at = (x: number, z: number) => {
    const fi = Math.max(0, Math.min(nx - 1.001, (x - gx) / CELL)), fj = Math.max(0, Math.min(nz - 1.001, (z - gz) / CELL));
    const i0 = Math.floor(fi), j0 = Math.floor(fj), tx = fi - i0, tz = fj - j0, g = (a: number, b: number) => sm[b * nx + a];
    return (g(i0, j0) * (1 - tx) + g(i0 + 1, j0) * tx) * (1 - tz) + (g(i0, j0 + 1) * (1 - tx) + g(i0 + 1, j0 + 1) * tx) * tz;
  };
  let lo = Infinity, hi = -Infinity;
  for (let s = 0; s < track.L; s += 10) {
    const p = track.pose(s, 0), v = at(p.x, p.y);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const q = new Int16Array(nx * nz);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(-32000, Math.min(32000, Math.round((sm[i] - lo) * 10)));
  writeFileSync(join("public", "autodromos", `${slug}.relevo.json`), JSON.stringify({ x0: gx, z0: gz, cell: CELL, nx, nz, h: Buffer.from(q.buffer).toString("base64"), fonte: "SRTM (AWS Terrain Tiles / Mapzen)" }));
  console.log(`${def.name}: ${nx}x${nz} pontos, a pista sobe ${(hi - lo).toFixed(0)} m (${lo.toFixed(0)} a ${hi.toFixed(0)} m de altitude)`);
}
