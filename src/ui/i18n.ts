// Idioma do jogo (Configurações > TELA > Idioma): português (o original), inglês ou espanhol.
// Em vez de mexer em cada tela, um tradutor observa a página e troca cada texto em português pelo do
// dicionário (src/ui/i18nDict.ts), inclusive título e dica (title/placeholder). Texto que não está no
// dicionário fica em português. Textos montados na hora: PATTERNS.
import { storeGet, storeSet } from "./common";
import { DICT, PATTERNS } from "./i18nDict";

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

/** o texto no idioma escolhido (ou o mesmo, se não tiver tradução) */
export function tr(s: string): string {
  const l = lang();
  if (l === "pt") return s;
  const key = norm(s);
  if (!key) return s;
  table ??= new Map(DICT.map(([pt, en, es]) => [norm(pt), l === "en" ? en : es]));
  // (mantém os espaços de antes e de depois: o HTML usa eles pra separar palavras)
  const wrap = (t: string) => (s.match(/^\s*/)?.[0] ?? "") + t + (s.match(/\s*$/)?.[0] ?? "");
  const hit = table.get(key);
  if (hit !== undefined) return wrap(hit);
  for (const [re, en, es] of PATTERNS) {
    const m = key.match(re);
    if (m) return wrap((l === "en" ? en : es)(...m.slice(1)));
  }
  return s;
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
