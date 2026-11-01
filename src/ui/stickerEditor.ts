// CRIAR MEU CARRO (Premium): adesivos onde a pessoa quiser no carro. O carro aparece grande, visto de cima
// (o modelo 3D de verdade, o mesmo das corridas; o desenho 2D só enquanto o 3D carrega);
// clicar num adesivo da paleta põe ele no meio, arrastar move, e o painel muda tamanho, giro, cor, texto e se
// espelha do outro lado. Sem o Premium dá pra montar e ver (prévia); só salvar é que pede.
import { TEAMS } from "../sim/data";
import { MAX_STICKERS, STICKERS, cleanLivery, type Livery, type Sticker, type StickerKind } from "../sim/livery";
import type { Team } from "../sim/types";
import { RES, SQUASH, carImage } from "../render/carArt";
import { esc, toast } from "./common";
import { isPremium } from "./support";
import { showViewer3d } from "./viewer3d";

/** abre o editor; `onDone` recebe os adesivos (só quando a pessoa confirma) */
export function showStickerEditor(lv: Livery, teamId: string, onDone: (stickers: Sticker[]) => void) {
  const t0 = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  let list: Sticker[] = (lv.stickers ?? []).map((s) => ({ ...s }));
  let sel = list.length ? list.length - 1 : -1;
  const team = (): Team => ({ ...t0, id: "stk-preview", color: lv.base, accent: lv.accent, livery: cleanLivery({ ...lv, stickers: list })! });

  const m = document.createElement("div");
  m.className = "helpmodal";
  m.style.zIndex = "265";
  m.innerHTML = `<div class="helpbox panel stkbox">
    <div class="helphead"><b>★★ CRIAR MEU CARRO</b><button class="btn small" data-x>✕</button></div>
    <p class="hint" style="margin:0 0 8px">Escolha um adesivo e ele aparece no meio do carro; arraste pra onde quiser. ${isPremium() ? "Premium ativo." : "Prévia do Premium: monte e veja à vontade; pra usar nas corridas, ative o Premium em ❤ Apoiar o jogo."}</p>
    <div class="stkgrid"><canvas class="stkcv"></canvas><div class="stkside"></div></div>
    <div class="stkpal">${STICKERS.map((s) => `<button class="btn small" data-add="${s.id}">${esc(s.label)}</button>`).join("")}</div>
    <div class="row-btns" style="justify-content:space-between;margin-top:12px">
      <div class="row-btns" style="margin:0"><button class="btn" data-clear>TIRAR TODOS</button><button class="btn" data-3d>🧊 VER EM 3D</button></div>
      <div class="row-btns" style="margin:0"><button class="btn" data-x>CANCELAR</button><button class="btn primary" data-ok>USAR ESTES ADESIVOS</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const cv = m.querySelector<HTMLCanvasElement>(".stkcv")!, side = m.querySelector<HTMLElement>(".stkside")!;
  // enquadramento: o carro deitado (frente pra direita), o maior que couber. Tela = (ox + x·ax, oy + y·ay)
  // pros metros (x, y) do desenho da pintura
  let view = { ox: 0, oy: 0, ax: 1, ay: 1 };
  let top3d: typeof import("../render/viewer3dScene") | null = null;
  void import("../render/viewer3dScene")
    .then(async (mod) => {
      await mod.prepareTop();
      top3d = mod;
      if (m.isConnected) draw();
    })
    .catch(() => {
      /* sem 3D: fica o desenho 2D */
    });

  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 620, H = cv.clientHeight || 300;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#2b2f38";
    g.fillRect(0, 0, W, H);
    const t3 = top3d?.renderTop(team(), W, H, dpr);
    if (t3) {
      g.drawImage(t3.canvas, 0, 0, W, H);
      view = { ox: W / 2 + 0.25 * t3.k, oy: H / 2, ax: 1.02 * t3.k, ay: t3.k };
    } else {
      const img = carImage(team()).canvas;
      const s = Math.min((W * 0.94) / img.width, (H * 0.94) / img.height);
      const x0 = (W - img.width * s) / 2, y0 = (H - img.height * s) / 2;
      g.drawImage(img, x0, y0, img.width * s, img.height * s);
      view = { ox: x0 + (img.width / 2) * s, oy: y0 + (img.height / 2) * s, ax: RES * SQUASH * s, ay: RES * s };
    }
    // contorno do adesivo escolhido
    const st = list[sel];
    if (st) {
      const [x, y] = toScreen(st.x, st.y);
      const r = st.s * view.ay * 0.62;
      g.strokeStyle = "#ffd23b";
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.strokeRect(x - r, y - r, r * 2, r * 2);
      g.setLineDash([]);
    }
  };
  /** metros do desenho do carro <-> pixels da tela */
  const toScreen = (mx: number, my: number): [number, number] => [view.ox + mx * view.ax, view.oy + my * view.ay];
  const toCar = (px: number, py: number): [number, number] => [(px - view.ox) / view.ax, (py - view.oy) / view.ay];

  const renderSide = () => {
    const st = list[sel];
    side.innerHTML = st
      ? `<div class="livsec"><b>${esc(STICKERS.find((k) => k.id === st.k)!.label.toUpperCase())}</b>
          <label class="sndrow"><span>Tamanho</span><input type="range" min="5" max="250" data-p="s" value="${Math.round(st.s * 100)}"></label>
          <label class="sndrow"><span>Giro</span><input type="range" min="-180" max="180" data-p="r" value="${Math.round((st.r * 180) / Math.PI)}"></label>
          <label class="livcol"><input type="color" data-p="c" value="${st.c}"><span>Cor</span></label>
          ${st.k === "texto" ? `<label class="fld"><span>Texto</span><input class="txt" data-p="t" maxlength="14" value="${esc(st.t ?? "")}"></label>` : ""}
          <label class="toggle"><input type="checkbox" data-p="m" ${st.m ? "checked" : ""}><span><b>Espelhar</b><br><span class="hint" style="margin:0">Repete do outro lado do carro</span></span></label>
          <div class="row-btns" style="margin-top:8px"><button class="btn small" data-dup>DUPLICAR</button><button class="btn small" data-up>▲ POR CIMA</button><button class="btn small" data-del>APAGAR</button></div></div>
        <p class="hint">${list.length} de ${MAX_STICKERS} adesivos.</p>`
      : `<p class="hint">Nenhum adesivo escolhido. Clique num da lista de baixo pra colocar, ou num adesivo do carro pra mexer nele.</p><p class="hint">${list.length} de ${MAX_STICKERS} adesivos.</p>`;
  };
  const refresh = () => {
    draw();
    renderSide();
  };

  // ---- arrastar ----
  let drag: { dx: number; dy: number } | null = null;
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect(), [mx, my] = toCar(e.clientX - r.left, e.clientY - r.top);
    // o mais de cima que estiver embaixo do clique (o espelhado também conta)
    let hit = -1;
    for (let i = list.length - 1; i >= 0 && hit < 0; i--) {
      const st = list[i];
      for (const sy of st.m ? [1, -1] : [1]) if (Math.hypot(mx - st.x, my - st.y * sy) < Math.max(0.12, st.s * 0.5)) hit = i;
    }
    sel = hit;
    if (hit >= 0) {
      drag = { dx: mx - list[hit].x, dy: my - list[hit].y };
      cv.setPointerCapture(e.pointerId);
    }
    refresh();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drag || !list[sel]) return;
    const r = cv.getBoundingClientRect(), [mx, my] = toCar(e.clientX - r.left, e.clientY - r.top);
    list[sel].x = Math.max(-2.6, Math.min(2.6, mx - drag.dx));
    list[sel].y = Math.max(-1, Math.min(1, my - drag.dy));
    draw();
  });
  cv.addEventListener("pointerup", () => (drag = null));

  // ---- painel e paleta ----
  m.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement, st = list[sel], p = el.dataset.p;
    if (!st || !p) return;
    if (p === "s") st.s = Number(el.value) / 100;
    else if (p === "r") st.r = (Number(el.value) * Math.PI) / 180;
    else if (p === "c") st.c = el.value;
    else if (p === "t") st.t = el.value;
    else if (p === "m") st.m = el.checked;
    draw();
  });
  const close = () => {
    m.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel >= 0 && !(e.target as HTMLElement).matches("input")) {
      list.splice(sel, 1);
      sel = -1;
      refresh();
    }
  };
  window.addEventListener("keydown", onKey, true);
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    const add = t.closest<HTMLElement>("[data-add]");
    if (add) {
      if (list.length >= MAX_STICKERS) return toast(`No máximo ${MAX_STICKERS} adesivos.`);
      const k = add.dataset.add as StickerKind;
      // (nasce na lateral, espelhado: no meio fica embaixo do cockpit e da tomada de ar e não aparece)
      list.push({ k, x: -0.7, y: 0.42, r: 0, s: k === "listra" ? 1.2 : k === "texto" || k === "numero" ? 0.9 : 0.4, c: lv.accent === lv.base ? "#ffffff" : lv.accent, m: true, ...(k === "texto" ? { t: "PIT WALL" } : {}) });
      sel = list.length - 1;
      return refresh();
    }
    const st = list[sel];
    if (st && t.closest("[data-dup]")) {
      if (list.length >= MAX_STICKERS) return toast(`No máximo ${MAX_STICKERS} adesivos.`);
      list.push({ ...st, x: Math.min(2.6, st.x + 0.3) });
      sel = list.length - 1;
      return refresh();
    }
    if (st && t.closest("[data-up]")) {
      list.splice(sel, 1);
      list.push(st);
      sel = list.length - 1;
      return refresh();
    }
    if (st && t.closest("[data-del]")) {
      list.splice(sel, 1);
      sel = -1;
      return refresh();
    }
    if (t.closest("[data-clear]")) {
      list = [];
      sel = -1;
      return refresh();
    }
    if (t.closest("[data-3d]")) return void showViewer3d(team());
    if (t.closest("[data-ok]")) {
      onDone(list);
      close();
    }
  });
  requestAnimationFrame(refresh);
}
