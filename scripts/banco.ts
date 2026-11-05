// BANCO DE TESTES da pancada: força X (m/s de impulso) a velocidade Y no ângulo Z, no ponto P do carro -> o que
// acontece (mesma física do jogo: slidePhysics.hitCar + slideStep no asfalto, sem muro). Uso:
//   npx tsx scripts/banco.ts            (tabela inteira)
//   npx tsx scripts/banco.ts 200 45 4 traseira   (um caso, com o caminho quadro a quadro)
import { hitCar, slideStep, type HitSpec } from "../src/sim/slidePhysics";

const SUB = 0.05 / 8;
/** depois da pancada: escorrega até parar (atrito do stepSlide: rodando 9 m/s², escapando de frente 8) */
function run(vKmh: number, h: HitSpec, trace = false) {
  const { body, result } = hitCar(vKmh / 3.6, h);
  if (result === "segue" || result === "susto") return { result, turn: 0, dist: 0, side: 0, time: 0 };
  const acc = result === "rodada" ? 9 : 8;
  let x = 0, y = 0, t = 0, turn = 0, k = 0;
  while ((body.v > 0.3 || Math.abs(body.w) > 0.3) && t < 30) {
    const y0 = body.yaw;
    slideStep(body, acc, SUB);
    x += body.v * Math.cos(body.psi) * SUB;
    y += body.v * Math.sin(body.psi) * SUB;
    turn += body.yaw - y0;
    t += SUB;
    if (trace && k++ % 40 === 0) console.log(`  ${t.toFixed(2)} s  ${(body.v * 3.6).toFixed(0).padStart(3)} km/h  andou ${x.toFixed(0).padStart(3)} m  de lado ${y.toFixed(1).padStart(5)} m  bico ${((body.yaw * 180) / Math.PI).toFixed(0).padStart(5)}°  giro ${((body.w * 180) / Math.PI).toFixed(0).padStart(4)}°/s`);
  }
  return { result, turn: (turn * 180) / Math.PI, dist: Math.hypot(x, y), side: y, time: t };
}

const args = process.argv.slice(2);
if (args.length >= 3) {
  const h: HitSpec = { ang: Number(args[1]), forca: Number(args[2]), ponto: (args[3] as HitSpec["ponto"]) ?? "traseira" };
  console.log(`pancada de ${h.forca} m/s a ${h.ang}° na ${h.ponto}, a ${args[0]} km/h:`);
  const r = run(Number(args[0]), h, true);
  console.log(`=> ${r.result}: girou ${r.turn.toFixed(0)}°, andou ${r.dist.toFixed(0)} m (${r.side.toFixed(1)} m de lado) em ${r.time.toFixed(1)} s`);
} else {
  const VEL = [100, 150, 200, 250, 300], ANG = [20, 45, 70, 90, 120], FORCA = [1, 2, 4, 7];
  console.log("segue = nem sentiu · susto = corrigiu · R = rodou (graus girados / metros até parar) · E = escapou de frente");
  console.log("ângulo: de onde vem o empurrão (0° = por trás, 90° = de lado, 120° = de lado e pra trás)\n");
  for (const ponto of ["traseira", "meio", "dianteira"] as const)
    for (const forca of FORCA) {
      console.log(`— ${ponto}, pancada de ${forca} m/s (${(forca * 3.6).toFixed(0)} km/h de diferença) —`);
      console.log("km/h  " + ANG.map((a) => `${a}°`.padStart(14)).join(""));
      for (const v of VEL) {
        const cells = ANG.map((ang) => {
          const r = run(v, { ang, forca, ponto });
          const s = r.result === "rodada" ? `R ${r.turn.toFixed(0)}°/${r.dist.toFixed(0)}m` : r.result === "escapada" ? `E ${r.turn.toFixed(0)}°/${r.dist.toFixed(0)}m` : r.result;
          return s.padStart(14);
        });
        console.log(String(v).padEnd(6) + cells.join(""));
      }
      console.log("");
    }
}
