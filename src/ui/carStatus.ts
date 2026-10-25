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
  // F1 atual visto de cima (frente pra cima): asa dianteira larga e curva, bico fino, halo,
  // sidepods largos afinando até a traseira (garrafa de coca), assoalho, barbatana, beam wing
  return `<svg class="carstatus" viewBox="0 0 64 132" aria-label="Estado do carro">
    <g fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path data-part="fw" d="M5 13 Q18 8 32 9.5 Q46 8 59 13 L59 17.5 Q46 13.5 32 14.5 Q18 13.5 5 17.5 Z" />
      <path data-part="fw" class="thin" d="M4 8 L4 20 M60 8 L60 20 M8 19.5 Q32 15.5 56 19.5" />
      <path class="body" d="M30 8 Q32 4.5 34 8 L36.5 40 L27.5 40 Z" />
      <rect data-part="fl" x="4" y="24" width="12" height="19" rx="3.5" />
      <rect data-part="fr" x="48" y="24" width="12" height="19" rx="3.5" />
      <path class="thin rim" d="M7 33.5 L13 33.5 M51 33.5 L57 33.5" />
      <path data-part="suspF" class="thin" d="M16 29.5 L28.5 26.5 M16 37 L28.5 39 M16 33 L28 33 M48 29.5 L35.5 26.5 M48 37 L35.5 39 M48 33 L36 33" />
      <path class="floor" d="M12 58 L12 96 Q12 100 16 101 L48 101 Q52 100 52 96 L52 58 Z" />
      <path class="body" d="M27.5 40 L36.5 40 L38 49 Q49 50 50.5 60 L50 74 Q47 88 40.5 98 L23.5 98 Q17 88 14 74 L13.5 60 Q15 50 26 49 Z" />
      <path class="thin" d="M14.5 57 L21 54 M49.5 57 L43 54 M17 66 L22 68 M47 66 L42 68" />
      <ellipse class="cockpit" cx="32" cy="53" rx="4.5" ry="7.5" />
      <circle class="helmet" cx="32" cy="53.5" r="3" />
      <path class="thin halo" d="M26.8 54 Q26.8 44.5 32 44.5 Q37.2 44.5 37.2 54 M32 44.5 L32 41" />
      <rect data-part="engine" x="26" y="64" width="12" height="34" rx="3" />
      <path class="thin" d="M32 62 L32 106" />
      <path class="body" d="M28.5 98 L35.5 98 L34.5 112 L29.5 112 Z" />
      <rect data-part="rl" x="2" y="96" width="14" height="22" rx="3.5" />
      <rect data-part="rr" x="48" y="96" width="14" height="22" rx="3.5" />
      <path class="thin rim" d="M5 107 L13 107 M51 107 L59 107" />
      <path data-part="suspR" class="thin" d="M16 101 L27 99 M16 111 L28 107 M48 101 L37 99 M48 111 L36 107" />
      <path data-part="rw" class="thin" d="M20 114.5 L44 114.5" />
      <path data-part="rw" d="M14 118.5 Q32 115.5 50 118.5 L50 125 Q32 122 14 125 Z" />
      <path data-part="rw" class="thin" d="M13 115 L13 128 M51 115 L51 128" />
    </g>
    <rect x="29" y="72" width="6" height="22" rx="1.5" class="fuelbg" />
    <rect x="29" y="72" width="6" height="22" rx="1.5" class="fuel" data-fuel />
    <text data-t="fl" x="9.5" y="52" class="tlabel"></text>
    <text data-t="fr" x="54.5" y="52" class="tlabel"></text>
    <text data-t="rl" x="9" y="93.5" class="tlabel"></text>
    <text data-t="rr" x="55" y="93.5" class="tlabel"></text>
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
  const flat = c.fault === "puncture" ? (["fl", "fr", "rl", "rr"][c.flatWheel ?? -1] ?? "") : "";
  for (const [k, load] of Object.entries(TYRE_LOAD)) {
    const w = Math.min(1.1, c.wear * load);
    if (k === flat) {
      // pneu furado: pisca em vermelho
      const on = Math.floor(performance.now() / 300) % 2 === 0;
      setPart(svg, k, on ? "#ff3b3b" : "transparent", "#ff3b3b", "Pneu FURADO: troca no box (qualquer pneu)");
      const t = svg.querySelector(`[data-t="${k}"]`);
      if (t) t.textContent = "FURO";
      continue;
    }
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
    const tip = lvl === 0 && p.id.startsWith("susp") && bottoming ? `${p.label}: carro baixo demais, batendo no chão` : partTip(p.label, race.partLossSec(p.id, sec), p.repair, c.repair?.[p.id] ?? true);
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
    fuelBar.setAttribute("y", String(72 + 22 - hh));
    fuelBar.setAttribute("height", String(hh));
    const laps = c.fuel / race.consumption(c);
    const short = !c.finished && laps < race.lapsLeft(c);
    fuelBar.style.fill = short ? (laps < 2 ? "#ff3b3b" : "#ffb02e") : "#3bd16f";
  }
  svg.classList.toggle("retired", c.retired);
}
