// Campeonato: uma etapa em cada pista, pontos estilo F1.
import type { Engineer } from "./entrants";
import type { Race } from "./race";
import { CIRCUITS } from "./track";

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export interface RoundResult {
  trackIndex: number;
  /** ids dos pilotos na ordem de chegada (abandonos no fim) */
  order: string[];
  retired: string[];
  winnerTeam: string;
}

export interface ChampState {
  rounds: number[]; // índice das pistas, na ordem
  round: number; // etapa atual (0..)
  driverPts: Record<string, number>;
  teamPts: Record<string, number>;
  results: RoundResult[];
  /** engenheiros sorteados no início, valem pro campeonato todo */
  engineers: Record<string, Engineer> | null;
  finished: boolean;
}

export function newChampionship(): ChampState {
  return {
    rounds: CIRCUITS.map((_, i) => i),
    round: 0,
    driverPts: {},
    teamPts: {},
    results: [],
    engineers: null,
    finished: false,
  };
}

/** soma os pontos da corrida que terminou */
export function awardPoints(ch: ChampState, race: Race) {
  const order = race.ordered();
  order.forEach((c, i) => {
    const pts = c.retired ? 0 : (POINTS[i] ?? 0);
    ch.driverPts[c.id] = (ch.driverPts[c.id] ?? 0) + pts;
    ch.teamPts[c.team.id] = (ch.teamPts[c.team.id] ?? 0) + pts;
  });
  ch.results.push({
    trackIndex: race.opts.trackIndex,
    order: order.map((c) => c.id),
    retired: order.filter((c) => c.retired).map((c) => c.id),
    winnerTeam: order[0].team.id,
  });
  if (ch.results.length >= ch.rounds.length) ch.finished = true;
}

/** tabela ordenada (empate: quem tem mais vitórias, depois melhor resultado) */
export function standings(pts: Record<string, number>, ids: string[], results: RoundResult[], byTeam: (driverId: string) => string, team = false) {
  const wins = (id: string) => results.filter((r) => (team ? r.winnerTeam === id : r.order[0] === id)).length;
  const best = (id: string) =>
    Math.min(99, ...results.map((r) => (team ? r.order.findIndex((d) => byTeam(d) === id) : r.order.indexOf(id))).filter((x) => x >= 0));
  return ids
    .map((id) => ({ id, pts: pts[id] ?? 0, wins: wins(id), best: best(id) }))
    .sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.best - b.best);
}
