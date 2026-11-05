// CRIAR MEU CARRO (Premium): adesivos onde a pessoa quiser. Dois editores, cada um com a sua lista:
// - 3D (Livery.decals): o carro 3D de verdade, o mesmo das corridas. Arrastar o fundo gira o carro, a roda
//   aproxima; arrastar um adesivo leva ele pela carroceria (colado na direção dela, como um adesivo de verdade:
//   não estica nem corta);
// - 2D (Livery.stickers): o carro 2D ESTILIZADO visto de cima (o clássico usa os mesmos adesivos); arrastar move.
// Clicar num adesivo da paleta põe ele no carro, e o painel muda tamanho, giro, cor, texto e se repete do outro
// lado. Sem o Premium dá pra montar e ver (prévia); só salvar é que pede.
import { TEAMS } from "../sim/data";
import { MAX_STICKERS, STICKERS, cleanLivery, type Decal, type Livery, type Sticker, type StickerKind } from "../sim/livery";
import type { Team } from "../sim/types";
import { RES, SQUASH, carImage } from "../render/carArt";
import { car3dFrame, car3dPreview } from "../render/car3d";
import type { Viewer3d } from "../render/viewer3dScene";
import { esc, toast } from "./common";
import { isPremium } from "./support";

type Item = Sticker | Decal;

/**
 * adesivo do carro 3D -> o mesmo visto de cima no 2D (⇩ GERAR DO 3D); null = na lateral (de cima não aparece).
 * Lugar: o encaixe da pintura (x 2D = (z - 0,25)/1,02; y 2D, + = direita = -x do carro). Giro: o "cima" do desenho
 * 3D em cima do carro aponta pro outro lado (cars3dReal.decalFrames): pro lado esquerdo (+x) se ele está do lado
 * direito, e vice-versa; visto de cima isso dá -r ou π - r
 */
function from3d(d: Decal): Sticker | null {
  if (d.n[1] < 0.35) return null;
  const { p, n, ...look } = d;
  return { ...look, x: Math.max(-2.6, Math.min(2.6, (p[2] - 0.25) / 1.02)), y: Math.max(-1, Math.min(1, -p[0])), r: n[0] > 0 ? Math.PI - d.r : -d.r };
}

/** abre o editor; `onDone` recebe os adesivos daquele modo (só quando a pessoa confirma) */
export function showStickerEditor(lv: Livery, teamId: string, mode: "2d" | "3d", onDone: (part: Pick<Livery, "stickers" | "decals">) => void) {
  const t0 = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  const key = mode === "3d" ? "decals" : "stickers";
  let list: Item[] = ((lv[key] ?? []) as Item[]).map((s) => ({ ...s }));
  let sel = list.length ? list.length - 1 : -1;
  const team = (): Team => ({ ...t0, id: "stk-preview", color: lv.base, accent: lv.accent, livery: cleanLivery({ ...lv, [key]: list })! });

  // TELA CHEIA, como o editor do autódromo: o carro ocupa a tela; à esquerda as abas ADESIVOS / CAMADAS, à direita
  // o adesivo escolhido, em cima a barra com o título e os botões
  const m = document.createElement("div");
  m.className = "stked";
  m.innerHTML = `${mode === "3d" ? `<div class="stkcv"><p class="hint stkwait" data-wait>Montando o carro em 3D…</p></div>` : `<canvas class="stkcv"></canvas>`}
    <div class="stkbar panel"><b>★★ CRIAR MEU CARRO ${mode.toUpperCase()}</b>
      <button class="btn small" data-clear>TIRAR TODOS</button>${mode === "2d" ? `<button class="btn small" data-from3d title="Os adesivos de cima do carro 3D viram os do 2D (e dá pra mexer depois)">⇩ GERAR DO 3D</button>` : ""}
      <span style="flex:1"></span><button class="btn small" data-x>CANCELAR</button><button class="btn small primary" data-ok>USAR ESTES ADESIVOS</button></div>
    <div class="stkleft panel"></div><div class="stkright panel" hidden></div>
    <div class="stkhint">${mode === "3d" ? "Escolha um adesivo à esquerda: ele aparece no carro, perto do meio da tela. <b>Arraste</b> o adesivo pela carroceria; arraste o fundo pra girar o carro e use a <b>roda</b> pra aproximar." : "O carro 2D estilizado visto de cima (o 2D simples usa os mesmos adesivos). Escolha um adesivo à esquerda e <b>arraste</b> pra onde quiser."} <b>Del</b> apaga · <b>Esc</b> cancela. ${isPremium() ? "Premium ativo." : "Prévia do Premium: monte à vontade; pra usar nas corridas, ative o Premium em ❤ Apoiar o jogo."}</div>`;
  document.body.appendChild(m);
  const host = m.querySelector<HTMLElement>(".stkcv")!, left = m.querySelector<HTMLElement>(".stkleft")!, side = m.querySelector<HTMLElement>(".stkright")!;
  /** aba da esquerda */
  let tab: "adesivos" | "camadas" = "adesivos";
  const onResize = () => mode === "2d" && draw();
  window.addEventListener("resize", onResize);

  // ---- 3D ----
  let view: Viewer3d | null = null;
  if (mode === "3d")
    void import("../render/viewer3dScene")
      .then((mod) => mod.mountViewer(host, team(), true))
      .then((v) => {
        if (!m.isConnected) return v.stop();
        view = v;
        host.querySelector("[data-wait]")?.remove();
        draw();
      })
      .catch((err) => {
        console.error(err);
        toast("Não deu pra abrir o 3D agora.");
      });

  // ---- 2D: o carro deitado (frente pra direita), o maior que couber. Tela = (ox + x·ax, oy + y·ay) ----
  let v2 = { ox: 0, oy: 0, ax: 1, ay: 1 };
  const draw = () => {
    if (mode === "3d") return view?.decals(team().livery!, sel);
    const cv = host as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 620, H = cv.clientHeight || 300;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#2b2f38";
    g.fillRect(0, 0, W, H);
    // o 2D ESTILIZADO (o clássico sai dos mesmos adesivos); o clássico só enquanto o estilizado carrega
    const sty = car3dPreview(team()), fr = car3dFrame();
    if (!sty || !fr) setTimeout(() => m.isConnected && draw(), 300);
    const img = sty && fr ? sty : carImage(team()).canvas;
    // (no espaço entre os painéis da esquerda e da direita, abaixo da barra de cima; tela estreita: a tela toda)
    const aw = W > 900 ? W - 580 : W, ah = H - 130;
    // (75% do espaço e nunca maior que a imagem: ampliado, o 2D fica borrado)
    const s = Math.min((aw * 0.75) / img.width, (ah * 0.75) / img.height, 1);
    const x0 = (W - img.width * s) / 2, y0 = 70 + (ah - img.height * s) / 2;
    g.drawImage(img, x0, y0, img.width * s, img.height * s);
    v2 =
      sty && fr
        ? { ox: x0 + (fr.W / 2 + 0.25 * fr.px) * s, oy: y0 + fr.cy * s, ax: 1.02 * fr.px * s, ay: fr.px * s }
        : { ox: x0 + (img.width / 2) * s, oy: y0 + (img.height / 2) * s, ax: RES * SQUASH * s, ay: RES * s };
    // contorno do adesivo escolhido
    const st = list[sel] as Sticker | undefined;
    if (st) {
      const r = st.s * v2.ay * 0.62;
      g.strokeStyle = "#ffd23b";
      g.setLineDash([5, 4]);
      g.lineWidth = 2;
      g.strokeRect(v2.ox + st.x * v2.ax - r, v2.oy + st.y * v2.ay - r, r * 2, r * 2);
      g.setLineDash([]);
    }
  };
  /** pixels da tela -> metros do desenho do carro 2D */
  const toCar = (e: PointerEvent): [number, number] => {
    const r = host.getBoundingClientRect();
    return [(e.clientX - r.left - v2.ox) / v2.ax, (e.clientY - r.top - v2.oy) / v2.ay];
  };

  const renderSide = () => {
    const st = list[sel];
    side.hidden = !st;
    side.innerHTML = st
      ? `<div class="livsec"><b>${esc(STICKERS.find((k) => k.id === st.k)!.label.toUpperCase())}</b>
          <label class="sndrow"><span>Tamanho</span><input type="range" min="5" max="250" data-p="s" value="${Math.round(st.s * 100)}"></label>
          <label class="sndrow"><span>Giro</span><input type="range" min="-180" max="180" data-p="r" value="${Math.round((st.r * 180) / Math.PI)}"></label>
          <label class="livcol"><input type="color" data-p="c" value="${st.c}"><span>Cor</span></label>
          ${st.k === "texto" ? `<label class="fld"><span>Texto</span><input class="txt" data-p="t" maxlength="14" value="${esc(st.t ?? "")}"></label>` : ""}
          <label class="toggle"><input type="checkbox" data-p="fx" ${st.fx ? "checked" : ""}><span><b>Espelhado ↔</b><br><span class="hint" style="margin:0">O desenho virado de lado</span></span></label>
          <label class="toggle"><input type="checkbox" data-p="fy" ${st.fy ? "checked" : ""}><span><b>Invertido ↕</b><br><span class="hint" style="margin:0">O desenho de ponta-cabeça</span></span></label>
          <label class="toggle"><input type="checkbox" data-p="m" ${st.m ? "checked" : ""}><span><b>Nos dois lados</b><br><span class="hint" style="margin:0">${mode === "3d" ? "O outro lado também, com o texto legível" : "Repete do outro lado do carro"}</span></span></label>
          <div class="row-btns" style="margin-top:8px"><button class="btn small" data-dup>DUPLICAR</button><button class="btn small" data-del>APAGAR</button></div></div>`
      : "";
  };
  /** painel da esquerda: abas ADESIVOS (a paleta) e CAMADAS (de cima pra baixo; a de cima cobre as de baixo) */
  const renderLeft = () => {
    const tabs = `<div class="stktabs">${([["adesivos", "ADESIVOS"], ["camadas", `CAMADAS (${list.length})`]] as const)
      .map(([k, n]) => `<button class="btn small ${tab === k ? "primary" : ""}" data-tab="${k}">${n}</button>`)
      .join("")}</div>`;
    left.innerHTML =
      tabs +
      (tab === "adesivos"
        ? `<p class="hint" style="margin:0 0 6px">Clique pra colocar no carro (${list.length} de ${MAX_STICKERS}).</p><div class="stkpal">${STICKERS.map((s) => `<button class="btn small" data-add="${s.id}">${esc(s.label)}</button>`).join("")}</div>`
        : list.length
          ? `<p class="hint" style="margin:0 0 6px">A de cima cobre as de baixo. <b>Arraste</b> pra mudar a ordem; clique pra escolher. 👁 esconde, 🔒 trava no lugar.</p>
            <div class="stklayers">${list
              .map((_, n) => {
                const i = list.length - 1 - n, it = list[i];
                return `<div class="stklayer ${i === sel ? "on" : ""} ${it.h ? "off" : ""}" draggable="true" data-row="${i}"><i style="background:${it.c}"></i><span>${esc(STICKERS.find((k) => k.id === it.k)!.label)}${it.k === "texto" && it.t ? ` "${esc(it.t)}"` : ""}</span>
                  <button class="btn small" data-eye="${i}" title="${it.h ? "Mostrar" : "Esconder"}">${it.h ? "◌" : "👁"}</button><button class="btn small ${it.l ? "on" : ""}" data-lock="${i}" title="${it.l ? "Destravar" : "Travar: não sai do lugar clicando no carro"}">${it.l ? "🔒" : "🔓"}</button></div>`;
              })
              .join("")}</div>`
          : `<p class="hint">Nenhum adesivo ainda. Coloque na aba ADESIVOS.</p>`);
  };
  // arrastar camadas: solta em cima de outra linha = fica acima dela
  let dragRow = -1;
  left.addEventListener("dragstart", (e) => (dragRow = Number((e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row ?? -1)));
  left.addEventListener("dragover", (e) => {
    if (dragRow >= 0 && (e.target as HTMLElement).closest("[data-row]")) e.preventDefault();
  });
  left.addEventListener("drop", (e) => {
    const to = Number((e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row ?? -1);
    if (dragRow < 0 || to < 0 || to === dragRow) return;
    e.preventDefault();
    const [it] = list.splice(dragRow, 1);
    sel = dragRow < to ? to : to + 1;
    list.splice(sel, 0, it);
    dragRow = -1;
    refresh();
  });
  const refresh = () => {
    draw();
    renderSide();
    renderLeft();
  };

  // ---- arrastar ----
  let drag: { dx: number; dy: number } | null = null;
  host.addEventListener(
    "pointerdown",
    (e) => {
      if (mode === "3d") {
        // (fora de um adesivo: segue pro carro girar)
        const h = view?.hit(e.clientX, e.clientY);
        if (!h || h.under < 0) return;
        e.stopPropagation();
        sel = h.under;
        drag = { dx: 0, dy: 0 };
      } else {
        const [mx, my] = toCar(e);
        // o mais de cima que estiver embaixo do clique (o espelhado também conta)
        let hit = -1;
        for (let i = list.length - 1; i >= 0 && hit < 0; i--) {
          const st = list[i] as Sticker;
          // (escondido e travado não pegam o clique: passa pro de baixo)
          if (st.h || st.l) continue;
          for (const sy of st.m ? [1, -1] : [1]) if (Math.hypot(mx - st.x, my - st.y * sy) < Math.max(0.12, st.s * 0.5)) hit = i;
        }
        sel = hit;
        if (hit >= 0) drag = { dx: mx - (list[hit] as Sticker).x, dy: my - (list[hit] as Sticker).y };
      }
      if (drag) host.setPointerCapture(e.pointerId);
      refresh();
    },
    // (antes do giro do carro, que escuta no canvas lá dentro)
    true,
  );
  host.addEventListener("pointermove", (e) => {
    if (!drag || !list[sel] || list[sel].l) return;
    if (mode === "3d") {
      const h = view?.hit(e.clientX, e.clientY), d = list[sel] as Decal;
      if (!h) return;
      d.p = h.p;
      d.n = h.n;
    } else {
      const [mx, my] = toCar(e), st = list[sel] as Sticker;
      st.x = Math.max(-2.6, Math.min(2.6, mx - drag.dx));
      st.y = Math.max(-1, Math.min(1, my - drag.dy));
    }
    draw();
  });
  host.addEventListener("pointerup", () => (drag = null));

  /** onde nasce o adesivo 3D: a carroceria no meio da tela (perto dele, se o meio cair no piloto ou fora do carro) */
  const spot3d = () => {
    // (em anéis cada vez maiores em volta do meio: o primeiro ponto de carroceria achado é o mais perto do meio;
    // o meio exato costuma cair no piloto)
    const r = host.getBoundingClientRect(), R = Math.min(r.width, r.height);
    for (let k = 0; k <= 10; k++)
      for (let a = 0; a < (k ? 12 : 1); a++) {
        const h = view?.hit(r.left + r.width / 2 + Math.cos((a * Math.PI) / 6) * k * R * 0.035, r.top + r.height / 2 + Math.sin((a * Math.PI) / 6) * k * R * 0.035);
        if (h) return h;
      }
    return null;
  };

  // ---- painel e paleta ----
  m.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement, st = list[sel], p = el.dataset.p;
    if (!st || !p) return;
    if (p === "s") st.s = Number(el.value) / 100;
    else if (p === "r") st.r = (Number(el.value) * Math.PI) / 180;
    else if (p === "c") st.c = el.value;
    else if (p === "t") st.t = el.value;
    else if (p === "m" || p === "fx" || p === "fy") st[p] = el.checked;
    draw();
  });
  const close = () => {
    view?.stop();
    m.remove();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
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
    if (t.closest("[data-x]")) return close();
    const tb = t.closest<HTMLElement>("[data-tab]");
    if (tb) {
      tab = tb.dataset.tab as typeof tab;
      return renderLeft();
    }
    const add = t.closest<HTMLElement>("[data-add]");
    if (add) {
      if (list.length >= MAX_STICKERS) return toast(`No máximo ${MAX_STICKERS} adesivos.`);
      const k = add.dataset.add as StickerKind;
      const big = k === "listra" ? 1.2 : k === "texto" || k === "numero" ? 0.9 : 0.4;
      const look = { k, r: 0, c: lv.accent === lv.base ? "#ffffff" : lv.accent, m: true, ...(k === "texto" ? { t: "PIT WALL" } : {}) };
      if (mode === "3d") {
        if (!view) return toast("Espere o carro 3D carregar.");
        const h = spot3d();
        if (!h) return toast("Não achei a carroceria perto do meio da tela: gire ou aproxime o carro e clique de novo.");
        list.push({ ...look, p: h.p, n: h.n, s: big * 0.7 });
      } else
        // (nasce no sidepod, espelhado: no meio fica embaixo do cockpit e da tomada de ar)
        list.push({ ...look, x: -0.7, y: 0.42, s: big });
      sel = list.length - 1;
      return refresh();
    }
    const st = list[sel];
    if (st && t.closest("[data-dup]")) {
      if (list.length >= MAX_STICKERS) return toast(`No máximo ${MAX_STICKERS} adesivos.`);
      // (um pouco pra trás; no 3D, arrastar encaixa ele de novo na carroceria)
      list.push("p" in st ? { ...st, p: [st.p[0], st.p[1], st.p[2] - 0.3] } : { ...st, x: Math.min(2.6, st.x + 0.3) });
      sel = list.length - 1;
      return refresh();
    }
    // camadas: olho, cadeado e clicar na linha escolhe
    const eye = t.closest<HTMLElement>("[data-eye]"), lock = t.closest<HTMLElement>("[data-lock]"), row = t.closest<HTMLElement>("[data-row]");
    if (eye || lock) {
      const it = list[Number((eye ?? lock)!.dataset[eye ? "eye" : "lock"])];
      if (eye) it.h = !it.h || undefined;
      else it.l = !it.l || undefined;
      return refresh();
    }
    if (row) {
      sel = Number(row.dataset.row);
      return refresh();
    }
    if (t.closest("[data-from3d]")) {
      const got = (lv.decals ?? []).map(from3d).filter((s): s is Sticker => !!s);
      if (!got.length) return toast(lv.decals?.length ? "Os adesivos do 3D estão todos na lateral: de cima eles não aparecem." : "O carro 3D ainda não tem adesivo. Crie em CRIAR MEU CARRO 3D.");
      list = got;
      sel = -1;
      toast(`${got.length} adesivo(s) do 3D no carro 2D${got.length < lv.decals!.length ? ` (${lv.decals!.length - got.length} da lateral ficaram de fora: de cima não aparecem)` : ""}. Dá pra mexer à vontade; CANCELAR desfaz.`);
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
    if (t.closest("[data-ok]")) {
      onDone({ [key]: list });
      close();
    }
  });
  requestAnimationFrame(refresh);
}
