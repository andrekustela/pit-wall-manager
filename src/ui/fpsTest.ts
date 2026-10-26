// Resultado do TESTE DE FPS (Configurações > Gráficos): a corrida de demonstração (?auto&fpsteste)
// mede 20 s com as opções escolhidas e mostra o FPS médio, o dos piores momentos e o que dá pra desligar.
import { gfx } from "../render/gfx";

export function showFpsResult(times: number[]) {
  if (times.length < 10) return;
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const avg = 1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
  // "1% mais lento": os quadros que mais demoraram (é o que dá a sensação de travada)
  const worst = gaps.slice(Math.floor(gaps.length * 0.99));
  const low = 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length);
  const g = gfx();
  const tips: string[] = [];
  if (avg < 50 || low < 30) {
    if (g.carStyle === "real" && g.aa) tips.push("Desligue o antisserrilhado");
    if (g.carStyle === "real" && g.shadows === "alto") tips.push("Deixe as sombras em MÉDIO ou BAIXO");
    else if (g.carStyle === "real") tips.push("Use os carros em 2D ESTILIZADO");
    else if (g.carStyle === "sprite") tips.push("Use os carros em 2D (o mais leve)");
    if (g.onboard) tips.push("Desligue a câmera onboard nos cards");
    if (g.sparks === "alto" || g.smoke === "alto") tips.push("Deixe faíscas e fumaça em BAIXO");
    if (g.skids === "alto") tips.push("Deixe as marcas de pneu em BAIXO");
    if (g.rain === "alto") tips.push("Deixe a chuva em BAIXO");
    tips.push("Ou use a predefinição BAIXO (ou MÍNIMO)");
  }
  const verdict = avg >= 55 && low >= 40 ? ["LISO", "#3bd16f"] : avg >= 40 ? ["JOGÁVEL", "#ffcc00"] : ["PESADO", "#ff4a4a"];
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel" style="max-width:460px;text-align:center">
    <div class="helphead"><b>▶ TESTE DE FPS</b></div>
    <div style="font-size:54px;font-weight:700;color:${verdict[1]};line-height:1">${Math.round(avg)} <small style="font-size:20px">FPS</small></div>
    <p style="margin:6px 0 2px"><b style="color:${verdict[1]}">${verdict[0]}</b> · nos piores momentos: <b>${Math.round(low)} FPS</b></p>
    ${g.fpsCap ? `<p class="hint">(com o limite de ${g.fpsCap} FPS ligado)</p>` : ""}
    ${tips.length ? `<div class="hint" style="text-align:left;margin:12px 0 0"><b>Pra ficar mais leve:</b><ul style="margin:6px 0 0 18px;padding:0">${tips.map((t) => `<li>${t}</li>`).join("")}</ul></div>` : `<p class="hint" style="margin-top:10px">Tudo certo com estas opções.</p>`}
    <div class="row-btns" style="justify-content:center;margin-top:14px"><button class="btn primary" data-back>VOLTAR PRAS CONFIGURAÇÕES</button></div>
  </div>`;
  document.body.appendChild(m);
  m.querySelector("[data-back]")!.addEventListener("click", () => (location.href = `${location.pathname}?config=graficos`));
}
