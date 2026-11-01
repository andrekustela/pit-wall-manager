// Editor de pintura do carro, do emblema e do uniforme do piloto da equipe, com prévia ao vivo.
import { carImage } from "../render/carArt";
import { loadPilotPreview, pilotPreview, pilotThumb, type Part } from "../render/driver3d";
import { previewCanvas } from "../render/car3d";
import { emblemSvg } from "../render/emblem";
import { TEAMS } from "../sim/data";
import { EMBLEM_SHAPES, EMBLEM_SYMBOLS, GLOVE_STYLES, HELMET_STYLES, PATTERNS, SHOE_STYLES, SUIT_STYLES, cleanLivery, defaultLivery, initialsOf, type Livery } from "../sim/livery";
import type { Team } from "../sim/types";
import { esc, toast } from "./common";
import { isPlus, isPremium } from "./support";
import { showStickerEditor } from "./stickerEditor";
import { showViewer3d } from "./viewer3d";
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
  let tab: "carro" | "emblema" | "piloto" = "carro";
  /** sub-aba da aba PILOTO: cada peça do uniforme com as cores e os desenhos dela */
  let ptab: "capacete" | "macacao" | "luvas" | "tenis" = "capacete";

  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel livbox">
    <div class="helphead"><b>🎨 PINTURA, EMBLEMA E UNIFORME DA EQUIPE</b><button class="btn small" data-x>✕</button></div>
    <div class="livgrid">
      <div class="livprev">
        <canvas class="livcar"></canvas>
        <div class="livemb"></div>
        <div class="livname">${esc(teamName || t0.name)}</div>
      </div>
      <div class="livctrl"></div>
    </div>
    <div class="row-btns" style="justify-content:space-between;margin-top:12px">
      <div class="row-btns" style="margin:0"><button class="btn" data-reset>CORES ORIGINAIS DA EQUIPE</button><button class="btn" data-3d>🧊 VER EM 3D</button></div>
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
    if (tab === "piloto") {
      // piloto em pé com o uniforme e os desenhos (capacete, macacão, luvas): foto assada do 3D e tingida em 2D
      const pp = pilotPreview(lv);
      if (!pp) {
        void loadPilotPreview().then((ok) => ok && m.isConnected && drawCar());
        return;
      }
      const k = H / pp.height;
      g.drawImage(pp, W / 2 - (pp.width * k) / 2, 0, pp.width * k, H);
      return;
    }
    const img = previewCanvas(previewTeam(lv), () => carImage(previewTeam(lv)).canvas);
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
    const tabs = `<div class="seg" style="margin-bottom:10px"><button data-tab="carro" class="${tab === "carro" ? "on" : ""}">CARRO</button><button data-tab="emblema" class="${tab === "emblema" ? "on" : ""}">EMBLEMA</button><button data-tab="piloto" class="${tab === "piloto" ? "on" : ""}">PILOTO</button></div>`;
    if (tab === "carro") {
      box.innerHTML = `${tabs}
        <div class="livsec"><b>CORES</b><div class="livcols">
          ${colorField("base", "Principal", lv.base)}${colorField("accent", "Secundária", lv.accent)}${colorField("patternColor", "Detalhes", lv.patternColor)}${colorField("wing", "Asas", lv.wing)}
        </div>
        <div class="livpal">${PALETTES.map((p, i) => `<button class="livpalb" data-pal="${i}" title="Paleta pronta" style="background:linear-gradient(135deg, ${p[0]} 0 50%, ${p[1]} 50% 80%, ${p[2]} 80%)"></button>`).join("")}</div></div>
        <div class="livsec"><b>ESTILO DA PINTURA</b><div class="livpats">${freeFirst(PATTERNS).map(([p]) => `<button class="livpat ${p.id === lv.pattern ? "on" : ""} ${p.plus ? "plus" : ""}" data-pat="${p.id}"><canvas data-patcv="${p.id}"></canvas><span>${esc(p.label)}${p.plus ? " ★" : ""}</span></button>`).join("")}</div>
          <p class="hint" style="margin:6px 0 0">★ = pacote Plus${isPlus() ? " (ativo)" : ": clique pra ver a prévia no carro; pra salvar, ❤ Apoiar o jogo no menu"}.</p></div>
        <div class="livsec"><b>ADESIVOS ★★ PREMIUM</b>
          <button class="m2btn small" data-stickers style="width:100%;clip-path:none"><b>★★ CRIAR MEU CARRO</b><span>${lv.stickers?.length ? `${lv.stickers.length} adesivo(s) no carro` : "Estrelas, raios, números, textos... onde você quiser"}</span><i>▶</i></button></div>`;
      // miniaturas de cada estilo (com as cores atuais)
      box.querySelectorAll<HTMLCanvasElement>("[data-patcv]").forEach((cv) => {
        const id = cv.dataset.patcv as Livery["pattern"];
        cv.width = 96;
        cv.height = 40;
        const g = cv.getContext("2d")!;
        const pt = previewTeam({ ...lv, pattern: id });
        const img = previewCanvas(pt, () => carImage(pt).canvas);
        const k = Math.min(96 / img.width, 40 / img.height);
        g.drawImage(img, (96 - img.width * k) / 2, (40 - img.height * k) / 2, img.width * k, img.height * k);
      });
    } else if (tab === "piloto") {
      const P = {
        capacete: { t: "CAPACETE", cores: "CORES DO CAPACETE", des: "DESENHO DO CAPACETE", part: "h" as Part, list: HELMET_STYLES, cur: lv.helmetStyle ?? 1, cols: [["helmet", "Capacete", lv.helmet], ["helmetDetail", "Detalhe", lv.helmetDetail]] },
        macacao: { t: "MACACÃO", cores: "CORES DO MACACÃO", des: "DESENHO DO MACACÃO", part: "s" as Part, list: SUIT_STYLES, cur: lv.suitStyle ?? 1, cols: [["suit", "Macacão", lv.suit], ["suitDetail", "Faixas e detalhe", lv.suitDetail]] },
        luvas: { t: "LUVAS", cores: "CORES DAS LUVAS", des: "DESENHO DAS LUVAS", part: "g" as Part, list: GLOVE_STYLES, cur: lv.gloveStyle ?? 0, cols: [["glove", "Luvas", lv.glove ?? lv.suit], ["gloveDetail", "Detalhe", lv.gloveDetail ?? lv.suitDetail]] },
        tenis: { t: "TÊNIS", cores: "CORES DO TÊNIS", des: "DESENHO DO TÊNIS", part: "f" as Part, list: SHOE_STYLES, cur: lv.shoeStyle ?? 0, cols: [["shoe", "Tênis", lv.shoe ?? lv.suit], ["shoeDetail", "Detalhe", lv.shoeDetail ?? lv.suitDetail]] },
      };
      const c = P[ptab];
      box.innerHTML = `${tabs}
        <div class="seg livsub">${(Object.keys(P) as (keyof typeof P)[]).map((k) => `<button data-ptab="${k}" class="${k === ptab ? "on" : ""}">${P[k].t}</button>`).join("")}</div>
        <div class="livsec"><b>${c.cores}</b><div class="livcols">${c.cols.map(([k, l, v]) => colorField(k, l, v)).join("")}</div></div>
        ${styleRow(c.des, c.part, c.list, c.cur)}
        <p class="hint" style="margin:6px 0 0">★ = pacote Plus${isPlus() ? " (ativo)" : ": clique pra ver a prévia; pra salvar, ❤ Apoiar o jogo no menu"}. O desenho aparece no piloto aqui do lado, no <b>VER EM 3D</b> e no carro 3D da corrida.</p>
        <button class="btn small" data-suitcar style="margin-top:10px">UNIFORME TODO COM AS CORES DO CARRO</button>
        <p class="hint">É o piloto que sobe no pódio e que aparece no carro 3D na corrida (capacete, macacão, luvas e tênis). Os dois pilotos da equipe usam o mesmo uniforme. No online, todo mundo vê o seu.</p>`;
      drawThumbs();
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

  /** na tela, os grátis primeiro e os do Plus depois (o número guardado na pintura continua o da lista) */
  const freeFirst = <T extends { plus?: boolean }>(list: T[]): [T, number][] => list.map((x, i) => [x, i] as [T, number]).sort((a, b) => Number(!!a[0].plus) - Number(!!b[0].plus));
  /** botões de desenho de uma peça (h capacete, s macacão, g luvas, f tênis), cada um com a miniatura */
  const styleBtns = (part: Part, list: { label: string; plus?: boolean }[], cur: number) =>
    freeFirst(list).map(([s, i]) => `<button data-pstyle="${part}${i}" class="${cur === i ? "on" : ""} ${s.plus ? "plus" : ""}"><canvas class="livth" data-th="${part}${i}"></canvas>${esc(s.label)}${s.plus ? " ★" : ""}</button>`).join("");
  const styleRow = (title: string, part: Part, list: { label: string; plus?: boolean }[], cur: number) => `<div class="livsec"><b>${title}</b><div class="seg livstyles">${styleBtns(part, list, cur)}</div></div>`;
  /** desenha as miniaturas (o piloto assado, recortado na peça, com cada desenho e as cores de agora) */
  const drawThumbs = () => {
    const cvs = m.querySelectorAll<HTMLCanvasElement>("canvas[data-th]");
    if (!cvs.length) return;
    if (!pilotThumb(lv, "h", 0)) {
      void loadPilotPreview().then((ok) => ok && m.isConnected && drawThumbs());
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of cvs) {
      const part = cv.dataset.th![0] as Part, i = Number(cv.dataset.th!.slice(1));
      const img = pilotThumb(lv, part, i)!;
      cv.width = 48 * dpr;
      cv.height = 48 * dpr;
      const g = cv.getContext("2d")!, k = Math.min(cv.width / img.width, cv.height / img.height);
      g.drawImage(img, (cv.width - img.width * k) / 2, (cv.height - img.height * k) / 2, img.width * k, img.height * k);
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
      if (tab === "piloto") {
        clearTimeout(thumbT);
        thumbT = setTimeout(drawThumbs, 200);
      }
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
    const ps = t.closest<HTMLElement>("[data-pstyle]");
    if (ps) {
      const part = ps.dataset.pstyle![0] as Part, i = Number(ps.dataset.pstyle!.slice(1));
      const list = { h: HELMET_STYLES, s: SUIT_STYLES, g: GLOVE_STYLES, f: SHOE_STYLES }[part];
      // (Plus: dá pra escolher e ver a prévia; pra salvar precisa do Plus)
      if (!isPlus() && list.at(i)?.plus) toast("★ Prévia do pacote Plus: veja como fica. Pra salvar, ative o Plus em ❤ Apoiar o jogo.");
      if (part === "h") lv.helmetStyle = i;
      else if (part === "s") lv.suitStyle = i;
      else if (part === "g") lv.gloveStyle = i;
      else lv.shoeStyle = i;
      update();
      renderCtrl();
      return;
    }
    const tb = t.closest<HTMLElement>("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab as typeof tab;
      renderCtrl();
      renderPreview();
      return;
    }
    const pt = t.closest<HTMLElement>("[data-ptab]");
    if (pt) {
      ptab = pt.dataset.ptab as typeof ptab;
      renderCtrl();
      return;
    }
    if (t.closest("[data-suitcar]")) {
      lv.suit = lv.base;
      lv.suitDetail = lv.accent;
      lv.helmet = lv.accent;
      lv.helmetDetail = lv.base;
      lv.glove = lv.base;
      lv.gloveDetail = lv.accent;
      lv.shoe = lv.base;
      lv.shoeDetail = lv.accent;
      update();
      renderCtrl();
      return;
    }
    const pat = t.closest<HTMLElement>("[data-pat]");
    if (pat) {
      lv.pattern = pat.dataset.pat as Livery["pattern"];
      if (!isPlus() && PATTERNS.find((p) => p.id === lv.pattern)?.plus) toast("★ Prévia do pacote Plus: veja como fica. Pra salvar, ative o Plus em ❤ Apoiar o jogo.");
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
    if (t.closest("[data-3d]")) return void showViewer3d(previewTeam(cleanLivery(lv)!));
    if (t.closest("[data-stickers]"))
      return showStickerEditor(lv, teamId, (list) => {
        lv.stickers = list;
        update();
        renderCtrl();
        if (list.length && !isPremium()) toast("★★ Adesivos em prévia: pra salvar a pintura com eles, ative o Premium em ❤ Apoiar o jogo.");
      });
    if (t.closest("[data-save]")) {
      // (com item do Plus na prévia e sem o Plus: não salva, explica o que está em prévia)
      if (!isPlus()) {
        const using = [
          PATTERNS.find((p) => p.id === lv.pattern)?.plus ? "a pintura" : "",
          HELMET_STYLES.at(lv.helmetStyle ?? 1)?.plus ? "o capacete" : "",
          SUIT_STYLES.at(lv.suitStyle ?? 1)?.plus ? "o macacão" : "",
          GLOVE_STYLES.at(lv.gloveStyle ?? 0)?.plus ? "as luvas" : "",
          SHOE_STYLES.at(lv.shoeStyle ?? 0)?.plus ? "o tênis" : "",
        ].filter(Boolean);
        if (using.length) return toast(`★ ${using.join(", ")} ${using.length > 1 ? "são" : "é"} do pacote Plus (prévia). Ative o Plus em ❤ Apoiar o jogo ou escolha um sem ★.`);
      }
      if (!isPremium() && lv.stickers?.length) return toast("★★ Os adesivos são do Premium (prévia). Ative o Premium em ❤ Apoiar o jogo, ou tire os adesivos em CRIAR MEU CARRO.");
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
