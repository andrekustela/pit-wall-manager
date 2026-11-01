// Pacote de pista (formato "pit-wall-pista": traçado + traçado ideal + autódromo 3D): baixar uma pista e
// instalar mods. Usado pelo Editor (lista de pistas) e pelo editor de traçado.
import { CIRCUITS, applyTrackMods } from "../sim/track";
import { RACING_LINES } from "../sim/racingLines";
import { saveMod, type ModTrack } from "../sim/trackMods";
import { slugOf } from "../sim/walls";
import { toast } from "./common";

export interface TrackPack {
  formato: "pit-wall-pista";
  versao: number;
  naoOficial: boolean;
  usoNaoComercial: boolean;
  pista: ModTrack;
  autodromo: string | null;
}

/** o pacote de uma pista da lista (como ela está agora, com a edição deste navegador) */
export function packOf(i: number): TrackPack {
  const c = CIRCUITS[i];
  let autodromo: string | null = null;
  try {
    autodromo = localStorage.getItem(`pwm.autodromo.${slugOf(c.name)}`);
  } catch {
    /* sem */
  }
  const pista: ModTrack = {
    id: Date.now().toString(36),
    name: c.name,
    blurb: c.blurb,
    points: c.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
    targetLength: Math.round(c.targetLength),
    line: RACING_LINES[c.lineKey ?? c.name]?.o,
    minHeight: c.minHeight,
    balance: c.balance,
    rainChance: c.rainChance,
    grass: c.grass,
    street: c.street,
    night: c.night,
    overtake: c.overtake,
  };
  return { formato: "pit-wall-pista", versao: 1, naoOficial: true, usoNaoComercial: true, pista, autodromo };
}

/** baixa o pacote da pista (um .json) */
export function downloadPack(i: number) {
  const pkg = packOf(i);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: "application/json" }));
  a.download = `pista-${slugOf(pkg.pista.name)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Pista baixada (traçado + autódromo 3D, se tiver)");
}

/** instala um pacote de pista como mod (só no solo); devolve o nome com que ela ficou */
export function installPack(txt: string): string {
  const pkg = JSON.parse(txt) as Partial<TrackPack>;
  if (pkg.formato !== "pit-wall-pista" || !pkg.pista?.points?.length) throw new Error("Esse arquivo não é um pacote de pista do Pit Wall Manager.");
  const m: ModTrack = { ...pkg.pista, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) };
  // (nome repetido ganha um número)
  const names = new Set(CIRCUITS.map((c) => c.name));
  let nm = m.name || "Pista instalada", k = 2;
  while (names.has(nm)) nm = `${m.name} ${k++}`;
  m.name = nm;
  saveMod(m);
  if (pkg.autodromo)
    try {
      localStorage.setItem(`pwm.autodromo.${slugOf(nm)}`, pkg.autodromo);
    } catch {
      toast("O autódromo 3D da pista não coube no navegador");
    }
  applyTrackMods();
  return nm;
}
