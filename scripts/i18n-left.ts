// lista os textos dos arquivos dados que o tradutor ainda deixa em português: textos entre aspas e os montados
// com ${} (as variáveis viram "7"). O TypeScript 7 não tem API em JS, então lê o código com um leitor simples.
(globalThis as any).localStorage = { getItem: () => "en", setItem() {} };
const { tr } = await import("../src/ui/i18n");
import { readFileSync } from "node:fs";

function strings(src: string): string[] {
  const found: string[] = [];
  let i = 0;
  const readQuoted = (q: string) => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") { s += src[i + 1] === "n" ? "\n" : src[i + 1]; i += 2; continue; }
      s += src[i++];
    }
    i++;
    return s;
  };
  const readTemplate = (): string => {
    let s = "";
    i++;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") { s += src[i + 1] === "n" ? "\n" : src[i + 1]; i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; scan(true); s += "7"; continue; }
      s += src[i++];
    }
    i++;
    return s;
  };
  let last = "";
  function scan(inExpr: boolean) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 2; if (i < 2) i = src.length; continue; }
      if (c === '"' || c === "'") { found.push(readQuoted(c)); last = "s"; continue; }
      if (c === "`") { found.push(readTemplate()); last = "s"; continue; }
      if (c === "/" && (last === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof|case|of|in)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
        // expressão regular: pula até a barra final (fora de [...])
        i++;
        let cls = false;
        while (i < src.length && (cls || src[i] !== "/")) {
          if (src[i] === "\\") i++;
          else if (src[i] === "[") cls = true;
          else if (src[i] === "]") cls = false;
          else if (src[i] === "\n") break;
          i++;
        }
        i++;
        last = "r";
        continue;
      }
      if (inExpr) {
        if (c === "{") depth++;
        if (c === "}") { if (depth === 0) { i++; return; } depth--; }
      }
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  scan(false);
  return found;
}

const files = process.argv.slice(2);
const out = new Map<string, string>();
const PT = /[ãõçéêáíóúâàÁÉÍÓÚÃÕÇÂÊ]|\b(de|da|do|das|dos|pra|pro|por|na|no|nas|nos|com|sem|volta|voltas|pneu|pneus|carro|chuva|box|seco|frente|ritmo|motor|asa|equipe|piloto|corrida|largada|tempo|melhor|chamar|minimizar|painel|segura|livre|deixar|passar|ou|e|um|uma|o|a|os|as)\b/i;
for (const f of files) {
  for (const s of strings(readFileSync(f, "utf8"))) {
    for (let part of s.replace(/<[^>]+>/g, "\n").split("\n")) {
      part = part.replace(/\s+/g, " ").trim();
      if (part.length < 2 || !/[A-Za-zÀ-ú]{2}/.test(part) || !PT.test(part)) continue;
      if (/^[\w.-]+$/.test(part) && part === part.toLowerCase()) continue;
      if (/^[.#\[]|^[\w-]+=|=>|\(\)|^\w+\.\w+/.test(part)) continue;
      if (tr(part) === part) out.set(part, f.split(/[\\/]/).pop()!);
    }
  }
}
for (const [t, f] of out) console.log(`${f}\t${t}`);
console.error(out.size + " textos");
