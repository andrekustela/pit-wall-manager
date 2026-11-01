// Gera as 40 pistas OFICIAIS do jogo: inventadas, no estilo das reais (rápida, travada, de rua, mista, curta,
// técnica), sem copiar traçado nem nome. Versão 2: as curvas vêm de um VOCABULÁRIO tirado das 40 pistas reais
// (os "complexos" de curvas delas: scripts/trackStatsLib.complexesOf), misturados, espelhados e deformados — cada
// trecho tem cara de pista de verdade, nenhuma pista copia uma real. Pra cada vaga, sorteia CANDIDATAS e fica com a
// de melhor nota nas medidas das reais (curvas por km, complexos, troca de direção, freadas fortes, reta mais
// longa, variedade); a pista que já existe só sai se a nova for melhor. Cada uma é uma "receita" de retas e curvas
// (src/sim/trackShape.ts) conferida: fecha a volta, curvas no limite, nenhuma parte encosta em outra. Depois acha
// o traçado ideal (src/sim/lineOpt.ts).
// Saída: src/sim/inventedTracks.ts
// uso: npx tsx scripts/gen-pistas.ts [iterações do traçado ideal, padrão 12000] [candidatas por vaga, padrão 120] [só=1,5,9 (vagas, de 1)]
import { writeFileSync } from "node:fs";
import { turtle } from "../src/sim/trackShape";
import { CIRCUITS, Track, type TrackDef } from "../src/sim/track";
import { geometryOf, optimizeLine } from "../src/sim/lineOpt";
import { INVENTED, type InventedTrack } from "../src/sim/inventedTracks";
import { complexesOf, trackStats, type Complex, type Stats } from "./trackStatsLib";

const ITERS = Number(process.argv[2] ?? 12000);
const CANDS = Number(process.argv[3] ?? 120);
const ONLY = (process.argv[4] ?? "").replace("só=", "").split(",").filter(Boolean).map((x) => Number(x) - 1);

// sorteio repetível
let seed = 20261101;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const r = (a: number, b: number) => a + rnd() * (b - a);
const ri = (a: number, b: number) => Math.round(r(a, b));
const pick = <T,>(l: T[]) => l[Math.floor(rnd() * l.length)];

type Style = "rapida" | "travada" | "rua" | "mista" | "curta" | "tecnica";
type Speed = "lento" | "medio" | "rapido";
/**
 * cada estilo: tamanho (m), reta principal, quanto as retas entre trechos esticam/encolhem, que tipo de complexo
 * aparece mais (peso), e as metas das medidas (curvas por km; a das reais é 4,05)
 */
const STYLE: Record<Style, { len: [number, number]; main: [number, number]; straight: [number, number]; mix: Record<Speed, number>; perKm: number; hairpins: number; street?: boolean }> = {
  // retas longas, chicanes e curvas rápidas (tipo Monza/Spa)
  rapida: { len: [5000, 6200], main: [900, 1200], straight: [0.9, 1.35], mix: { lento: 1, medio: 3, rapido: 4 }, perKm: 3.3, hairpins: 1 },
  // curva atrás de curva (tipo Hungaroring)
  travada: { len: [3800, 4600], main: [550, 750], straight: [0.5, 0.9], mix: { lento: 3, medio: 5, rapido: 1 }, perKm: 4.8, hairpins: 1 },
  // rua: cantos de 90° e muros (tipo Baku/Singapura)
  rua: { len: [4300, 6000], main: [650, 1200], straight: [0.8, 1.4], mix: { lento: 4, medio: 3, rapido: 1 }, perKm: 4.2, hairpins: 1, street: true },
  // curvas rápidas encadeadas (tipo Silverstone/Suzuka)
  mista: { len: [5000, 5900], main: [650, 900], straight: [0.8, 1.2], mix: { lento: 1, medio: 4, rapido: 4 }, perKm: 4.2, hairpins: 0 },
  // volta curta e rápida (tipo Red Bull Ring)
  curta: { len: [3600, 4400], main: [600, 900], straight: [1.0, 1.5], mix: { lento: 2, medio: 3, rapido: 2 }, perKm: 3.8, hairpins: 1 },
  // freadas fortes em curvas lentas que saem em retas (tipo Bahrein)
  tecnica: { len: [4800, 5600], main: [800, 1100], straight: [1.1, 1.6], mix: { lento: 4, medio: 3, rapido: 1 }, perKm: 3.8, hairpins: 2 },
};

// ---- o vocabulário: os complexos das 40 reais, e o tamanho das retas entre eles ----
const REAL = CIRCUITS.filter((d) => d.pack === "real");
const LIB: Complex[] = [], GAPS: number[] = [];
for (const def of REAL) {
  const t = new Track(def), cs = complexesOf(t);
  LIB.push(...cs);
  // (reta entre um complexo e o próximo: o espaço que sobra na volta, dividido entre eles, pelas reais)
  const used = cs.reduce((s, c) => s + c.bends.reduce((a, b) => a + (Math.abs(b.deg) * Math.PI * b.r) / 180, 0) + c.gaps.reduce((a, g) => a + g, 0), 0);
  const free = (t.L - used) / Math.max(1, cs.length);
  for (let k = 0; k < cs.length; k++) GAPS.push(Math.max(60, Math.min(900, free * r(0.4, 1.6))));
}
const speedOf = (c: Complex): Speed => (c.minR < 50 ? "lento" : c.minR < 120 ? "medio" : "rapido");
const BY: Record<Speed, Complex[]> = { lento: [], medio: [], rapido: [] };
for (const c of LIB) if (c.bends.every((b) => Math.abs(b.deg) <= 200)) BY[speedOf(c)].push(c);

const tok = (deg: number, rad: number) => `${deg > 0 ? "R" : "L"}${Math.round(Math.abs(deg))}/${Math.max(13, Math.round(rad))}`;
/** um complexo das reais, deformado e às vezes espelhado; devolve os tokens e o giro total (graus, com sinal) */
function realComplex(sp: Speed, mirror: boolean): { toks: string[]; turn: number } {
  const c = pick(BY[sp].length ? BY[sp] : LIB);
  const toks: string[] = [];
  let turn = 0;
  c.bends.forEach((b, i) => {
    const deg = b.deg * r(0.8, 1.2) * (mirror ? -1 : 1), rad = b.r * r(0.75, 1.3);
    toks.push(tok(deg, rad));
    turn += deg;
    if (i < c.gaps.length) toks.push(`S${Math.max(5, Math.round(c.gaps[i] * r(0.7, 1.4)))}`);
  });
  return { toks, turn };
}
/** curvas feitas à mão que as reais quase não têm no vocabulário: grampo e o canto de 90° de rua, e a chicane */
function handCorner(k: "grampo" | "noventa" | "chicane", dir: number): { toks: string[]; turn: number } {
  if (k === "grampo") {
    const a = r(150, 180);
    return { toks: [tok(dir * a, r(14, 22))], turn: dir * a };
  }
  if (k === "noventa") {
    const a = r(80, 100);
    return { toks: [tok(dir * a, r(16, 32))], turn: dir * a };
  }
  const a = r(30, 55), b = a * r(0.8, 1.05), rad = r(16, 26);
  return { toks: [tok(dir * a, rad), `S${ri(10, 30)}`, tok(-dir * b, rad)], turn: dir * (a - b) };
}

/** receita de uma pista do estilo (rumo: horário se dir = 1) */
function recipe(st: Style) {
  const S = STYLE[st];
  const dir = rnd() < 0.7 ? 1 : -1;
  const weights = (Object.entries(S.mix) as [Speed, number][]).flatMap(([k, w]) => Array(w).fill(k) as Speed[]);
  const toks = [`S${ri(...S.main)}*`];
  let net = 0, len = 0, midDone = false, hair = 0;
  const want = r(...S.len);
  while (len < want * 0.8) {
    // trecho: um complexo das reais (ou, na rua, cantos de 90° e chicanes; às vezes um grampo depois de reta longa)
    let c: { toks: string[]; turn: number };
    const prevStraight = Number(/S(\d+)/.exec(toks[toks.length - 1])?.[1] ?? 0);
    let d = rnd() < 0.68 ? dir : -dir;
    // (nunca deixa o giro passar de ~330° nem voltar muito: pista com cara de pista, não de oval nem de nó)
    if (dir * net > 300) d = -dir;
    if (dir * net < -80) d = dir;
    if (hair < S.hairpins && prevStraight > 450 && rnd() < 0.5) {
      c = handCorner("grampo", d);
      hair++;
    } else if (S.street && rnd() < 0.6) c = handCorner(rnd() < 0.8 ? "noventa" : "chicane", d);
    else {
      c = realComplex(pick(weights), false);
      // (espelha pra seguir o rumo que a volta precisa)
      if (Math.sign(c.turn) !== d && Math.abs(c.turn) > 20) c = { toks: c.toks.map((t) => (t[0] === "R" ? "L" + t.slice(1) : t[0] === "L" ? "R" + t.slice(1) : t)), turn: -c.turn };
    }
    toks.push(...c.toks);
    net += c.turn;
    len += c.toks.reduce((s, t) => {
      if (t[0] === "S") return s + Number(t.slice(1));
      const [deg, rad] = t.slice(1).split("/").map(Number);
      return s + (deg * Math.PI * rad) / 180;
    }, 0);
    const sl = Math.round(pick(GAPS) * r(...S.straight));
    // a reta do meio da volta é a segunda ajustável (fecha a volta junto com a principal). Precisa fazer um
    // ângulo bom com a principal: quase paralelas, a conta de fechar pedia retas de quilômetros
    const ang = Math.abs(((net % 180) + 180) % 180);
    const adjustable = !midDone && len > want * 0.35 && sl > 180 && ang > 35 && ang < 145;
    if (adjustable) midDone = true;
    toks.push(`S${sl}${adjustable ? "*" : ""}`);
    len += sl;
  }
  if (!midDone) return null;
  toks.push(`${dir > 0 ? "R" : "L"}0/${ri(st === "rapida" ? 60 : 30, st === "rapida" ? 140 : 70)}`, `S${ri(80, 220)}`);
  return toks.join(" ");
}

/** a pista serve? fecha, tamanho, curvas não apertadas demais, nenhuma parte encosta em outra */
function check(t: Track, st: Style): string | null {
  const L = t.L, S = STYLE[st];
  if (L < S.len[0] * 0.88 || L > S.len[1] * 1.12) return `tamanho ${L}`;
  // raio mínimo 13 m (grampo de rua)
  for (let s = 0; s < L; s++) if (Math.abs(t.curvature[s]) > 1 / 13) return "curva apertada";
  // partes da pista longe na volta precisam ficar a 45 m uma da outra (pista + escape)
  const step = 6, pts: { x: number; y: number }[] = [];
  for (let s = 0; s < L; s += step) pts.push(t.pose(s, 0));
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const arc = Math.min(j - i, pts.length - (j - i)) * step;
      if (arc < 160) continue;
      if ((pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2 < 45 * 45) return "encosta";
    }
  // a maior reta tem que dar uma reta de largada de verdade
  if (t.mainStraight[1] + (t.L - t.mainStraight[0]) < 350) return "reta curta";
  // (e pelo menos uma zona de DRS: a pista travada mais lenta saía sem nenhuma)
  if (!t.drsZones.length) return "sem DRS";
  return null;
}

/**
 * nota (menor = melhor): quanto as medidas fogem das das pistas reais, na meta do estilo. Reais (média): 4,05
 * curvas/km, 56% das curvas em complexo, 37% trocam de lado, ~6 freadas fortes, reta mais longa ~580 m,
 * variedade (desvio das velocidades mínimas) ~9,5 m/s
 */
function score(s: Stats, st: Style): number {
  const S = STYLE[st], n = Math.max(1, s.corners);
  const sq = (x: number) => x * x;
  let p = sq((s.perKm - S.perKm) / 0.6);
  p += sq(Math.max(0, 0.45 - s.complex / n) / 0.1) + sq(Math.max(0, s.complex / n - 0.75) / 0.1);
  p += sq(Math.max(0, 0.28 - s.flips / n) / 0.08);
  p += sq(Math.max(0, (st === "travada" || st === "mista" ? 3 : 4) - s.brakes));
  const lmax = st === "rapida" ? 1450 : st === "travada" ? 650 : 1150, lmin = st === "travada" ? 200 : 380;
  p += sq(Math.max(0, s.longest - lmax) / 150) + sq(Math.max(0, lmin - s.longest) / 100);
  p += sq(Math.max(0, (st === "rua" || st === "tecnica" ? 0.25 : 0.4) - s.med / n) / 0.1);
  p += sq(Math.max(0, s.hair - 2));
  p += sq(Math.max(0, 7.5 - s.variety) / 1.5);
  // (nem só lentas nem só rápidas)
  if (!s.fast && st !== "travada" && st !== "rua") p += 1;
  if (s.slow + s.hair === 0) p += 1;
  return p;
}

// nomes: cidades pelo mundo, no formato genérico "Circuito/Autódromo de <cidade>" (nome de cidade não é marca).
// Fora: cidades que sediam a F1 hoje e as que já têm autódromo conhecido com esse nome (nem parecer evento
// oficial nem confundir com as pistas reais dos mods). Na ordem das vagas: estilo = vaga % 6
const NAMES = [
  "Autódromo de Atenas",
  "Circuito de Praga",
  "Circuito Urbano de Lisboa",
  "Autódromo de Viena",
  "Circuito de Genebra",
  "Autódromo de Bangkok",
  "Autódromo de Oslo",
  "Circuito de Florença",
  "Circuito Urbano de Tóquio",
  "Circuito de Estocolmo",
  "Autódromo de Copenhague",
  "Circuito de Lima",
  "Autódromo de Nairóbi",
  "Circuito de Kyoto",
  "Circuito Urbano de Nova York",
  "Autódromo de Vancouver",
  "Circuito de Helsinque",
  "Autódromo de Bogotá",
  "Autódromo de Perth",
  "Circuito de Veneza",
  "Circuito Urbano de Mumbai",
  "Autódromo de Seul",
  "Circuito do Porto",
  "Circuito de Manaus",
  "Autódromo de Calgary",
  "Circuito de Edimburgo",
  "Circuito Urbano do Cairo",
  "Circuito de Dublin",
  "Autódromo de Montevidéu",
  "Circuito de Varsóvia",
  "Autódromo de Reykjavík",
  "Circuito de Bruges",
  "Circuito Urbano de Havana",
  "Autódromo de Auckland",
  "Circuito de Lyon",
  "Circuito de Belém",
  "Circuito de Florianópolis",
  "Circuito de Salvador",
  "Circuito Urbano de Sydney",
  "Circuito do Recife"
];
const STYLES: Style[] = ["rapida", "travada", "rua", "mista", "curta", "tecnica"];
const BLURB: Record<Style, string[]> = {
  rapida: ["Retas enormes cortadas por chicanes. Asa mínima e vácuo valem ouro.", "Velocidade pura: curvas rápidas e freadas fortes no fim das retas."],
  travada: ["Curva atrás de curva, quase sem reta. Ultrapassar é difícil: a classificação decide.", "Travada e técnica: pede muita asa e pneu que aguente."],
  rua: ["Circuito de rua entre muros: errou, bateu. Retas longas e cantos de 90°.", "Ruas da cidade fechadas pra corrida. Muro colado na pista o tempo todo."],
  mista: ["Curvas rápidas encadeadas: o carro tem que ser bom em tudo.", "Mistura de esses velozes e freadas fortes. Clássica de piloto."],
  curta: ["Volta curta e rápida, poucas curvas: o pelotão anda junto e o tráfego pesa.", "Pequena e veloz: cada décimo conta e o box é rápido."],
  tecnica: ["Grampos lentos que saem em retas longas: tração e freada fazem a diferença.", "Técnica: freadas fortes em curvas lentas e retas pra ultrapassar."],
};

const defOf = (name: string, shape: string, extra: Partial<TrackDef>): TrackDef => {
  const sh = turtle(shape);
  return { name, blurb: "", points: sh.points, targetLength: Math.round(sh.targetLength), marks: sh.marks, minHeight: 4, balance: 0, rainChance: 0.3, grass: ["#3f8a3c", "#438f40"], ...extra };
};

console.log(`vocabulário: ${LIB.length} complexos das reais (lentos ${BY.lento.length}, médios ${BY.medio.length}, rápidos ${BY.rapido.length}), ${GAPS.length} retas`);
const out: InventedTrack[] = [];
const t0 = Date.now();
for (let i = 0; i < 40; i++) {
  const st = STYLES[i % STYLES.length];
  const old = INVENTED[i];
  if (ONLY.length && !ONLY.includes(i)) {
    out.push(old);
    continue;
  }
  // a pista de hoje entra na disputa
  let best: { shape: string; sc: number; s: Stats } | null = null;
  try {
    const t = new Track(defOf(old.name, old.shape, { street: old.street }));
    // (só disputa se passar nas mesmas exigências das novas)
    if (!check(t, st)) {
      const s = trackStats(t);
      best = { shape: old.shape, sc: score(s, st), s };
    }
  } catch {
    /* a antiga não monta: qualquer nova serve */
  }
  const oldScore = best?.sc ?? Infinity;
  let ok = 0;
  for (let tries = 0; tries < CANDS * 40 && ok < CANDS; tries++) {
    const shape = recipe(st);
    if (!shape) continue;
    const sh = turtle(shape);
    if ((sh.closeError ?? 0) > sh.targetLength * 0.12 || sh.targetLength > 9000) continue;
    let t: Track;
    try {
      t = new Track(defOf(NAMES[i], shape, { street: !!STYLE[st].street }));
    } catch {
      continue;
    }
    if (check(t, st)) continue;
    ok++;
    const s = trackStats(t), sc = score(s, st) + rnd() * 0.05;
    if (!best || sc < best.sc) best = { shape, sc, s };
  }
  if (!best) throw new Error(`não achei pista boa pro estilo ${st} (${NAMES[i]})`);
  const kept = best.shape === old.shape;
  const S = STYLE[st], street = !!S.street;
  const grass = street ? (["#6f7177", "#73757b"] as [string, string]) : old.grass;
  const def = defOf(NAMES[i], best.shape, { street });
  const t = new Track(def);
  const line = kept ? { o: old.line, lap: t.idealLap } : optimizeLine(geometryOf(t), ITERS);
  out.push({
    name: NAMES[i],
    blurb: kept ? old.blurb : pick(BLURB[st]),
    shape: best.shape,
    style: st,
    minHeight: old.minHeight,
    balance: old.balance,
    rainChance: old.rainChance,
    grass,
    overtake: old.overtake,
    line: kept ? old.line : line.o.map((v) => Math.round(v * 100) / 100),
    ...(street ? { street: true, night: old.night ?? rnd() < 0.4 } : {}),
  });
  const s = best.s;
  console.log(
    `${String(i + 1).padStart(2)} ${NAMES[i].padEnd(30)} ${st.padEnd(8)} ${kept ? "MANTIDA" : "NOVA   "} nota ${best.sc.toFixed(2)} (antes ${oldScore.toFixed(2)}) · ${(t.L / 1000).toFixed(2)} km, ${s.corners} curvas (${s.perKm.toFixed(1)}/km), complexos ${s.complex}, trocas ${s.flips}, freadas ${s.brakes}, reta ${s.longest} m [${((Date.now() - t0) / 1000).toFixed(0)}s]`,
  );
}
writeFileSync(
  "src/sim/inventedTracks.ts",
  `// GERADO por scripts/gen-pistas.ts — as 40 pistas oficiais do jogo (inventadas no estilo das reais).
// shape = receita de retas e curvas (src/sim/trackShape.ts); line = traçado ideal a cada LINE_STEP m.
export interface InventedTrack { name: string; blurb: string; shape: string; style: string; minHeight: number; balance: number; rainChance: number; grass: [string, string]; street?: boolean; night?: boolean; overtake: number; line: number[] }
export const INVENTED: InventedTrack[] = ${JSON.stringify(out)};
`,
);
console.log("gravado src/sim/inventedTracks.ts");
