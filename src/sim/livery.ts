// Pintura do carro e emblema da equipe que o jogador cria no editor.
// Só dados (sem desenho): a pintura viaja pela rede no online e fica salva na conta.

export type PatternId = "classica" | "lisa" | "faixas" | "lateral" | "chevron" | "diagonal" | "dividida" | "degrade" | "flechas" | "pontas";

export const PATTERNS: { id: PatternId; label: string }[] = [
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
  emblem: Emblem;
}

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
    emblem: { shape: "escudo", symbol: "iniciais", initials: initialsOf(teamName), bg: base, border: accent, fg: "#ffffff" },
  };
}

export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "PW";
  return (w.length === 1 ? w[0].slice(0, 2) : w.slice(0, 3).map((x) => x[0]).join("")).toUpperCase();
}

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
  return l ? [l.base, l.accent, l.wing, l.pattern, l.patternColor, l.number, l.numberColor, l.helmet, l.helmetDetail].join("|") : "";
}
