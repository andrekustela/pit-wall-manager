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
}
export const DISPLAY_DEF: Display = { brilho: 100, contraste: 100, saturacao: 100, tom: 0 };

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
}

export function setDisplay(d: Partial<Display>) {
  cur = { ...display(), ...d };
  storeSet("pwm.tela", JSON.stringify(cur));
  applyDisplay(cur);
}
