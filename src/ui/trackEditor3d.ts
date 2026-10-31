// Editor do autódromo 3D (Editor > AUTÓDROMO 3D): mexe nas peças em volta da pista (arquibancadas, boxes,
// pneus, placas, árvores, casas, carros parados...). Arrastar move; o painel gira, muda o tamanho e a cor,
// duplica e apaga; a paleta põe peças novas. Salva por pista, neste navegador; na corrida, o autódromo 3D usa
// o que foi salvo. Só desenho: não muda nada da corrida (o traçado continua o mesmo).
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { SCENE_LOD_DIST, gfx } from "../render/gfx";
import { ACTIVE_TRACKS, CIRCUITS, getTrack, type Track } from "../sim/track";
import { buildTrack3d, slugOf } from "../render/track3d";
import { DEFAULT_SIZE, PIECES, standV, clearPieces, pathsFromJson, piecesFromJson, piecesToJson, savePieces, type Piece, type PieceKind, type PieceLayer } from "../render/pieces";
import { addModelFile, deleteModel, listModels, loadModels } from "../render/customModels";
import { applyTerrain, type BrushMode, type Terrain } from "../render/terrain";
import { PATHS, orderOf, samplePath, type PathItem, type PathKind, type PathLayer } from "../render/paths3d";
import { esc, toast } from "./common";
import { BAKE_PX, deleteBaked, getBakedMeta, putBakedMeta, putBakedTile, type BakedMeta } from "../render/bakedWorld";

/** as peças por assunto, na ordem da paleta (o que faltar cai em "Outros") */
const GROUPS: [string, PieceKind[]][] = [
  ["Arquibancadas e público", ["arquibancada", "torcida", "telao", "bandeira", "passarela", "podio", "arco", "banheiro", "fotografo"]],
  ["Pista e segurança", ["pneu", "blocopneus", "barreira", "jersey", "salsicha", "guardrail", "muro", "cone", "ambulancia", "freada", "placa", "fiscal", "cameratv", "portico", "semaforo", "poste"]],
  ["Boxes e paddock", ["box", "equipe", "torre", "tenda", "motorhome", "onibus", "caminhao", "container", "caixas", "gerador", "golfe", "carro", "heliponto"]],
  ["Prédios e cidade", ["edificio", "casa", "predio", "apartamento", "palacete", "hotel", "vila", "caixadagua", "tunel"]],
  ["Natureza", ["arvore", "pinheiro", "palmeira", "arbusto", "cercaviva", "canteiro", "pedra"]],
  ["Mar e porto", ["iate", "veleiro", "cruzeiro", "pier", "farol"]],
];

const CSS = `
.ted{position:fixed;inset:0;z-index:9000;background:#0b0f14;user-select:none}
.ted canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.ted{--tedz:1;--pw:270px}
.ted .tedbar,.ted .tedside,.ted .tedhint,.ted .tedmode,.ted .tedctx{zoom:var(--tedz)}
.ted .tedbar{position:absolute;left:calc((var(--pw) + 20px) / var(--tedz));top:10px;right:calc((var(--pw) + 20px) / var(--tedz));display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ted .tedbar select{max-width:230px}
.ted .tedpanels{position:absolute;inset:0;pointer-events:none}
.ted .tedside{position:absolute;right:10px;top:10px;max-height:calc((100% - 20px) / var(--tedz));width:270px;overflow:auto;padding:10px;pointer-events:auto;box-sizing:border-box}
.ted .tedside.tedleft{left:10px;right:auto;bottom:auto}
.ted .tedside h4{margin:10px 0 6px;font-size:12px;letter-spacing:.08em;opacity:.8}
.ted .tedpal{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ted .tedpal button.on{outline:2px solid #ffd21a}
.ted .tedtabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:0 0 8px}
.ted details.tedgrp{margin:4px 0}
.ted details.tedgrp summary{cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.04em;padding:4px 0;opacity:.9}
.ted .tedfld{display:flex;flex-direction:column;gap:3px;margin:6px 0;font-size:12px}
.ted .tedfld input[type=range]{width:100%}
.ted .tedhint{position:absolute;left:calc((var(--pw) + 20px) / var(--tedz));bottom:10px;right:calc((var(--pw) + 20px) / var(--tedz));font-size:12px;opacity:.85;pointer-events:none;text-shadow:0 1px 2px #000}
.ted .tedctx{position:absolute;z-index:5;display:flex;flex-direction:column;gap:3px;padding:6px;min-width:150px}
.ted .tedall{position:absolute;inset:0;z-index:20;background:rgba(5,8,12,.72);display:flex;align-items:center;justify-content:center;padding:20px}
.ted .tedall>div{zoom:var(--tedz);width:min(980px,calc((100vw - 40px) / var(--tedz)));max-height:calc((100vh - 40px) / var(--tedz));overflow:auto;padding:14px;box-sizing:border-box}
.ted .tedall .tedpal{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.ted .tedall h4{margin:12px 0 6px;font-size:12px;letter-spacing:.08em;opacity:.8}
.ted .tedrect{position:absolute;border:1px dashed #ffd21a;background:rgba(255,210,26,.12);pointer-events:none}
.ted .tedmode{position:absolute;left:50%;top:60px;transform:translateX(-50%);background:#ffd21a;color:#111;padding:6px 12px;border-radius:6px;font-weight:700;font-size:13px}
`;

export function showTrackEditor3d(onDone: () => void = () => {}, startIndex = ACTIVE_TRACKS.find((i) => slugOf(CIRCUITS[i].name) === "interlagos") ?? ACTIVE_TRACKS[0]) {
  if (!document.getElementById("ted-css")) {
    const st = document.createElement("style");
    st.id = "ted-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement("div");
  root.className = "ted";
  document.body.appendChild(root);

  // ---- cena ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const sky = new THREE.Color("#74c6f2");
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 1500, 6000);
  scene.add(new THREE.HemisphereLight("#dfe8ff", "#3a3a32", 1.05));
  const sun = new THREE.DirectionalLight("#ffffff", 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 8000);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = (85 * Math.PI) / 180;
  controls.minDistance = 12;
  controls.maxDistance = 2600;
  // (a roda aproxima de onde o mouse está; o giro do botão direito é nosso, em volta do ponto clicado)
  controls.zoomToCursor = true;
  controls.mouseButtons.RIGHT = undefined as unknown as THREE.MOUSE;
  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd21a);
  selBox.visible = false;
  scene.add(selBox);

  // ---- estado ----
  let idx = startIndex;
  let track: Track;
  let world: THREE.Group | null = null;
  let layer: PieceLayer | null = null;
  let auto: Piece[] = [];
  let autoPaths: PathItem[] = [];
  let sel = -1;
  let placing: PieceKind | null = null;
  // linhas e áreas (guard-rail, zebra, chão pintado...): a selecionada, o ponto selecionado e a que está sendo desenhada
  let pathL: PathLayer | null = null;
  // relevo: o pincel ligado, raio e força; a aba da esquerda (peças ou camadas)
  let terrain: Terrain | null = null;
  let relevo: BrushMode | null = null;
  let rRadius = 40, rForce = 0.6, rLevel = 0;
  // camadas do chão: as linhas da lista (as do mapa iguais juntas) e as selecionadas (por chave)
  let layerRows: { key: string; ids: number[] }[] = [];
  const layerSel = new Set<string>();
  const layerRowsOf = () => {
    const ids = paths().map((_, i) => i).filter((i) => PATHS[paths()[i].t].area && !PATHS[paths()[i].t].solid);
    ids.sort((a, b) => orderOf(paths()[b]) - orderOf(paths()[a]) || b - a);
    const rows: { key: string; ids: number[] }[] = [], byKey = new Map<string, { key: string; ids: number[] }>();
    for (const i of ids) {
      const it = paths()[i];
      const key = it.src ? `${it.src}:${it.t}:${it.c ?? ""}:${orderOf(it)}` : `i:${i}`;
      let r = byKey.get(key);
      if (!r) {
        r = { key, ids: [] };
        rows.push(r);
        byKey.set(key, r);
      }
      r.ids.push(i);
    }
    return rows;
  };
  /** põe as linhas `moved` logo acima da linha `before` (-1 = no fim) e renumera a ordem de todas (a de cima cobre) */
  const moveRows = (moved: number[], before: number) => {
    if (!pathL || !moved.length) return;
    const set = new Set(moved);
    const mv = layerRows.filter((_, n) => set.has(n));
    const rest: typeof layerRows = [];
    layerRows.forEach((r, n) => {
      if (n === before) rest.push(...mv);
      if (!set.has(n)) rest.push(r);
    });
    if (before < 0) rest.push(...mv);
    rest.forEach((r, n) => r.ids.forEach((i) => (paths()[i].o = (rest.length - n) * 10)));
    pathL.rebuild();
    commit();
  };
  /** grupos da paleta abertos (lembra entre um desenho e outro do painel) */
  const openGroups = new Set<string>(["Arquibancadas e público", "Linhas (barreiras, zebras, cercas)", "Chão (pintar uma área)", "Prédio pelo contorno"]);
  // modelos .glb importados (neste navegador) e qual está sendo colocado
  let myModels: { id: number; name: string }[] = [];
  let placingV = 0;
  void listModels().then((l) => {
    myModels = l;
    renderSide();
  });
  let leftTab: "pecas" | "linhas" | "relevo" | "camadas" = "pecas";
  // seleção múltipla (Shift + clique, ou Shift + arrastar um retângulo): "p3" = peça 3, "l5" = linha 5
  const multi = new Set<string>();
  let selP = -1;
  let selPt = -1;
  let drawing: { t: PathKind; pts: [number, number][] } | null = null;
  let cursor: [number, number] | null = null;
  const handles = new THREE.Group();
  scene.add(handles);
  const handleGeo = new THREE.SphereGeometry(0.9, 10, 8);
  const handleMat = new THREE.MeshBasicMaterial({ color: 0xffd21a, depthTest: false });
  const handleOn = new THREE.MeshBasicMaterial({ color: 0xff3b3b, depthTest: false });
  const preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd21a, depthTest: false }));
  preview.renderOrder = 10;
  preview.frustumCulled = false;
  preview.visible = false;
  scene.add(preview);
  let lastR = 0;
  /** busca na paleta */
  let q = "";
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let dirty = false;
  let undo: string[] = [];
  let snap = "";
  let loading = true;
  /** gerando o 2D: o laço da tela para enquanto isso (as fotos usam a mesma cena) */
  let baking: string | null = null;
  let hasBaked = false;

  const pieces = () => layer?.pieces ?? [];
  const paths = () => pathL?.items ?? [];
  const stateJson = () => piecesToJson(pieces(), paths());
  /** guarda o estado de antes de uma mudança (pro Ctrl+Z) */
  const commit = () => {
    undo.push(snap);
    if (undo.length > 25) undo.shift();
    snap = stateJson();
    dirty = true;
    renderSide();
  };
  const replaceAll = (list: Piece[], plist: PathItem[] = []) => {
    if (!layer || !pathL) return;
    layer.pieces.length = 0;
    layer.pieces.push(...list);
    layer.rebuild();
    pathL.items.length = 0;
    pathL.items.push(...plist);
    pathL.rebuild();
    select(-1);
  };

  const load = async (i: number) => {
    loading = true;
    renderBar();
    if (world) {
      scene.remove(world);
      layer?.dispose();
    }
    select(-1);
    idx = i;
    track = getTrack(i);
    const res = await buildTrack3d(track, true, { terrain: true });
    world = res.group;
    layer = res.layer;
    pathL = res.paths;
    terrain = res.terrain;
    auto = res.auto;
    autoPaths = res.autoPaths;
    scene.add(world);
    snap = stateJson();
    undo = [];
    dirty = false;
    loading = false;
    // começa olhando a largada, de cima e um pouco de lado
    const p = track.pose(0, 0);
    controls.target.set(p.x, 0, p.y);
    camera.position.set(p.x, 260, p.y + 260);
    controls.update();
    hasBaked = !!(await getBakedMeta(slugOf(track.name)));
    renderBar();
    renderSide();
  };

  // ---- gerar o 2D: o autódromo visto de cima, fotografado em pedaços ----
  const bake = async () => {
    if (!layer || baking) return;
    const slug = slugOf(track.name);
    // área: a pista e uns 220 m em volta (o resto é grama)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let s = 0; s < track.L; s += 10) {
      const p = track.pose(s, 0);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    x0 -= 220;
    y0 -= 220;
    x1 += 220;
    y1 += 220;
    // (perto, médio e longe: o 2D usa o mais nítido que o zoom pede)
    const levels = [10, 3.5, 1.2].map((ppm) => {
      const size = BAKE_PX / ppm;
      return { ppm, size, nx: Math.ceil((x1 - x0) / size), ny: Math.ceil((y1 - y0) / size) };
    });
    const total = levels.reduce((a, l) => a + l.nx * l.ny, 0);
    const r2 = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r2.setPixelRatio(1);
    r2.setSize(BAKE_PX, BAKE_PX, false);
    r2.shadowMap.enabled = true;
    r2.shadowMap.type = THREE.PCFSoftShadowMap;
    r2.toneMapping = renderer.toneMapping;
    r2.toneMappingExposure = renderer.toneMappingExposure;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
    // (de cima, com o norte da pista pra cima, igual ao 2D: y do mundo cresce pra baixo da tela)
    cam.up.set(0, 0, -1);
    const fog = scene.fog;
    scene.fog = null;
    selBox.visible = false;
    handles.visible = preview.visible = false;
    let done = 0;
    baking = `gerando o 2D: 0/${total}`;
    renderBar();
    try {
      await deleteBaked(slug);
      for (let l = 0; l < levels.length; l++) {
        const L = levels[l];
        for (let ty = 0; ty < L.ny; ty++)
          for (let tx = 0; tx < L.nx; tx++) {
            const cx = x0 + (tx + 0.5) * L.size, cz = y0 + (ty + 0.5) * L.size, h = L.size / 2;
            cam.left = -h;
            cam.right = h;
            cam.top = h;
            cam.bottom = -h;
            cam.position.set(cx, 450, cz);
            cam.lookAt(cx, 0, cz);
            cam.updateProjectionMatrix();
            // sombra só deste pedaço (e um pouco além, pra sombra de quem está do lado)
            const sc = sun.shadow.camera, ext = h * 1.4;
            sc.left = -ext;
            sc.right = ext;
            sc.top = ext;
            sc.bottom = -ext;
            sc.near = 1;
            sc.far = 600;
            sc.updateProjectionMatrix();
            sun.position.set(cx - 60, 150, cz - 80);
            sun.target.position.set(cx, 0, cz);
            sun.target.updateMatrixWorld();
            r2.render(scene, cam);
            const blob = await new Promise<Blob | null>((ok) => r2.domElement.toBlob(ok, "image/webp", 0.9));
            if (blob) await putBakedTile(slug, l, tx, ty, blob);
            done++;
            if (done % 4 === 0) {
              baking = `gerando o 2D: ${done}/${total}`;
              renderBar();
              await new Promise((ok) => setTimeout(ok, 0));
            }
          }
      }
      const meta: BakedMeta = { v: 1, x0, y0, levels, at: Date.now() };
      await putBakedMeta(slug, meta);
      hasBaked = true;
      toast(`2D gerado (${total} pedaços): nos modos 2D esta pista usa ele`);
    } catch (e) {
      toast(`Não deu pra gerar o 2D: ${(e as Error).message}`);
    } finally {
      scene.fog = fog;
      sun.shadow.camera.right = -1; // (o laço recalcula a sombra da tela)
      r2.dispose();
      baking = null;
      handles.visible = preview.visible = true;
      updateSel();
      renderBar();
    }
  };

  // ---- painel ----
  const bar = document.createElement("div");
  bar.className = "tedbar";
  const side = document.createElement("div");
  // (peças à esquerda; o editor do que está selecionado à direita)
  side.className = "tedpanels";
  const hint = document.createElement("div");
  hint.className = "tedhint";
  hint.innerHTML =
    "<b>Mouse:</b> esquerdo arrasta o mapa ou a peça (com <b>Alt</b>: só anda, sem mexer em nada) · direito gira em volta do ponto clicado · roda aproxima de onde está o mouse · <b>Teclas:</b> Q/E giram · [ ] tamanho · Ctrl+D duplica · Del apaga · Ctrl+Z desfaz · Esc solta";
  const mode = document.createElement("div");
  mode.className = "tedmode";
  mode.hidden = true;
  root.append(bar, side, hint, mode);

  function renderBar() {
    bar.innerHTML = `<b style="margin-right:6px">AUTÓDROMO 3D</b>
      <select class="txt" data-track ${loading ? "disabled" : ""}>${ACTIVE_TRACKS.map((i) => `<option value="${i}" ${i === idx ? "selected" : ""}>${esc(CIRCUITS[i].name)}</option>`).join("")}</select>
      <button class="btn small" data-all ${loading ? "disabled" : ""} title="Todas as peças, linhas, chãos e ferramentas numa tela só, com pesquisa">☰ VER TUDO</button>
      <button class="btn small primary" data-save ${loading ? "disabled" : ""}>SALVAR</button>
      <button class="btn small" data-auto ${loading ? "disabled" : ""} title="Volta pro posicionamento automático desta pista">AUTOMÁTICO</button>
      <button class="btn small" data-exp ${loading ? "disabled" : ""}>⬇ EXPORTAR</button>
      <button class="btn small" data-imp ${loading ? "disabled" : ""}>⬆ IMPORTAR</button><input type="file" accept=".json" data-file hidden>
      <button class="btn small" data-bake ${loading || baking ? "disabled" : ""} title="Fotografa o autódromo 3D de cima e usa nos modos 2D (a cara do 3D com o peso do 2D)">GERAR 2D</button>
      ${hasBaked ? `<button class="btn small" data-unbake ${baking ? "disabled" : ""} title="Volta o 2D desta pista pro desenho normal">APAGAR 2D</button>` : ""}
      <button class="btn small" data-exit ${baking ? "disabled" : ""}>SAIR</button>
      ${baking ? `<span class="hint">${baking}</span>` : loading ? `<span class="hint">montando o autódromo...</span>` : `<span class="hint">${pieces().length.toLocaleString("pt-BR")} peças${dirty ? " · não salvo" : ""}${hasBaked ? " · com 2D gerado" : ""}</span>`}`;
  }

  // ---- VER TUDO: o catálogo inteiro numa tela, com pesquisa; um clique já escolhe ----
  const catalog = document.createElement("div");
  catalog.className = "tedall";
  catalog.hidden = true;
  root.appendChild(catalog);
  let cq = "";
  function renderCatalog() {
    const show = (label: string) => !cq || norm(label).includes(norm(cq));
    const used = new Set(GROUPS.flatMap((g) => g[1]));
    const all = Object.keys(PIECES) as PieceKind[];
    const ks = Object.keys(PATHS) as PathKind[];
    const sec = (title: string, items: string[]) => (items.length ? `<h4>${esc(title)} (${items.length})</h4><div class="tedpal">${items.join("")}</div>` : "");
    const pc = (k: PieceKind) => (show(PIECES[k].label) ? [`<button class="btn small" data-cat-place="${k}">${esc(PIECES[k].label)}</button>`] : []);
    const pa = (k: PathKind) => (show(PATHS[k].label) ? [`<button class="btn small" data-cat-draw="${k}">${esc(cap(PATHS[k].label.replace("Chão: ", "")))}</button>`] : []);
    const rel = (["subir", "descer", "suavizar", "nivelar"] as BrushMode[]).filter((m) => show(`relevo ${m}`)).map((m) => `<button class="btn small" data-cat-relevo="${m}">Relevo: ${m}</button>`);
    const body =
      [...GROUPS, ["Outros", all.filter((k) => !used.has(k))] as [string, PieceKind[]]].map(([n, list]) => sec(`Peças · ${n}`, list.flatMap(pc))).join("") +
      sec("Linhas (barreiras, zebras, cercas)", ks.filter((k) => !PATHS[k].area).flatMap(pa)) +
      sec("Chão (pintar uma área)", ks.filter((k) => PATHS[k].area && !PATHS[k].solid).flatMap(pa)) +
      sec("Prédio pelo contorno", ks.filter((k) => PATHS[k].solid).flatMap(pa)) +
      sec("Relevo", rel);
    const box = catalog.querySelector<HTMLElement>("[data-cat-body]");
    if (box) box.innerHTML = body || `<p class="hint">Nada com "${esc(cq)}".</p>`;
    else
      catalog.innerHTML = `<div class="panel"><div class="row-btns" style="align-items:center;margin:0"><b style="flex:1">TUDO DO EDITOR</b><input class="txt" data-cat-q placeholder="Pesquisar em tudo..." style="width:260px"><button class="btn small" data-cat-x>✕ FECHAR (Esc)</button></div><div data-cat-body>${body}</div></div>`;
  }
  const openCatalog = () => {
    cq = "";
    catalog.innerHTML = "";
    renderCatalog();
    catalog.hidden = false;
    catalog.querySelector<HTMLInputElement>("[data-cat-q]")?.focus();
  };
  catalog.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches("[data-cat-q]")) return;
    cq = t.value;
    renderCatalog();
  });
  catalog.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === catalog || t.closest("[data-cat-x]")) return void (catalog.hidden = true);
    const b = t.closest<HTMLElement>("[data-cat-place], [data-cat-draw], [data-cat-relevo]");
    if (!b) return;
    relevo = null;
    placing = null;
    drawing = null;
    sel = selP = selPt = -1;
    multi.clear();
    if (b.dataset.catPlace) {
      leftTab = "pecas";
      placing = b.dataset.catPlace as PieceKind;
      // (abre o grupo da peça na paleta)
      const g = GROUPS.find(([, l]) => l.includes(placing!));
      if (g) openGroups.add(g[0]);
    } else if (b.dataset.catDraw) {
      leftTab = "linhas";
      drawing = { t: b.dataset.catDraw as PathKind, pts: [] };
    } else {
      leftTab = "relevo";
      relevo = b.dataset.catRelevo as BrushMode;
    }
    catalog.hidden = true;
    updateSel();
    renderSide();
  });

  function renderSide() {
    const p = sel >= 0 ? pieces()[sel] : null;
    const kinds = Object.keys(PIECES) as PieceKind[];
    const tabs = `<div class="tedtabs">${([["pecas", "PEÇAS"], ["linhas", "LINHAS E CHÃO"], ["relevo", "RELEVO"], ["camadas", "CAMADAS"]] as const)
      .map(([k, n]) => `<button class="btn small ${leftTab === k ? "primary" : ""}" data-tab3="${k}">${n}</button>`)
      .join("")}</div>`;
    const hidden = (label: string) => (q && !norm(label).includes(norm(q)) ? "hidden" : "");
    let palHtml = tabs;
    // (abrir ou fechar todos os grupos da aba)
    const grpAll = (names: string[]) => {
      const all = names.every((n) => openGroups.has(n));
      return `<button class="btn small" data-grpall="${esc(names.join("|"))}" title="${all ? "Fechar todos os grupos" : "Abrir todos os grupos"}" style="flex:0 0 34px;padding:0;font-size:16px">${all ? "⊟" : "⊞"}</button>`;
    };
    /** campo de pesquisa com o botão de abrir/fechar os grupos do lado */
    const search = (ph: string, names: string[]) => `<div style="display:flex;gap:4px;margin-bottom:4px"><input class="txt" data-q placeholder="${ph}" value="${esc(q)}" style="flex:1;min-width:0">${grpAll(names)}</div>`;
    if (leftTab === "camadas") {
      layerRows = layerRowsOf();
      palHtml += `<p class="hint" style="margin:0 0 6px">De cima pra baixo: a de cima cobre as de baixo. <b>Arraste</b> pra mudar a ordem; <b>Ctrl/Shift + clique</b> seleciona várias. As do mapa real do mesmo tipo e cor vêm juntas numa linha (ex.: lagos e piscinas = água).</p>${layerRows
        .map((r, n) => {
          const it = paths()[r.ids[0]], on = layerSel.has(r.key) || (r.ids.length === 1 && r.ids[0] === selP);
          return `<div class="row-btns tedlayer" draggable="true" data-row="${n}" style="margin:2px 0;align-items:center;cursor:grab;${on ? "outline:1px solid #ffd21a;" : ""}"><span style="display:inline-block;width:12px;height:12px;background:${it.c ?? PATHS[it.t].cores?.[0] ?? "#30343d"};border:1px solid #000"></span><button class="btn small" data-lrow="${n}" style="flex:1;text-align:left">${esc(cap(PATHS[it.t].label.replace("Chão: ", "")))}${it.src === "mapa" ? " · mapa" : it.src === "pista" ? " · beira da pista" : ""}${r.ids.length > 1 ? ` (${r.ids.length})` : ""}</button><button class="btn small" data-lmove="${n}" data-dir="-1" title="Pra cima">▲</button><button class="btn small" data-lmove="${n}" data-dir="1" title="Pra baixo">▼</button></div>`;
        })
        .join("")}`;
    } else if (leftTab === "relevo")
      palHtml += `<p class="hint" style="margin:0 0 6px">Escolha o pincel e arraste no chão. A pista, as peças e o chão acompanham. (Só o visual: a corrida não muda.)</p><div class="tedpal">${(["subir", "descer", "suavizar", "nivelar"] as BrushMode[])
        .map((m) => `<button class="btn small ${relevo === m ? "on" : ""}" data-relevo="${m}">${{ subir: "▲ Subir", descer: "▼ Descer", suavizar: "≈ Suavizar", nivelar: "▬ Nivelar" }[m]}</button>`)
        .join("")}</div>
        <label class="tedfld"><span>Raio: <b data-out="rr">${rRadius} m</b></span><input type="range" data-rr min="8" max="250" step="1" value="${rRadius}"></label><label class="tedfld"><span>Força: <b data-out="rf">${rForce.toFixed(1)}</b></span><input type="range" data-rf min="0.1" max="3" step="0.1" value="${rForce}"></label>`;
    else if (leftTab === "linhas") {
      const ks = Object.keys(PATHS) as PathKind[];
      const btn = (k: PathKind) => `<button class="btn small ${drawing?.t === k ? "on" : ""}" data-draw="${k}" ${hidden(PATHS[k].label)}>${cap(PATHS[k].label.replace("Chão: ", ""))}</button>`;
      const groups: [string, PathKind[]][] = [
        ["Linhas (barreiras, zebras, cercas)", ks.filter((k) => !PATHS[k].area)],
        ["Chão (pintar uma área)", ks.filter((k) => PATHS[k].area && !PATHS[k].solid)],
        ["Prédio pelo contorno", ks.filter((k) => PATHS[k].solid)],
      ];
      palHtml += `${search("Pesquisar linha ou chão...", groups.map((g) => g[0]))}${groups
        .map(([name, list]) => `<details class="tedgrp" ${q || openGroups.has(name) ? "open" : ""} data-grp="${esc(name)}" ${q && list.every((k) => hidden(PATHS[k].label)) ? "hidden" : ""}><summary>${esc(name)}</summary><div class="tedpal">${list.map(btn).join("")}</div></details>`)
        .join("")}<p class="hint" style="margin-top:8px">Escolha e clique os pontos no chão; a curva passa suave por eles. Enter conclui.</p>`;
    } else {
      const used = new Set(GROUPS.flatMap((g) => g[1]));
      const groups: [string, PieceKind[]][] = [...GROUPS, ["Outros", kinds.filter((k) => !used.has(k) && k !== "modelo")]];
      palHtml += `${search("Pesquisar peça...", groups.filter(([, ks]) => ks.length).map((g) => g[0]))}${groups
        .filter(([, ks]) => ks.length && (!q || ks.some((k) => !hidden(PIECES[k].label))))
        .map(([name, ks]) => `<details class="tedgrp" ${q || openGroups.has(name) ? "open" : ""} data-grp="${esc(name)}"><summary>${esc(name)}</summary><div class="tedpal">${ks
          .map((k) => `<button class="btn small ${placing === k ? "on" : ""}" data-place="${k}" ${hidden(PIECES[k].label)}>${PIECES[k].label}</button>`)
          .join("")}</div></details>`)
        .join("")}
        <details class="tedgrp" open><summary>Meus modelos 3D (.glb)</summary>
          <button class="btn small" data-glb style="width:100%;margin:2px 0 4px">⬆ IMPORTAR MODELO .GLB</button><input type="file" accept=".glb" data-glbfile hidden>
          <div class="tedpal">${myModels.map((m) => `<button class="btn small ${placing === "modelo" && placingV === m.id ? "on" : ""}" data-model="${m.id}" ${hidden(m.name)}>${esc(m.name)}</button>`).join("")}</div>
          ${myModels.length ? `<p class="hint" style="margin:4px 0 0">Ficam só neste navegador. Pra ir pro jogo de todo mundo, me mande o .glb junto com o autódromo exportado.</p>` : `<p class="hint" style="margin:4px 0 0">Modelos de graça: Poly Pizza, Sketchfab (licença livre), Kenney. Em metros, de preferência leves.</p>`}
        </details>
        <p class="hint" style="margin-top:8px">Escolha uma peça e clique no chão (várias seguidas; Esc para). Clique numa peça pra editar.</p>`;
    }
    let html = "";
    const it = selP >= 0 ? paths()[selP] : null;
    if (multi.size)
      html += `<h4>SELEÇÃO</h4><b>${multi.size} selecionados</b><p class="hint">Shift + clique põe ou tira da seleção; Shift + arrastar seleciona por área.</p>
        <div class="row-btns" style="margin-top:6px"><button class="btn small" data-del>APAGAR TODOS (Del)</button><button class="btn small" data-unsel>SOLTAR</button></div>`;
    else if (drawing)
      html += `<p class="hint" style="margin-top:10px">Clique no chão os pontos de <b>${PATHS[drawing.t].label}</b> (${drawing.pts.length} até agora). A curva passa suave pelos pontos.</p>
        <div class="row-btns"><button class="btn small primary" data-finish>CONCLUIR (Enter)</button><button class="btn small" data-cancel>CANCELAR (Esc)</button></div>`;
    else if (it) {
      const def = PATHS[it.t];
      html += `<h4>EDITAR</h4><b>${def.label}</b>
        ${def.w ? `<label class="tedfld"><span>${def.w[3]}: <b data-out="pw">${def.solid ? Math.round(it.w ?? def.w[0]) : (it.w ?? def.w[0]).toFixed(1) + " m"}</b></span><input type="range" data-pw min="${def.w[1]}" max="${def.w[2]}" step="${def.solid ? 1 : 0.1}" value="${it.w ?? def.w[0]}"></label>` : ""}
        ${def.solid ? `<label class="tedfld"><span>Paredes</span><select class="txt" data-pvar>${["Janelas", "Vidro (espelhado)", "Parede lisa"].map((n, i) => `<option value="${i}" ${(it.v ?? 0) === i ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : ""}
        ${def.cores ? `<label class="tedfld"><span>Cor</span><input type="color" data-pc="c" value="${it.c ?? def.cores[0]}"></label>` : ""}
        ${def.cores?.[1] ? `<label class="tedfld"><span>${def.solid ? "Cor do teto" : "Cor 2"}</span><input type="color" data-pc="c2" value="${it.c2 ?? def.cores[1]}"></label>` : ""}
        ${def.area && !def.solid && it.t !== "pintura" ? `<div class="row-btns" style="margin:6px 0"><button class="btn small" data-up title="PageUp">▲ POR CIMA</button><button class="btn small" data-down title="PageDown">▼ POR BAIXO</button></div>` : ""}
        <label class="tedfld" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-preto ${it.reto ? "checked" : ""}> cantos retos (sem curva)</label>
        <p class="hint">Arraste os pontos amarelos pra mudar a curva; arraste a linha pra mover tudo. Shift+clique no chão põe um ponto no fim.</p>
        ${def.solid ? `<button class="btn small" data-heli style="margin-top:6px">+ HELIPONTO NO TETO</button>` : ""}
        <div class="row-btns" style="margin-top:6px">${selPt >= 0 ? `<button class="btn small" data-delpt>APAGAR PONTO</button>` : ""}<button class="btn small" data-dup>DUPLICAR</button><button class="btn small" data-del>APAGAR</button></div>`;
    } else if (p) {
      const def = PIECES[p.k];
      const deg = Math.round((((p.r * 180) / Math.PI) % 360 + 360) % 360);
      const rng = (k: string, label: string, v: number, min: number, max: number, step: number, unit = "") =>
        `<label class="tedfld"><span>${label}: <b data-out="${k}">${v.toFixed(step < 1 ? 2 : 0)}${unit}</b></span><input type="range" data-f="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
      html += `<h4>EDITAR PEÇA</h4><b>${def.label}</b>
        ${rng("r", "Giro", deg, 0, 360, 1, "°")}
        ${rng("s", "Tamanho", p.s ?? 1, 0.3, 3, 0.05, "×")}
        ${rng("y", "Altura do chão", p.y ?? 0, 0, 150, 0.5, " m")}
        ${p.sx != null ? rng("sx", "Comprimento", p.sx, 2, 120, 0.5, " m") + (p.k === "edificio" ? rng("andares", "Andares", Math.max(1, Math.round((p.sy ?? 3) / 3)), 1, 40, 1) : rng("sy", "Altura", p.sy ?? 4, 2, 40, 0.5, " m")) + rng("sz", "Largura", p.sz ?? 6, 2, 120, 0.5, " m") : ""}
        ${p.k === "edificio" ? `<label class="tedfld"><span>Cor do teto</span><input type="color" data-c="c2" value="${p.c2 ?? "#c9c2b4"}"></label>` : ""}
        ${def.cores ? `<label class="tedfld"><span>Cor</span><input type="color" data-c="c" value="${p.c ?? def.cores[0]}"></label>` : ""}
        ${def.cores?.[1] && p.k !== "edificio" ? `<label class="tedfld"><span>Cor do telhado</span><input type="color" data-c="c2" value="${p.c2 ?? def.cores[1]}"></label>` : ""}
        ${def.variantes ? `<label class="tedfld"><span>Tipo</span><select class="txt" data-var>${def.variantes.map((n, i) => `<option value="${i}" ${(p.k === "arquibancada" ? (p.v ?? 0) & 3 : p.v ?? 0) === i ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : ""}
        ${p.k === "arquibancada" ? `<label class="tedfld" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-crowd ${(p.v ?? 0) & 4 ? "checked" : ""}> com torcida (gente e bandeiras)</label>` : ""}
        ${p.k === "edificio" ? `<button class="btn small" data-heli style="margin-top:6px">+ HELIPONTO NO TETO</button>` : ""}
        ${p.k === "modelo" ? `<p class="hint">${esc(myModels.find((m) => m.id === p.v)?.name ?? "modelo sem o arquivo neste navegador (caixa rosa)")}</p><button class="btn small" data-delmodel="${p.v ?? 0}">APAGAR ESTE MODELO DO NAVEGADOR</button>` : ""}
        <div class="row-btns" style="margin-top:8px"><button class="btn small" data-dup>DUPLICAR</button><button class="btn small" data-del>APAGAR</button></div>`;
    }
    side.innerHTML = `<div class="tedside tedleft panel">${palHtml}</div>${html ? `<div class="tedside panel">${html}</div>` : ""}`;
    mode.hidden = !placing && !drawing;
    if (relevo) {
      mode.hidden = false;
      mode.textContent = `Relevo: arraste no chão pra ${relevo} (Alt + arrastar anda pela cena · Esc solta)`;
    }
    if (placing) mode.textContent = `Clique no chão pra colocar: ${PIECES[placing].label} (Esc pra parar)`;
    if (drawing) mode.textContent = `Desenhando ${PATHS[drawing.t].label}: clique os pontos · Enter ou duplo clique conclui · Backspace desfaz ponto · Esc cancela`;
    renderer.domElement.style.cursor = placing || drawing || relevo ? "crosshair" : "";
    renderBar();
  }

  function select(i: number) {
    multi.clear();
    layerSel.clear();
    sel = i;
    selP = selPt = -1;
    updateSel();
    renderSide();
  }
  function selectPath(i: number, pt = -1) {
    multi.clear();
    layerSel.clear();
    sel = -1;
    selP = i;
    selPt = pt;
    updateSel();
    renderSide();
  }
  /** pontos amarelos da linha selecionada */
  function updateHandles() {
    handles.clear();
    const it = selP >= 0 ? paths()[selP] : null;
    const list = drawing ? drawing.pts : it ? it.p : [];
    list.forEach(([x, z], i) => {
      const h = new THREE.Mesh(handleGeo, !drawing && i === selPt ? handleOn : handleMat);
      h.position.set(x, 0.6, z);
      h.renderOrder = 11;
      h.userData.pt = i;
      handles.add(h);
    });
  }
  /** a linha que está sendo desenhada (até o mouse) */
  function updatePreview() {
    const pts = drawing ? (cursor ? [...drawing.pts, cursor] : drawing.pts) : [];
    if (pts.length < 2) {
      preview.visible = false;
      return;
    }
    const sm = samplePath({ t: drawing!.t, p: pts }, 1);
    if (PATHS[drawing!.t].area) sm.push(sm[0]);
    // (geometria nova: a setFromPoints reaproveita a antiga e quebrava quando a quantidade de pontos mudava)
    preview.geometry.dispose();
    preview.geometry = new THREE.BufferGeometry().setFromPoints(sm.map(([x, z]) => new THREE.Vector3(x, 0.5, z)));
    preview.visible = true;
  }
  // ---- ir até a seleção (clique na camada): a câmera desliza até ela, olhando do mesmo jeito ----
  let fly: { t0: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null = null;
  function focusSel() {
    if (!selBox.visible || selBox.box.isEmpty()) return;
    const c = selBox.box.getCenter(new THREE.Vector3()), size = selBox.box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = Math.min(controls.maxDistance, Math.max(40, size * 1.4));
    fly = { t0: performance.now(), fromT: controls.target.clone(), toT: c, fromP: camera.position.clone(), toP: c.clone().addScaledVector(dir, dist) };
  }
  function updateSel() {
    updateHandles();
    updatePreview();
    if (multi.size && layer && pathL) {
      const box = new THREE.Box3();
      for (const k of multi) box.union(k[0] === "p" ? layer.boxOf(Number(k.slice(1))) : new THREE.Box3().setFromObject(pathL.objOf(Number(k.slice(1)))));
      selBox.box.copy(box).expandByScalar(0.5);
      selBox.visible = !box.isEmpty();
      return;
    }
    if (selP >= 0 && pathL) {
      selBox.box.setFromObject(pathL.objOf(selP)).expandByScalar(0.3);
      selBox.visible = !selBox.box.isEmpty();
      return;
    }
    if (sel < 0 || !layer) {
      selBox.visible = false;
      return;
    }
    selBox.box.copy(layer.boxOf(sel)).expandByScalar(0.3);
    selBox.visible = true;
  }

  // ---- ações ----
  const addPiece = (k: PieceKind, x: number, z: number) => {
    if (!layer) return;
    const def = PIECES[k], sz = DEFAULT_SIZE[k];
    const p: Piece = { k, x, z, r: lastR, ...(k === "modelo" ? { v: placingV } : {}), ...(def.cores ? { c: def.cores[0] } : {}), ...(def.cores?.[1] ? { c2: def.cores[1] } : {}), ...(sz ? { sx: sz[0], sy: sz[1], sz: sz[2] } : {}) };
    layer.pieces.push(p);
    layer.rebuild();
    sel = layer.pieces.length - 1;
    updateSel();
    commit();
  };
  // ---- linhas ----
  const finishDrawing = () => {
    if (!drawing || !pathL) return;
    const need = PATHS[drawing.t].area ? 3 : 2;
    if (drawing.pts.length < need) return toast(`Precisa de pelo menos ${need} pontos`);
    const def = PATHS[drawing.t];
    pathL.items.push({ t: drawing.t, p: drawing.pts, ...(def.cores ? { c: def.cores[0] } : {}), ...(def.cores?.[1] ? { c2: def.cores[1] } : {}) });
    pathL.update(pathL.items.length - 1);
    drawing = null;
    cursor = null;
    selectPath(pathL.items.length - 1);
    commit();
  };
  const pathChanged = () => {
    if (selP < 0 || !pathL) return;
    pathL.update(selP);
    updateSel();
  };
  const del = () => {
    if (multi.size && layer && pathL) {
      const ps = [...multi].filter((k) => k[0] === "p").map((k) => Number(k.slice(1))).sort((a, b) => b - a);
      const ls = [...multi].filter((k) => k[0] === "l").map((k) => Number(k.slice(1))).sort((a, b) => b - a);
      for (const i of ps) layer.pieces.splice(i, 1);
      for (const i of ls) pathL.items.splice(i, 1);
      if (ps.length) layer.rebuild();
      if (ls.length) pathL.rebuild();
      toast(`${ps.length + ls.length} apagados (Ctrl+Z desfaz)`);
      select(-1);
      return commit();
    }
    if (selP >= 0 && pathL) {
      pathL.items.splice(selP, 1);
      pathL.rebuild();
      select(-1);
      return commit();
    }
    if (sel < 0 || !layer) return;
    layer.pieces.splice(sel, 1);
    layer.rebuild();
    select(-1);
    commit();
  };
  const dup = () => {
    if (selP >= 0 && pathL) {
      const it = paths()[selP];
      pathL.items.push({ ...it, p: it.p.map(([x, z]) => [x + 6, z + 6] as [number, number]) });
      pathL.update(pathL.items.length - 1);
      selectPath(pathL.items.length - 1);
      return commit();
    }
    if (sel < 0 || !layer) return;
    const p = { ...layer.pieces[sel] };
    p.x += 4;
    p.z += 4;
    layer.pieces.push(p);
    layer.rebuild();
    sel = layer.pieces.length - 1;
    updateSel();
    commit();
  };
  const changed = () => {
    if (sel < 0 || !layer) return;
    layer.update(sel);
    updateSel();
  };
  const doUndo = () => {
    const prev = undo.pop();
    if (prev == null) return toast("Nada pra desfazer");
    replaceAll(piecesFromJson(prev), pathsFromJson(prev));
    snap = prev;
    dirty = true;
    renderSide();
  };
  const save = () => {
    if (savePieces(slugOf(track.name), pieces(), paths(), terrain)) {
      dirty = false;
      renderBar();
      toast("Autódromo salvo: a corrida em 3D vai usar este");
    } else toast("Não coube no navegador: exporte o arquivo pra guardar");
  };
  const close = () => {
    if (dirty && !window.confirm("Sair sem salvar as mudanças?")) return;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", resize);
    controls.dispose();
    layer?.dispose();
    renderer.dispose();
    // (devolve o contexto da placa de vídeo na hora: abrir e fechar várias vezes esgotava e a tela não abria)
    renderer.forceContextLoss();
    root.remove();
    onDone();
  };

  // ---- cliques: barra e painel ----
  bar.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-track]")) {
      if (dirty && !window.confirm("Trocar de pista sem salvar as mudanças?")) {
        t.value = String(idx);
        return;
      }
      void load(Number(t.value));
    }
    if (t.matches("[data-file]") && t.files?.[0]) {
      void t.files[0].text().then((txt) => {
        try {
          const list = piecesFromJson(txt);
          void loadModels(list.filter((p) => p.k === "modelo").map((p) => p.v ?? 0)).then(() => layer?.rebuild());
          undo.push(snap);
          replaceAll(list, pathsFromJson(txt));
          snap = stateJson();
          dirty = true;
          renderSide();
          toast(`${list.length} peças importadas (falta SALVAR)`);
        } catch {
          toast("Arquivo inválido");
        }
      });
      t.value = "";
    }
  });
  bar.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-exit]")) return close();
    if (t.closest("[data-all]")) return openCatalog();
    if (t.closest("[data-bake]")) return void bake();
    if (t.closest("[data-unbake]")) {
      void deleteBaked(slugOf(track.name)).then(() => {
        hasBaked = false;
        renderBar();
        toast("2D gerado apagado: o 2D desta pista volta pro desenho normal");
      });
      return;
    }
    if (t.closest("[data-save]")) return save();
    if (t.closest("[data-auto]")) {
      if (!window.confirm("Voltar ao posicionamento automático desta pista? (apaga o que foi salvo)")) return;
      undo.push(snap);
      replaceAll(auto.map((p) => ({ ...p })), autoPaths.map((it) => ({ ...it, p: it.p.slice() })));
      clearPieces(slugOf(track.name));
      snap = stateJson();
      dirty = false;
      renderSide();
      return toast("Voltou pro automático");
    }
    if (t.closest("[data-exp]")) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([piecesToJson(pieces(), paths(), terrain)], { type: "application/json" }));
      a.download = `autodromo-${slugOf(track.name)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    if (t.closest("[data-imp]")) bar.querySelector<HTMLInputElement>("[data-file]")?.click();
  });
  side.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const pl = t.closest<HTMLElement>("[data-place]");
    if (pl) {
      const k = pl.dataset.place as PieceKind;
      placing = placing === k ? null : k;
      drawing = null;
      updateSel();
      return renderSide();
    }
    const tb3 = t.closest<HTMLElement>("[data-tab3]");
    if (tb3) {
      leftTab = tb3.dataset.tab3 as typeof leftTab;
      relevo = null;
      placing = null;
      drawing = null;
      updateSel();
      return renderSide();
    }
    const rl = t.closest<HTMLElement>("[data-relevo]");
    if (rl) {
      const m = rl.dataset.relevo as BrushMode;
      relevo = relevo === m ? null : m;
      placing = null;
      drawing = null;
      updateSel();
      return renderSide();
    }
    const dm = t.closest<HTMLElement>("[data-delmodel]");
    if (dm && layer) {
      if (!window.confirm("Apagar o arquivo deste modelo do navegador? As peças dele viram caixa rosa até importar de novo.")) return;
      void deleteModel(Number(dm.dataset.delmodel)).then(async () => {
        myModels = await listModels();
        layer?.rebuild();
        renderSide();
      });
      return;
    }
    if (t.closest("[data-glb]")) return side.querySelector<HTMLInputElement>("[data-glbfile]")?.click();
    const md = t.closest<HTMLElement>("[data-model]");
    if (md) {
      const id = Number(md.dataset.model);
      placing = placing === "modelo" && placingV === id ? null : "modelo";
      placingV = id;
      drawing = null;
      relevo = null;
      updateSel();
      return renderSide();
    }
    const ga = t.closest<HTMLElement>("[data-grpall]");
    if (ga) {
      const names = (ga.dataset.grpall ?? "").split("|"), open = !names.every((n) => openGroups.has(n));
      for (const n of names) {
        if (open) openGroups.add(n);
        else openGroups.delete(n);
      }
      return renderSide();
    }
    const lr = t.closest<HTMLElement>("[data-lrow]");
    if (lr) {
      const r = layerRows[Number(lr.dataset.lrow)];
      if (!r) return;
      const me = e as MouseEvent;
      const keep = new Set(me.ctrlKey || me.shiftKey || me.metaKey ? layerSel : []);
      if (keep.has(r.key)) keep.delete(r.key);
      else keep.add(r.key);
      // (a seleção da lista vira a seleção da cena: uma só abre o editor dela; várias, a seleção múltipla)
      const ids = layerRows.filter((x) => keep.has(x.key)).flatMap((x) => x.ids);
      if (ids.length === 1) selectPath(ids[0]);
      else {
        select(-1);
        for (const i of ids) multi.add(`l${i}`);
        updateSel();
      }
      for (const k of keep) layerSel.add(k);
      focusSel();
      return renderSide();
    }
    const lmv = t.closest<HTMLElement>("[data-lmove]");
    if (lmv) {
      const n = Number(lmv.dataset.lmove), dir = Number(lmv.dataset.dir);
      // (move a linha, ou todas as selecionadas se ela estiver entre elas)
      const sel0 = layerRows.map((r, k) => (layerSel.has(r.key) ? k : -1)).filter((k) => k >= 0);
      const moved = sel0.includes(n) ? sel0 : [n];
      const edge = dir < 0 ? Math.min(...moved) - 1 : Math.max(...moved) + 2;
      if (edge < 0 || edge > layerRows.length) return;
      moveRows(moved, edge >= layerRows.length ? -1 : edge);
      return renderSide();
    }
    const ly = t.closest<HTMLElement>("[data-layer]");
    if (ly) {
      selectPath(Number(ly.dataset.layer));
      return renderSide();
    }
    const lm = t.closest<HTMLElement>("[data-lup], [data-ldown]");
    if (lm && pathL) {
      // uma camada pra cima ou pra baixo (passa da vizinha)
      const i = Number(lm.dataset.lup ?? lm.dataset.ldown), up = lm.dataset.lup != null;
      const ids = paths().map((_, k) => k).filter((k) => PATHS[paths()[k].t].area && !PATHS[paths()[k].t].solid);
      const mine = orderOf(paths()[i]);
      const others = [...new Set(ids.filter((k) => k !== i).map((k) => orderOf(paths()[k])))].sort((a, b) => a - b);
      const next = up ? others.filter((o) => o >= mine) : others.filter((o) => o <= mine).reverse();
      if (!next.length) return;
      const beyond = up ? others.filter((o) => o > next[0])[0] : others.filter((o) => o < next[0]).reverse()[0];
      paths()[i].o = beyond == null ? next[0] + (up ? 1 : -1) : (next[0] + beyond) / 2;
      pathL.rebuild();
      selectPath(i);
      commit();
      return renderSide();
    }
    const dr = t.closest<HTMLElement>("[data-draw]");
    if (dr) {
      const k = dr.dataset.draw as PathKind;
      placing = null;
      drawing = drawing?.t === k ? null : { t: k, pts: [] };
      sel = selP = selPt = -1;
      updateSel();
      return renderSide();
    }
    if (t.closest("[data-finish]")) return finishDrawing();
    // heliponto em cima do prédio selecionado, do tamanho do teto
    if (t.closest("[data-heli]")) {
      let x = 0, z = 0, top = 0, span = 20, r = 0;
      const pc = sel >= 0 ? pieces()[sel] : null, it = selP >= 0 ? paths()[selP] : null;
      if (pc) {
        const s = pc.s ?? 1;
        x = pc.x;
        z = pc.z;
        r = pc.r;
        top = (pc.sy ?? 12) * s;
        span = Math.min(pc.sx ?? 16, pc.sz ?? 12) * s;
      } else if (it) {
        const sm = samplePath(it, 2);
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [px, pz] of sm) {
          x += px / sm.length;
          z += pz / sm.length;
          x0 = Math.min(x0, px);
          x1 = Math.max(x1, px);
          z0 = Math.min(z0, pz);
          z1 = Math.max(z1, pz);
        }
        top = Math.max(1, Math.round(it.w ?? 4)) * 3;
        span = Math.min(x1 - x0, z1 - z0);
      } else return;
      const keepR = lastR;
      lastR = r;
      addPiece("heliponto", x, z);
      lastR = keepR;
      const h = pieces()[sel];
      h.y = Math.round((top + 0.02) * 100) / 100;
      // (o heliponto tem 20 m de diâmetro)
      h.s = Math.max(0.3, Math.min(3, Math.round(((span * 0.9) / 20) * 100) / 100));
      changed();
      return commit();
    }
    const ud = t.closest("[data-up], [data-down]");
    if (ud && selP >= 0 && pathL) {
      pathL.reorder(selP, ud.matches("[data-up]") ? 1 : -1);
      updateSel();
      return commit();
    }
    if (t.closest("[data-cancel]")) {
      drawing = null;
      updateSel();
      return renderSide();
    }
    if (t.closest("[data-delpt]")) {
      const it = paths()[selP];
      if (it && it.p.length > (PATHS[it.t].area ? 3 : 2)) {
        it.p.splice(selPt, 1);
        selPt = -1;
        pathChanged();
        commit();
      } else toast("Poucos pontos: apague a linha inteira");
      return;
    }
    if (t.closest("[data-unsel]")) return select(-1);
    if (t.closest("[data-del]")) return del();
    if (t.closest("[data-dup]")) return dup();
  });
  side.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    // busca: só esconde os botões (sem redesenhar, senão o campo perde o foco)
    if (t.matches("[data-rr]") || t.matches("[data-rf]")) {
      if (t.matches("[data-rr]")) rRadius = Number(t.value);
      else rForce = Number(t.value);
      const o = side.querySelector(t.matches("[data-rr]") ? "[data-out=rr]" : "[data-out=rf]");
      if (o) o.textContent = t.matches("[data-rr]") ? `${rRadius} m` : rForce.toFixed(1);
      return;
    }
    if (t.matches("[data-q]")) {
      q = t.value;
      side.querySelectorAll<HTMLElement>("[data-place]").forEach((b) => (b.hidden = !!q && !norm(PIECES[b.dataset.place as PieceKind].label).includes(norm(q))));
      side.querySelectorAll<HTMLElement>("[data-draw]").forEach((b) => (b.hidden = !!q && !norm(PATHS[b.dataset.draw as PathKind].label).includes(norm(q))));
      side.querySelectorAll<HTMLDetailsElement>("details.tedgrp").forEach((d) => {
        d.hidden = !!q && ![...d.querySelectorAll<HTMLElement>("button")].some((b) => !b.hidden);
        d.open = !!q || openGroups.has(d.dataset.grp ?? "");
      });
      return;
    }
    const it = selP >= 0 ? paths()[selP] : null;
    if (it) {
      if (t.matches("[data-pw]")) {
        it.w = Number(t.value);
        const out = side.querySelector("[data-out=pw]");
        if (out) out.textContent = PATHS[it.t].solid ? String(Math.round(it.w)) : `${it.w.toFixed(1)} m`;
      }
      if (t.dataset.pc) (it as unknown as Record<string, string>)[t.dataset.pc] = t.value;
      if (t.matches("[data-preto]")) it.reto = t.checked || undefined;
      if (t.matches("[data-pvar]")) it.v = Number((t as unknown as HTMLSelectElement).value) || undefined;
      return pathChanged();
    }
    const p = sel >= 0 ? pieces()[sel] : null;
    if (!p) return;
    const f = t.dataset.f;
    if (f) {
      const v = Number(t.value);
      if (f === "r") p.r = lastR = (v * Math.PI) / 180;
      else if (f === "s") p.s = v === 1 ? undefined : v;
      else if (f === "andares") p.sy = v * 3;
      else (p as unknown as Record<string, number>)[f] = v;
      const out = side.querySelector(`[data-out="${f}"]`);
      if (out) out.textContent = f === "r" ? `${v}°` : f === "s" ? `${v.toFixed(2)}×` : f === "andares" ? String(v) : `${v.toFixed(1)} m`;
      changed();
    }
    if (t.dataset.c) {
      (p as unknown as Record<string, string>)[t.dataset.c] = t.value;
      changed();
    }
  });
  // arrastar camadas: solta em cima de outra linha = fica acima dela
  let dragRow = -1;
  side.addEventListener("dragstart", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!r) return;
    dragRow = Number(r.dataset.row);
    e.dataTransfer?.setData("text/plain", String(dragRow));
  });
  side.addEventListener("dragover", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!r || dragRow < 0) return;
    e.preventDefault();
    side.querySelectorAll<HTMLElement>("[data-row]").forEach((x) => (x.style.borderTop = x === r ? "2px solid #ffd21a" : ""));
  });
  side.addEventListener("dragend", () => (dragRow = -1));
  side.addEventListener("drop", (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!r || dragRow < 0) return;
    e.preventDefault();
    const to = Number(r.dataset.row);
    const sel0 = layerRows.map((x, k) => (layerSel.has(x.key) ? k : -1)).filter((k) => k >= 0);
    const moved = sel0.includes(dragRow) ? sel0 : [dragRow];
    dragRow = -1;
    if (!moved.includes(to)) moveRows(moved, to);
    renderSide();
  });
  // (lembra quais grupos da paleta ficaram abertos; o "toggle" não sobe, por isso a captura)
  side.addEventListener(
    "toggle",
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.dataset?.grp || q) return;
      if (d.open) openGroups.add(d.dataset.grp);
      else openGroups.delete(d.dataset.grp);
    },
    true,
  );
  side.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    const fi = e.target as HTMLInputElement;
    if (fi.matches("[data-glbfile]") && fi.files?.[0]) {
      const f = fi.files[0];
      toast(`Lendo ${f.name}...`);
      void addModelFile(f)
        .then(async (id) => {
          myModels = await listModels();
          placing = "modelo";
          placingV = id;
          renderSide();
          toast(`${f.name}: clique no chão pra colocar`);
        })
        .catch((err) => toast(`Não deu pra abrir o modelo: ${(err as Error).message}`));
      return;
    }
    if (t.matches("[data-q]") || t.matches("[data-rr]") || t.matches("[data-rf]")) return;
    if (selP >= 0) return commit();
    const p = sel >= 0 ? pieces()[sel] : null;
    if (!p) return;
    if (t.matches("[data-var]") || t.matches("[data-crowd]")) {
      if (p.k === "arquibancada") {
        const v = p.v ?? 0, kind = t.matches("[data-var]") ? Number(t.value) : v & 3;
        const crowd = t.matches("[data-crowd]") ? (t as unknown as HTMLInputElement).checked : !!(v & 4);
        p.v = standV(kind, crowd, (v >> 3) & 3) || undefined;
      } else p.v = Number(t.value) || undefined;
      layer?.rebuild();
      updateSel();
    }
    // (o fim de cada mudança no painel vale um passo do Ctrl+Z)
    commit();
  });

  // ---- mouse na cena ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitGround = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // (com relevo: acerta o chão levantado, chegando perto em duas voltas)
    let hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
    for (let k = 0; k < 2 && hit && terrain; k++) {
      const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -terrain.heightAt(hit.x, hit.z));
      hit = ray.ray.intersectPlane(pl, new THREE.Vector3()) ?? hit;
    }
    return hit;
  };
  let brushing = false;
  let rect: { x: number; y: number } | null = null;
  const rectEl = document.createElement("div");
  rectEl.className = "tedrect";
  rectEl.hidden = true;
  root.appendChild(rectEl);
  const paintAt = (e: PointerEvent) => {
    const g = hitGround(e);
    if (!g || !terrain || !relevo) return;
    terrain.brush(g.x, g.z, rRadius, rForce, relevo, rLevel);
    dirty = true;
  };
  /** o que está embaixo do mouse: peça, linha ou nada (o mais perto da câmera) */
  const pick = (e: PointerEvent): { piece: number } | { path: number } | null => {
    if (!layer || !pathL) return null;
    hitGround(e);
    for (const h of ray.intersectObjects([...layer.meshes, pathL.group], true)) {
      const pi = pathL.pathAt(h.object, h.faceIndex);
      if (pi >= 0) return { path: pi };
      if (h.instanceId == null) continue;
      const i = layer.pieceAt(h.object, h.instanceId);
      if (i >= 0) return { piece: i };
    }
    return null;
  };
  let drag: { kind: "piece" | "path" | "pt"; i: number; dx: number; dz: number; last?: THREE.Vector3; moved: boolean } | null = null;
  let down: { x: number; y: number } | null = null;
  // (captura antes dos controles: clicou numa peça, arrasta a peça e não o mapa)
  root.addEventListener(
    "pointerdown",
    (e) => {
      // (Alt segurado: só anda pela cena, não mexe em nada)
      if (e.target !== renderer.domElement || e.button !== 0 || loading || e.altKey) return;
      down = { x: e.clientX, y: e.clientY };
      if (relevo) {
        const g = hitGround(e);
        if (g && terrain) rLevel = terrain.heightAt(g.x, g.z);
        brushing = true;
        controls.enabled = false;
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          /* (evento sintético) */
        }
        paintAt(e);
        e.stopPropagation();
        return;
      }
      if (placing) {
        const g = hitGround(e);
        if (g) addPiece(placing, g.x, g.z);
        e.stopPropagation();
        return;
      }
      if (drawing) {
        const g = hitGround(e);
        if (g) {
          drawing.pts.push([g.x, g.z]);
          updateSel();
          renderSide();
        }
        e.stopPropagation();
        return;
      }
      // Shift: clique numa coisa põe/tira da seleção; no chão vazio arrasta um retângulo
      if (e.shiftKey) {
        const hit = pick(e);
        if (hit) {
          const key = "piece" in hit ? `p${hit.piece}` : `l${hit.path}`;
          // (o que já estava selecionado sozinho entra junto)
          if (!multi.size && sel >= 0) multi.add(`p${sel}`);
          if (!multi.size && selP >= 0) multi.add(`l${selP}`);
          if (multi.has(key)) multi.delete(key);
          else multi.add(key);
          sel = selP = selPt = -1;
          updateSel();
          renderSide();
          e.stopPropagation();
          return;
        }
        if (selP < 0) {
          rect = { x: e.clientX, y: e.clientY };
          rectEl.hidden = false;
          controls.enabled = false;
          e.stopPropagation();
          return;
        }
      }
      const g = hitGround(e);
      // linha selecionada: ponto amarelo arrasta o ponto; Shift+clique põe um ponto no fim
      if (selP >= 0) {
        const hp = ray.intersectObjects(handles.children, false)[0];
        if (hp) {
          selectPath(selP, hp.object.userData.pt as number);
          drag = { kind: "pt", i: hp.object.userData.pt as number, dx: 0, dz: 0, moved: false };
        } else if (e.shiftKey && g) {
          paths()[selP].p.push([g.x, g.z]);
          pathChanged();
          commit();
          e.stopPropagation();
          return;
        }
      }
      if (!drag) {
        const hit = pick(e);
        if (!hit) return;
        if ("path" in hit) {
          selectPath(hit.path);
          drag = { kind: "path", i: hit.path, dx: 0, dz: 0, last: g ?? undefined, moved: false };
        } else {
          const p = pieces()[hit.piece];
          select(hit.piece);
          drag = { kind: "piece", i: hit.piece, dx: p.x - (g?.x ?? p.x), dz: p.z - (g?.z ?? p.z), moved: false };
        }
      }
      controls.enabled = false;
      try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          /* (evento sintético) */
        }
      e.stopPropagation();
    },
    true,
  );
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (brushing) return paintAt(e);
    if (rect) {
      const r = root.getBoundingClientRect();
      Object.assign(rectEl.style, { left: `${Math.min(rect.x, e.clientX) - r.left}px`, top: `${Math.min(rect.y, e.clientY) - r.top}px`, width: `${Math.abs(e.clientX - rect.x)}px`, height: `${Math.abs(e.clientY - rect.y)}px` });
      return;
    }
    if (drawing) {
      const g = hitGround(e);
      cursor = g ? [g.x, g.z] : null;
      updatePreview();
    }
    if (!drag) return;
    const g = hitGround(e);
    if (!g) return;
    if (drag.kind === "pt") {
      paths()[selP].p[drag.i] = [g.x, g.z];
      drag.moved = true;
      return pathChanged();
    }
    if (drag.kind === "path") {
      if (drag.last) {
        const dx = g.x - drag.last.x, dz = g.z - drag.last.z;
        paths()[drag.i].p = paths()[drag.i].p.map(([x, z]) => [x + dx, z + dz]);
      }
      drag.last = g;
      drag.moved = true;
      return pathChanged();
    }
    const p = pieces()[drag.i];
    p.x = g.x + drag.dx;
    p.z = g.z + drag.dz;
    drag.moved = true;
    changed();
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (rect) {
      // tudo cujo centro cai no retângulo da tela
      const r = renderer.domElement.getBoundingClientRect();
      const ax = Math.min(rect.x, e.clientX), bx = Math.max(rect.x, e.clientX), ay = Math.min(rect.y, e.clientY), by = Math.max(rect.y, e.clientY);
      rect = null;
      rectEl.hidden = true;
      controls.enabled = true;
      if (bx - ax < 4 || by - ay < 4) return;
      const v = new THREE.Vector3();
      const inside = (x: number, y: number, z: number) => {
        v.set(x, y, z).project(camera);
        if (v.z > 1) return false;
        const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
        return sx >= ax && sx <= bx && sy >= ay && sy <= by;
      };
      const hy = (x: number, z: number) => (terrain ? terrain.heightAt(x, z) : 0);
      pieces().forEach((pc, i) => inside(pc.x, hy(pc.x, pc.z) + (pc.y ?? 0), pc.z) && multi.add(`p${i}`));
      paths().forEach((it, i) => {
        if (it.src === "mapa" && PATHS[it.t].area) return; // (o chão grande do mapa só com clique)
        let x = 0, z = 0;
        for (const [px, pz] of it.p) {
          x += px / it.p.length;
          z += pz / it.p.length;
        }
        if (inside(x, hy(x, z), z)) multi.add(`l${i}`);
      });
      sel = selP = selPt = -1;
      updateSel();
      return renderSide();
    }
    if (brushing) {
      brushing = false;
      controls.enabled = true;
      renderBar();
      return;
    }
    if (drag) {
      if (drag.moved) commit();
      drag = null;
      controls.enabled = true;
    } else if (down && !placing && !drawing && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) select(-1);
    down = null;
  });

  // botão direito clicado (sem arrastar, que gira a câmera) em cima de algo: menu rápido
  const ctx = document.createElement("div");
  ctx.className = "tedctx panel";
  ctx.hidden = true;
  root.appendChild(ctx);
  let rdown: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    ctx.hidden = true;
    if (e.button === 2) {
      rdown = { x: e.clientX, y: e.clientY };
      // girar a câmera: o eixo é o ponto do chão onde clicou (a tela não pula: câmera e alvo giram juntos)
      // (com algo selecionado, gira em volta dele)
      const pv = selBox.visible && !selBox.box.isEmpty() ? selBox.box.getCenter(new THREE.Vector3()) : null;
      orbit = { x: e.clientX, y: e.clientY, pivot: pv ?? hitGround(e) ?? controls.target.clone() };
    }
  });
  let orbit: { x: number; y: number; pivot: THREE.Vector3 } | null = null;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  window.addEventListener("pointermove", (e) => {
    if (!orbit || !(e.buttons & 2)) return void (orbit = null);
    const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
    orbit.x = e.clientX;
    orbit.y = e.clientY;
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    qa.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.005);
    qb.setFromAxisAngle(right, -dy * 0.005);
    // (sem passar de olhar reto pra baixo nem olhar pro horizonte)
    fwd.set(0, 0, -1).applyQuaternion(qb.clone().multiply(camera.quaternion));
    if (fwd.y > -0.08 || fwd.y < -0.998) qb.identity();
    const q = qa.multiply(qb);
    const pv = orbit.pivot;
    camera.position.sub(pv).applyQuaternion(q).add(pv);
    controls.target.sub(pv).applyQuaternion(q).add(pv);
    camera.quaternion.premultiply(q);
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button === 2) orbit = null;
  });
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (e.button !== 2 || !rdown || drawing || placing || e.altKey) return;
    const moved = Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y) > 4;
    rdown = null;
    if (moved) return;
    const hit = pick(e);
    if (!hit) return;
    const area = "path" in hit && PATHS[paths()[hit.path].t].area && !PATHS[paths()[hit.path].t].solid && paths()[hit.path].t !== "pintura";
    if ("path" in hit) selectPath(hit.path);
    else select(hit.piece);
    ctx.innerHTML = `${area ? `<button class="btn small" data-ctx="up">▲ POR CIMA</button><button class="btn small" data-ctx="down">▼ POR BAIXO</button>` : ""}<button class="btn small" data-ctx="dup">DUPLICAR</button><button class="btn small" data-ctx="del">APAGAR</button>`;
    const r = root.getBoundingClientRect();
    ctx.style.left = `${e.clientX - r.left + 4}px`;
    ctx.style.top = `${e.clientY - r.top + 4}px`;
    ctx.hidden = false;
  });
  ctx.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]");
    if (!b) return;
    ctx.hidden = true;
    side.querySelector<HTMLElement>(`[data-${b.dataset.ctx}]`)?.click();
  });

  renderer.domElement.addEventListener("dblclick", () => {
    if (!drawing) return;
    // (o duplo clique também pôs dois pontos iguais no fim: tira o repetido)
    const n = drawing.pts.length;
    if (n > 1 && Math.hypot(drawing.pts[n - 1][0] - drawing.pts[n - 2][0], drawing.pts[n - 1][1] - drawing.pts[n - 2][1]) < 1.5) drawing.pts.pop();
    finishDrawing();
  });

  // ---- teclas ----
  const onKey = (e: KeyboardEvent) => {
    // (catálogo aberto: Esc fecha, o resto das teclas não mexe na cena)
    if (!catalog.hidden) {
      if (e.key === "Escape") catalog.hidden = true;
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT") {
      if (e.key !== "Escape") return;
      (e.target as HTMLElement).blur();
    }
    e.stopPropagation();
    const k = e.key.toLowerCase();
    const p = sel >= 0 ? pieces()[sel] : null;
    if (drawing) {
      if (k === "enter") return finishDrawing();
      if (k === "backspace") {
        drawing.pts.pop();
        updateSel();
        return renderSide();
      }
    }
    if (k === "escape") {
      if (relevo) relevo = null;
      else if (drawing) drawing = null;
      else if (placing) placing = null;
      else select(-1);
      updateSel();
      return renderSide();
    }
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      return doUndo();
    }
    if ((e.ctrlKey || e.metaKey) && k === "d") {
      e.preventDefault();
      return dup();
    }
    if ((k === "pageup" || k === "pagedown") && selP >= 0 && pathL && PATHS[paths()[selP].t].area) {
      e.preventDefault();
      pathL.reorder(selP, k === "pageup" ? 1 : -1);
      updateSel();
      return commit();
    }
    if ((k === "delete" || k === "backspace") && multi.size) return del();
    if (k === "delete" || k === "backspace") {
      if (selP >= 0 && selPt >= 0) return side.querySelector<HTMLElement>("[data-delpt]")?.click();
      return del();
    }
    if (!p) return;
    if (k === "q" || k === "e") {
      p.r = lastR = p.r + ((k === "q" ? 1 : -1) * Math.PI) / 12;
      changed();
      commit();
    }
    if (k === "[" || k === "]") {
      const s = Math.max(0.3, Math.min(3, (p.s ?? 1) * (k === "]" ? 1.1 : 1 / 1.1)));
      p.s = Math.abs(s - 1) < 0.01 ? undefined : Math.round(s * 100) / 100;
      changed();
      commit();
    }
  };
  window.addEventListener("keydown", onKey, true);

  // ---- tamanho e laço ----
  /** escala dos painéis pelo tamanho da tela (tela menor: tudo menor, nada cortado) */
  const fitUi = () => {
    const z = Math.max(0.6, Math.min(1.15, window.innerWidth / 1600, window.innerHeight / 880));
    root.style.setProperty("--tedz", z.toFixed(3));
    root.style.setProperty("--pw", `${Math.round(270 * z)}px`);
  };
  fitUi();
  const resize = () => {
    fitUi();
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();
  let raf = 0;
  let terrFrame = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (baking) return;
    if (world && terrain && ++terrFrame % 20 === 0) applyTerrain(world, terrain);
    if (fly) {
      const k = Math.min(1, (performance.now() - fly.t0) / 600), e = 1 - Math.pow(1 - k, 3);
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (k >= 1) fly = null;
    }
    controls.update();
    // sombra em volta do que está sendo olhado (o tamanho segue o zoom)
    const t = controls.target, dist = camera.position.distanceTo(t);
    const ext = Math.max(60, Math.min(500, dist * 0.9));
    const sc = sun.shadow.camera;
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.near = 1;
      sc.far = 600;
      sc.updateProjectionMatrix();
    }
    const tx = ((2 * ext) / 2048) * 2;
    const sx = Math.round(t.x / tx) * tx, sz = Math.round(t.z / tx) * tx;
    sun.position.set(sx - 60, 150, sz - 80);
    sun.target.position.set(sx, 0, sz);
    sun.target.updateMatrixWorld();
    layer?.lod(camera.position, SCENE_LOD_DIST[gfx().sceneQ]);
    renderer.render(scene, camera);
  };
  loop();
  renderBar();
  renderSide();
  void load(idx);
}
