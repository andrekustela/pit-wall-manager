// Baixa o entorno real (OpenStreetMap) de todas as pistas reais que ainda não têm public/autodromos/<slug>.json.
// uso: npx tsx scripts/osm-batch.ts <pasta pros downloads> [nome da pista...]
// Pra cada pista: traçado real do bacinger/f1-circuits (MIT), consulta no Overpass numa caixa ~800 m em
// volta e scripts/osm-track.ts (que encaixa o mapa no traçado do jogo). Dados: © colaboradores do
// OpenStreetMap (ODbL). Uma pista de cada vez, com pausa: o Overpass é um servidor público.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CIRCUITS } from "../src/sim/track";
import { slugOf } from "../src/sim/walls";

const [dir, ...only] = process.argv.slice(2);
if (!dir) throw new Error("falta a pasta dos downloads");
mkdirSync(dir, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** id do circuito no f1-circuits -> nome no jogo (o mesmo de scripts/gen-real-tracks.mjs) */
const NAMES: Record<string, string> = {
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

const allPath = join(dir, "f1-circuits.geojson");
if (!existsSync(allPath)) {
  const r = await fetch("https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson");
  if (!r.ok) throw new Error(`f1-circuits: ${r.status}`);
  writeFileSync(allPath, await r.text());
}
const all = JSON.parse(readFileSync(allPath, "utf8")) as { features: { properties: { id: string }; geometry: { coordinates: [number, number][] } }[] };

const report: string[] = [];
for (const [id, name] of Object.entries(NAMES)) {
  if (only.length && !only.includes(name)) continue;
  const slug = slugOf(name), out = join("public", "autodromos", `${slug}.json`);
  if (existsSync(out)) {
    report.push(`${name}: já tinha`);
    continue;
  }
  // a pista do jogo com esse nome (a ativa: as guardadas ficam pra saves antigos)
  const idx = CIRCUITS.findIndex((t) => t.name === name && !t.standby);
  const f = all.features.find((x) => x.properties.id === id);
  if (idx < 0 || !f) {
    report.push(`${name}: ${idx < 0 ? "não está no jogo" : "sem traçado no f1-circuits"}`);
    continue;
  }
  const geoPath = join(dir, `${slug}.geojson`);
  writeFileSync(geoPath, JSON.stringify({ type: "FeatureCollection", features: [f] }));
  const osmPath = join(dir, `${slug}.osm.json`);
  if (!existsSync(osmPath)) {
    const c = f.geometry.coordinates;
    const lat0 = c.reduce((a, q) => a + q[1], 0) / c.length;
    const dLat = 800 / 110540, dLon = 800 / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const s = Math.min(...c.map((q) => q[1])) - dLat, n = Math.max(...c.map((q) => q[1])) + dLat;
    const w = Math.min(...c.map((q) => q[0])) - dLon, e = Math.max(...c.map((q) => q[0])) + dLon;
    const bb = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
    const q = `[out:json][timeout:180];(way["highway"](${bb});way["building"](${bb});way["landuse"](${bb});way["natural"](${bb});way["leisure"](${bb});way["barrier"~"fence|wall|retaining_wall"](${bb});way["amenity"="parking"](${bb});way["man_made"~"pier|breakwater"](${bb}););out geom;`;
    let ok = false;
    for (let tent = 0; tent < 4 && !ok; tent++) {
      try {
        const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "pit-wall-manager/1.0 (jogo, uso pessoal)" } });
        if (r.ok) {
          writeFileSync(osmPath, await r.text());
          ok = true;
        } else {
          console.log(`${name}: Overpass ${r.status}, tentando de novo`);
          await wait(30000 * (tent + 1));
        }
      } catch (err) {
        console.log(`${name}: ${String(err)}, tentando de novo`);
        await wait(30000 * (tent + 1));
      }
    }
    if (!ok) {
      report.push(`${name}: Overpass falhou`);
      continue;
    }
    await wait(8000);
  }
  try {
    const msg = execFileSync(process.execPath, ["--import", "tsx", "scripts/osm-track.ts", String(idx), geoPath, osmPath, out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    report.push(msg.trim());
  } catch (err) {
    report.push(`${name}: osm-track falhou (${String((err as { stderr?: string }).stderr ?? err).split("\n").slice(0, 3).join(" ")})`);
  }
  console.log(report.at(-1));
}
console.log("\n" + report.join("\n"));
