// Ajustes de imagem (Configurações > TELA): brilho, contraste, saturação e tom de cor do jogo. Viram um
// filtro do navegador nos desenhos (canvas: corrida, 3D, onboard, pódio); a interface (textos e botões)
// fica igual. Valem na hora e ficam guardados neste navegador.
import { storeGet, storeSet } from "../ui/common";

export interface Display {
  /** % (100 = normal) */
  brilho: number;
  contraste: number;
  saturacao: number;
  /** tom: -100 frio (azulado) a +100 quente (alaranjado) */
  tom: number;
  /** escala da interface (%): por cima do ajuste automático pela tela (referência 1600×900) */
  escala: number;
  /** tamanho extra só do painel dos pilotos (%) */
  painel: number;
}
export const DISPLAY_DEF: Display = { brilho: 100, contraste: 100, saturacao: 100, tom: 0, escala: 100, painel: 100 };

let cur: Display | null = null;
export function display(): Display {
  if (cur) return cur;
  try {
    cur = { ...DISPLAY_DEF, ...(JSON.parse(storeGet("pwm.tela") || "{}") as Partial<Display>) };
  } catch {
    cur = { ...DISPLAY_DEF };
  }
  return cur;
}

/** aplica nos desenhos (sem mudança nenhuma, nem liga o filtro: não pesa) */
export function applyDisplay(d: Display = display()) {
  let st = document.getElementById("pwm-tela") as HTMLStyleElement | null;
  if (!st) {
    st = document.createElement("style");
    st.id = "pwm-tela";
    document.head.appendChild(st);
  }
  const same = d.brilho === 100 && d.contraste === 100 && d.saturacao === 100 && d.tom === 0;
  // (tom quente = um pouco de sépia; frio = gira a cor pro azul)
  const tom = d.tom > 0 ? ` sepia(${(d.tom / 100) * 0.35})` : d.tom < 0 ? ` hue-rotate(${(d.tom / 100) * 12}deg)` : "";
  st.textContent = same ? "" : `canvas{filter:brightness(${d.brilho / 100}) contrast(${d.contraste / 100}) saturate(${d.saturacao / 100})${tom}}`;
  applyHudZoom(d);
}

export function setDisplay(d: Partial<Display>) {
  cur = { ...display(), ...d };
  storeSet("pwm.tela", JSON.stringify(cur));
  applyDisplay(cur);
}

/** escala da interface, como a "resolução" dos jogos: o layout foi desenhado pra 1600×900 e cresce/encolhe pra caber
 * na tela (1920×1080 = 1,2×, notebook 1366×768 = 0,85×), vezes a escala escolhida; o painel dos pilotos ainda tem
 * um ajuste próprio e nunca passa do espaço entre a tabela de posições e o minimapa */
let zoomHooked = false;
export function uiZoom(d: Display = display()): number {
  // (e a tabela de posições inteira, ~650 px, sempre cabe na altura: ela não rola mais — a barra de rolagem aparecia
  // quando uma linha pulava na troca de posição)
  const fit = Math.max(0.6, Math.min(2.2, Math.min(window.innerWidth / 1600, window.innerHeight / 900))) * (d.escala / 100);
  return Math.min(fit, (window.innerHeight - 24) / 650);
}
function applyHudZoom(d: Display) {
  const ui = uiZoom(d);
  const team = Math.min(ui * (d.painel / 100), Math.max(0.55, (window.innerWidth - 600 * ui) / 1060));
  document.documentElement.style.setProperty("--ui-zoom", ui.toFixed(3));
  document.documentElement.style.setProperty("--hud-zoom", team.toFixed(3));
  if (!zoomHooked) {
    zoomHooked = true;
    window.addEventListener("resize", () => applyHudZoom(display()));
  }
}
