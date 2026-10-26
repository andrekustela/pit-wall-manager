// O que a IA do rádio sabe do carro: um resumo em texto da situação agora (posição, distâncias,
// pneu, combustível, danos, modo, clima). Só fatos do jogo, pra ela não inventar.
import { tyreTempLabel, type Race } from "../sim/race";
import { COMPOUNDS, ENGINE, FAULTS, PACE, type CarState } from "../sim/types";
import { PARTS } from "../sim/parts";

const num = (x: number, d = 1) => x.toFixed(d).replace(".", ",");

export function carStatusText(race: Race, c: CarState): string {
  const order = race.ordered();
  const i = order.indexOf(c);
  const g = (car: CarState) => race.gapToLeader(car);
  const lines: string[] = [];
  const lap = Math.min(race.laps, Math.max(1, c.lap + 1));
  if (c.retired) return `Você abandonou a corrida (${c.retireReason ?? "problema"}).`;
  if (c.finished) return `Você terminou a corrida em P${c.position}.`;
  lines.push(`Posição: P${c.position} de ${order.length}, volta ${lap} de ${race.laps}.`);
  const ahead = i > 0 ? order[i - 1] : null, behind = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  if (ahead && !ahead.retired) {
    const a = g(ahead), me = g(c);
    lines.push(me.laps > a.laps ? `Na frente: ${ahead.driver.name}, uma volta à frente.` : `Na frente: ${ahead.driver.name}, ${num(Math.max(0, me.seconds - a.seconds))} s.`);
  } else if (i === 0) lines.push("Você está liderando.");
  if (behind && !behind.retired) {
    const b = g(behind), me = g(c);
    if (b.laps === me.laps) lines.push(`Atrás: ${behind.driver.name}, ${num(Math.max(0, b.seconds - me.seconds))} s.`);
  }
  const rubber = Math.round((1 - Math.min(1, c.wear)) * 100);
  const temp = tyreTempLabel(c.tyreTemp ?? 0.6);
  lines.push(`Pneu ${COMPOUNDS[c.compound].label.toLowerCase()} com ${c.tyreLaps} voltas, ${rubber}% de borracha, ${temp === "frio" ? "frio" : temp === "quente" ? "quente demais" : "na temperatura certa"}.`);
  const fuelLaps = c.fuel / race.consumption(c), left = race.lapsLeft(c);
  const next = c.plan[c.planIdx];
  lines.push(`Combustível pra ${num(fuelLaps)} voltas; faltam ${num(left)} voltas${next ? `; parada planejada na volta ${next.lap}` : ""}.`);
  const broken = PARTS.filter((p) => c.dmg[p.id] > 0.05).map((p) => p.label.toLowerCase());
  if (broken.length) lines.push(`Danos: ${broken.join(", ")} (perdendo uns ${num(race.damageLoss(c))} s por volta).`);
  else lines.push("Carro sem danos.");
  if (c.fault && FAULTS[c.fault]) lines.push(`Problema: ${FAULTS[c.fault].label.toLowerCase()}.`);
  if (c.engineHealth < 0.5) lines.push(`Motor gasto (${Math.round(c.engineHealth * 100)}%).`);
  lines.push(`Ritmo: ${PACE[c.pace].label.toLowerCase()}; motor: ${ENGINE[c.engine].label.toLowerCase()}.`);
  if (c.boxRequest) lines.push(`Você já foi chamado pro box (pneu ${COMPOUNDS[c.boxRequest].label.toLowerCase()}).`);
  if (c.pit !== "none") lines.push("Você está no pit lane agora.");
  if (c.dirtyAir) lines.push("Colado atrás de outro carro, perdendo aderência no ar sujo.");
  if (c.drs) lines.push("Com a asa aberta (DRS) nesta reta.");
  lines.push(race.wet > 0.5 ? "Pista bem molhada." : race.wet > 0.15 ? "Pista úmida." : race.rain > 0 ? "Começando a chover." : "Pista seca.");
  if (race.sc.active) lines.push("Safety car na pista.");
  return lines.join("\n");
}
