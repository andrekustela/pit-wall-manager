// Painel de estado do carro (estilo jogos de F1): o carro "vazado", visto de
// cima, com cada peça pintada conforme o estado. Frente pra cima.
import type { Race } from "../sim/race";
import type { CarState } from "../sim/types";

/** desgaste aproximado de cada pneu (os da frente sofrem um pouco mais) */
const TYRE_LOAD = { fl: 1.06, fr: 1.0, rl: 0.95, rr: 0.9 };

export function statusSvg(): string {
  return `<svg class="carstatus" viewBox="0 0 64 132" aria-label="Estado do carro">
    <g fill="none" stroke-linejoin="round" stroke-linecap="round">
      <!-- asa dianteira -->
      <path data-part="fw" d="M6 10 Q32 2 58 10 L58 16 Q32 10 6 16 Z" />
      <path data-part="fw" d="M5 6 L5 18 M59 6 L59 18" class="thin" />
      <!-- pneus dianteiros -->
      <rect data-part="fl" x="4" y="24" width="11" height="20" rx="3" />
      <rect data-part="fr" x="49" y="24" width="11" height="20" rx="3" />
      <!-- suspensão dianteira -->
      <path data-part="susp" class="thin" d="M15 30 L27 28 M15 38 L27 40 M49 30 L37 28 M49 38 L37 40" />
      <!-- bico -->
      <path class="body" d="M28 12 Q32 9 36 12 L37 46 L27 46 Z" />
      <!-- cockpit, capacete e halo -->
      <path class="body" d="M27 46 L37 46 L46 60 Q48 76 46 92 L40 104 L24 104 L18 92 Q16 76 18 60 Z" />
      <ellipse class="cockpit" cx="32" cy="60" rx="5" ry="8" />
      <circle class="helmet" cx="32" cy="60" r="3.2" />
      <path class="thin" d="M26 54 Q32 48 38 54 M32 48 L32 51" />
      <!-- motor / combustível (centro) -->
      <path data-part="engine" class="thin" d="M32 70 L32 100" />
      <!-- pneus traseiros -->
      <rect data-part="rl" x="2" y="94" width="13" height="23" rx="3" />
      <rect data-part="rr" x="49" y="94" width="13" height="23" rx="3" />
      <!-- suspensão traseira -->
      <path data-part="susp" class="thin" d="M15 100 L24 98 M15 110 L24 106 M49 100 L40 98 M49 110 L40 106" />
      <!-- asa traseira -->
      <path data-part="rw" d="M16 118 L48 118 L48 126 L16 126 Z" />
      <path data-part="rw" class="thin" d="M16 116 L16 128 M48 116 L48 128" />
    </g>
    <!-- combustível: barra no centro do carro -->
    <rect x="29" y="72" width="6" height="26" rx="1.5" class="fuelbg" />
    <rect x="29" y="72" width="6" height="26" rx="1.5" class="fuel" data-fuel />
    <text data-t="fl" x="9.5" y="52" class="tlabel"></text>
    <text data-t="fr" x="54.5" y="52" class="tlabel"></text>
    <text data-t="rl" x="8.5" y="92" class="tlabel"></text>
    <text data-t="rr" x="55.5" y="92" class="tlabel"></text>
  </svg>`;
}

/** verde (novo) → amarelo → laranja → vermelho (acabando) */
function wearColor(w: number): string {
  const hue = Math.max(0, 120 * (1 - Math.min(1, w / 0.9)));
  return `hsl(${hue.toFixed(0)} 85% ${w > 0.85 ? 48 : 52}%)`;
}

function setPart(svg: Element, part: string, fill: string | null, stroke: string, title: string) {
  svg.querySelectorAll<SVGElement>(`[data-part="${part}"]`).forEach((el) => {
    if (!el.classList.contains("thin")) el.style.fill = fill ?? "transparent";
    el.style.stroke = stroke;
    el.querySelector("title")?.remove();
    const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
    t.textContent = title;
    el.appendChild(t);
  });
}

const OK = "#8a93a6";
const BAD = "#ff3b3b";

export function updateStatus(svg: Element, c: CarState, race: Race) {
  // pneus
  const cold = c.tyreLaps === 0 && c.pitStops > 0;
  for (const [k, load] of Object.entries(TYRE_LOAD)) {
    const w = Math.min(1.1, c.wear * load);
    const col = cold ? "#4aa3ff" : wearColor(w);
    setPart(svg, k, col, col, `Pneu ${Math.round((1 - Math.min(1, w)) * 100)}%${cold ? " (frio)" : ""}`);
    const t = svg.querySelector(`[data-t="${k}"]`);
    if (t) t.textContent = `${Math.round((1 - Math.min(1, w)) * 100)}`;
  }
  // asas e suspensão (dano)
  const blink = Math.floor(performance.now() / 400) % 2 === 0;
  const dmg = c.dmg ?? { fw: 0, rw: 0, susp: 0 };
  setPart(svg, "fw", dmg.fw > 0 ? (blink ? BAD : "#8a1f1f") : null, dmg.fw > 0 ? BAD : OK, dmg.fw > 0 ? `Asa dianteira danificada (+${dmg.fw.toFixed(1)}s/volta)` : "Asa dianteira OK");
  setPart(svg, "rw", dmg.rw > 0 ? (blink ? BAD : "#8a1f1f") : null, dmg.rw > 0 ? BAD : OK, dmg.rw > 0 ? `Asa traseira danificada (+${dmg.rw.toFixed(1)}s/volta)` : "Asa traseira OK");
  // suspensão: dano de batida (vermelho) ou carro batendo no chão pelo acerto (laranja)
  const bottoming = c.tuning.h < race.track.def.minHeight;
  const suspCol = dmg.susp > 0 ? BAD : bottoming ? "#ffb02e" : OK;
  setPart(svg, "susp", null, suspCol, dmg.susp > 0 ? `Suspensão danificada (+${dmg.susp.toFixed(1)}s/volta)` : bottoming ? "Carro baixo demais: batendo no chão" : "Suspensão OK");
  // motor: cor pelo modo de mistura
  const eng = c.engine === "rich" ? "#ff8a1c" : c.engine === "lean" ? "#4aa3ff" : OK;
  setPart(svg, "engine", null, eng, `Motor: mistura ${c.engine === "rich" ? "rica" : c.engine === "lean" ? "pobre" : "normal"}`);
  // combustível: barra enche de baixo pra cima, fica vermelha se não chega
  const fuelBar = svg.querySelector<SVGRectElement>("[data-fuel]");
  if (fuelBar) {
    const frac = Math.max(0, Math.min(1, c.fuel / 110));
    const h = 26 * frac;
    fuelBar.setAttribute("y", String(72 + 26 - h));
    fuelBar.setAttribute("height", String(h));
    const laps = c.fuel / race.consumption(c);
    const short = !c.finished && laps < race.lapsLeft(c);
    fuelBar.style.fill = short ? (laps < 2 ? BAD : "#ffb02e") : "#3bd16f";
  }
  svg.classList.toggle("retired", c.retired);
}
