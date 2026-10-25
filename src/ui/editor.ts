// Tela do Editor (menu): renomear pistas e pilotos e escolher a voz do P1 e do P2 no rádio.
// Fica só neste navegador/programa; dá pra exportar/importar um pacote de nomes.
import { ACTIVE_TRACKS, CIRCUITS } from "../sim/track";
import { DRIVER_POOL, LEGEND_POOL } from "../sim/drivers";
import { esc, toast } from "./common";
import { RADIO_VOICES, exportEditor, getEditor, importEditor, originalDriver, originalTrackName, saveEditor, type EditorData } from "./editorData";

type Tab = "pistas" | "lendas" | "pilotos" | "vozes";

export function showEditor(onDone: () => void) {
  const d: EditorData = getEditor();
  let tab: Tab = "pistas";
  let q = "";
  const m = document.createElement("div");
  m.className = "helpmodal";
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rowsHtml = () => {
    if (tab === "vozes") {
      const pick = (k: "p1" | "p2") =>
        `<div class="fld"><span>Voz do ${k.toUpperCase()} (${k === "p1" ? "1º" : "2º"} piloto da equipe)</span><div class="seg" data-voice="${k}">${RADIO_VOICES.map((v) => `<button data-v="${v.id}" class="${d.voices[k] === v.id ? "on" : ""}">${v.label}</button>`).join("")}</div></div>`;
      return `${pick("p1")}${pick("p2")}<p class="hint" style="margin:6px 0 0">As falas do rádio são gravadas em cada voz. Os dois pilotos podem ter a mesma voz, mas aí fica difícil saber quem está falando.</p>`;
    }
    if (tab === "pistas") {
      const list = ACTIVE_TRACKS.map((i) => ({ i, o: originalTrackName(i) })).filter((x) => !q || norm(`${x.o} ${d.tracks[x.i] ?? ""} ${CIRCUITS[x.i].official ?? ""}`).includes(norm(q)));
      return list
        .sort((a, b) => a.o.localeCompare(b.o, "pt-BR"))
        .map(({ i, o }) => `<label class="edrow"><span title="${esc(CIRCUITS[i].official ?? o)}">${esc(o)}</span><input class="txt" data-track="${i}" maxlength="40" placeholder="${esc(o)}" value="${esc(d.tracks[i] ?? "")}"></label>`)
        .join("");
    }
    const pool = tab === "lendas" ? LEGEND_POOL : DRIVER_POOL;
    return pool
      .map((p) => ({ p, o: originalDriver(p.id)! }))
      .filter(({ o, p }) => !q || norm(`${o.name} ${o.short} ${d.drivers[p.id]?.name ?? ""}`).includes(norm(q)))
      .sort((a, b) => a.o.name.localeCompare(b.o.name, "pt-BR"))
      .map(({ p, o }) => {
        const e = d.drivers[p.id] ?? {};
        return `<div class="edrow"><span>${esc(o.name)} <small>${esc(o.short)}</small></span>
          <input class="txt" data-dname="${esc(p.id)}" maxlength="30" placeholder="${esc(o.name)}" value="${esc(e.name ?? "")}">
          <input class="txt edshort" data-dshort="${esc(p.id)}" maxlength="3" placeholder="${esc(o.short)}" value="${esc(e.short ?? "")}"></div>`;
      })
      .join("");
  };
  const render = () => {
    m.innerHTML = `<div class="helpbox panel profbox edbox">
      <div class="helphead"><b>EDITOR</b><button class="btn small" data-x>✕</button></div>
      <p class="hint" style="margin:0 0 10px">Troque os nomes das pistas e dos pilotos do seu jeito (vazio = nome original) e escolha a voz de cada piloto no rádio. Fica salvo só aqui; dá pra exportar e mandar o pacote pros amigos.</p>
      <div class="seg edtabs">${(["pistas", "lendas", "pilotos", "vozes"] as Tab[]).map((t) => `<button data-tab="${t}" class="${t === tab ? "on" : ""}">${{ pistas: "PISTAS", lendas: "LENDAS", pilotos: "PILOTOS FICTÍCIOS", vozes: "VOZES DO RÁDIO" }[t]}</button>`).join("")}</div>
      ${tab === "vozes" ? "" : `<input class="txt edsearch" data-q placeholder="Buscar..." value="${esc(q)}">`}
      <div class="edlist">${rowsHtml()}</div>
      <div class="row-btns" style="justify-content:space-between;margin-top:12px">
        <div class="row-btns" style="margin:0"><button class="btn small" data-exp>⬇ EXPORTAR</button><button class="btn small" data-imp>⬆ IMPORTAR</button><button class="btn small" data-reset>RESTAURAR ORIGINAIS</button><input type="file" accept=".json" data-file hidden></div>
        <div class="row-btns" style="margin:0"><button class="btn" data-x>CANCELAR</button><button class="btn primary" data-save>SALVAR</button></div>
      </div></div>`;
    const s = m.querySelector<HTMLInputElement>("[data-q]");
    if (s && q) {
      s.focus();
      s.setSelectionRange(q.length, q.length);
    }
  };
  // guarda o que foi digitado antes de trocar de aba / buscar
  const collect = () => {
    m.querySelectorAll<HTMLInputElement>("[data-track]").forEach((i) => {
      const v = i.value.trim();
      if (v) d.tracks[i.dataset.track!] = v;
      else delete d.tracks[i.dataset.track!];
    });
    m.querySelectorAll<HTMLInputElement>("[data-dname]").forEach((i) => {
      const id = i.dataset.dname!, sh = m.querySelector<HTMLInputElement>(`[data-dshort="${id}"]`)!;
      const name = i.value.trim(), short = sh.value.trim().toUpperCase();
      if (name || short) d.drivers[id] = { ...(name ? { name } : {}), ...(short ? { short } : {}) };
      else delete d.drivers[id];
    });
  };
  render();
  document.body.appendChild(m);
  const close = () => {
    m.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  m.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-q]")) {
      collect();
      q = t.value;
      render();
    }
  });
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    const tb = t.closest<HTMLElement>("[data-tab]");
    if (tb) {
      collect();
      tab = tb.dataset.tab as Tab;
      q = "";
      render();
      return;
    }
    const vb = t.closest<HTMLElement>("[data-voice] button");
    if (vb) {
      const k = vb.parentElement!.dataset.voice as "p1" | "p2";
      d.voices[k] = vb.dataset.v as EditorData["voices"]["p1"];
      render();
      return;
    }
    if (t.closest("[data-save]")) {
      collect();
      saveEditor(d);
      toast("Editor salvo");
      close();
      onDone();
    }
    if (t.closest("[data-reset]")) {
      d.tracks = {};
      d.drivers = {};
      render();
      toast("Nomes originais (clique em SALVAR pra valer)");
    }
    if (t.closest("[data-exp]")) {
      collect();
      saveEditor(d);
      const url = URL.createObjectURL(new Blob([exportEditor()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "pit-wall-manager-nomes.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    if (t.closest("[data-imp]")) m.querySelector<HTMLInputElement>("[data-file]")!.click();
  });
  m.addEventListener("change", async (e) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.matches("[data-file]") || !inp.files?.[0]) return;
    try {
      const c = importEditor(await inp.files[0].text());
      Object.assign(d, c);
      render();
      toast("Pacote de nomes importado");
      onDone();
    } catch (err) {
      toast(err instanceof Error && /Editor/.test(err.message) ? err.message : "Não consegui ler esse arquivo.");
    }
  });
}
