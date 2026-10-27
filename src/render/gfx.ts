// Configurações gráficas (Configurações > Gráficos): o que pode pesar no jogo dá pra baixar ou desligar,
// pra rodar em PC fraco. Ficam no navegador.
import { storeGet, storeSet } from "../ui/common";

/** carros na pista: "2d" (vetor, o mais leve), "sprite" (2D estilizado: imagens do Blender) ou "real" (3D) */
export type CarStyle = "2d" | "sprite" | "real";
/** câmera do modo 3D: de cima (como o 2D), de lado (inclinada, gira com o botão direito) ou atrás do carro */
export type Cam3d = "cima" | "lado" | "tras";
/** nível de um efeito */
export type Lv = "off" | "baixo" | "medio" | "alto";

export interface Gfx {
  carStyle: CarStyle;
  /** antisserrilhado e resolução cheia no 3D (sem os pneus e bordas serrilhados) */
  aa: boolean;
  /** sombra dos carros: desligada, simples (mancha), sombra de verdade e sombra de verdade suave */
  shadows: Lv;
  /** faíscas (assoalho, batida, muro) */
  sparks: Lv;
  /** fumaça (rodada, motor) e poeira (brita) */
  smoke: Lv;
  /** spray dos carros e gotas na chuva */
  rain: Lv;
  /** marcas de pneu no asfalto (quanto tempo ficam) */
  skids: Lv;
  /** câmera onboard nos cards dos pilotos */
  onboard: boolean;
  /** autódromo em 3D no modo 3D (em qualquer pista; onde tem o mapa real, com o entorno real) */
  track3d: boolean;
  /** câmera do modo 3D (de lado e atrás do carro usam o autódromo 3D) */
  cam3d: Cam3d;
  /** pódio em 3D (senão, o desenhado) */
  podium3d: boolean;
  /** limite de quadros por segundo (0 = sem limite; digitado nas configurações, 15 a 360) */
  fpsCap: number;
}

export const PRESETS: Record<"minimo" | "baixo" | "medio" | "alto", Gfx> = {
  minimo: { cam3d: "cima", track3d: false, carStyle: "2d", aa: false, shadows: "off", sparks: "off", smoke: "off", rain: "off", skids: "off", onboard: false, podium3d: false, fpsCap: 30 },
  baixo: { cam3d: "cima", track3d: false, carStyle: "sprite", aa: false, shadows: "baixo", sparks: "baixo", smoke: "baixo", rain: "baixo", skids: "baixo", onboard: false, podium3d: false, fpsCap: 60 },
  medio: { cam3d: "cima", track3d: false, carStyle: "sprite", aa: false, shadows: "medio", sparks: "medio", smoke: "medio", rain: "medio", skids: "medio", onboard: true, podium3d: true, fpsCap: 0 },
  alto: { cam3d: "cima", track3d: false, carStyle: "real", aa: true, shadows: "alto", sparks: "alto", smoke: "alto", rain: "alto", skids: "alto", onboard: true, podium3d: true, fpsCap: 0 },
};
const DEF: Gfx = { ...PRESETS.medio, shadows: "alto", sparks: "alto", smoke: "alto", rain: "alto", skids: "alto" };

/** quanto de um efeito aparece (0..1) */
export const LV_AMOUNT: Record<Lv, number> = { off: 0, baixo: 0.33, medio: 0.66, alto: 1 };

let cur: Gfx | null = null;

function read(): Gfx {
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(storeGet("pwm.gfx") || "{}") as Record<string, unknown>;
  } catch {
    /* estragado: padrão */
  }
  // versões antigas: liga/desliga do 3D, qualidade, partículas e chuva/marcas como sim/não
  const old = storeGet("pwm.carstyle") || (storeGet("pwm.car3d") === "0" ? "2d" : "");
  const g: Gfx = { ...DEF, ...(old ? { carStyle: old as CarStyle } : {}) };
  const lv = (v: unknown): Lv | undefined => (v === true ? "alto" : v === false ? "off" : ["off", "baixo", "medio", "alto"].includes(v as string) ? (v as Lv) : undefined);
  if (saved.quality === "qualidade") g.aa = true;
  const pa = lv(saved.particles);
  if (pa) g.sparks = g.smoke = pa;
  for (const k of ["carStyle", "aa", "onboard", "podium3d", "fpsCap", "track3d", "cam3d"] as const) if (saved[k] !== undefined) (g as unknown as Record<string, unknown>)[k] = saved[k];
  for (const k of ["shadows", "sparks", "smoke", "rain", "skids"] as const) g[k] = lv(saved[k]) ?? g[k];
  if (!["2d", "sprite", "real"].includes(g.carStyle)) g.carStyle = DEF.carStyle;
  if (!["cima", "lado", "tras"].includes(g.cam3d)) g.cam3d = "cima";
  g.fpsCap = Number(g.fpsCap) > 0 ? Math.max(15, Math.min(360, Math.round(Number(g.fpsCap)))) : 0;
  return g;
}

/** as configurações atuais */
export function gfx(): Gfx {
  return (cur ??= read());
}

export function setGfx(p: Partial<Gfx>) {
  cur = { ...gfx(), ...p };
  storeSet("pwm.gfx", JSON.stringify(cur));
}
