// Idioma do jogo (Configurações > TELA > Idioma): português (o original), inglês ou espanhol.
// Em vez de mexer em cada tela, um tradutor observa a página e troca cada texto em português pelo do
// dicionário (src/ui/i18nDict.ts), inclusive título e dica (title/placeholder). Texto que não está no
// dicionário fica em português. Textos montados na hora: PATTERNS; mensagens da corrida, rádio e telas do fim de semana: i18nRace.ts.
import { storeGet, storeSet } from "./common";
import { DICT, PATTERNS } from "./i18nDict";
import { RACE_DICT, RACE_PATTERNS, setInner } from "./i18nRace";

export type Lang = "pt" | "en" | "es";
export const LANGS: [Lang, string][] = [["pt", "Português"], ["en", "English"], ["es", "Español"]];

export function lang(): Lang {
  const v = storeGet("pwm.lang");
  return v === "en" || v === "es" ? v : "pt";
}

/** troca o idioma (recarrega a página: as telas já montadas voltam traduzidas) */
export function setLang(l: Lang) {
  storeSet("pwm.lang", l);
  location.reload();
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
let table: Map<string, string> | null = null;
const ALL_PATTERNS = [...PATTERNS, ...RACE_PATTERNS];
setInner((s) => trKey(s));

/** tradução de um texto já sem espaços sobrando (o mesmo texto, se não tiver) */
function trKey(key: string): string {
  const l = lang();
  if (l === "pt" || !key) return key;
  table ??= new Map([...DICT, ...RACE_DICT].map(([pt, en, es]) => [norm(pt), l === "en" ? en : es]));
  const hit = table.get(key);
  if (hit !== undefined) return hit;
  for (const [re, en, es] of ALL_PATTERNS) {
    const m = key.match(re);
    if (m) return (l === "en" ? en : es)(...m.slice(1));
  }
  // texto montado com " · " (ex.: "Pista seca · Previsão: ..."): traduz pedaço por pedaço
  if (key.includes(" · ")) {
    const parts = key.split(" · ");
    const out = parts.map((p) => trKey(p.trim()));
    if (out.some((p, i) => p !== parts[i].trim())) return out.join(" · ");
  }
  return key;
}

/** o texto no idioma escolhido (ou o mesmo, se não tiver tradução) */
export function tr(s: string): string {
  if (lang() === "pt") return s;
  const key = norm(s);
  if (!key) return s;
  const t = trKey(key);
  if (t === key) return s;
  // (mantém os espaços de antes e de depois: o HTML usa eles pra separar palavras)
  return (s.match(/^\s*/)?.[0] ?? "") + t + (s.match(/\s*$/)?.[0] ?? "");
}

const ATTRS = ["title", "placeholder", "aria-label"];

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    const t = root.textContent ?? "";
    if (/[A-Za-zÀ-ú]/.test(t)) {
      const out = tr(t);
      if (out !== t) root.textContent = out;
    }
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  // (código e campos de texto ficam como estão)
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "TEXTAREA") return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const out = tr(v);
      if (out !== v) el.setAttribute(a, out);
    }
  }
  for (const c of el.childNodes) translateTree(c);
}

/** liga o tradutor na página (no português não faz nada) */
export function startTranslator() {
  if (lang() === "pt") return;
  document.documentElement.lang = lang();
  translateTree(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") translateTree(m.target);
      else if (m.type === "attributes") translateTree(m.target);
      else m.addedNodes.forEach(translateTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
