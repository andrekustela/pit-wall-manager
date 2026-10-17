// Campeonatos salvos (solo): vários, cada um com nome. Ficam no navegador e, com
// conta, também na nuvem (entra de outro computador e continua).
import type { ChampSave } from "../net/room";
import { account } from "../net/account";
import { storeGet, storeSet } from "./common";

const KEY = "pwm.saves";

export type SaveMap = Record<string, ChampSave>;

function read(): SaveMap {
  try {
    const m = JSON.parse(storeGet(KEY) || "{}") as SaveMap;
    // save antigo (um campeonato só): entra na lista
    const old = storeGet("pwm.champ");
    if (old) {
      const s = JSON.parse(old) as ChampSave;
      if (s?.champ) {
        s.champ.id ??= "antigo";
        s.champ.name ??= "Meu campeonato";
        m[s.champ.id] ??= s;
      }
      storeSet("pwm.champ", "");
      storeSet(KEY, JSON.stringify(m));
    }
    return m;
  } catch {
    return {};
  }
}

function write(m: SaveMap) {
  storeSet(KEY, JSON.stringify(m));
  account.saveChamps(m); // na nuvem também (se tiver conta)
}

/** campeonatos salvos, do mais recente pro mais antigo */
export function listSaves(): ChampSave[] {
  return Object.values(read())
    .filter((s) => s?.champ)
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}

export function putSave(s: ChampSave) {
  const m = read();
  const id = (s.champ.id ??= Math.random().toString(36).slice(2, 10));
  m[id] = s;
  write(m);
}

export function deleteSave(id: string) {
  const m = read();
  delete m[id];
  write(m);
}

export function renameSave(id: string, name: string) {
  const m = read();
  if (!m[id]) return;
  m[id].champ.name = name.trim().slice(0, 40) || m[id].champ.name;
  write(m);
}

/** junta os campeonatos da nuvem com os do navegador (o mais novo de cada vence) */
export function mergeCloudSaves(cloud: SaveMap | null | undefined) {
  if (!cloud) return;
  const m = read();
  for (const [id, s] of Object.entries(cloud)) if (s?.champ && (s.updated ?? 0) >= (m[id]?.updated ?? 0)) m[id] = s;
  storeSet(KEY, JSON.stringify(m));
}
