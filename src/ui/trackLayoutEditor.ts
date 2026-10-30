// Editor de traçado (Editor > TRAÇADO): mexe no desenho das pistas do jogo (tamanho, curvas) ou cria
// pistas novas "não oficiais". Arrastar um ponto puxa os vizinhos junto (alcance ajustável), duplo clique
// põe ponto, botão direito no ponto tira; DESENHAR DO ZERO clica os pontos de uma pista nova. O carro de
// teste (worker) acha o traçado ideal. Fica salvo neste navegador (src/sim/trackMods.ts); EXPORTAR gera o
// pacote da pista (traçado + autódromo 3D) pra mandar pros outros importarem.
import { ACTIVE_TRACKS, CIRCUITS, ORIGINAL_CIRCUITS, TRACK_WIDTH, Track, applyTrackMods, trackCurve, type TrackDef, type Vec } from "../sim/track";
import { RACING_LINES } from "../sim/racingLines";
import { loadEdits, loadMods, saveEdit, saveMod, type ModTrack } from "../sim/trackMods";
import { esc, toast } from "./common";

const CSS = `
.tle{position:fixed;inset:0;z-index:9000;background:#16301c;user-select:none}
.tle canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.tle .tlebar{position:absolute;left:10px;right:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tle .tleside{position:absolute;right:10px;top:60px;width:280px;max-height:calc(100% - 70px);overflow:auto;padding:10px;box-sizing:border-box}
.tle .tleside h4{margin:10px 0 6px;font-size:12px;letter-spacing:.08em;opacity:.8}
.tle .tlefld{display:flex;flex-direction:column;gap:3px;margin:6px 0;font-size:12px}
.tle .tlewarn{color:#ffb347;font-size:12px;margin:4px 0}
.tle .tlehint{position:absolute;left:10px;bottom:10px;right:300px;font-size:12px;opacity:.9;text-shadow:0 1px 2px #000;pointer-events:none}
.tle .tleprog{height:6px;background:#0006;border-radius:3px;overflow:hidden;margin:6px 0}
.tle .tleprog>i{display:block;height:100%;background:#ffd21a;width:0}
`;

const slug = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** pista nova: um oval simples de ~3,6 km pra começar a mexer */
function starterPoints(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    // (oval com retas: superelipse)
    const c = Math.cos(a), s = Math.sin(a);
    out.push([Math.sign(c) * Math.pow(Math.abs(c), 0.45) * 750, Math.sign(s) * Math.pow(Math.abs(s), 0.45) * 330]);
  }
  return out;
}

type Target = { t: "edit"; idx: number } | { t: "mod"; id: string };

export function showTrackLayoutEditor(onDone: () => void = () => {}) {
  if (!document.getElementById("tle-css")) {
    const st = document.createElement("style");
    st.id = "tle-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement("div");
  root.className = "tle";
  root.innerHTML = `<canvas></canvas><div class="tlebar"></div><div class="tleside panel"></div><div class="tlehint"></div>`;
  document.body.appendChild(root);
  const cv = root.querySelector("canvas")!, g = cv.getContext("2d")!;
  const bar = root.querySelector<HTMLElement>(".tlebar")!, side = root.querySelector<HTMLElement>(".tleside")!, hint = root.querySelector<HTMLElement>(".tlehint")!;

  // ---- estado ----
  let target: Target = { t: "edit", idx: ACTIVE_TRACKS.find((i) => !CIRCUITS[i].mod) ?? ACTIVE_TRACKS[0] };
  /** pontos de controle no mundo (m) */
  let pts: [number, number][] = [];
  let meta: Omit<ModTrack, "points" | "targetLength" | "line"> = { id: "", name: "", blurb: "", minHeight: 5, balance: 0, rainChance: 0.25, grass: ["#3d8a3a", "#418f3d"] };
  let line: number[] | undefined;
  let dirty = false;
  let reach = 120;
  let drawing: [number, number][] | null = null;
  let undo: string[] = [];
  let preview: Track | null = null;
  let warns: string[] = [];
  let calc: { p: number; w: Worker } | null = null;
  // vista: centro (m) e escala (px por m)
  let vx = 0, vy = 0, sc = 0.3;

  const defNow = (): TrackDef => {
    const base = target.t === "edit" ? ORIGINAL_CIRCUITS[target.idx] : null;
    const L = trackCurve(pts, 8).length;
    return base
      ? { ...base, points: pts, targetLength: L, lineKey: "-", marks: undefined }
      : { name: meta.name || "Pista nova", blurb: meta.blurb, points: pts, targetLength: L, minHeight: meta.minHeight, balance: meta.balance, rainChance: meta.rainChance, grass: meta.grass, street: meta.street, night: meta.night, realStart: true, lineKey: "-" };
  };

  /** abre uma pista do jogo (com a edição deste navegador, se tiver) ou uma não oficial */
  const open = (t: Target) => {
    target = t;
    calc?.w.terminate();
    calc = null;
    undo = [];
    dirty = false;
    if (t.t === "edit") {
      const o = ORIGINAL_CIRCUITS[t.idx], e = loadEdits()[o.name];
      const src = e ?? o;
      // (os pontos do jogo vêm numa escala qualquer: passa pro tamanho de verdade, em metros)
      const k = src.targetLength / trackCurve(src.points, 8).length;
      pts = src.points.map(([x, y]) => [x * k, y * k]);
      line = e?.line;
      meta = { id: "", name: o.name, blurb: o.blurb, minHeight: o.minHeight, balance: o.balance, rainChance: o.rainChance, grass: o.grass };
    } else {
      const m = loadMods().find((x) => x.id === t.id);
      if (!m) return;
      pts = m.points.map(([x, y]) => [x, y]);
      line = m.line;
      const { points: _p, targetLength: _l, line: _ln, ...rest } = m;
      meta = rest;
    }
    fit();
    rebuild();
  };
  const newTrack = () => {
    const id = Date.now().toString(36);
    target = { t: "mod", id };
    pts = starterPoints();
    line = undefined;
    meta = { id, name: "Minha pista", blurb: "Pista não oficial feita no editor.", minHeight: 5, balance: 0, rainChance: 0.25, grass: ["#3d8a3a", "#418f3d"] };
    undo = [];
    dirty = true;
    fit();
    rebuild();
  };

  /** prévia (pista montada do jeito do jogo) e os avisos: curva apertada demais, cruzamento, tamanho */
  const rebuild = () => {
    warns = [];
    try {
      const def = defNow();
      // (mostra o traçado ideal calculado)
      if (line) RACING_LINES.__previa = { o: line, gain: 0, lap: 0 };
      preview = new Track({ ...def, lineKey: line ? "__previa" : "-" });
      let kMax = 0;
      for (let s = 0; s < preview.L; s += 2) kMax = Math.max(kMax, Math.abs(preview.curvature[s] ?? 0));
      if (kMax > 1 / 11) warns.push(`Curva apertada demais (raio de ${(1 / kMax).toFixed(0)} m): os carros quase param.`);
      if (preview.L < 1500) warns.push("Pista muito curta (menos de 1,5 km).");
      if (preview.L > 9000) warns.push("Pista muito longa (mais de 9 km).");
      if (crosses()) warns.push("O traçado cruza ele mesmo: os carros vão se encontrar no cruzamento.");
    } catch {
      preview = null;
      warns.push("Não deu pra montar a pista com esses pontos.");
    }
    render();
  };
  /** o traçado passa por cima dele mesmo? (fora o comecinho de cada trecho) */
  const crosses = () => {
    const c = trackCurve(pts, 10).pts, n = c.length;
    const hit = (a: Vec, b: Vec, p: Vec, q: Vec) => {
      const d = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x);
      if (Math.abs(d) < 1e-9) return false;
      const t = ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x)) / d, u = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / d;
      return t > 0 && t < 1 && u > 0 && u < 1;
    };
    for (let i = 0; i < n; i++)
      for (let j = i + 3; j < n; j++) {
        if (i === 0 && j >= n - 2) continue;
        if (hit(c[i], c[(i + 1) % n], c[j], c[(j + 1) % n])) return true;
      }
    return false;
  };

  // ---- vista ----
  const W = () => cv.clientWidth, H = () => cv.clientHeight;
  const toScr = (x: number, y: number) => [(x - vx) * sc + W() / 2, (y - vy) * sc + H() / 2] as const;
  const toWorld = (px: number, py: number) => [(px - W() / 2) / sc + vx, (py - H() / 2) / sc + vy] as const;
  const fit = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    vx = (x0 + x1) / 2;
    vy = (y0 + y1) / 2;
    sc = Math.min((W() - 340) / Math.max(1, x1 - x0 + 120), (H() - 120) / Math.max(1, y1 - y0 + 120));
  };

  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W() * dpr) || cv.height !== Math.round(H() * dpr)) {
      cv.width = Math.round(W() * dpr);
      cv.height = Math.round(H() * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#1d3a22";
    g.fillRect(0, 0, W(), H());
    // grade de 100 m
    g.strokeStyle = "rgba(255,255,255,.05)";
    g.lineWidth = 1;
    const [ax, ay] = toWorld(0, 0), [bx, by] = toWorld(W(), H());
    for (let x = Math.floor(ax / 100) * 100; x < bx; x += 100) {
      const [sx] = toScr(x, 0);
      g.beginPath();
      g.moveTo(sx, 0);
      g.lineTo(sx, H());
      g.stroke();
    }
    for (let y = Math.floor(ay / 100) * 100; y < by; y += 100) {
      const [, sy] = toScr(0, y);
      g.beginPath();
      g.moveTo(0, sy);
      g.lineTo(W(), sy);
      g.stroke();
    }
    if (pts.length >= 3) {
      const c = trackCurve(pts, 4).pts;
      const path = () => {
        g.beginPath();
        c.forEach((p, i) => {
          const [x, y] = toScr(p.x, p.y);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
      };
      g.lineJoin = "round";
      path();
      g.strokeStyle = "#e8e8e8";
      g.lineWidth = Math.max(3, (TRACK_WIDTH + 2) * sc);
      g.stroke();
      path();
      g.strokeStyle = "#3a3f4a";
      g.lineWidth = Math.max(2, TRACK_WIDTH * sc);
      g.stroke();
      // traçado ideal (se calculado)
      if (preview?.hasLine && !dirtyLine) {
        g.beginPath();
        for (let s = 0; s <= preview.L; s += 4) {
          const p = preview.pose(s % preview.L, preview.lineAt(s));
          const [x, y] = toScr(p.x, p.y);
          if (s) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.strokeStyle = "rgba(255,210,26,.85)";
        g.lineWidth = Math.max(1.5, 1.2 * sc);
        g.stroke();
      }
      // largada e sentido
      if (preview) {
        const p = preview.pose(0, 0), [x, y] = toScr(p.x, p.y);
        g.save();
        g.translate(x, y);
        g.rotate(p.h);
        const w = Math.max(10, TRACK_WIDTH * sc);
        for (let q = 0; q < 6; q++) {
          g.fillStyle = q % 2 ? "#111" : "#fff";
          g.fillRect(-3, -w / 2 + (q * w) / 6, 6, w / 6);
        }
        g.fillStyle = "#ffd21a";
        g.beginPath();
        g.moveTo(w * 0.9 + 14, 0);
        g.lineTo(w * 0.9, -7);
        g.lineTo(w * 0.9, 7);
        g.fill();
        g.restore();
      }
    }
    // pontos: de longe, só alguns (uns 28 px entre eles), pra não cobrir a pista; de perto, todos
    let gap = 0;
    for (let i = 1; i < pts.length; i++) gap += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / (pts.length - 1);
    const every = Math.max(1, Math.ceil(28 / Math.max(0.1, gap * sc)));
    pts.forEach(([x, y], i) => {
      if (i % every && i !== hover && i !== 0) return;
      const [sx, sy] = toScr(x, y);
      g.fillStyle = i === hover ? "#ff3b3b" : i === 0 ? "#22d36b" : "rgba(255,210,26,.9)";
      g.strokeStyle = "#000";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx, sy, i === hover ? 6 : 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
    // alcance do arraste
    if (hover >= 0 && !drawing) {
      const [sx, sy] = toScr(pts[hover][0], pts[hover][1]);
      g.strokeStyle = "rgba(255,210,26,.35)";
      g.setLineDash([6, 6]);
      g.beginPath();
      g.arc(sx, sy, reach * sc, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    // desenhando do zero
    if (drawing) {
      g.strokeStyle = "#ffd21a";
      g.lineWidth = 2;
      g.beginPath();
      drawing.forEach(([x, y], i) => {
        const [sx, sy] = toScr(x, y);
        if (i) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      if (mouseW) {
        const [sx, sy] = toScr(mouseW[0], mouseW[1]);
        g.lineTo(sx, sy);
      }
      g.stroke();
      for (const [x, y] of drawing) {
        const [sx, sy] = toScr(x, y);
        g.fillStyle = "#ffd21a";
        g.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }
  };
  /** o traçado ideal deixou de valer (mexeu no desenho depois de calcular) */
  let dirtyLine = false;

  // ---- painel ----
  const isMod = () => target.t === "mod";
  const renderBar = () => {
    const mods = loadMods(), edits = loadEdits();
    const opts = ACTIVE_TRACKS.filter((i) => !CIRCUITS[i].mod)
      .map((i) => `<option value="e${i}" ${target.t === "edit" && target.idx === i ? "selected" : ""}>${esc(ORIGINAL_CIRCUITS[i].name)}${edits[ORIGINAL_CIRCUITS[i].name] ? " (editada)" : ""}</option>`)
      .join("");
    const mopts = mods.map((m) => `<option value="m${m.id}" ${target.t === "mod" && target.id === m.id ? "selected" : ""}>${esc(m.name)} (não oficial)</option>`).join("");
    const unsavedNew = target.t === "mod" && !mods.some((m) => m.id === (target as { id: string }).id);
    bar.innerHTML = `<b style="margin-right:6px">TRAÇADO</b>
      <select class="txt" data-pick style="max-width:260px">${unsavedNew ? `<option selected>${esc(meta.name)} (nova, não salva)</option>` : ""}<optgroup label="Pistas do jogo">${opts}</optgroup>${mopts ? `<optgroup label="Não oficiais (suas)">${mopts}</optgroup>` : ""}</select>
      <button class="btn small" data-new>+ NOVA PISTA</button>
      <button class="btn small" data-draw ${drawing ? "disabled" : ""}>✎ DESENHAR DO ZERO</button>
      <button class="btn small primary" data-save>SALVAR</button>
      ${target.t === "edit" ? `<button class="btn small" data-orig>VOLTAR AO ORIGINAL</button>` : `<button class="btn small" data-delmod>APAGAR PISTA</button>`}
      <button class="btn small" data-exp>⬇ EXPORTAR PISTA</button>
      <button class="btn small" data-imp>⬆ IMPORTAR PISTA</button><input type="file" accept=".json" data-file hidden>
      <button class="btn small" disabled title="Em breve. Por enquanto as pistas são compartilhadas pelo arquivo exportado (offline): quem recebe usa ⬆ IMPORTAR PISTA.">☁ ENVIAR PISTA</button>
      <button class="btn small" data-exit>SAIR</button>
      ${dirty ? `<span class="hint">não salvo</span>` : ""}`;
  };
  const renderSide = () => {
    const L = preview?.L ?? trackCurve(pts, 8).length;
    side.innerHTML = `<h4>${isMod() ? "PISTA NÃO OFICIAL" : "PISTA DO JOGO"}</h4>
      ${isMod() ? `<label class="tlefld"><span>Nome</span><input class="txt" data-meta="name" value="${esc(meta.name)}" maxlength="40"></label>
      <label class="tlefld"><span>Descrição (aparece na tela inicial)</span><input class="txt" data-meta="blurb" value="${esc(meta.blurb)}" maxlength="140"></label>
      <label class="tlefld" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-meta="street" ${meta.street ? "checked" : ""}> circuito de rua (muro colado, prédios)</label>
      <label class="tlefld" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-meta="night" ${meta.night ? "checked" : ""}> corrida de noite</label>
      <label class="tlefld"><span>Chance de chuva: <b data-out="rain">${Math.round(meta.rainChance * 100)}%</b></span><input type="range" data-meta="rainChance" min="0" max="0.8" step="0.05" value="${meta.rainChance}"></label>` : `<b>${esc(meta.name)}</b><p class="hint" style="margin:4px 0">A edição fica só neste navegador. Pra ir pro jogo de todo mundo, exporte e me mande.</p>`}
      <h4>TAMANHO</h4>
      <label class="tlefld"><span>Comprimento: <b>${(L / 1000).toFixed(3)} km</b></span><input type="range" data-len min="1.5" max="9" step="0.01" value="${(L / 1000).toFixed(2)}"></label>
      <h4>MEXER NO DESENHO</h4>
      <label class="tlefld"><span>Alcance do arraste: <b data-out="reach">${reach} m</b></span><input type="range" data-reach min="0" max="600" step="10" value="${reach}"></label>
      <p class="hint" style="margin:2px 0">Arraste um ponto amarelo: os vizinhos dentro do alcance vêm junto, suave (0 = só o ponto). Duplo clique na pista põe ponto; botão direito no ponto tira. O ponto verde é o começo. Ctrl+Z desfaz.</p>
      <h4>TRAÇADO IDEAL</h4>
      ${calc ? `<div class="tleprog"><i style="width:${Math.round(calc.p * 100)}%"></i></div><p class="hint">O carro de teste está dando voltas... ${Math.round(calc.p * 100)}%</p><button class="btn small" data-stop>PARAR</button>`
        : `<p class="hint" style="margin:2px 0">${line && !dirtyLine ? "Calculado (linha amarela)." : "Sem traçado ideal: os carros andam pelo meio. Calcule depois de terminar o desenho."}</p><button class="btn small" data-line style="width:100%">🏎 CALCULAR TRAÇADO IDEAL</button>`}
      ${warns.length ? `<h4>AVISOS</h4>${warns.map((w) => `<div class="tlewarn">⚠ ${esc(w)}</div>`).join("")}` : ""}`;
    hint.innerHTML = drawing
      ? `<b>Desenhando:</b> clique os pontos da pista nova no sentido da corrida · <b>Enter</b> fecha a volta · Backspace tira o último · Esc cancela`
      : `<b>Mouse:</b> arrastar ponto mexe a pista · arrastar o fundo (ou botão direito) anda · roda dá zoom · duplo clique põe ponto · direito no ponto tira · <b>Ctrl+Z</b> desfaz`;
  };
  const render = () => {
    renderBar();
    renderSide();
    draw();
  };

  const snapshot = () => {
    undo.push(JSON.stringify(pts));
    if (undo.length > 40) undo.shift();
  };
  const changed = () => {
    dirty = true;
    if (line) dirtyLine = true;
    rebuild();
  };

  // ---- salvar / carregar / pacote ----
  const save = () => {
    if (pts.length < 6) return toast("A pista precisa de mais pontos");
    const L = trackCurve(pts, 8).length;
    const ln = dirtyLine ? undefined : line;
    if (target.t === "edit") saveEdit(ORIGINAL_CIRCUITS[target.idx].name, { points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), targetLength: Math.round(L), line: ln });
    else saveMod({ ...meta, points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), targetLength: Math.round(L), line: ln });
    applyTrackMods();
    dirty = false;
    toast(ln ? "Pista salva: já vale nas próximas corridas" : "Pista salva (sem traçado ideal: calcule pra os carros andarem melhor)");
    render();
  };
  const exportPkg = () => {
    const name = target.t === "edit" ? `${ORIGINAL_CIRCUITS[target.idx].name} (editada)` : meta.name;
    const pista: ModTrack = { ...meta, id: meta.id || Date.now().toString(36), name, points: pts, targetLength: Math.round(trackCurve(pts, 8).length), line: dirtyLine ? undefined : line };
    let autodromo: string | null = null;
    try {
      autodromo = localStorage.getItem(`pwm.autodromo.${slug(target.t === "edit" ? ORIGINAL_CIRCUITS[target.idx].name : meta.name)}`);
    } catch {
      /* sem */
    }
    const pkg = { formato: "pit-wall-pista", versao: 1, naoOficial: true, usoNaoComercial: true, pista, autodromo };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: "application/json" }));
    a.download = `pista-${slug(name)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Pacote da pista exportado (traçado + autódromo 3D, se tiver)");
  };
  const importPkg = (txt: string) => {
    const pkg = JSON.parse(txt) as { formato?: string; pista?: ModTrack; autodromo?: string | null };
    if (pkg.formato !== "pit-wall-pista" || !pkg.pista?.points?.length) throw new Error("não é um pacote de pista do Pit Wall");
    const m: ModTrack = { ...pkg.pista, id: Date.now().toString(36) };
    // (nome repetido ganha um número)
    const names = new Set([...CIRCUITS.map((c) => c.name)]);
    let nm = m.name, k = 2;
    while (names.has(nm)) nm = `${m.name} ${k++}`;
    m.name = nm;
    saveMod(m);
    if (pkg.autodromo)
      try {
        localStorage.setItem(`pwm.autodromo.${slug(nm)}`, pkg.autodromo);
      } catch {
        toast("O autódromo 3D não coube no navegador");
      }
    applyTrackMods();
    open({ t: "mod", id: m.id });
    toast(`"${nm}" importada como pista não oficial`);
  };

  // ---- traçado ideal (worker) ----
  const calcLine = () => {
    if (calc) return;
    const w = new Worker(new URL("../sim/lineWorker.ts", import.meta.url), { type: "module" });
    calc = { p: 0, w };
    renderSide();
    w.onmessage = (e: MessageEvent<{ p?: number; o?: number[]; lap?: number }>) => {
      if (e.data.o) {
        line = e.data.o;
        dirtyLine = false;
        dirty = true;
        calc = null;
        w.terminate();
        toast(`Traçado ideal pronto (volta de ~${(e.data.lap ?? 0).toFixed(1)} s no carro de teste). Salve pra valer.`);
        rebuild();
      } else if (e.data.p != null && calc) {
        calc.p = e.data.p;
        const bar2 = side.querySelector<HTMLElement>(".tleprog>i");
        if (bar2) bar2.style.width = `${Math.round(calc.p * 100)}%`;
      }
    };
    w.onerror = (e) => {
      calc = null;
      toast(`O carro de teste falhou: ${e.message}`);
      renderSide();
    };
    w.postMessage({ def: defNow(), iters: 9000 });
  };

  // ---- cliques do painel e da barra ----
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-exit]")) return close();
    if (t.closest("[data-new]")) {
      if (dirty && !confirm("Começar uma pista nova sem salvar esta?")) return;
      return newTrack();
    }
    if (t.closest("[data-draw]")) {
      drawing = [];
      return render();
    }
    if (t.closest("[data-save]")) return save();
    if (t.closest("[data-orig]") && target.t === "edit") {
      if (!confirm("Voltar esta pista pro traçado original do jogo?")) return;
      saveEdit(ORIGINAL_CIRCUITS[target.idx].name, null);
      applyTrackMods();
      return open(target);
    }
    if (t.closest("[data-delmod]") && target.t === "mod") {
      if (!confirm(`Apagar a pista "${meta.name}" deste navegador?`)) return;
      saveMod(null, target.id);
      applyTrackMods();
      return open({ t: "edit", idx: ACTIVE_TRACKS.find((i) => !CIRCUITS[i].mod) ?? ACTIVE_TRACKS[0] });
    }
    if (t.closest("[data-exp]")) return exportPkg();
    if (t.closest("[data-imp]")) return root.querySelector<HTMLInputElement>("[data-file]")?.click();
    if (t.closest("[data-line]")) return calcLine();
    if (t.closest("[data-stop]") && calc) {
      calc.w.terminate();
      calc = null;
      return renderSide();
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-pick]")) {
      if (dirty && !confirm("Trocar de pista sem salvar?")) return renderBar();
      const v = t.value;
      return open(v[0] === "e" ? { t: "edit", idx: Number(v.slice(1)) } : { t: "mod", id: v.slice(1) });
    }
    if (t.matches("[data-file]") && t.files?.[0]) {
      void t.files[0].text().then((txt) => {
        try {
          importPkg(txt);
        } catch (err) {
          toast(`Não deu pra importar: ${(err as Error).message}`);
        }
      });
      t.value = "";
      return;
    }
    if (t.matches("[data-len]")) {
      // muda o tamanho todo em volta do meio
      snapshot();
      const want = Number(t.value) * 1000, now = trackCurve(pts, 8).length, k = want / now;
      let cx = 0, cy = 0;
      for (const [x, y] of pts) {
        cx += x / pts.length;
        cy += y / pts.length;
      }
      pts = pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
      return changed();
    }
    if (t.dataset.meta) {
      const k = t.dataset.meta as "name" | "blurb" | "street" | "night" | "rainChance";
      if (k === "street" || k === "night") meta[k] = t.checked || undefined;
      else if (k === "rainChance") meta.rainChance = Number(t.value);
      else meta[k] = t.value;
      dirty = true;
      return renderBar();
    }
  });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-reach]")) {
      reach = Number(t.value);
      const o = side.querySelector("[data-out=reach]");
      if (o) o.textContent = `${reach} m`;
    }
    if (t.matches("[data-meta=rainChance]")) {
      const o = side.querySelector("[data-out=rain]");
      if (o) o.textContent = `${Math.round(Number(t.value) * 100)}%`;
    }
  });

  // ---- mouse ----
  let hover = -1;
  let mouseW: [number, number] | null = null;
  let drag: { i: number; x: number; y: number; orig: [number, number][]; moved: boolean } | null = null;
  let pan: { x: number; y: number } | null = null;
  const pointAt = (px: number, py: number) => {
    let best = -1, bd = 10;
    pts.forEach(([x, y], i) => {
      const [sx, sy] = toScr(x, y), d = Math.hypot(sx - px, sy - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  /** distância (m) pelo caminho entre os pontos i e j (pros vizinhos do arraste) */
  const along = (() => {
    let cum: number[] = [];
    let total = 0;
    return {
      prep() {
        cum = [0];
        for (let i = 1; i <= pts.length; i++) {
          const a = pts[i - 1], b = pts[i % pts.length];
          cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        total = cum[pts.length];
      },
      d(i: number, j: number) {
        const d = Math.abs(cum[i] - cum[j]);
        return Math.min(d, total - d);
      },
    };
  })();
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (drawing && e.button === 0) {
      drawing.push([...toWorld(px, py)] as [number, number]);
      return draw();
    }
    const i = pointAt(px, py);
    if (e.button === 2 && i >= 0 && !drawing) {
      if (pts.length <= 6) return toast("A pista precisa de pelo menos 6 pontos");
      snapshot();
      pts.splice(i, 1);
      hover = -1;
      return changed();
    }
    if (e.button === 0 && i >= 0) {
      along.prep();
      drag = { i, x: px, y: py, orig: pts.map((p) => [p[0], p[1]]), moved: false };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    pan = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    mouseW = [...toWorld(px, py)] as [number, number];
    if (drag) {
      const dx = (px - drag.x) / sc, dy = (py - drag.y) / sc;
      if (!drag.moved && Math.hypot(px - drag.x, py - drag.y) > 2) {
        drag.moved = true;
        undo.push(JSON.stringify(drag.orig));
      }
      // os vizinhos vêm junto, mais fraco quanto mais longe (pelo caminho, não em linha reta)
      pts = drag.orig.map(([x, y], j) => {
        const d = along.d(drag!.i, j);
        const w = j === drag!.i ? 1 : reach > 0 && d < reach ? 0.5 + 0.5 * Math.cos((Math.PI * d) / reach) : 0;
        return [x + dx * w, y + dy * w];
      });
      return draw();
    }
    if (pan) {
      vx -= (e.clientX - pan.x) / sc;
      vy -= (e.clientY - pan.y) / sc;
      pan = { x: e.clientX, y: e.clientY };
      return draw();
    }
    const h = drawing ? -1 : pointAt(px, py);
    if (h !== hover || drawing) {
      hover = h;
      cv.style.cursor = drawing ? "crosshair" : h >= 0 ? "grab" : "";
      draw();
    }
  });
  cv.addEventListener("pointerup", () => {
    if (drag?.moved) changed();
    drag = null;
    pan = null;
  });
  cv.addEventListener("dblclick", (e) => {
    if (drawing) return finishDrawing();
    // ponto novo no trecho mais perto do clique
    const r = cv.getBoundingClientRect(), [wx, wy] = toWorld(e.clientX - r.left, e.clientY - r.top);
    let best = -1, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, d = Math.hypot(mx - wx, my - wy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0 || bd * sc > 40) return;
    snapshot();
    pts.splice(best + 1, 0, [wx, wy]);
    changed();
  });
  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = toWorld(px, py);
      sc = Math.max(0.03, Math.min(8, sc * Math.pow(1.0015, -e.deltaY)));
      // (o ponto debaixo do mouse fica parado)
      vx = wx - (px - W() / 2) / sc;
      vy = wy - (py - H() / 2) / sc;
      draw();
    },
    { passive: false },
  );
  /** fecha o desenho do zero: a curva passa pelos cliques e vira pontos a cada 20 m */
  const finishDrawing = () => {
    if (!drawing) return;
    if (drawing.length < 4) return toast("Clique pelo menos 4 pontos");
    snapshot();
    const c = trackCurve(drawing, 20).pts;
    pts = c.map((p) => [p.x, p.y]);
    drawing = null;
    if (target.t === "edit") {
      // (desenho novo numa pista do jogo vira pista nova, não oficial)
      const id = Date.now().toString(36);
      target = { t: "mod", id };
      meta = { id, name: "Minha pista", blurb: "Pista não oficial feita no editor.", minHeight: 5, balance: 0, rainChance: 0.25, grass: ["#3d8a3a", "#418f3d"] };
    }
    line = undefined;
    changed();
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
    e.stopPropagation();
    const k = e.key.toLowerCase();
    if (drawing) {
      if (k === "enter") finishDrawing();
      else if (k === "backspace") drawing.pop();
      else if (k === "escape") drawing = null;
      render();
      return draw();
    }
    if ((e.ctrlKey || e.metaKey) && k === "z" && undo.length) {
      e.preventDefault();
      pts = JSON.parse(undo.pop()!);
      return changed();
    }
    if (k === "escape") close();
  };
  window.addEventListener("keydown", onKey, true);
  const resize = () => draw();
  window.addEventListener("resize", resize);

  const close = () => {
    if (dirty && !confirm("Sair sem salvar?")) return;
    calc?.w.terminate();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", resize);
    root.remove();
    onDone();
  };

  open(target);
}
