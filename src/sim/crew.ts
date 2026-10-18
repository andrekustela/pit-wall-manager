// Mecânicos de cada carro: quatro especialistas, cada um com seu nível (0..5).
// Evoluem com pontos próprios (pontos de mecânicos), separados dos do carro.

export type CrewArea = "pneus" | "gasolina" | "pecas" | "chefe";
export type Crew = Record<CrewArea, number>;

export const CREW_DEFAULT = 2;
export const CREW_MAX = 5;

export const CREW_AREAS: { id: CrewArea; label: string; icon: string; desc: string }[] = [
  { id: "pneus", label: "Mecânicos dos pneus", icon: "🛞", desc: "Trocam os quatro pneus mais rápido." },
  { id: "gasolina", label: "Mecânico do combustível", icon: "⛽", desc: "Reabastecimento mais rápido (a parada dura o que demorar mais: pneu ou combustível)." },
  { id: "pecas", label: "Mecânicos de peças", icon: "🔧", desc: "Trocam bico, asa traseira e suspensão danificados em menos tempo." },
  { id: "chefe", label: "Chefe de box", icon: "🚦", desc: "Menos erros: parada lenta (roda travada, macaco) e liberação insegura (5 s de punição)." },
];

export function crewOf(level = CREW_DEFAULT): Crew {
  return { pneus: level, gasolina: level, pecas: level, chefe: level };
}

/** aceita o formato antigo (um número só) e completa o que faltar */
export function normCrew(v: unknown): Crew {
  if (typeof v === "number") return crewOf(v);
  const o = (v ?? {}) as Partial<Crew>;
  const c = (x: unknown) => (typeof x === "number" ? Math.max(0, Math.min(CREW_MAX, Math.round(x))) : CREW_DEFAULT);
  return { pneus: c(o.pneus), gasolina: c(o.gasolina), pecas: c(o.pecas), chefe: c(o.chefe) };
}

export function crewTotal(c: Crew): number {
  return c.pneus + c.gasolina + c.pecas + c.chefe;
}

/** chance de dar errado no pit stop pelo nível do chefe de box (0 ≈ 10%, 5 ≈ 1,5%) */
export function crewErrorChance(level: number): number {
  return Math.max(0.01, 0.1 - level * 0.017);
}
/** tempo médio de troca de pneu (s) pelo nível dos mecânicos dos pneus */
export function crewStopTime(level: number): number {
  const lo = 2.9 - level * 0.18;
  return lo + (1.0 - level * 0.12) / 2;
}
/** multiplicador do tempo de reabastecimento (nível 0 = 1,15×, nível 5 = 0,8×) */
export function refuelMult(level: number): number {
  return 1.15 - level * 0.07;
}
/** multiplicador do tempo de conserto de peças (nível 0 = 1,25×, nível 5 = 0,7×) */
export function repairMult(level: number): number {
  return 1.25 - level * 0.11;
}

/** custo (pontos de mecânicos) de subir um especialista do nível atual pro próximo */
export function crewCost(level: number): number {
  return 1 + level;
}

/** pontos de mecânicos ganhos na etapa: o líder ganha 2, o último 4 */
export function roundCrewPoints(rank: number, n: number): number {
  return 2 + Math.round((rank / Math.max(1, n - 1)) * 2);
}
