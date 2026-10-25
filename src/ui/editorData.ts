// Editor: nomes de pistas e pilotos trocados pelo jogador (ficam só neste navegador/programa)
// e a voz de cada piloto no rádio. Aplicado por cima dos dados do jogo na hora de abrir.
import { CIRCUITS } from "../sim/track";
import { DRIVER_POOL, LEGEND_POOL, type DriverProfile } from "../sim/drivers";
import { storeGet, storeSet } from "./common";

const KEY = "pwm.editor";

/** vozes do rádio que existem gravadas (sufixo do arquivo em public/radio) */
export const RADIO_VOICES = [
  { id: "faber", label: "Faber", suffix: "" },
  { id: "jeff", label: "Jeff", suffix: "_b" },
  { id: "cadu", label: "Cadu", suffix: "_c" },
] as const;
export type VoiceId = (typeof RADIO_VOICES)[number]["id"];

export interface EditorData {
  tracks: Record<string, string>;
  drivers: Record<string, { name?: string; short?: string }>;
  voices: { p1: VoiceId; p2: VoiceId };
}

const empty = (): EditorData => ({ tracks: {}, drivers: {}, voices: { p1: "faber", p2: "jeff" } });

// nomes originais (pra restaurar e pra achar a história da pista pelo nome de verdade)
const origTrack = CIRCUITS.map((t) => t.name);
const origDriver = new Map<string, { name: string; short: string }>();
for (const d of [...DRIVER_POOL, ...LEGEND_POOL]) origDriver.set(d.id, { name: d.name, short: d.short });

export function originalTrackName(i: number): string {
  return origTrack[i] ?? "";
}
export function originalDriver(id: string) {
  return origDriver.get(id);
}

export function getEditor(): EditorData {
  try {
    const d = JSON.parse(storeGet(KEY) || "null") as Partial<EditorData> | null;
    const e = empty();
    if (!d) return e;
    return { tracks: d.tracks ?? {}, drivers: d.drivers ?? {}, voices: { ...e.voices, ...(d.voices ?? {}) } };
  } catch {
    return empty();
  }
}

/** limpa o que veio de fora (arquivo importado) */
function clean(d: Partial<EditorData>): EditorData {
  const txt = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[<>]/g, "").trim().slice(0, max) : "");
  const out = empty();
  for (const [k, v] of Object.entries(d.tracks ?? {})) if (CIRCUITS[Number(k)] && txt(v, 40)) out.tracks[k] = txt(v, 40);
  for (const [k, v] of Object.entries(d.drivers ?? {})) {
    if (!origDriver.has(k) || !v) continue;
    const name = txt(v.name, 30), short = txt(v.short, 3).toUpperCase();
    if (name || short) out.drivers[k] = { ...(name ? { name } : {}), ...(short ? { short } : {}) };
  }
  const ok = (x: unknown): x is VoiceId => RADIO_VOICES.some((r) => r.id === x);
  if (ok(d.voices?.p1)) out.voices.p1 = d.voices!.p1;
  if (ok(d.voices?.p2)) out.voices.p2 = d.voices!.p2;
  return out;
}

export function saveEditor(d: EditorData) {
  storeSet(KEY, JSON.stringify(clean(d)));
  applyEditor();
}

/** aplica os nomes por cima dos dados do jogo (chamado ao abrir e ao salvar) */
export function applyEditor() {
  const d = getEditor();
  CIRCUITS.forEach((t, i) => (t.name = d.tracks[String(i)] || origTrack[i]));
  const set = (p: DriverProfile) => {
    const o = origDriver.get(p.id)!;
    const e = d.drivers[p.id];
    p.name = e?.name || o.name;
    p.short = e?.short || o.short;
  };
  DRIVER_POOL.forEach(set);
  LEGEND_POOL.forEach(set);
}

/** sufixo do arquivo de voz do piloto 1 ou 2 */
export function voiceSuffix(slot: number): string {
  const v = getEditor().voices[slot === 1 ? "p2" : "p1"];
  return RADIO_VOICES.find((r) => r.id === v)?.suffix ?? (slot === 1 ? "_b" : "");
}

/** pacote de nomes pra exportar (compartilhar com amigos) */
export function exportEditor(): string {
  return JSON.stringify({ app: "pit-wall-manager-editor", v: 1, ...getEditor() }, null, 1);
}

export function importEditor(text: string): EditorData {
  const d = JSON.parse(text) as Partial<EditorData> & { app?: string };
  if (d?.app !== "pit-wall-manager-editor") throw new Error("Esse arquivo não é um pacote do Editor do Pit Wall Manager.");
  const c = clean(d);
  saveEditor(c);
  return c;
}
