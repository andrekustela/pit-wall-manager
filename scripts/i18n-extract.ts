// Junta os textos fixos da interface (o que aparece entre tags HTML e em title/placeholder) pra montar o
// dicionário de tradução (src/ui/i18nDict.ts). Só lista; a tradução é feita à mão/por IA e revisada.
// uso: npx tsx scripts/i18n-extract.ts > textos.txt
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = ["src/ui", "src/main.ts"].flatMap((p) => (p.endsWith(".ts") ? [p] : readdirSync(p).filter((f) => f.endsWith(".ts")).map((f) => join(p, f))));
const found = new Map<string, number>();
const add = (s: string) => {
  s = s.replace(/\s+/g, " ").trim();
  // só texto de verdade (tem letra, não é só variável, nem código)
  if (s.length < 2 || !/[A-Za-zÀ-ú]{2}/.test(s) || /^[\w.-]+$/.test(s) && !/[À-ú]/.test(s) && s === s.toLowerCase()) return;
  if (/\$\{/.test(s) || /[{};=<>]/.test(s)) return;
  found.set(s, (found.get(s) ?? 0) + 1);
};
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // texto entre tags: >Texto<
  for (const m of src.matchAll(/>([^<>`$]{2,160})</g)) add(m[1]);
  // atributos visíveis
  for (const m of src.matchAll(/(?:title|placeholder)="([^"$]{2,200})"/g)) add(m[1]);
}
const list = [...found.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));
console.log(list.join("\n"));
console.error(`${list.length} textos`);
