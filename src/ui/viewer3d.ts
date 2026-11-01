// Janela "VER EM 3D" (editor de pintura). O 3D (Three.js) só é baixado quando ela abre.
import type { Team } from "../sim/types";
import { toast } from "./common";

export async function showViewer3d(team: Team) {
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.style.zIndex = "270";
  m.innerHTML = `<div class="helpbox panel" style="width:min(900px,100%)">
    <div class="helphead"><b>🧊 VER EM 3D</b><button class="btn small" data-x>✕</button></div>
    <div class="v3dhost" style="width:100%;height:min(520px,62vh);background:#1a1f2b;position:relative"><p class="hint" style="position:absolute;inset:auto 0 45% 0;text-align:center" data-wait>Montando o carro e o piloto em 3D…</p></div>
    <p class="hint" style="margin:8px 0 0">Arraste pra girar, roda do mouse pra aproximar. Mostra também o que é prévia do pacote Plus.</p></div>`;
  document.body.appendChild(m);
  let off: (() => void) | null = null, closed = false;
  const close = () => {
    closed = true;
    off?.();
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
    if (t === m || t.closest("[data-x]")) close();
  });
  try {
    const { mountViewer } = await import("../render/viewer3dScene");
    const host = m.querySelector<HTMLElement>(".v3dhost")!;
    const stop = await mountViewer(host, team);
    m.querySelector("[data-wait]")?.remove();
    if (closed) stop();
    else off = stop;
  } catch (err) {
    console.error(err);
    toast("Não deu pra abrir o 3D agora.");
    close();
  }
}
