// Campeonato: uma etapa em cada pista, pontos estilo F1.
import type { Engineer } from "./entrants";
import { DEV_AREAS, DEV_MAX, NO_DEV, devCost, roundDevPoints, rollUpgrade, type DevArea, type DevLevels } from "./development";
import { CREW_DEFAULT, CREW_MAX, type Race } from "./race";
import { TEAMS } from "./data";
import { CIRCUITS } from "./track";

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export interface RoundResult {
  trackIndex: number;
  /** ids dos pilotos na ordem de chegada (abandonos no fim) */
  order: string[];
  retired: string[];
  winnerTeam: string;
  /** quem largou na pole */
  pole?: string;
  /** volta mais rápida (piloto e tempo) */
  fastest?: { carId: string; time: number } | null;
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
  /** nível da equipe de mecânicos (0..5) de cada equipe */
  crew: Record<string, number>;
  /** nome que o jogador deu pro campeonato e um id pra achar o save */
  name?: string;
  id?: string;
  /** carreira: temporada atual (1, 2, ...) e o resumo das que já acabaram */
  season?: number;
  past?: SeasonSummary[];
  /** temporadas de contrato que faltam pra cada piloto (0 = acaba agora) */
  contracts?: Record<string, number>;
  /** pilotos livres no mercado (fim de temporada) */
  market?: string[];
}

export interface SeasonSummary {
  season: number;
  champion: string; // piloto campeão
  championTeam: string;
  /** equipes na ordem final */
  teamOrder: string[];
  teamPts: Record<string, number>;
  rounds: number;
}

/** custos do mercado (pontos de desenvolvimento) */
export const RENEW_COST = 2;
export const SIGN_COST = 3;

/** contratos iniciais: 1 a 3 temporadas pra cada piloto */
export function initContracts(ch: ChampState, lineup: Record<string, string[]>, rnd: () => number) {
  ch.contracts ??= {};
  for (const cars of Object.values(lineup)) for (const id of cars) ch.contracts[id] ??= 1 + Math.floor(rnd() * 3);
}

/** abre o mercado no fim da temporada: pilotos livres (fora das equipes) */
export function openMarket(ch: ChampState, lineup: Record<string, string[]>, pool: string[], rnd: () => number) {
  const used = new Set(Object.values(lineup).flat());
  const free = pool.filter((id) => !used.has(id)).sort(() => rnd() - 0.5);
  ch.market = free.slice(0, 6);
}

/** renova o contrato do piloto por mais 2 temporadas */
export function renewDriver(ch: ChampState, team: string, id: string): boolean {
  if ((ch.devPts[team] ?? 0) < RENEW_COST) return false;
  ch.devPts[team] -= RENEW_COST;
  ch.contracts ??= {};
  ch.contracts[id] = (ch.contracts[id] ?? 0) + 2;
  return true;
}

/** contrata um piloto livre no lugar de outro da equipe; devolve a escalação nova */
export function signDriver(ch: ChampState, lineup: Record<string, [string, string]>, team: string, outId: string, inId: string): Record<string, [string, string]> | null {
  const pair = lineup[team];
  if (!pair || !pair.includes(outId) || !ch.market?.includes(inId) || (ch.devPts[team] ?? 0) < SIGN_COST) return null;
  ch.devPts[team] -= SIGN_COST;
  const np = [...pair] as [string, string];
  np[np.indexOf(outId)] = inId;
  ch.market = ch.market.filter((x) => x !== inId).concat(outId); // quem saiu vai pro mercado
  ch.contracts ??= {};
  ch.contracts[inId] = 2;
  delete ch.contracts[outId];
  return { ...lineup, [team]: np };
}

/**
 * Nova temporada: guarda o resumo, sorteia as pistas de novo, zera os pontos,
 * o carro fica com metade da evolução (regulamento novo), motores e reservas
 * renovam, mecânicos ficam. Contratos andam: a IA renova ou troca quem acabou;
 * o jogador que não mexeu tem o piloto renovado por 1 temporada.
 */
export function startNewSeason(
  ch: ChampState,
  lineup: Record<string, [string, string]>,
  humanTeams: Set<string>,
  pool: string[],
  rnd: () => number,
): Record<string, [string, string]> {
  const allIds = Object.values(lineup).flat();
  const byTeam = (d: string) => Object.entries(lineup).find(([, c]) => c.includes(d))?.[0] ?? "";
  const drivers = standings(ch.driverPts, allIds, ch.results, byTeam);
  const teams = standings(ch.teamPts, Object.keys(lineup), ch.results, byTeam, true);
  (ch.past ??= []).push({
    season: ch.season ?? 1,
    champion: drivers[0]?.id ?? "",
    championTeam: teams[0]?.id ?? "",
    teamOrder: teams.map((t) => t.id),
    teamPts: { ...ch.teamPts },
    rounds: ch.rounds.length,
  });
  ch.season = (ch.season ?? 1) + 1;
  // pistas novas (mesma quantidade de etapas)
  const all = CIRCUITS.map((_, i) => i).sort(() => rnd() - 0.5);
  ch.rounds = all.slice(0, ch.rounds.length);
  ch.round = 0;
  ch.driverPts = {};
  ch.teamPts = {};
  ch.results = [];
  ch.finished = false;
  ch.devLog = {};
  ch.engines = {};
  ch.gridPen = {};
  ch.spares = Object.fromEntries(TEAMS.map((t) => [t.id, champSpares(ch.rounds.length)]));
  // regulamento novo: o carro perde metade da evolução
  for (const lv of Object.values(ch.dev)) for (const a of DEV_AREAS) lv[a.id] = Math.floor(lv[a.id] / 2);
  // pontos de desenvolvimento pra começar: quem ficou atrás ganha mais
  teams.forEach((t, rank) => (ch.devPts[t.id] = (ch.devPts[t.id] ?? 0) + 3 + Math.round((rank / Math.max(1, teams.length - 1)) * 4)));
  // contratos
  ch.contracts ??= {};
  let lu = { ...lineup };
  const used = new Set(allIds);
  const free = pool.filter((id) => !used.has(id)).sort(() => rnd() - 0.5);
  for (const [team, pair] of Object.entries(lu)) {
    const np = [...pair] as [string, string];
    np.forEach((id, i) => {
      const left = (ch.contracts![id] ?? 1) - 1;
      if (left > 0) {
        ch.contracts![id] = left;
        return;
      }
      if (humanTeams.has(team) || rnd() < 0.6 || !free.length) {
        ch.contracts![id] = humanTeams.has(team) ? 1 : 1 + Math.floor(rnd() * 2); // renovou
        return;
      }
      // IA trocou de piloto
      const nw = free.shift()!;
      free.push(id);
      delete ch.contracts![id];
      ch.contracts![nw] = 1 + Math.floor(rnd() * 3);
      np[i] = nw;
    });
    lu = { ...lu, [team]: np };
  }
  ch.market = [];
  return lu;
}

/** custo (pontos de desenvolvimento) de subir os mecânicos do nível atual pro próximo */
export function crewCost(level: number): number {
  return 2 + level;
}

/** treina a equipe de mecânicos (sobe 1 nível); false se não dava */
export function upgradeCrew(ch: ChampState, team: string): boolean {
  ch.crew ??= {};
  const lv = ch.crew[team] ?? CREW_DEFAULT;
  const cost = crewCost(lv);
  if (lv >= CREW_MAX || (ch.devPts[team] ?? 0) < cost) return false;
  ch.devPts[team] -= cost;
  ch.crew[team] = lv + 1;
  return true;
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
    crew: Object.fromEntries(TEAMS.map((t) => [t.id, CREW_DEFAULT])),
    id: Math.random().toString(36).slice(2, 10),
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
    pole: race.opts.grid?.[0],
    fastest: race.fastestLap,
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

/** revisão do motor entre as etapas: custa pontos de desenvolvimento e devolve saúde */
export const ENGINE_REPAIR_COST = 2;
export const ENGINE_REPAIR_GAIN = 0.25;

/** revisa o motor do carro; devolve false se não dava (sem pontos ou motor já inteiro) */
export function repairEngine(ch: ChampState, team: string, carId: string): boolean {
  const h = ch.engines[carId] ?? 1;
  if (h >= 0.999 || h <= 0.02 || (ch.devPts[team] ?? 0) < ENGINE_REPAIR_COST) return false;
  ch.devPts[team] -= ENGINE_REPAIR_COST;
  ch.engines[carId] = Math.min(1, h + ENGINE_REPAIR_GAIN);
  return true;
}

/** equipes da IA gastam tudo (engenheiro bom espalha melhor); motor muito gasto é revisado antes */
export function aiDevelop(ch: ChampState, humanTeams: Set<string>, rnd: () => number, lineup?: Record<string, string[]>) {
  for (const team of Object.keys(ch.devPts)) {
    if (humanTeams.has(team)) continue;
    const q = ch.engineers?.[team]?.quality ?? 0.5;
    for (const id of lineup?.[team] ?? []) {
      // engenheiro bom cuida do motor mais cedo
      while ((ch.engines[id] ?? 1) < 0.35 + q * 0.2 && repairEngine(ch, team, id));
    }
    // engenheiro bom também investe nos mecânicos (às vezes)
    if ((ch.crew?.[team] ?? CREW_DEFAULT) < 1 + Math.round(q * 4) && rnd() < 0.35 + q * 0.4) upgradeCrew(ch, team);
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
