// Campeonato: uma etapa em cada pista, pontos estilo F1.
import type { Engineer } from "./entrants";
import { DEV_AREAS, DEV_MAX, NO_DEV, devCost, roundDevPoints, rollUpgrade, type DevArea, type DevLevels } from "./development";
import type { Race } from "./race";
import { TEAMS } from "./data";
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
  /** níveis de desenvolvimento de cada equipe */
  dev: Record<string, DevLevels>;
  /** pontos de desenvolvimento pra gastar */
  devPts: Record<string, number>;
  /** o que aconteceu nos investimentos desde a última corrida */
  devLog: Record<string, { area: DevArea; gain: number }[]>;
  /** saúde do motor de cada carro, que passa de uma etapa pra outra */
  engines: Record<string, number>;
  /** motores reservas de cada equipe */
  spares: Record<string, number>;
  /** posições de punição no grid da próxima corrida (motor novo sem reserva) */
  gridPen: Record<string, number>;
}

/** no campeonato o motor gasta menos por corrida (dura umas 6 etapas no ritmo normal) */
export const CHAMP_ENGINE_WEAR = 0.45;
/** posições perdidas por usar motor além das reservas */
export const ENGINE_GRID_PEN = 10;

/** reservas por equipe: 1 a cada 10 corridas (mínimo 1) */
export function champSpares(rounds: number): number {
  return Math.max(1, Math.round(rounds / 10));
}

/** troca o motor do carro: usa reserva ou toma punição no grid. Devolve "spare" ou "penalty" */
export function swapEngine(ch: ChampState, team: string, carId: string): "spare" | "penalty" {
  ch.engines[carId] = 1;
  if ((ch.spares[team] ?? 0) > 0) {
    ch.spares[team]--;
    return "spare";
  }
  ch.gridPen[carId] = ENGINE_GRID_PEN;
  return "penalty";
}

/** motor estourado troca na marra; IA troca motor muito gasto */
export function engineCheck(ch: ChampState, lineup: Record<string, string[]>, human: Set<string>) {
  for (const [team, cars] of Object.entries(lineup)) {
    for (const id of cars) {
      const h = ch.engines[id] ?? 1;
      if (h <= 0.02) swapEngine(ch, team, id);
      else if (!human.has(team) && ((h < 0.3 && (ch.spares[team] ?? 0) > 0) || h < 0.14)) swapEngine(ch, team, id);
    }
  }
}

/** quantas etapas tem um campeonato com essa porcentagem das pistas */
export function champRounds(pct: number): number {
  return Math.max(1, Math.round((CIRCUITS.length * pct) / 100));
}

/** campeonato com uma parte das pistas, sorteadas e em ordem aleatória */
export function newChampionship(pct = 100, rnd: () => number = Math.random): ChampState {
  const all = CIRCUITS.map((_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const n = champRounds(pct);
  return {
    rounds: all.slice(0, n),
    round: 0,
    driverPts: {},
    teamPts: {},
    results: [],
    engineers: null,
    finished: false,
    dev: {},
    devPts: {},
    devLog: {},
    engines: {},
    spares: Object.fromEntries(TEAMS.map((t) => [t.id, champSpares(n)])),
    gridPen: {},
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
  for (const c of race.cars) ch.engines[c.id] = c.retireReason === "Motor" ? 0 : c.engineHealth;
  ch.gridPen = {};
  ch.results.push({
    trackIndex: race.opts.trackIndex,
    order: order.map((c) => c.id),
    retired: order.filter((c) => c.retired).map((c) => c.id),
    winnerTeam: order[0].team.id,
  });
  if (ch.results.length >= ch.rounds.length) ch.finished = true;
  if (ch.finished) return;
  // pontos de desenvolvimento: quem está atrás no campeonato ganha mais
  ch.devLog = {};
  const teamIds = [...new Set(race.cars.map((c) => c.team.id))].sort((a, b) => (ch.teamPts[b] ?? 0) - (ch.teamPts[a] ?? 0));
  teamIds.forEach((id, rank) => (ch.devPts[id] = (ch.devPts[id] ?? 0) + roundDevPoints(rank, teamIds.length)));
}

export function devOf(ch: ChampState, team: string): DevLevels {
  return (ch.dev[team] ??= { ...NO_DEV });
}

/** investe numa área; devolve quanto subiu (0, 1, 2) ou null se não dava */
export function investDev(ch: ChampState, team: string, area: DevArea, quality: number | null, rnd: () => number): number | null {
  const lv = devOf(ch, team);
  if (lv[area] >= DEV_MAX) return null;
  const cost = devCost(lv[area]);
  if ((ch.devPts[team] ?? 0) < cost) return null;
  ch.devPts[team] -= cost;
  const gain = Math.min(DEV_MAX - lv[area], rollUpgrade(rnd, quality));
  lv[area] += gain;
  (ch.devLog[team] ??= []).push({ area, gain });
  return gain;
}

/** equipes da IA gastam tudo (engenheiro bom espalha melhor) */
export function aiDevelop(ch: ChampState, humanTeams: Set<string>, rnd: () => number) {
  for (const team of Object.keys(ch.devPts)) {
    if (humanTeams.has(team)) continue;
    const q = ch.engineers?.[team]?.quality ?? 0.5;
    for (let guard = 0; guard < 20; guard++) {
      const lv = devOf(ch, team);
      // bom engenheiro sobe a área mais atrasada; ruim escolhe meio no chute
      const areas = DEV_AREAS.map((a) => a.id).filter((a) => lv[a] < DEV_MAX && devCost(lv[a]) <= (ch.devPts[team] ?? 0));
      if (!areas.length) break;
      areas.sort((a, b) => lv[a] - lv[b]);
      const pick = rnd() < q ? areas[0] : areas[Math.floor(rnd() * areas.length)];
      investDev(ch, team, pick, q, rnd);
    }
  }
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
