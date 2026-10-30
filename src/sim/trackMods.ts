// Pistas do editor de traçado, guardadas neste navegador:
// - edições das pistas do jogo (pwm.tracado): pontos novos e traçado ideal, por nome original;
// - pistas novas, "não oficiais" (pwm.pistas): entram no fim da lista de pistas (só no modo solo:
//   o servidor do online não tem elas).
// track.ts aplica tudo quando carrega. Sem DOM: o worker do traçado e os scripts também importam.

export interface TrackEdit {
  points: [number, number][];
  targetLength: number;
  /** traçado ideal calculado no editor (m até o meio, a cada 10 m); sem: os carros vão pelo meio */
  line?: number[];
}
export interface ModTrack extends TrackEdit {
  id: string;
  name: string;
  blurb: string;
  street?: boolean;
  night?: boolean;
  minHeight: number;
  balance: number;
  rainChance: number;
  grass: [string, string];
  overtake?: number;
  /** quem fez (vai no pacote exportado) */
  author?: string;
}

const KE = "pwm.tracado", KM = "pwm.pistas";
const ls = () => (typeof localStorage !== "undefined" ? localStorage : null);

export function loadEdits(): Record<string, TrackEdit> {
  try {
    return JSON.parse(ls()?.getItem(KE) ?? "{}");
  } catch {
    return {};
  }
}
export function loadMods(): ModTrack[] {
  try {
    return JSON.parse(ls()?.getItem(KM) ?? "[]");
  } catch {
    return [];
  }
}
export function saveEdit(name: string, e: TrackEdit | null) {
  const all = loadEdits();
  if (e) all[name] = e;
  else delete all[name];
  ls()?.setItem(KE, JSON.stringify(all));
}
export function saveMod(m: ModTrack | null, removeId?: string) {
  let all = loadMods().filter((x) => x.id !== (m?.id ?? removeId));
  if (m) all = [...all, m];
  ls()?.setItem(KM, JSON.stringify(all));
}
