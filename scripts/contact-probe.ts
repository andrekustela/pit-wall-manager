// teste: empurrões de contato no ?caos&semsc — quantos vêm de carro batido parado, de carro solto, e quantos
// acontecem sem os carros desenhados (retângulos virados) se tocarem de verdade ("toque invisível")
import { Race, setChaos, setNoSc } from "../src/sim/race";
setChaos(40);
setNoSc(true);
const L = 4.8, W = 1.9;
/** os dois retângulos virados se tocam? (eixos separadores; s ao longo, lateral de lado) */
function obb(dx: number, dy: number, ya: number, yb: number, m = 0): boolean {
  const ax = [[Math.cos(ya), Math.sin(ya)], [-Math.sin(ya), Math.cos(ya)]];
  const bx = [[Math.cos(yb), Math.sin(yb)], [-Math.sin(yb), Math.cos(yb)]];
  const h = [L / 2, W / 2];
  for (const n of [...ax, ...bx]) {
    const ra = h[0] * Math.abs(n[0] * ax[0][0] + n[1] * ax[0][1]) + h[1] * Math.abs(n[0] * ax[1][0] + n[1] * ax[1][1]);
    const rb = h[0] * Math.abs(n[0] * bx[0][0] + n[1] * bx[0][1]) + h[1] * Math.abs(n[0] * bx[1][0] + n[1] * bx[1][1]);
    if (Math.abs(dx * n[0] + dy * n[1]) > ra + rb + m) return false;
  }
  return true;
}
const k = { pushes: 0, ghost: 0, byWreck: 0, byLoose: 0, kick: 0, brake: 0 };
for (let i = 0; i < 10; i++) {
  const r = new Race({ seed: 900 + i * 37, laps: 4, trackIndex: i % 5, humanTeams: [], setups: {} });
  const R = r as unknown as { resolveContacts(dt: number): void; rel(a: unknown, b: unknown): number };
  const orig = R.resolveContacts.bind(r);
  R.resolveContacts = (dt: number) => {
    const before = r.cars.map((c) => ({ lat: c.lateral, v: c.v }));
    orig(dt);
    r.cars.forEach((c, j) => {
      if (c.retired || (c.slide && c.slide.mode !== "rejoin")) return;
      const moved = Math.abs(c.lateral - before[j].lat) > 1e-6, slowed = before[j].v - c.v > 3;
      if (!moved && !slowed) return;
      k.pushes++;
      if (before[j].v - c.v > 10) k.brake++;
      if (Math.abs(c.latV ?? 0) >= 2.5) k.kick++;
      const yaw = (o: typeof c) => o.slide?.yaw ?? o.restYaw ?? 0;
      const near = r.cars.filter((o) => o !== c && Math.abs(R.rel(c, o)) < 6 && Math.abs(o.lateral - c.lateral) < 4);
      if (near.some((o) => o.retired)) k.byWreck++;
      if (near.some((o) => o.slide && o.slide.mode !== "rejoin")) k.byLoose++;
      if (!near.some((o) => obb(R.rel(c, o), o.lateral - before[j].lat, yaw(c), yaw(o), 0.3))) k.ghost++;
    });
  };
  for (let s = 0; s < 20 * 60 * 6 && r.phase !== "finished"; s++) r.step(0.05);
}
console.log(k);
