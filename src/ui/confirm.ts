// Janela de confirmação no estilo do jogo (no lugar do confirm() do navegador).
import { esc } from "./common";

export interface ConfirmOptions {
  title: string;
  text: string;
  ok?: string;
  cancel?: string;
  /** botão de confirmar em vermelho (ação que não dá pra desfazer) */
  danger?: boolean;
  icon?: string;
}

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "helpmodal confirmmodal";
    m.innerHTML = `<div class="helpbox panel confirmbox">
      <div class="helphead"><b>${o.icon ? `${o.icon} ` : ""}${esc(o.title)}</b></div>
      <div class="confirmtext">${esc(o.text).replace(/\n/g, "<br>")}</div>
      <div class="row-btns" style="justify-content:flex-end">
        <button class="btn" data-no>${esc(o.cancel ?? "CANCELAR")}</button>
        <button class="btn ${o.danger ? "primary" : "okbtn"}" data-yes>${esc(o.ok ?? "CONFIRMAR")}</button>
      </div>
    </div>`;
    const done = (v: boolean) => {
      m.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        done(true);
      }
    };
    m.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t === m || t.closest("[data-no]")) done(false);
      else if (t.closest("[data-yes]")) done(true);
    });
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(m);
    m.querySelector<HTMLButtonElement>("[data-yes]")!.focus();
  });
}
