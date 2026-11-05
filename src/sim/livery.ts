// Pintura do carro e emblema da equipe que o jogador cria no editor.
// Só dados (sem desenho): a pintura viaja pela rede no online e fica salva na conta.

export type PatternId =
  | "classica" | "lisa" | "faixas" | "lateral" | "chevron" | "diagonal" | "dividida" | "degrade" | "flechas" | "pontas"
  | "xadrez" | "ondas" | "raio" | "tigre" | "pixel" | "aneis" | "estrelas" | "chamas" | "camuflada" | "retro"
  | "tres" | "metade" | "bico" | "zigue" | "colmeia" | "triangulos" | "onca" | "velocidade";

/** estilos de pintura; `plus` = do pacote Plus (dá pra ver a prévia sem ter) */
export const PATTERNS: { id: PatternId; label: string; plus?: boolean }[] = [
  { id: "classica", label: "Clássica (faixa no meio)" },
  { id: "lisa", label: "Lisa" },
  { id: "faixas", label: "Faixas duplas" },
  { id: "lateral", label: "Faixa lateral" },
  { id: "chevron", label: "V (chevron)" },
  { id: "diagonal", label: "Listras diagonais" },
  { id: "dividida", label: "Dividida" },
  { id: "degrade", label: "Degradê" },
  { id: "flechas", label: "Flechas" },
  { id: "pontas", label: "Bico e asas" },
  { id: "xadrez", label: "Bandeirada", plus: true },
  { id: "ondas", label: "Ondas", plus: true },
  { id: "raio", label: "Raio", plus: true },
  { id: "tigre", label: "Tigre", plus: true },
  { id: "pixel", label: "Pixel", plus: true },
  { id: "aneis", label: "Anéis", plus: true },
  { id: "estrelas", label: "Estrelas", plus: true },
  { id: "chamas", label: "Chamas", plus: true },
  { id: "camuflada", label: "Camuflada", plus: true },
  { id: "retro", label: "Retrô", plus: true },
  { id: "tres", label: "Três faixas" },
  { id: "metade", label: "Metade e metade" },
  { id: "bico", label: "Bico colorido" },
  { id: "zigue", label: "Zigue-zague", plus: true },
  { id: "colmeia", label: "Colmeia", plus: true },
  { id: "triangulos", label: "Triângulos", plus: true },
  { id: "onca", label: "Onça", plus: true },
  { id: "velocidade", label: "Velocidade", plus: true },
];

export type EmblemShape = "escudo" | "circulo" | "hexagono" | "losango" | "quadrado";
export type EmblemSymbol = "raio" | "estrela" | "chama" | "coroa" | "asa" | "bandeira" | "volante" | "iniciais";

export const EMBLEM_SHAPES: { id: EmblemShape; label: string }[] = [
  { id: "escudo", label: "Escudo" },
  { id: "circulo", label: "Círculo" },
  { id: "hexagono", label: "Hexágono" },
  { id: "losango", label: "Losango" },
  { id: "quadrado", label: "Quadrado" },
];

export const EMBLEM_SYMBOLS: { id: EmblemSymbol; label: string }[] = [
  { id: "raio", label: "Raio" },
  { id: "estrela", label: "Estrela" },
  { id: "chama", label: "Chama" },
  { id: "coroa", label: "Coroa" },
  { id: "asa", label: "Asa" },
  { id: "bandeira", label: "Bandeira" },
  { id: "volante", label: "Volante" },
  { id: "iniciais", label: "Iniciais" },
];

export interface Emblem {
  shape: EmblemShape;
  symbol: EmblemSymbol;
  /** até 3 letras (quando o símbolo é "iniciais") */
  initials: string;
  bg: string;
  border: string;
  fg: string;
}

export interface Livery {
  base: string;
  accent: string;
  wing: string;
  pattern: PatternId;
  patternColor: string;
  number: number;
  numberColor: string;
  /** capacete do piloto: cor e faixa */
  helmet: string;
  helmetDetail: string;
  /** macacão do piloto: cor e faixas */
  suit: string;
  suitDetail: string;
  /** desenho do capacete (HELMET_STYLES) e do macacão (SUIT_STYLES) */
  helmetStyle?: number;
  suitStyle?: number;
  /** luvas do piloto: cor, detalhe e desenho (GLOVE_STYLES); sem elas, a cor do macacão e lisas */
  glove?: string;
  gloveDetail?: string;
  gloveStyle?: number;
  /** tênis do piloto: cor, detalhe e desenho (SHOE_STYLES); sem eles, a cor do macacão e lisos */
  shoe?: string;
  shoeDetail?: string;
  shoeStyle?: number;
  /** adesivos (Premium) do carro 2D: por cima da pintura, onde a pessoa quiser */
  stickers?: Sticker[];
  /** adesivos (Premium) do carro 3D: colados na carroceria */
  decals?: Decal[];
  emblem: Emblem;
}

/** tipos de adesivo */
export const STICKERS = [
  { id: "estrela", label: "Estrela" }, { id: "raio", label: "Raio" }, { id: "chama", label: "Chama" },
  { id: "circulo", label: "Círculo" }, { id: "anel", label: "Anel" }, { id: "triangulo", label: "Triângulo" },
  { id: "seta", label: "Seta" }, { id: "coracao", label: "Coração" }, { id: "xadrez", label: "Quadriculado" },
  { id: "listra", label: "Listra" }, { id: "coroa", label: "Coroa" }, { id: "asa", label: "Asas" },
  { id: "numero", label: "Número do carro" }, { id: "texto", label: "Texto" },
  { id: "losango", label: "Losango" }, { id: "hexagono", label: "Hexágono" }, { id: "brilho", label: "Brilho" },
  { id: "lua", label: "Lua" }, { id: "sol", label: "Sol" }, { id: "gota", label: "Gota" }, { id: "folha", label: "Folha" },
  { id: "chevron", label: "Chevron" }, { id: "velocidade", label: "Velocidade" }, { id: "pata", label: "Pata" },
  { id: "garra", label: "Garras" }, { id: "alvo", label: "Alvo" }, { id: "mais", label: "Cruz" }, { id: "zigue", label: "Zigue-zague" },
] as const;
export type StickerKind = (typeof STICKERS)[number]["id"];
/** um adesivo do carro 2D: no desenho do carro visto de cima (m; frente pra +x, -2,4..2,4 × -0,8..0,8), giro (rad),
 * tamanho (m), cor, texto (só o "texto"), se repete espelhado do outro lado (m) e o desenho virado: espelhado ↔ (fx),
 * invertido ↕ (fy); camadas: escondido (h) e travado (l, não sai do lugar clicando no carro). A ordem da lista = de baixo pra
 * cima */
export interface Sticker { k: StickerKind; x: number; y: number; r: number; s: number; c: string; t?: string; m?: boolean; fx?: boolean; fy?: boolean; h?: boolean; l?: boolean }
/** um adesivo do carro 3D: projetado na carroceria na direção dela, como um adesivo de verdade (não estica com a
 * pintura). p: o ponto onde foi colado; n: pra onde a superfície olha ali. Os dois no espaço do carro (m; x de
 * lado, + = esquerdo; y = altura acima do ponto mais baixo da carroceria; z = comprimento, + = frente, 0 no meio).
 * m = nos dois lados (o lugar espelha, o texto continua legível) */
export interface Decal { k: StickerKind; p: [number, number, number]; n: [number, number, number]; r: number; s: number; c: string; t?: string; m?: boolean; fx?: boolean; fy?: boolean; h?: boolean; l?: boolean }
export const MAX_STICKERS = 40;

/** desenhos do capacete: a faixa (helmetDetail) por cima da cor dele; `plus` = pacote Plus.
 * A ordem é o número guardado na pintura (só acrescentar no fim) */
export const HELMET_STYLES: { label: string; plus?: boolean }[] = [
  { label: "Liso" }, { label: "Faixa no meio" }, { label: "Duas faixas" },
  { label: "Topo colorido", plus: true }, { label: "Frente colorida", plus: true },
  { label: "Faixa horizontal" }, { label: "Laterais coloridas" }, { label: "Viseira contornada" },
  { label: "Xadrez", plus: true }, { label: "Listras diagonais", plus: true }, { label: "Bolinhas", plus: true }, { label: "Metade e metade", plus: true },
];
/** desenhos do macacão: as faixas (suitDetail) por cima da cor dele; `plus` = pacote Plus */
export const SUIT_STYLES: { label: string; plus?: boolean }[] = [
  { label: "Liso" }, { label: "Faixas laterais" }, { label: "Ombros coloridos", plus: true },
  { label: "Cintura colorida" }, { label: "Pernas coloridas" }, { label: "Faixa no peito" },
  { label: "Diagonal", plus: true }, { label: "Xadrez", plus: true }, { label: "Metade e metade", plus: true },
];

/** desenhos das luvas: o detalhe (gloveDetail) por cima da cor delas; `plus` = pacote Plus */
export const GLOVE_STYLES: { label: string; plus?: boolean }[] = [
  { label: "Lisa" }, { label: "Dedos coloridos" }, { label: "Punho colorido" }, { label: "Dorso colorido" },
  { label: "Palma colorida" }, { label: "Pontas dos dedos" }, { label: "Listras", plus: true },
  { label: "Xadrez", plus: true }, { label: "Uma de cada cor", plus: true },
];

/** desenhos do tênis: o detalhe (shoeDetail) por cima da cor dele; `plus` = pacote Plus */
export const SHOE_STYLES: { label: string; plus?: boolean }[] = [
  { label: "Liso" }, { label: "Bico colorido" }, { label: "Calcanhar colorido" }, { label: "Cano colorido" },
  { label: "Sola colorida" }, { label: "Faixa lateral" }, { label: "Listras", plus: true },
  { label: "Xadrez", plus: true }, { label: "Um de cada cor", plus: true },
];

const HEX = /^#[0-9a-f]{6}$/i;
const color = (c: unknown, fb: string) => (typeof c === "string" && HEX.test(c) ? c.toLowerCase() : fb);

/** pintura padrão a partir das cores da equipe */
export function defaultLivery(base: string, accent: string, teamName = ""): Livery {
  return {
    base,
    accent,
    wing: accent,
    pattern: "classica",
    patternColor: accent,
    number: 1 + Math.floor(Math.random() * 98),
    numberColor: "#ffffff",
    helmet: accent,
    helmetDetail: base,
    suit: base,
    suitDetail: accent,
    helmetStyle: 1,
    suitStyle: 1,
    glove: base,
    gloveDetail: accent,
    gloveStyle: 0,
    shoe: base,
    shoeDetail: accent,
    shoeStyle: 0,
    emblem: { shape: "escudo", symbol: "iniciais", initials: initialsOf(teamName), bg: base, border: accent, fg: "#ffffff" },
  };
}

export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "PW";
  return (w.length === 1 ? w[0].slice(0, 2) : w.slice(0, 3).map((x) => x[0]).join("")).toUpperCase();
}

const okSticker = (s: Partial<Sticker | Decal> | null) => !!s && STICKERS.some((k) => k.id === s.k);
/** o que o adesivo 2D e o 3D têm em comum: tipo, giro, tamanho, cor, texto, se repete do outro lado e se é virado */
const stickerLook = (s: Partial<Sticker | Decal>) => ({
  k: s.k as StickerKind,
  r: Number(s.r) || 0,
  s: Math.max(0.05, Math.min(3, Number(s.s) || 0.3)),
  c: color(s.c, "#ffffff"),
  ...(s.k === "texto" ? { t: String(s.t ?? "").replace(/[<>&"]/g, "").slice(0, 14) } : {}),
  ...(s.m ? { m: true } : {}),
  ...(s.fx ? { fx: true } : {}),
  ...(s.fy ? { fy: true } : {}),
  ...(s.h ? { h: true } : {}),
  ...(s.l ? { l: true } : {}),
});
const vec3 = (a: unknown, lim: number) => [0, 1, 2].map((i) => Math.max(-lim, Math.min(lim, Number((a as number[] | undefined)?.[i]) || 0))) as [number, number, number];

/** valida o que veio de fora (rede, navegador): nada de cor ou texto estranho */
export function cleanLivery(x: unknown): Livery | null {
  const l = x as Partial<Livery> | null;
  if (!l || typeof l !== "object") return null;
  const e = (l.emblem ?? {}) as Partial<Emblem>;
  const base = color(l.base, "#e8202a");
  const accent = color(l.accent, "#ffffff");
  return {
    base,
    accent,
    wing: color(l.wing, accent),
    pattern: PATTERNS.some((p) => p.id === l.pattern) ? (l.pattern as PatternId) : "classica",
    patternColor: color(l.patternColor, accent),
    number: Math.max(0, Math.min(99, Math.round(Number(l.number) || 0))),
    numberColor: color(l.numberColor, "#ffffff"),
    helmet: color(l.helmet, accent),
    helmetDetail: color(l.helmetDetail, base),
    suit: color(l.suit, base),
    suitDetail: color(l.suitDetail, accent),
    helmetStyle: Math.max(0, Math.min(HELMET_STYLES.length - 1, Math.round(Number(l.helmetStyle ?? 1)) || 0)),
    suitStyle: Math.max(0, Math.min(SUIT_STYLES.length - 1, Math.round(Number(l.suitStyle ?? 1)) || 0)),
    glove: color(l.glove, color(l.suit, base)),
    gloveDetail: color(l.gloveDetail, accent),
    gloveStyle: Math.max(0, Math.min(GLOVE_STYLES.length - 1, Math.round(Number(l.gloveStyle ?? 0)) || 0)),
    shoe: color(l.shoe, color(l.suit, base)),
    shoeDetail: color(l.shoeDetail, color(l.suitDetail, accent)),
    shoeStyle: Math.max(0, Math.min(SHOE_STYLES.length - 1, Math.round(Number(l.shoeStyle ?? 0)) || 0)),
    // (os antigos da LATERAL, v "lado", não têm onde aparecer no carro 2D: ficam de fora)
    stickers: Array.isArray(l.stickers)
      ? l.stickers
          .filter((s) => okSticker(s) && (s as { v?: string }).v !== "lado")
          .slice(0, MAX_STICKERS)
          .map((s) => ({ ...stickerLook(s), x: Math.max(-2.6, Math.min(2.6, Number(s.x) || 0)), y: Math.max(-1, Math.min(1, Number(s.y) || 0)) }))
      : [],
    decals: Array.isArray(l.decals)
      ? l.decals
          .filter(okSticker)
          .slice(0, MAX_STICKERS)
          .map((d) => {
            const n = vec3(d.n, 1), len = Math.hypot(...n);
            return { ...stickerLook(d), p: vec3(d.p, 3), n: len > 0.01 ? (n.map((x) => x / len) as [number, number, number]) : ([0, 1, 0] as [number, number, number]) };
          })
      : [],
    emblem: {
      shape: EMBLEM_SHAPES.some((s) => s.id === e.shape) ? (e.shape as EmblemShape) : "escudo",
      symbol: EMBLEM_SYMBOLS.some((s) => s.id === e.symbol) ? (e.symbol as EmblemSymbol) : "iniciais",
      initials: String(e.initials ?? "").replace(/[^A-Za-z0-9ÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü]/g, "").slice(0, 3).toUpperCase() || "PW",
      bg: color(e.bg, base),
      border: color(e.border, accent),
      fg: color(e.fg, "#ffffff"),
    },
  };
}

/** chave curta pra cache de desenho */
export function liveryKey(l: Livery | undefined): string {
  return l ? [l.base, l.accent, l.wing, l.pattern, l.patternColor, l.number, l.numberColor, l.helmet, l.helmetDetail, l.suit, l.suitDetail, l.helmetStyle ?? 1, l.suitStyle ?? 1, l.glove ?? "", l.gloveDetail ?? "", l.gloveStyle ?? 0, l.shoe ?? "", l.shoeDetail ?? "", l.shoeStyle ?? 0, l.stickers?.length ? JSON.stringify(l.stickers) : "", l.decals?.length ? JSON.stringify(l.decals) : ""].join("|") : "";
}
