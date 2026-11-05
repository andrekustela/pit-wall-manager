// Configurações gráficas (Configurações > Gráficos): o que pode pesar no jogo dá pra baixar ou desligar,
// pra rodar em PC fraco. Ficam no navegador.
import { storeGet, storeSet } from "../ui/common";

/** carros na pista: "2d" (vetor, o mais leve), "sprite" (2D estilizado: imagens do Blender) ou "real" (3D) */
export type CarStyle = "2d" | "sprite" | "real";
/** câmera do modo 3D: de cima (como o 2D), de lado (inclinada, gira com o botão direito) ou atrás do carro */
export type Cam3d = "cima" | "lado" | "tras" | "piloto" | "multicam";
export type SceneQ = "baixa" | "media" | "top";
/** a partir de quantos metros da câmera o cenário 3D usa a versão simples (PieceLayer.lod) */
export const SCENE_LOD_DIST: Record<SceneQ, number> = { baixa: 60, media: 150, top: Infinity };
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
  /** onboard em 3D de verdade (com o autódromo 3D carregado); senão, o desenho 2D */
  onboard3d: boolean;
  /** detalhe do modelo dos carros 3D: baixo (leve), médio, alto (o detalhado em todos) */
  carQ: "baixo" | "medio" | "alto";
  /** detalhe do cenário 3D (torcida e árvores): top = tudo detalhado; média e baixa = versão simples de longe */
  sceneQ: SceneQ;
  /** autódromo em 3D no modo 3D (em qualquer pista; onde tem o mapa real, com o entorno real) */
  track3d: boolean;
  /** câmera do modo 3D (de lado e atrás do carro usam o autódromo 3D) */
  cam3d: Cam3d;
  /** pódio em 3D (senão, o desenhado) */
  podium3d: boolean;
  /** limite de quadros por segundo (0 = sem limite; digitado nas configurações, 15 a 360) */
  fpsCap: number;
  /** acessibilidade: sem tremor de câmera, câmera lenta, tela cinza nem piscadas fortes */
  calm?: boolean;
  /** tomadas da TV (MultiCam) desligadas em Configurações > MULTICAM (as novas entram ligadas) */
  camOff?: string[];
}

/** tomadas da TV (MultiCam): id, nome e o que mostra (Configurações > MULTICAM liga e desliga cada uma) */
export const MULTICAM_SHOTS: [string, string, string][] = [
  ["largada", "Largada", "De frente pro grid, nas luzes"],
  ["chegada", "Bandeirada", "Na linha de chegada, na última volta"],
  ["baixa", "Beira da pista, baixa", "Parada na beira, lente fechada, o carro vindo"],
  ["alta", "Beira da pista, alta", "Num poste de 10 a 20 m"],
  ["grua", "Grua", "De 6 a 10 m de altura, perto da pista"],
  ["frontal", "De frente, de longe", "Teleobjetiva lá na frente, o carro vindo de longe"],
  ["torre", "Torre na curva", "Bem alta, do lado de dentro da curva que vem"],
  ["apice", "Ápice da curva", "Baixa, do lado de dentro, no ponto mais fechado da curva"],
  ["chao", "No chão", "Rente à zebra: o carro passa raspando"],
  ["heli", "Helicóptero", "De 40 a 70 m de altura, acompanhando"],
  ["persegue", "Perseguição", "Atrás do carro, andando junto"],
  ["lateral", "Lateral", "Do lado do carro, andando junto"],
  ["drone", "Drone na frente", "Na frente do carro, filmando ele chegar"],
  ["frente", "Na frente, rente ao chão", "Bem baixa, na frente do bico, olhando o carro"],
  ["roda", "Na roda", "Presa do lado da roda de trás, olhando pra frente"],
  ["asa", "Na asa traseira", "Olhando quem vem atrás"],
  ["tcam", "Em cima do carro (T-cam)", "Em cima da entrada de ar, olhando a pista"],
  ["orbita", "Girando em volta", "Dá a volta no carro"],
  ["onboard", "Piloto", "Da cabeça do piloto"],
  ["lado", "De lado", "A câmera de lado, num ângulo sorteado"],
  ["cima", "De cima", "Vista de cima"],
  ["muro", "Muro do box", "Na parada, do muro do pit, vendo os mecânicos"],
];

export const PRESETS: Record<"minimo" | "baixo" | "medio" | "alto", Gfx> = {
  minimo: { cam3d: "cima", track3d: false, carStyle: "2d", aa: false, shadows: "off", sparks: "off", smoke: "off", rain: "off", skids: "off", onboard: false, onboard3d: false, carQ: "baixo", sceneQ: "baixa", podium3d: false, fpsCap: 30 },
  baixo: { cam3d: "cima", track3d: false, carStyle: "sprite", aa: false, shadows: "baixo", sparks: "baixo", smoke: "baixo", rain: "baixo", skids: "baixo", onboard: false, onboard3d: false, carQ: "baixo", sceneQ: "baixa", podium3d: false, fpsCap: 60 },
  medio: { cam3d: "cima", track3d: false, carStyle: "sprite", aa: false, shadows: "medio", sparks: "medio", smoke: "medio", rain: "medio", skids: "medio", onboard: true, onboard3d: false, carQ: "medio", sceneQ: "media", podium3d: true, fpsCap: 0 },
  alto: { cam3d: "cima", track3d: false, carStyle: "real", aa: true, shadows: "alto", sparks: "alto", smoke: "alto", rain: "alto", skids: "alto", onboard: true, onboard3d: true, carQ: "alto", sceneQ: "top", podium3d: true, fpsCap: 0 },
};
const DEF: Gfx = { ...PRESETS.medio, shadows: "alto", sparks: "alto", smoke: "alto", rain: "alto", skids: "alto", sceneQ: "top" };

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
  for (const k of ["carStyle", "aa", "onboard", "onboard3d", "carQ", "sceneQ", "podium3d", "fpsCap", "track3d", "cam3d", "calm", "camOff"] as const) if (saved[k] !== undefined) (g as unknown as Record<string, unknown>)[k] = saved[k];
  for (const k of ["shadows", "sparks", "smoke", "rain", "skids"] as const) g[k] = lv(saved[k]) ?? g[k];
  if (!["2d", "sprite", "real"].includes(g.carStyle)) g.carStyle = DEF.carStyle;
  if (!["cima", "lado", "tras", "piloto", "multicam"].includes(g.cam3d)) g.cam3d = "cima";
  if (!Array.isArray(g.camOff)) g.camOff = [];
  if (typeof g.onboard3d !== "boolean") g.onboard3d = true;
  if (!["baixo", "medio", "alto"].includes(g.carQ)) g.carQ = "medio";
  if (!["baixa", "media", "top"].includes(g.sceneQ)) g.sceneQ = "top";
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
