// Painel de estado do carro (estilo jogos de F1): o carro "vazado", visto de
// cima, com cada peça pintada conforme o estado, e embaixo a lista das peças
// (asas, suspensões, motor) com 4 estados e a opção de trocar na próxima parada.
import { ENGINE_LEVELS, ENGINE_SAVE, LEVELS, PARTS, engineLevel, partLevel, type PartId } from "../sim/parts";
import type { Race } from "../sim/race";
import type { CarState, Command } from "../sim/types";

/** desgaste aproximado de cada pneu (os da frente sofrem um pouco mais) */
const TYRE_LOAD = { fl: 1.06, fr: 1.0, rl: 0.95, rr: 0.9 };
const LEVEL_COLOR = ["#3bd16f", "#ffd23b", "#ff8a1c", "#ff3b3b"];
const OK = "#8a93a6";

export function statusSvg(): string {
  return `<svg class="carstatus" viewBox="0 0 64 132" aria-label="Estado do carro">
    <g fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path data-part="fw" d="M6 10 Q32 2 58 10 L58 16 Q32 10 6 16 Z" />
      <path data-part="fw" class="thin" d="M5 6 L5 18 M59 6 L59 18" />
      <rect data-part="fl" x="4" y="24" width="11" height="20" rx="3" />
      <rect data-part="fr" x="49" y="24" width="11" height="20" rx="3" />
      <path data-part="suspF" class="thin" d="M15 30 L27 28 M15 38 L27 40 M49 30 L37 28 M49 38 L37 40" />
      <path class="body" d="M28 12 Q32 9 36 12 L37 46 L27 46 Z" />
      <path class="body" d="M27 46 L37 46 L46 60 Q48 76 46 92 L40 104 L24 104 L18 92 Q16 76 18 60 Z" />
      <ellipse class="cockpit" cx="32" cy="60" rx="5" ry="8" />
      <circle class="helmet" cx="32" cy="60" r="3.2" />
      <path class="thin" d="M26 54 Q32 48 38 54 M32 48 L32 51" />
      <rect data-part="engine" x="25" y="70" width="14" height="30" rx="3" />
      <rect data-part="rl" x="2" y="94" width="13" height="23" rx="3" />
      <rect data-part="rr" x="49" y="94" width="13" height="23" rx="3" />
      <path data-part="suspR" class="thin" d="M15 100 L24 98 M15 110 L24 106 M49 100 L40 98 M49 110 L40 106" />
      <path data-part="rw" d="M16 118 L48 118 L48 126 L16 126 Z" />
      <path data-part="rw" class="thin" d="M16 116 L16 128 M48 116 L48 128" />
    </g>
    <rect x="29" y="74" width="6" height="22" rx="1.5" class="fuelbg" />
    <rect x="29" y="74" width="6" height="22" rx="1.5" class="fuel" data-fuel />
    <text data-t="fl" x="9.5" y="52" class="tlabel"></text>
    <text data-t="fr" x="54.5" y="52" class="tlabel"></text>
    <text data-t="rl" x="8.5" y="92" class="tlabel"></text>
    <text data-t="rr" x="55.5" y="92" class="tlabel"></text>
  </svg>`;
}

/** lista embaixo do desenho: peça · estado · trocar/poupar */
export function partsListHtml(): string {
  const rows = PARTS.map(
    (p) => `<label class="prow" data-row="${p.id}"><span class="pn">${p.label.replace("Suspensão", "Susp.")}</span>
      <span class="pchip" data-chip="${p.id}"></span>
      <input type="checkbox" data-fix="${p.id}" title="Trocar na próxima parada"></label>`,
  ).join("");
  return `<div class="partslist">${rows}
    <label class="prow" data-row="engine"><span class="pn">Motor</span><span class="pchip" data-chip="engine"></span>
      <input type="checkbox" data-save title="Poupar o motor"></label>
    <div class="phint">☐ trocar no box · motor: ☐ poupar</div></div>`;
}

/** liga as caixinhas aos comandos (uma vez) */
export function bindParts(root: Element, carId: string, send: (cmd: Command) => void) {
  root.querySelectorAll<HTMLInputElement>("[data-fix]").forEach((cb) =>
    cb.addEventListener("change", () => send({ type: "repair", carId, parts: { [cb.dataset.fix as PartId]: cb.checked } })),
  );
  root.querySelector<HTMLInputElement>("[data-save]")?.addEventListener("change", (e) =>
    send({ type: "engineSave", carId, on: (e.target as HTMLInputElement).checked }),
  );
}

function wearColor(w: number): string {
  const hue = Math.max(0, 120 * (1 - Math.min(1, w / 0.9)));
  return `hsl(${hue.toFixed(0)} 85% ${w > 0.85 ? 48 : 52}%)`;
}

function setPart(svg: Element, part: string, fill: string | null, stroke: string, title: string) {
  svg.querySelectorAll<SVGElement>(`[data-part="${part}"]`).forEach((el) => {
    if (!el.classList.contains("thin")) el.style.fill = fill ?? "transparent";
    el.style.stroke = stroke;
    let t = el.querySelector<SVGTitleElement>("title");
    if (!t) {
      t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      el.appendChild(t);
    }
    if (t.textContent !== title) t.textContent = title;
  });
}

function partTip(label: string, sec: number, repair: [number, number], fix: boolean): string {
  const lvl = partLevel(sec);
  if (lvl === 0) return `${label}: OK`;
  return `${label}: ${LEVELS[lvl].toLowerCase()} · perdendo ~${sec.toFixed(1)}s por volta · trocar no box leva ~${Math.round((repair[0] + repair[1]) / 2)}s${fix ? " (marcado pra trocar)" : " (NÃO vai trocar)"}`;
}

export function updateStatus(root: Element, c: CarState, race: Race) {
  const svg = root.querySelector(".carstatus");
  if (!svg) return;
  // pneus
  const cold = (c.tyreTemp ?? 0.6) < 0.5; // pneu frio fica azul
  for (const [k, load] of Object.entries(TYRE_LOAD)) {
    const w = Math.min(1.1, c.wear * load);
    const col = cold ? "#4aa3ff" : wearColor(w);
    setPart(svg, k, col, col, `Pneu ${Math.round((1 - Math.min(1, w)) * 100)}%${cold ? " (frio)" : ""}`);
    const t = svg.querySelector(`[data-t="${k}"]`);
    if (t) t.textContent = `${Math.round((1 - Math.min(1, w)) * 100)}`;
  }
  // asas e suspensões
  const blink = Math.floor(performance.now() / 400) % 2 === 0;
  const dmg = c.dmg;
  const bottoming = c.tuning.h < race.track.def.minHeight;
  for (const p of PARTS) {
    const sec = dmg?.[p.id] ?? 0;
    const lvl = partLevel(sec);
    const col = lvl === 0 ? (p.id.startsWith("susp") && bottoming ? "#ffb02e" : OK) : LEVEL_COLOR[lvl];
    const fill = lvl >= 2 ? (blink ? col : "transparent") : lvl === 1 ? "rgba(255,210,59,0.35)" : null;
    const tip = lvl === 0 && p.id.startsWith("susp") && bottoming ? `${p.label}: carro baixo demais, batendo no chão` : partTip(p.label, sec, p.repair, c.repair?.[p.id] ?? true);
    setPart(svg, p.id, fill, col, tip);
    // linha da lista
    const chip = root.querySelector<HTMLElement>(`[data-chip="${p.id}"]`);
    if (chip) {
      chip.textContent = LEVELS[lvl];
      chip.style.background = LEVEL_COLOR[lvl];
      chip.style.color = lvl === 0 ? "#08210f" : "#111";
    }
    const row = root.querySelector<HTMLElement>(`[data-row="${p.id}"]`);
    if (row && row.title !== tip) row.title = tip;
    const cb = root.querySelector<HTMLInputElement>(`[data-fix="${p.id}"]`);
    if (cb) {
      cb.disabled = lvl === 0;
      const want = c.repair?.[p.id] ?? true;
      if (document.activeElement !== cb && cb.checked !== want) cb.checked = want;
      cb.parentElement?.classList.toggle("dim", lvl === 0);
    }
  }
  // motor
  const h = c.engineHealth ?? 1;
  const el = engineLevel(h);
  const risk = h < 0.3 ? "ALTO" : h < 0.45 ? "médio" : "baixo";
  const engTip =
    `Motor ${Math.round(h * 100)}% (${ENGINE_LEVELS[el].toLowerCase()}) · risco de quebra: ${risk}` +
    (h < 0.6 ? ` · perdendo ~${(Math.max(0, 0.6 - h) * 1.2).toFixed(1)}s por volta` : "") +
    ` · poupar: +${ENGINE_SAVE.offset.toFixed(2)}s por volta e desgasta ${Math.round((1 - ENGINE_SAVE.wear) * 100)}% menos (não dá pra trocar o motor)`;
  setPart(svg, "engine", el >= 2 ? "rgba(255,59,59,0.25)" : null, LEVEL_COLOR[el], engTip);
  const echip = root.querySelector<HTMLElement>(`[data-chip="engine"]`);
  if (echip) {
    echip.textContent = `${ENGINE_LEVELS[el]} ${Math.round(h * 100)}%`;
    echip.style.background = LEVEL_COLOR[el];
    echip.style.color = "#111";
  }
  const erow = root.querySelector<HTMLElement>(`[data-row="engine"]`);
  if (erow && erow.title !== engTip) erow.title = engTip;
  const save = root.querySelector<HTMLInputElement>("[data-save]");
  if (save && document.activeElement !== save && save.checked !== !!c.engineSave) save.checked = !!c.engineSave;

  // combustível: barra enche de baixo pra cima, fica vermelha se não chega
  const fuelBar = svg.querySelector<SVGRectElement>("[data-fuel]");
  if (fuelBar) {
    const frac = Math.max(0, Math.min(1, c.fuel / 110));
    const hh = 22 * frac;
    fuelBar.setAttribute("y", String(74 + 22 - hh));
    fuelBar.setAttribute("height", String(hh));
    const laps = c.fuel / race.consumption(c);
    const short = !c.finished && laps < race.lapsLeft(c);
    fuelBar.style.fill = short ? (laps < 2 ? "#ff3b3b" : "#ffb02e") : "#3bd16f";
  }
  svg.classList.toggle("retired", c.retired);
}
