// Monta as equipes/pilotos de um fim de semana (nomes personalizados,
// modo "carros iguais") e sorteia os engenheiros da IA.
import { DRIVERS, TEAMS } from "./data";
import { profileOf, toDriver, type Lineup } from "./drivers";
import { Rng } from "./rng";
import type { Driver, Team } from "./types";

export interface Engineer {
  name: string;
  /** 0 = ruim, 1 = excelente (só IA; humano = null) */
  quality: number | null;
}

export interface EntrantOptions {
  equalCars?: boolean;
  /** nome personalizado das equipes humanas */
  teamNames?: Record<string, string>;
  /** pilotos sorteados de cada equipe (sem isso, usa a escalação fixa antiga) */
  lineup?: Lineup;
}

/** no modo igual todo mundo tem carro e piloto equivalentes */
const EQUAL_SKILL = 0.25;

export function buildEntrants(opts: EntrantOptions): { teams: Team[]; drivers: Driver[] } {
  const teams = TEAMS.map((t) => ({
    ...t,
    name: opts.teamNames?.[t.id]?.trim() || t.name,
    carPace: opts.equalCars ? 0 : t.carPace,
  }));
  if (opts.lineup) {
    // pilotos da base: no modo "carros iguais" só o carro é igual; o piloto faz a diferença
    const drivers = TEAMS.flatMap((t) => (opts.lineup![t.id] ?? []).map((id) => toDriver(profileOf(id)!, t.id)));
    return { teams, drivers };
  }
  const drivers = DRIVERS.map((d) => (opts.equalCars ? { ...d, skill: EQUAL_SKILL, tyreCare: 1 } : { ...d }));
  return { teams, drivers };
}

const ENGINEER_NAMES = [
  "Carla Mendes", "Otto Brenner", "Sakura Ito", "Paulo Rezende", "Inês Duarte", "Viktor Hale",
  "Jonas Petrov", "Lia Fontaine", "Rui Tavares", "Greta Holm", "Marcos Leal", "Hana Sato",
  "Felipe Durán", "Nadia Kowal", "Tom Ashby", "Beatriz Lobo", "Ivan Sorokin", "Clara Weiss",
  "Davi Moura", "Elena Rossi",
];

export function makeEngineers(seed: number, human: Record<string, string>): Record<string, Engineer> {
  const rng = new Rng(seed ^ 0x51ed27);
  const names = [...ENGINEER_NAMES];
  const out: Record<string, Engineer> = {};
  for (const t of TEAMS) {
    if (human[t.id] !== undefined) {
      out[t.id] = { name: human[t.id].trim() || "Você", quality: null };
      continue;
    }
    const i = Math.floor(rng.next() * names.length);
    const name = names.splice(i, 1)[0];
    // distribuição: maioria mediana, alguns muito bons/ruins
    const q = Math.max(0, Math.min(1, 0.5 + rng.gauss(0.28)));
    out[t.id] = { name, quality: Math.round(q * 100) / 100 };
  }
  return out;
}

export function engineerLabel(q: number | null): string {
  if (q === null) return "Humano";
  if (q > 0.8) return "Excelente";
  if (q > 0.6) return "Bom";
  if (q > 0.4) return "Mediano";
  if (q > 0.2) return "Fraco";
  return "Péssimo";
}
