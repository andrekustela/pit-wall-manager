// Campeonatos salvos (solo): vários, cada um com nome. Ficam no navegador e, com
// conta, também na nuvem (entra de outro computador e continua).
// Backup: a versão anterior de cada campeonato fica guardada (desfaz uma etapa), apagar
// manda pra lixeira (30 dias), um save estragado nunca é gravado por cima e dá pra
// exportar/importar tudo num arquivo.
import type { ChampSave } from "../net/room";
import { account } from "../net/account";
import { storeGet, storeSet } from "./common";

const KEY = "pwm.saves";
/** versão anterior de cada campeonato (antes da última gravação) */
const PREV = "pwm.saves.anterior";
/** apagados: { id: { s, at } } */
const TRASH = "pwm.saves.lixeira";
/** cópia inteira da última gravação boa (o primeiro lugar de onde recupera) */
const COPY = "pwm.saves.copia";
/** cópia do texto que não abriu (pra não perder de vez se der pra consertar) */
const BROKEN = "pwm.saves.estragado";
const TRASH_DAYS = 30;

export type SaveMap = Record<string, ChampSave>;
type TrashMap = Record<string, { s: ChampSave; at: number }>;

function parse<T>(k: string): T | null {
  const raw = storeGet(k);
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function read(): SaveMap {
  let m = parse<SaveMap>(KEY);
  if (!m) {
    // estragou: guarda o texto e abre a versão anterior (nunca grava uma lista vazia por cima)
    storeSet(BROKEN, storeGet(KEY));
    m = { ...(parse<SaveMap>(PREV) ?? {}), ...(parse<SaveMap>(COPY) ?? {}) };
    storeSet(KEY, JSON.stringify(m));
  }
  // save antigo (um campeonato só): entra na lista
  const old = storeGet("pwm.champ");
  if (old) {
    try {
      const s = JSON.parse(old) as ChampSave;
      if (s?.champ) {
        s.champ.id ??= "antigo";
        s.champ.name ??= "Meu campeonato";
        m[s.champ.id] ??= s;
      }
      storeSet("pwm.champ", "");
      storeSet(KEY, JSON.stringify(m));
    } catch {
      /* fica como está */
    }
  }
  return m;
}

/** grava; false = o navegador recusou (sem espaço): avisa em vez de perder em silêncio */
function write(m: SaveMap): boolean {
  let ok = true;
  try {
    const txt = JSON.stringify(m);
    localStorage.setItem(KEY, txt);
    localStorage.setItem(COPY, txt);
  } catch {
    ok = false;
    saveWarn?.("Não deu pra salvar o campeonato neste navegador (sem espaço). Exporte um backup no Modo solo.");
  }
  account.saveChamps(m); // na nuvem também (se tiver conta)
  return ok;
}

/** aviso quando a gravação falha (o menu liga num toast) */
export let saveWarn: ((msg: string) => void) | null = null;
export function onSaveWarn(f: (msg: string) => void) {
  saveWarn = f;
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
  // a versão que está saindo vira a "anterior" desse campeonato
  if (m[id] && (m[id].updated ?? 0) !== (s.updated ?? 0)) {
    const prev = parse<SaveMap>(PREV) ?? {};
    prev[id] = m[id];
    storeSet(PREV, JSON.stringify(prev));
  }
  m[id] = s;
  write(m);
}

export function deleteSave(id: string) {
  const m = read();
  if (m[id]) {
    const t = parse<TrashMap>(TRASH) ?? {};
    t[id] = { s: m[id], at: Date.now() };
    storeSet(TRASH, JSON.stringify(t));
  }
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

// ---------- backup ----------

/** versão anterior guardada de um campeonato (null = não tem) */
export function previousSave(id: string): ChampSave | null {
  return (parse<SaveMap>(PREV) ?? {})[id] ?? null;
}

/** volta o campeonato pra versão anterior (a atual vira a anterior: dá pra desfazer) */
export function restorePrevious(id: string): boolean {
  const prev = parse<SaveMap>(PREV) ?? {};
  const m = read();
  if (!prev[id]) return false;
  const cur = m[id];
  m[id] = prev[id];
  if (cur) prev[id] = cur;
  else delete prev[id];
  storeSet(PREV, JSON.stringify(prev));
  return write(m);
}

/** campeonatos na lixeira (os com mais de 30 dias somem) */
export function trashList(): { s: ChampSave; at: number }[] {
  const t = parse<TrashMap>(TRASH) ?? {};
  const limit = Date.now() - TRASH_DAYS * 864e5;
  let changed = false;
  for (const [id, e] of Object.entries(t))
    if (!e?.s?.champ || e.at < limit) {
      delete t[id];
      changed = true;
    }
  if (changed) storeSet(TRASH, JSON.stringify(t));
  return Object.values(t).sort((a, b) => b.at - a.at);
}

export function restoreFromTrash(id: string): boolean {
  const t = parse<TrashMap>(TRASH) ?? {};
  if (!t[id]) return false;
  const m = read();
  m[id] = t[id].s;
  delete t[id];
  storeSet(TRASH, JSON.stringify(t));
  return write(m);
}

/** arquivo de backup com todos os campeonatos (e a lixeira) */
export function exportBackup(): string {
  return JSON.stringify({ app: "pit-wall-manager", v: 1, at: new Date().toISOString(), saves: read(), lixeira: parse<TrashMap>(TRASH) ?? {} }, null, 1);
}

/** importa um arquivo de backup: junta com o que já tem (o mais novo de cada campeonato vence) */
export function importBackup(text: string): { added: number; updated: number } {
  const data = JSON.parse(text) as { app?: string; saves?: SaveMap };
  if (data?.app !== "pit-wall-manager" || !data.saves) throw new Error("Esse arquivo não é um backup do Pit Wall Manager.");
  const m = read();
  let added = 0, updated = 0;
  for (const [id, s] of Object.entries(data.saves)) {
    if (!s?.champ) continue;
    if (!m[id]) {
      m[id] = s;
      added++;
    } else if ((s.updated ?? 0) > (m[id].updated ?? 0)) {
      m[id] = s;
      updated++;
    }
  }
  write(m);
  return { added, updated };
}
