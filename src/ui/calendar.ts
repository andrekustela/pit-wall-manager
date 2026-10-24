// Calendário da temporada do campeonato: as pistas sorteadas, na ordem, com o que
// já foi corrido (vencedor) e a próxima etapa em destaque. Aparece no começo de
// cada temporada e fica numa aba da sede.
import type { ChampState } from "../sim/championship";
import { profileOf } from "../sim/drivers";
import { CIRCUITS } from "../sim/track";
import { drawTrackThumb, esc, trackTagsHtml } from "./common";

/** grade com as etapas (as miniaturas são desenhadas depois, com drawCalendarThumbs) */
export function calendarHtml(ch: ChampState): string {
  const next = ch.results.length;
  const cards = ch.rounds
    .map((t, i) => {
      const c = CIRCUITS[t];
      const r = ch.results[i];
      const st = r ? "done" : i === next ? "next" : "";
      const win = r ? profileOf(r.order[0])?.name ?? "" : "";
      return `<div class="calcard ${st}" style="--d:${Math.min(i, 30) * 22}ms">
        <div class="calnum">${String(i + 1).padStart(2, "0")}</div>
        <canvas data-calt="${t}"></canvas>
        <div class="calname">${esc(c?.name ?? "")}</div>
        <div class="ttags">${trackTagsHtml(t, 3)}</div>
        <div class="calinfo">${r ? `🏆 ${esc(win)}` : i === next ? "PRÓXIMA ETAPA" : `chuva ${Math.round((c?.rainChance ?? 0) * 100)}%`}</div>
      </div>`;
    })
    .join("");
  return `<div class="calgrid">${cards}</div>`;
}

export function drawCalendarThumbs(root: HTMLElement) {
  const cvs = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-calt]")];
  let k = 0;
  const some = () => {
    const t0 = performance.now();
    while (k < cvs.length && performance.now() - t0 < 8) {
      const cv = cvs[k++];
      if (cv.isConnected) drawTrackThumb(cv, Number(cv.dataset.calt));
    }
    if (k < cvs.length) requestAnimationFrame(some);
  };
  requestAnimationFrame(some);
}

/** tela do calendário no começo da temporada (fecha com o botão, Enter ou Esc) */
export function showCalendar(ch: ChampState, onClose?: () => void) {
  const m = document.createElement("div");
  m.className = "helpmodal calmodal";
  m.innerHTML = `<div class="helpbox panel calbox">
      <div class="calhead"><div><div class="hint" style="margin:0">${esc(ch.name ?? "Campeonato")}</div>
        <h1 class="title" style="margin:2px 0 0">CALENDÁRIO DA <span>TEMPORADA ${ch.season ?? 1}</span></h1>
        <p class="sub" style="margin:4px 0 0">${ch.rounds.length} etapas sorteadas · ${ch.season && ch.season > 1 ? "pistas novas a cada temporada" : "na próxima temporada sai um sorteio novo"}</p></div></div>
      ${calendarHtml(ch)}
      <div class="row-btns" style="margin-top:16px"><button class="go" data-go style="margin:0">VAMOS LÁ ▶</button></div>
    </div>`;
  document.body.appendChild(m);
  drawCalendarThumbs(m);
  const close = () => {
    m.remove();
    window.removeEventListener("keydown", onKey, true);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  m.querySelector("[data-go]")!.addEventListener("click", close);
}
