// FISCAL: roda corridas sem navegador e acusa o que é IMPOSSÍVEL (no formato das notas do 📌 ANOTAR).
//   npx tsx scripts/fiscal.ts [corridas=8] [--caos 40] [--voltas 4] [--lab rodada|batida|...|fisica]
// Regras: carro dentro de outro, empurrão sem encostar, tranco de lado, parada brusca, giro que acelera sozinho,
// peça quebrada sem pancada, rodada sozinho na reta, teleporte. Sai com a contagem por regra + exemplos.
import { Race, boxesTouch, setChaos, setNoSc } from "../src/sim/race";
import { LAB_SCENES, labFromParams, setLab, type LabScene } from "../src/sim/lab";
import type { CarState } from "../src/sim/types";

const argv = process.argv.slice(2);
const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const RACES = Number(argv.find((a, i) => /^\d+$/.test(a) && !argv[i - 1]?.startsWith("--")) ?? 8);
const LAPS = Number(opt("--voltas") ?? 4);
const lab = opt("--lab") as LabScene | undefined;
if (lab && !LAB_SCENES.includes(lab)) throw new Error(`cena desconhecida: ${lab} (${LAB_SCENES.join(", ")})`);
if (lab) setLab(labFromParams(new URLSearchParams(`lab=${lab}`)));
setChaos(Number(opt("--caos") ?? (lab ? 1 : 40)));
setNoSc(true);

const DT = 0.05;
const RULES = ["dentro de outro", "empurrão sem encostar", "tranco de lado", "parada brusca", "giro acelera sozinho", "peça sem pancada", "rodada sozinho na reta", "teleporte"] as const;
type Rule = (typeof RULES)[number];
const count = new Map<Rule, number>(RULES.map((r) => [r, 0]));
const examples = new Map<Rule, string[]>(RULES.map((r) => [r, []]));
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, "0")}`;

for (let i = 0; i < RACES; i++) {
  const seed = 1000 + i * 7919;
  const r = new Race({ seed, laps: LAPS, trackIndex: i % 6, humanTeams: [], setups: {} });
  const R = r as unknown as { resolveContacts(dt: number): void; rel(a: CarState, b: CarState): number; yawOf(c: CarState): number };
  const last = new Map<string, number>();
  const flag = (c: CarState, rule: Rule, what: string) => {
    const k = `${c.id}|${rule}`;
    if ((last.get(k) ?? -9) > r.time - 3) return;
    last.set(k, r.time);
    count.set(rule, count.get(rule)! + 1);
    const ex = examples.get(rule)!;
    if (ex.length < 6) ex.push(`[${r.track.name} · seed ${seed} · ${fmt(r.time)} de corrida · ${c.driver.name}] ${what}`);
  };
  // quem a separação de carros mexeu neste passo (e se tinha alguém encostando de verdade)
  let shoved = new Map<string, boolean>();
  const orig = R.resolveContacts.bind(r);
  R.resolveContacts = (dt: number) => {
    const before = r.cars.map((c) => ({ lat: c.lateral, v: c.v, w: c.slide?.yawRate }));
    orig(dt);
    shoved = new Map();
    r.cars.forEach((c, j) => {
      const b = before[j];
      if (Math.abs(c.lateral - b.lat) < 1e-6 && Math.abs(c.v - b.v) < 1e-6 && c.slide?.yawRate === b.w) return;
      const near = r.cars.some((o) => o !== c && o.pit !== "parked" && Math.abs(R.rel(c, o)) < 8 && boxesTouch(R.rel(c, o), o.lateral - b.lat, R.yawOf(c), R.yawOf(o), 0, 0.3));
      shoved.set(c.id, near);
    });
  };
  const cur = r.track.curvature;
  const straight = (s: number) => {
    // reta = nem força de lado (até 0,5 g) nem freada pra curva (perder o carro freando acontece de verdade)
    const v0 = r.track.speedAt(r.track.wrap(s));
    if (r.track.speedAt(r.track.wrap(s + 120)) < v0 - 12 || r.track.speedAt(r.track.wrap(s + 60)) < v0 - 12) return false;
    for (let d = -40; d <= 80; d += 5) {
      const x = r.track.wrap(s + d), v = r.track.speedAt(x);
      if ((v * v * Math.abs(cur[Math.floor(x) % r.track.L] ?? 0)) / 9.8 > 0.5) return false;
    }
    return true;
  };
  for (let k = 0; k < 20 * 60 * 3 * LAPS && r.phase !== "finished"; k++) {
    const pre = r.cars.map((c) => ({ s: c.s, lat: c.lateral, v: c.v, latV: c.latV ?? 0, loose: !!c.slide && c.slide.mode !== "rejoin", slide: !!c.slide, w: c.slide?.yawRate ?? 0, build: c.slide?.build !== undefined, imp: c.impact?.n ?? 0, dmg: Object.values(c.dmg).reduce((a, x) => a + x, 0), pit: c.pit, ret: c.retired }));
    const ev0 = r.events.length;
    r.step(DT);
    if (r.phase !== "racing") continue;
    const evs = r.events.slice(ev0);
    r.cars.forEach((c, j) => {
      const p = pre[j];
      if (p.pit !== "none" || c.pit !== "none" || p.ret) return;
      const mine = evs.filter((e) => e.carId === c.id || e.text.includes(c.driver.short) || e.text.includes(c.driver.name));
      const loose = !!c.slide && c.slide.mode !== "rejoin";
      // teleporte: andou mais do que a velocidade deixa
      let ds = c.s - p.s;
      if (ds < -r.track.L / 2) ds += r.track.L;
      const moved = Math.hypot(ds, c.lateral - p.lat), can = Math.max(p.v, c.v) * DT * 1.3 + (shoved.has(c.id) ? 0.25 : 0) + 0.15;
      if (moved > can) flag(c, "teleporte", `andou ${moved.toFixed(2)} m num passo de 0,05 s (dava ${can.toFixed(2)})`);
      if (shoved.get(c.id) === false) flag(c, "empurrão sem encostar", "a separação mexeu nele sem nenhum carro encostando");
      if (!p.slide && !c.slide) {
        const dl = Math.abs((c.latV ?? 0) - p.latV);
        if (dl > 2 && !shoved.has(c.id)) flag(c, "tranco de lado", `velocidade de lado mudou ${dl.toFixed(1)} m/s num passo (${(dl / DT / 9.8).toFixed(0)} g)`);
        const dv = p.v - c.v;
        if (dv > 8 && !shoved.has(c.id)) flag(c, "parada brusca", `perdeu ${(dv * 3.6).toFixed(0)} km/h num passo (${(dv / DT / 9.8).toFixed(0)} g)`);
      }
      if (p.loose && loose && !p.build && (c.impact?.n ?? 0) === p.imp && !shoved.has(c.id)) {
        const up = Math.abs(c.slide!.yawRate) - Math.abs(p.w);
        if (up > 1.5) flag(c, "giro acelera sozinho", `giro subiu ${((up * 180) / Math.PI).toFixed(0)}°/s num passo sem bater em nada`);
      }
      const dmg = Object.values(c.dmg).reduce((a, x) => a + x, 0);
      if (dmg > p.dmg + 1e-6 && (c.impact?.n ?? 0) === p.imp && !mine.length) flag(c, "peça sem pancada", `estrago subiu ${(dmg - p.dmg).toFixed(2)} sem batida nem toque`);
      for (const e of mine)
        if (e.carId === c.id && ["spin", "off", "moment"].includes(e.kind ?? "") && !p.slide && straight(c.s) && !/toque|laborat|levou/i.test(e.text)) {
          const touched = r.events.slice(-12).some((x) => x.time > r.time - 1.5 && /toque/i.test(x.text) && x.text.includes(c.driver.short));
          if (!touched) flag(c, "rodada sozinho na reta", `"${e.text}" num trecho reto (sem curva nem freada por perto)`);
        }
    });
    // carro dentro de outro (encolhe os dois até pararem de se tocar)
    for (let a = 0; a < r.cars.length; a++)
      for (let b = a + 1; b < r.cars.length; b++) {
        const A = r.cars[a], B = r.cars[b];
        if (A.pit !== "none" || B.pit !== "none" || (A.retired && B.retired)) continue;
        const d = R.rel(A, B);
        if (Math.abs(d) > 8) continue;
        const hit = (m: number) => boxesTouch(d, B.lateral - A.lateral, R.yawOf(A), R.yawOf(B), -m, -m);
        if (!hit(0.3)) continue;
        let pen = 0.6;
        while (pen < 2.4 && hit(pen / 2 + 0.01)) pen += 0.05;
        flag(A, "dentro de outro", `${pen.toFixed(1)} m dentro do carro de ${B.driver.name}`);
      }
  }
}

console.log(`FISCAL: ${RACES} corridas de ${LAPS} voltas${lab ? `, laboratório "${lab}"` : ", caos sem safety car"}\n`);
for (const rule of RULES) {
  console.log(`${String(count.get(rule)).padStart(5)}  ${rule}`);
  for (const e of examples.get(rule)!) console.log(`         ${e}`);
}
