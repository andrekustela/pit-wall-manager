// Janela de backup dos campeonatos: exportar/importar num arquivo e a lixeira (apagados há até 30 dias).
import { CIRCUITS } from "../sim/track";
import { esc, toast } from "./common";
import { exportBackup, importBackup, restoreFromTrash, trashList } from "./saves";

export function showBackup(onChange: () => void) {
  const m = document.createElement("div");
  m.className = "helpmodal";
  const render = () => {
    const trash = trashList();
    m.innerHTML = `<div class="helpbox panel profbox">
      <div class="helphead"><b>🗂 BACKUP DOS CAMPEONATOS</b><button class="btn small" data-x>✕</button></div>
      <p class="hint" style="margin:0 0 10px">O jogo já guarda sozinho a versão anterior de cada campeonato e manda os apagados pra lixeira. O arquivo serve pra guardar uma cópia sua ou levar pra outro computador (ou do navegador pro programa de PC).</p>
      <div class="row-btns" style="margin:0 0 14px"><button class="btn primary" data-exp>⬇ EXPORTAR ARQUIVO</button><button class="btn" data-imp>⬆ IMPORTAR ARQUIVO</button>
        <input type="file" accept=".json,application/json" data-file hidden></div>
      <h3 class="m2psub">LIXEIRA</h3>
      ${trash.length
        ? trash
            .map(({ s, at }) => {
              const ch = s.champ;
              return `<div class="m2champ"><div class="m2champtop"><b>${esc(ch.name ?? "Campeonato")}</b></div>
                <div class="hint" style="margin:4px 0 8px">Etapa ${ch.results.length} de ${ch.rounds.length}${ch.finished ? " · concluído" : ` · próxima: ${esc(CIRCUITS[ch.rounds[ch.results.length]]?.name ?? "")}`} · apagado em ${new Date(at).toLocaleDateString("pt-BR")}</div>
                <button class="btn small" data-restore="${esc(ch.id ?? "")}">RESTAURAR</button></div>`;
            })
            .join("")
        : `<p class="hint" style="margin:0">Vazia. Campeonatos apagados ficam aqui por 30 dias.</p>`}
    </div>`;
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
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    if (t.closest("[data-exp]")) {
      const url = URL.createObjectURL(new Blob([exportBackup()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `pit-wall-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Backup exportado");
    }
    if (t.closest("[data-imp]")) m.querySelector<HTMLInputElement>("[data-file]")!.click();
    const r = t.closest<HTMLElement>("[data-restore]");
    if (r && restoreFromTrash(r.dataset.restore!)) {
      toast("Campeonato restaurado");
      render();
      onChange();
    }
  });
  m.addEventListener("change", async (e) => {
    const inp = e.target as HTMLInputElement;
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const { added, updated } = importBackup(await f.text());
      toast(added || updated ? `Importado: ${added} novo(s), ${updated} atualizado(s)` : "Nada novo nesse arquivo (você já tem tudo)");
      onChange();
    } catch (err) {
      toast(err instanceof Error && /Pit Wall/.test(err.message) ? err.message : "Não consegui ler esse arquivo.");
    }
    inp.value = "";
  });
}
