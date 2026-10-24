// Recordes de volta por pista mostrados no menu (embaixo do nome da pista e nos
// "carros" de luz do fundo). O jogador escolhe no perfil de quais modos contam
// (todos ou só online) e de quem (só os seus, amigos ou todo mundo).
import { account, type LapRec, type RankRow } from "../net/account";
import { storeGet, storeSet } from "./common";

export type RecMode = "todos" | "online";
export type RecScope = "meu" | "amigos" | "todos";
export interface RecPrefs {
  mode: RecMode;
  scope: RecScope;
}
export interface TrackRecord extends LapRec {
  who: string;
}

const PREFS_KEY = "pwm.recPrefs";
const LOCAL_KEY = "pwm.laps";

export function getRecPrefs(): RecPrefs {
  try {
    const p = JSON.parse(storeGet(PREFS_KEY) || "{}") as Partial<RecPrefs>;
    return { mode: p.mode === "online" ? "online" : "todos", scope: p.scope === "meu" || p.scope === "amigos" ? p.scope : "todos" };
  } catch {
    return { mode: "todos", scope: "todos" };
  }
}

export function setRecPrefs(p: RecPrefs) {
  storeSet(PREFS_KEY, JSON.stringify(p));
}

interface LocalLaps {
  all: Record<string, LapRec>;
  online: Record<string, LapRec>;
}

function readLocal(): LocalLaps {
  try {
    const x = JSON.parse(storeGet(LOCAL_KEY) || "{}") as Partial<LocalLaps>;
    return { all: x.all ?? {}, online: x.online ?? {} };
  } catch {
    return { all: {}, online: {} };
  }
}

/** guarda a melhor volta neste navegador (vale pra quem joga sem conta) */
export function saveLocalLap(track: number, time: number, driver: string, online: boolean) {
  if (!(time > 0)) return;
  const l = readLocal();
  const k = String(track);
  const rec = { time: Math.round(time * 1000) / 1000, driver, at: Date.now() };
  if (!l.all[k] || time < l.all[k].time) l.all[k] = rec;
  if (online && (!l.online[k] || time < l.online[k].time)) l.online[k] = rec;
  storeSet(LOCAL_KEY, JSON.stringify(l));
}

/** os meus recordes (da conta, ou do navegador se não tiver conta) */
function mine(mode: RecMode): Record<string, LapRec> {
  if (account.profile) return (mode === "online" ? account.profile.lapsOnline : account.profile.laps) ?? {};
  const l = readLocal();
  return mode === "online" ? l.online : l.all;
}

let rowsCache: RankRow[] | null = null;
let rowsAt = 0;

/** carrega o ranking (se precisar) e devolve quem é o top 3 de cada pista */
export async function loadRecords(): Promise<(track: number) => TrackRecord[]> {
  const p = getRecPrefs();
  const myName = account.profile?.name || storeGet("pwm.name") || "Você";
  const lapsOf = (r: RankRow) => (p.mode === "online" ? r.lapsOnline : r.laps) ?? {};
  let pool: { who: string; laps: Record<string, LapRec> }[] = [{ who: myName, laps: mine(p.mode) }];
  if (p.scope !== "meu" && account.profile) {
    try {
      if (!rowsCache || Date.now() - rowsAt > 60000) {
        rowsCache = (await account.ranking()) ?? [];
        rowsAt = Date.now();
      }
      const me = account.user?.uid;
      const friends = new Set(account.profile.friends ?? []);
      const others = rowsCache.filter((r) => r.id !== me && (p.scope === "todos" || friends.has(r.id)));
      pool = pool.concat(others.map((r) => ({ who: r.name, laps: lapsOf(r) })));
    } catch {
      /* sem internet: fica só com os meus */
    }
  }
  return (track) => {
    const k = String(track);
    return pool
      .map((x) => (x.laps[k] ? { ...x.laps[k], who: x.who } : null))
      .filter((x): x is TrackRecord => !!x && x.time > 0)
      .sort((a, b) => a.time - b.time)
      .slice(0, 3);
  };
}
