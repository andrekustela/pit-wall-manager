// Ficha do piloto (janela): idade, nacionalidade, estilo, atributos e preferências de acerto.
import type { DriverProfile } from "../sim/drivers";
import { esc, natBadge } from "./common";
import { CAREERS } from "../sim/legendsHistory";

const ATTRS: [keyof DriverProfile, string, string][] = [
  ["pace", "Velocidade", "Ritmo puro de volta rápida"],
  ["consistency", "Consistência", "Quanto o tempo varia de uma volta pra outra"],
  ["aggression", "Agressividade", "Tenta mais ultrapassagens, mas se envolve em mais toques"],
  ["overtaking", "Ultrapassagem", "Ganha mais disputas na freada"],
  ["defending", "Defesa", "Segura melhor a posição"],
  ["tyreCare", "Cuidado com pneu", "Gasta menos pneu"],
  ["wet", "Chuva", "Perde menos tempo com a pista molhada"],
  ["feedback", "Feedback de acerto", "Explica no rádio exatamente o que mudar no carro"],
];

function barColor(v: number) {
  return v >= 85 ? "#3bd16f" : v >= 70 ? "#9ad13b" : v >= 55 ? "#ffd23b" : v >= 40 ? "#ff8a1c" : "#ff3b3b";
}

function prefText(p: DriverProfile): string {
  const bal = p.balancePref > 4 ? "gosta de traseira mais solta" : p.balancePref < -4 ? "gosta de carro mais preso na frente" : "equilíbrio neutro";
  const st = p.stiffPref > 6 ? "suspensão mais dura" : p.stiffPref < -6 ? "suspensão mais macia" : "suspensão no meio-termo";
  return `${bal} · ${st}`;
}

export function driverCardHtml(p: DriverProfile, team: string, color: string): string {
  return `<div class="dcard">
    <div class="dhead" style="border-left:5px solid ${color}">
      <div class="dname">${natBadge(p)} ${esc(p.name)} <span class="dshort">${esc(p.short)}</span></div>
      <div class="dsub">${esc(team)} · ${p.age} anos · ${esc(p.country)}</div>
      <div class="dtags"><span class="dtag">${esc(p.style)}</span><span class="drating" title="Nota geral">${p.rating}</span></div>
    </div>
    <div class="dattrs">${ATTRS.map(
      ([k, label, tip]) => `<div class="dattr" title="${esc(tip)}"><span>${label}</span>
        <span class="dbar"><i style="width:${p[k]}%;background:${barColor(p[k] as number)}"></i></span><b>${p[k]}</b></div>`,
    ).join("")}</div>
    <div class="dpref">Preferência de acerto: ${esc(prefText(p))}</div>
    ${careerHtml(p)}
  </div>`;
}

export function showDriverCards(drivers: DriverProfile[], team: string, color: string) {
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel" style="width:min(820px,100%)">
    <div class="helphead"><b>PILOTOS · ${esc(team.toUpperCase())}</b><button class="hbtn" data-close>✕</button></div>
    <div class="cols">${drivers.map((d) => driverCardHtml(d, team, color)).join("")}</div>
    <p class="hint">Os pilotos são sorteados a cada jogo novo. Cada um tem um jeito de pilotar e um gosto de acerto: o que é perfeito pra um pode não ser pro outro.</p>
  </div>`;
  m.addEventListener("click", (e) => {
    if (e.target === m || (e.target as HTMLElement).closest("[data-close]")) m.remove();
  });
  document.body.appendChild(m);
}

/** revela o reserva: carta virando + comparação com quem saiu */
export function showReserveReveal(gone: DriverProfile, came: DriverProfile, team: string, color: string) {
  const diff = came.rating - gone.rating;
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel" style="width:min(560px,100%)">
    <div class="helphead"><b>🎲 PILOTO RESERVA</b></div>
    <p class="hint" style="margin-top:0">Sai ${esc(gone.name)} (${gone.rating}). Entra…</p>
    <div class="flip"><div class="flip-back">?</div><div class="flip-front">${driverCardHtml(came, team, color)}</div></div>
    <p class="reserve-verdict" style="opacity:0;transition:opacity .4s;font-family:var(--pix);font-size:14px;margin:12px 0 0;color:${diff > 0 ? "var(--ok)" : diff < 0 ? "var(--soft)" : "var(--muted)"}">
      ${diff > 0 ? `MELHOROU! +${diff} na nota geral` : diff < 0 ? `PIOROU… ${diff} na nota geral` : "MESMA NOTA GERAL"}</p>
    <button class="go" data-close style="margin-top:12px">OK ▶</button>
  </div>`;
  m.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-close]")) m.remove();
  });
  document.body.appendChild(m);
  setTimeout(() => m.querySelector(".flip")!.classList.add("on"), 700);
  setTimeout(() => ((m.querySelector(".reserve-verdict") as HTMLElement).style.opacity = "1"), 1400);
}

/** carreira real (só pros pilotos da opção "Lendas") */
function careerHtml(p: DriverProfile): string {
  const c = p.id.startsWith("r_") ? CAREERS[p.short] : undefined;
  if (!c) return "";
  return `<div class="dcareer">
    <div class="dct">CARREIRA NA F1 · ${esc(c.years)}</div>
    <div class="dcstats"><span><b>${esc(c.starts)}</b> corridas</span><span><b>${c.titles ? c.titles.split(",").length : 0}</b> título(s)</span><span><b>${esc(c.wins)}</b> vitórias</span></div>
    ${c.titles ? `<div class="dcrow">🏆 ${esc(c.titles)}</div>` : ""}
    <div class="dcrow">Equipes: ${esc(c.teams)}</div>
    <div class="dcnote">${esc(c.note)}</div>
  </div>`;
}
