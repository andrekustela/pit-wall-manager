// Aba ESTRATÉGIA do card: regras prontas que o jogador liga/desliga (algumas com um número). O piloto executa
// sozinho quando a condição acontece (manda os mesmos comandos dos botões) e avisa no feed. Fica no navegador,
// por carro da equipe (1º e 2º card), e vale pra próxima corrida também.
import type { Race } from "../sim/race";
import type { CarState, Command, Compound, PlannedStop } from "../sim/types";
import { storeGet, storeSet } from "./common";

export interface StratRule {
  id: string;
  /** texto da regra (v = o número ajustável) */
  text: (v: number) => string;
  /** versão curta (painel COMPACTO) */
  short: (v: number) => string;
  param?: { min: number; max: number; step: number; def: number };
}

export const STRAT_RULES: StratRule[] = [
  { id: "final", short: (v) => `Últimas <b>${v}</b> V → ataque`, text: (v) => `Ataque final: últimas <b>${v}</b> voltas → Atacar + Rica`, param: { min: 1, max: 10, step: 1, def: 3 } },
  { id: "pneu", short: (v) => `Pneu < <b>${v}%</b> → Poupar`, text: (v) => `Pneu abaixo de <b>${v}%</b> → Poupar`, param: { min: 10, max: 60, step: 5, def: 30 } },
  { id: "comb", short: () => `Comb. curto → Pobre`, text: () => `Combustível não chega → Mistura pobre` },
  { id: "def", short: () => `Atrás < 0,5 s → DEF`, text: () => `Carro atrás a menos de 0,5 s → DEFENDER` },
  { id: "atk", short: () => `Frente < 0,5 s → ATK`, text: () => `Carro na frente a menos de 0,5 s → ATACAR` },
  { id: "chuva", short: () => `Molhou → box INTER`, text: () => `Pista molhando no pneu seco → box pro intermediário` },
  { id: "sc", short: (v) => `SC + parada ≤ <b>${v}</b> V → box`, text: (v) => `Safety car com parada a até <b>${v}</b> voltas → box`, param: { min: 1, max: 10, step: 1, def: 3 } },
];

export type StratState = Record<string, { on: boolean; v: number; fired?: boolean }>;

const KEY = "pwm.estrategias";

/** as regras do carro (slot = 1º ou 2º card), com o que o jogador deixou da última vez */
export function loadStrat(slot: number): StratState {
  let saved: Record<string, StratState> = {};
  try {
    saved = JSON.parse(storeGet(KEY) || "{}");
  } catch {
    /* sem nada salvo */
  }
  const s = saved[slot] ?? {};
  const out: StratState = {};
  for (const r of STRAT_RULES) {
    const v = Number(s[r.id]?.v);
    out[r.id] = { on: !!s[r.id]?.on, v: r.param ? (Number.isFinite(v) ? Math.max(r.param.min, Math.min(r.param.max, v)) : r.param.def) : 0 };
  }
  return out;
}

export function saveStrat(slot: number, st: StratState) {
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(storeGet(KEY) || "{}");
  } catch {
    /* recomeça */
  }
  saved[slot] = Object.fromEntries(Object.entries(st).map(([k, x]) => [k, { on: x.on, v: x.v }]));
  storeSet(KEY, JSON.stringify(saved));
}

/** a lista da aba (os botões usam data-st-on / data-st-v) */
export function stratHtml(): string {
  return STRAT_RULES.map(
    (r) =>
      `<div class="srow" data-sr="${r.id}"><button class="sw" data-st-on="${r.id}" title="Liga/desliga"></button><span class="st"></span><span class="ss"></span>${
        r.param ? `<span class="stp"><button data-st-v="${r.id}" data-d="-1">−</button><button data-st-v="${r.id}" data-d="1">+</button></span>` : ""
      }</div>`,
  ).join("");
}

/** o que muda na corrida agora: devolve os comandos e um aviso pro feed (regra disparada) */
export interface StratCtx {
  race: Race;
  c: CarState;
  /** distância (s) pro da frente / pro de trás (99 = ninguém perto) */
  ga: number;
  gb: number;
  /** combustível falta pra chegar (até a parada ou o fim) */
  fuelShort: boolean;
  /** combustível (kg) pra colocar numa parada agora */
  fuelFor: number;
  nextStop: PlannedStop | null;
}

export function runStrat(st: StratState, x: StratCtx): { cmds: Command[]; note: string[] } {
  const { race, c } = x;
  const cmds: Command[] = [], note: string[] = [];
  const racing = race.phase === "racing" && !c.finished && !c.retired && c.pit === "none";
  // cada regra dispara uma vez e rearma quando a condição some
  const rule = (id: string, cond: boolean, rearm: boolean, act: () => void) => {
    const r = st[id];
    if (!r?.on) return;
    if (r.fired) {
      if (rearm) r.fired = false;
      return;
    }
    if (cond) {
      r.fired = true;
      act();
    }
  };
  const id = c.id, rubber = (1 - Math.min(1, c.wear)) * 100;
  const dry = c.compound === "S" || c.compound === "M" || c.compound === "H";
  rule("final", racing && !race.sc.active && race.lapsLeft(c) <= (st.final?.v ?? 3), false, () => {
    if (!c.engineSave) cmds.push({ type: "pace", carId: id, mode: "push" }, { type: "engine", carId: id, mode: "rich" });
    note.push("ataque final: Atacar + Rica");
  });
  rule("pneu", racing && rubber < (st.pneu?.v ?? 30) && c.pace !== "conserve", rubber >= (st.pneu?.v ?? 30), () => {
    cmds.push({ type: "pace", carId: id, mode: "conserve" });
    note.push("pneu gasto: Poupar");
  });
  rule("comb", racing && x.fuelShort && c.engine !== "lean", !x.fuelShort, () => {
    cmds.push({ type: "engine", carId: id, mode: "lean" });
    note.push("combustível curto: mistura pobre");
  });
  rule("def", racing && !race.sc.active && x.gb < 0.5 && !c.fight, x.gb > 1 && !c.fight, () => {
    cmds.push({ type: "fight", carId: id, mode: "def" });
    note.push("carro colado atrás: DEFENDER");
  });
  rule("atk", racing && !race.sc.active && x.ga < 0.5 && c.wear < 0.6 && !c.fight, x.ga > 1 && !c.fight, () => {
    cmds.push({ type: "fight", carId: id, mode: "atk" });
    note.push("colado no da frente: ATACAR");
  });
  rule("chuva", racing && dry && (race.wet > 0.3 || race.rain > 0.3) && !c.boxRequest, race.wet < 0.1 && race.rain === 0, () => {
    cmds.push({ type: "box", carId: id, compound: "I" as Compound, fuel: x.fuelFor });
    note.push("pista molhando: box pro intermediário");
  });
  const due = x.nextStop ? x.nextStop.lap - c.lap : 99;
  rule("sc", racing && race.sc.active && race.sc.onTrack && due <= (st.sc?.v ?? 3) && !c.boxRequest, !race.sc.active, () => {
    cmds.push({ type: "box", carId: id, compound: x.nextStop!.compound, fuel: x.nextStop!.fuel });
    note.push("safety car: box agora (parada adiantada)");
  });
  return { cmds, note };
}
