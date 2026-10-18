// Editor de pintura do carro e do emblema da equipe, com prévia ao vivo.
import { carImage } from "../render/carArt";
import { emblemSvg } from "../render/emblem";
import { TEAMS } from "../sim/data";
import { EMBLEM_SHAPES, EMBLEM_SYMBOLS, PATTERNS, cleanLivery, defaultLivery, initialsOf, type Livery } from "../sim/livery";
import type { Team } from "../sim/types";
import { esc } from "./common";
import { getLivery, setLivery } from "./liveryStore";

/** paletas prontas (principal, secundária, detalhe) */
const PALETTES: [string, string, string][] = [
  ["#e8202a", "#ffffff", "#111111"],
  ["#0a0a0a", "#ffd23b", "#ffffff"],
  ["#1c6ed4", "#ffd23b", "#ffffff"],
  ["#00a19c", "#c8ccd2", "#0a0a0a"],
  ["#ff8000", "#1d2a44", "#ffffff"],
  ["#f2f2f2", "#e8202a", "#1c6ed4"],
  ["#2d8a3e", "#ffd23b", "#ffffff"],
  ["#7a1fa2", "#00e5ff", "#ffffff"],
  ["#ff4fa3", "#111111", "#ffffff"],
  ["#5a5f6b", "#ff3b3b", "#ffffff"],
];

/**
 * Abre o editor. `teamId` = equipe atual (pras cores padrão); `teamName` pras iniciais.
 * `onSave(null)` = voltar pras cores originais da equipe.
 */
export function showLiveryEditor(current: Livery | null, teamId: string, teamName: string, onSave: (l: Livery | null) => void) {
  const t0 = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  let lv: Livery = current ? { ...current, emblem: { ...current.emblem } } : defaultLivery(t0.color, t0.accent, teamName || t0.name);
  let tab: "carro" | "emblema" = "carro";

  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel livbox">
    <div class="helphead"><b>🎨 PINTURA E EMBLEMA DA EQUIPE</b><button class="btn small" data-x>✕</button></div>
    <div class="livgrid">
      <div class="livprev">
        <canvas class="livcar"></canvas>
        <div class="livemb"></div>
        <div class="livname">${esc(teamName || t0.name)}</div>
      </div>
      <div class="livctrl"></div>
    </div>
    <div class="row-btns" style="justify-content:space-between;margin-top:12px">
      <button class="btn" data-reset>CORES ORIGINAIS DA EQUIPE</button>
      <div class="row-btns" style="margin:0"><button class="btn" data-x>CANCELAR</button><button class="btn primary" data-save>SALVAR PINTURA</button></div>
    </div>
  </div>`;
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

  const previewTeam = (l: Livery): Team => ({ ...t0, id: "preview", color: l.base, accent: l.accent, livery: l });

  /** carro grande na prévia (sobre asfalto, apontando pra cima) */
  const drawCar = () => {
    const cv = m.querySelector<HTMLCanvasElement>(".livcar")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 260, H = cv.clientHeight || 340;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#3a3b40");
    bg.addColorStop(1, "#2b2c31");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,.12)";
    for (let y = 12; y < H; y += 36) g.fillRect(W / 2 - 1, y, 2, 18);
    const img = carImage(previewTeam(lv)).canvas;
    const scale = Math.min((H * 0.9) / img.width, (W * 0.9) / img.height);
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-Math.PI / 2);
    g.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
    g.restore();
  };

  const renderPreview = () => {
    drawCar();
    m.querySelector(".livemb")!.innerHTML = emblemSvg(lv.emblem, 120);
  };

  const colorField = (key: string, label: string, val: string) =>
    `<label class="livcol"><input type="color" data-col="${key}" value="${val}"><span>${label}</span></label>`;

  const renderCtrl = () => {
    const box = m.querySelector<HTMLElement>(".livctrl")!;
    const tabs = `<div class="seg" style="margin-bottom:10px"><button data-tab="carro" class="${tab === "carro" ? "on" : ""}">CARRO</button><button data-tab="emblema" class="${tab === "emblema" ? "on" : ""}">EMBLEMA</button></div>`;
    if (tab === "carro") {
      box.innerHTML = `${tabs}
        <div class="livsec"><b>CORES</b><div class="livcols">
          ${colorField("base", "Principal", lv.base)}${colorField("accent", "Secundária", lv.accent)}${colorField("patternColor", "Detalhes", lv.patternColor)}${colorField("wing", "Asas", lv.wing)}
        </div>
        <div class="livpal">${PALETTES.map((p, i) => `<button class="livpalb" data-pal="${i}" title="Paleta pronta" style="background:linear-gradient(135deg, ${p[0]} 0 50%, ${p[1]} 50% 80%, ${p[2]} 80%)"></button>`).join("")}</div></div>
        <div class="livsec"><b>ESTILO DA PINTURA</b><div class="livpats">${PATTERNS.map((p) => `<button class="livpat ${p.id === lv.pattern ? "on" : ""}" data-pat="${p.id}"><canvas data-patcv="${p.id}"></canvas><span>${esc(p.label)}</span></button>`).join("")}</div></div>`;
      // miniaturas de cada estilo (com as cores atuais)
      box.querySelectorAll<HTMLCanvasElement>("[data-patcv]").forEach((cv) => {
        const id = cv.dataset.patcv as Livery["pattern"];
        cv.width = 96;
        cv.height = 40;
        const g = cv.getContext("2d")!;
        const img = carImage(previewTeam({ ...lv, pattern: id })).canvas;
        const k = Math.min(96 / img.width, 40 / img.height);
        g.drawImage(img, (96 - img.width * k) / 2, (40 - img.height * k) / 2, img.width * k, img.height * k);
      });
    } else {
      const e = lv.emblem;
      box.innerHTML = `${tabs}
        <div class="livsec"><b>FORMATO</b><div class="livopts">${EMBLEM_SHAPES.map((s) => `<button class="livopt ${s.id === e.shape ? "on" : ""}" data-shape="${s.id}">${emblemSvg({ ...e, shape: s.id }, 44)}<span>${s.label}</span></button>`).join("")}</div></div>
        <div class="livsec"><b>SÍMBOLO</b><div class="livopts">${EMBLEM_SYMBOLS.map((s) => `<button class="livopt ${s.id === e.symbol ? "on" : ""}" data-sym="${s.id}">${emblemSvg({ ...e, symbol: s.id }, 44)}<span>${s.label}</span></button>`).join("")}</div>
          <label class="fld" style="margin-top:8px"><span>Iniciais (até 3 letras)</span><input class="txt" data-ini maxlength="3" value="${esc(e.initials)}" style="width:110px;text-transform:uppercase"></label></div>
        <div class="livsec"><b>CORES</b><div class="livcols">${colorField("e.bg", "Fundo", e.bg)}${colorField("e.border", "Borda", e.border)}${colorField("e.fg", "Símbolo", e.fg)}</div>
          <button class="btn small" data-embcar style="margin-top:8px">USAR AS CORES DO CARRO</button></div>`;
    }
  };

  const update = () => {
    lv = cleanLivery(lv)!;
    renderPreview();
  };

  m.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    const k = el.dataset.col;
    if (k) {
      if (k.startsWith("e.")) (lv.emblem as unknown as Record<string, string>)[k.slice(2)] = el.value;
      else (lv as unknown as Record<string, string>)[k] = el.value;
      update();
      if (tab === "carro" && (k === "base" || k === "accent" || k === "patternColor" || k === "wing")) {
        // miniaturas acompanham as cores
        clearTimeout(thumbT);
        thumbT = setTimeout(renderCtrl, 250);
      }
    }
    if (el.dataset.num !== undefined) {
      lv.number = Number(el.value);
      update();
    }
    if (el.dataset.ini !== undefined) {
      lv.emblem.initials = el.value;
      update();
    }
  });
  let thumbT: ReturnType<typeof setTimeout> | undefined;

  m.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    const tb = t.closest<HTMLElement>("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab as typeof tab;
      renderCtrl();
      return;
    }
    const pat = t.closest<HTMLElement>("[data-pat]");
    if (pat) {
      lv.pattern = pat.dataset.pat as Livery["pattern"];
      update();
      renderCtrl();
    }
    const pal = t.closest<HTMLElement>("[data-pal]");
    if (pal) {
      const [a, b, c] = PALETTES[Number(pal.dataset.pal)];
      lv.base = a;
      lv.accent = b;
      lv.patternColor = c;
      lv.wing = b;
      update();
      renderCtrl();
    }
    const sh = t.closest<HTMLElement>("[data-shape]");
    if (sh) {
      lv.emblem.shape = sh.dataset.shape as Livery["emblem"]["shape"];
      update();
      renderCtrl();
    }
    const sy = t.closest<HTMLElement>("[data-sym]");
    if (sy) {
      lv.emblem.symbol = sy.dataset.sym as Livery["emblem"]["symbol"];
      update();
      renderCtrl();
    }
    if (t.closest("[data-embcar]")) {
      lv.emblem.bg = lv.base;
      lv.emblem.border = lv.accent;
      lv.emblem.fg = lv.patternColor === lv.base ? "#ffffff" : lv.patternColor;
      update();
      renderCtrl();
    }
    if (t.closest("[data-reset]")) {
      onSave(null);
      close();
    }
    if (t.closest("[data-save]")) {
      if (!lv.emblem.initials) lv.emblem.initials = initialsOf(teamName || t0.name);
      onSave(cleanLivery(lv));
      close();
    }
  });

  renderCtrl();
  requestAnimationFrame(renderPreview);
}

/** abre o editor com a pintura salva e, ao salvar, guarda e avisa a sala (se tiver) */
export function editMyLivery(teamId: string, teamName: string, conn?: { send(m: { t: "livery"; livery: Livery | null }): void }, after?: () => void) {
  showLiveryEditor(getLivery(), teamId, teamName, (l) => {
    setLivery(l);
    conn?.send({ t: "livery", livery: l });
    after?.();
  });
}
