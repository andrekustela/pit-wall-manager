// Tela do Editor (menu): renomear pistas e pilotos e escolher a voz do P1 e do P2 no rádio.
// Fica só neste navegador/programa; dá pra exportar/importar um pacote de nomes.
import { ACTIVE_TRACKS, CIRCUITS, trackGroup } from "../sim/track";
import { DRIVER_POOL, LEGEND_POOL } from "../sim/drivers";
import { drawTrackThumb, esc, toast } from "./common";
import { downloadPack, installPack } from "./trackPack";

/** ajuda: como criar uma pista nova e passar pros amigos */
function showHowto() {
  const h = document.createElement("div");
  h.className = "helpmodal";
  h.style.zIndex = "260";
  h.innerHTML = `<div class="helpbox panel"><div class="helphead"><b>COMO CRIAR UMA PISTA</b><button class="btn small" data-x>✕</button></div>
    <div class="helpbody">
      <p>Uma pista (mod) é um arquivo <b>.json</b> com o traçado, o traçado ideal e, se quiser, o autódromo 3D. Três jeitos de fazer:</p>
      <ol>
        <li><b>Desenhar do zero</b>: <b>+ CRIAR PISTA</b> → <b>✎ DESENHAR DO ZERO</b>. Clique os pontos no sentido da corrida e feche a volta. Dê nome, descrição, se é de rua ou de noite e a chance de chuva.</li>
        <li><b>Partir de uma pista</b>: em qualquer pista da lista, <b>EDITAR TRAÇADO</b>. Arraste os pontos (puxa os vizinhos junto), duplo clique põe ponto, botão direito tira. Os avisos mostram curva apertada demais e partes que se cruzam.</li>
        <li><b>Inspirada num traçado real</b>: com um mapa aberto do lado (Google Maps, por exemplo), desenhe do zero copiando as curvas, ponto a ponto, no editor de traçado.</li>
      </ol>
      <p>Depois de desenhar: <b>🏎 CALCULAR TRAÇADO IDEAL</b> (o carro de teste acha por onde andar mais rápido; sem isso os carros andam pelo meio) e <b>SALVAR</b>. Pra decorar: <b>EDITAR 3D</b> na pista (arquibancadas, boxes, árvores, zebras, relevo).</p>
      <p><b>Passar pros amigos</b>: <b>⬇ BAIXAR PISTA</b> gera o arquivo. Quem recebe usa <b>⬆ INSTALAR MODS</b> e a pista aparece na aba <b>MODS</b> da escolha de pista.</p>
      <p class="hint">Pistas instaladas ou feitas por você valem no modo solo (o servidor do online não tem elas). As pistas reais que vêm com o jogo valem no solo, no campeonato e no online. Mods são de uso não comercial.</p>
    </div></div>`;
  document.body.appendChild(h);
  h.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === h || t.closest("[data-x]")) h.remove();
  });
}
import { RADIO_VOICES, exportEditor, getEditor, importEditor, originalDriver, originalTrackName, saveEditor, type EditorData } from "./editorData";

type Tab = "pistas" | "lendas" | "pilotos" | "vozes";

export function showEditor(onDone: () => void) {
  const d: EditorData = getEditor();
  let tab: Tab = "pistas";
  let q = "";
  /** pista com o campo de nome aberto (EDITAR NOME) */
  let editingName = -1;
  const m = document.createElement("div");
  m.className = "helpmodal";
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rowsHtml = () => {
    if (tab === "vozes") {
      const pick = (k: "p1" | "p2") =>
        `<div class="fld"><span>Voz do ${k.toUpperCase()} (${k === "p1" ? "1º" : "2º"} piloto da equipe)</span><div class="seg" data-voice="${k}">${RADIO_VOICES.map((v) => `<button data-v="${v.id}" class="${d.voices[k] === v.id ? "on" : ""}">${v.label}</button>`).join("")}</div></div>`;
      return `${pick("p1")}${pick("p2")}<p class="hint" style="margin:6px 0 0">As falas do rádio são gravadas em cada voz. Os dois pilotos podem ter a mesma voz, mas aí fica difícil saber quem está falando.</p>`;
    }
    if (tab === "pistas") {
      // todas as pistas, por grupo; cada uma com os botões dela (traçado, 3D, nome e, se for mod, baixar)
      const GROUPS: [ReturnType<typeof trackGroup>, string][] = [["oficial", "PISTAS OFICIAIS"], ["real", "MODS · PISTAS REAIS"], ["mod", "MODS · INSTALADOS E FEITOS POR VOCÊ"]];
      const head = `<div class="edtrkbar"><button class="btn small primary" data-install>⬆ INSTALAR MODS</button><button class="btn small" data-newtrack>+ CRIAR PISTA</button><button class="btn small" data-howto>? COMO CRIAR UMA PISTA</button><input type="file" accept=".json" multiple data-modfile hidden></div>`;
      return head + GROUPS.map(([g, title]) => {
        const list = ACTIVE_TRACKS.filter((i) => trackGroup(i) === g)
          .map((i) => ({ i, o: originalTrackName(i) }))
          .filter((x) => !q || norm(`${x.o} ${d.tracks[x.i] ?? ""} ${CIRCUITS[x.i].official ?? ""}`).includes(norm(q)))
          .sort((a, b) => a.o.localeCompare(b.o, "pt-BR"));
        if (!list.length && g !== "mod") return "";
        const rows = list.map(({ i, o }) => {
          const shown = d.tracks[i] || o, mod = g !== "oficial";
          return `<div class="edtrk ${editingName === i ? "naming" : ""}" data-row="${i}"><canvas data-thumb="${i}"></canvas>
            <div class="edtname"><b>${esc(shown)}</b>${shown !== o ? `<small>original: ${esc(o)}</small>` : ""}
              <input class="txt" data-track="${i}" maxlength="40" placeholder="${esc(o)}" value="${esc(d.tracks[i] ?? "")}"></div>
            <div class="edtbtns"><button class="btn small" data-act="tle" data-i="${i}">EDITAR TRAÇADO</button><button class="btn small" data-act="ted" data-i="${i}">EDITAR 3D</button><button class="btn small" data-act="nome" data-i="${i}">EDITAR NOME</button>${mod ? `<button class="btn small" data-act="baixar" data-i="${i}">⬇ BAIXAR PISTA</button>` : ""}</div></div>`;
        }).join("");
        return `<h3 class="m2psub">${title} (${list.length})</h3>${rows || `<p class="hint">Nenhuma ainda. Use <b>⬆ INSTALAR MODS</b> pra colocar uma pista que alguém te mandou, ou <b>+ CRIAR PISTA</b>.</p>`}`;
      }).join("");
    }
    const pool = tab === "lendas" ? LEGEND_POOL : DRIVER_POOL;
    return pool
      .map((p) => ({ p, o: originalDriver(p.id)! }))
      .filter(({ o, p }) => !q || norm(`${o.name} ${o.short} ${d.drivers[p.id]?.name ?? ""}`).includes(norm(q)))
      .sort((a, b) => a.o.name.localeCompare(b.o.name, "pt-BR"))
      .map(({ p, o }) => {
        const e = d.drivers[p.id] ?? {};
        return `<div class="edrow"><span>${esc(o.name)} <small>${esc(o.short)}</small></span>
          <input class="txt" data-dname="${esc(p.id)}" maxlength="30" placeholder="${esc(o.name)}" value="${esc(e.name ?? "")}">
          <input class="txt edshort" data-dshort="${esc(p.id)}" maxlength="3" placeholder="${esc(o.short)}" value="${esc(e.short ?? "")}"></div>`;
      })
      .join("");
  };
  const render = () => {
    m.innerHTML = `<div class="helpbox panel profbox edbox">
      <div class="helphead"><b>EDITOR</b><button class="btn small" data-x>✕</button></div>
      <p class="hint" style="margin:0 0 10px">Pistas: mexa no traçado, no autódromo 3D e no nome de cada uma, instale mods e baixe as suas. Pilotos e vozes: troque os nomes (vazio = original) e a voz de cada piloto no rádio. Fica salvo só aqui.</p>
      <div class="seg edtabs">${(["pistas", "lendas", "pilotos", "vozes"] as Tab[]).map((t) => `<button data-tab="${t}" class="${t === tab ? "on" : ""}">${{ pistas: "PISTAS", lendas: "LENDAS", pilotos: "PILOTOS FICTÍCIOS", vozes: "VOZES DO RÁDIO" }[t]}</button>`).join("")}</div>
      ${tab === "vozes" ? "" : `<input class="txt edsearch" data-q placeholder="Buscar..." value="${esc(q)}">`}
      <div class="edlist">${rowsHtml()}</div>
      <div class="row-btns" style="justify-content:space-between;margin-top:12px">
        <div class="row-btns" style="margin:0"><button class="btn small" data-exp>⬇ EXPORTAR</button><button class="btn small" data-imp>⬆ IMPORTAR</button><button class="btn small" data-reset>RESTAURAR ORIGINAIS</button><input type="file" accept=".json" data-file hidden></div>
        <div class="row-btns" style="margin:0"><button class="btn" data-x>CANCELAR</button><button class="btn primary" data-save>SALVAR</button></div>
      </div></div>`;
    const s = m.querySelector<HTMLInputElement>("[data-q]");
    if (s && q) {
      s.focus();
      s.setSelectionRange(q.length, q.length);
    }
    // miniaturas das pistas aos poucos (uma leva por quadro), pra a lista abrir na hora
    const cvs = [...m.querySelectorAll<HTMLCanvasElement>("canvas[data-thumb]")];
    let k = 0;
    const drawSome = () => {
      const t0 = performance.now();
      while (k < cvs.length && performance.now() - t0 < 8) {
        const cv = cvs[k++];
        if (cv.isConnected) drawTrackThumb(cv, Number(cv.dataset.thumb));
      }
      if (k < cvs.length) requestAnimationFrame(drawSome);
    };
    requestAnimationFrame(drawSome);
    m.querySelector<HTMLInputElement>(".naming input")?.focus();
  };
  /** abre o editor de traçado (numa pista, ou do jeito que ele abre) e o do autódromo 3D (numa pista) */
  const openLayout = (i?: number) => {
    close();
    toast("Abrindo o editor de traçado...");
    import("./trackLayoutEditor")
      .then((md) => md.showTrackLayoutEditor(onDone, i))
      .catch((err) => {
        console.error(err);
        toast("Não deu pra abrir o editor: recarregando a página...");
        setTimeout(() => location.reload(), 1200);
      });
  };
  const open3d = (i: number) => {
    close();
    // (aviso enquanto baixa; se o arquivo do editor não vier, por exemplo porque o jogo foi atualizado
    // com a página aberta, recarrega a página em vez de não fazer nada)
    toast("Abrindo o editor do autódromo 3D...");
    import("./trackEditor3d")
      .then((md) => md.showTrackEditor3d(onDone, i))
      .catch((err) => {
        console.error(err);
        toast("Não deu pra abrir o editor: recarregando a página...");
        setTimeout(() => location.reload(), 1200);
      });
  };
  // guarda o que foi digitado antes de trocar de aba / buscar
  const collect = () => {
    m.querySelectorAll<HTMLInputElement>("[data-track]").forEach((i) => {
      const v = i.value.trim();
      if (v) d.tracks[i.dataset.track!] = v;
      else delete d.tracks[i.dataset.track!];
    });
    m.querySelectorAll<HTMLInputElement>("[data-dname]").forEach((i) => {
      const id = i.dataset.dname!, sh = m.querySelector<HTMLInputElement>(`[data-dshort="${id}"]`)!;
      const name = i.value.trim(), short = sh.value.trim().toUpperCase();
      if (name || short) d.drivers[id] = { ...(name ? { name } : {}), ...(short ? { short } : {}) };
      else delete d.drivers[id];
    });
  };
  render();
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
  m.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-q]")) {
      collect();
      q = t.value;
      render();
    }
  });
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    // botões de cada pista (os editores de traçado e 3D são telas próprias: o Three.js só é baixado lá)
    const act = t.closest<HTMLElement>("[data-act]");
    if (act) {
      const i = Number(act.dataset.i);
      collect();
      saveEditor(d);
      if (act.dataset.act === "tle") return openLayout(i);
      if (act.dataset.act === "ted") return open3d(i);
      if (act.dataset.act === "baixar") return downloadPack(i);
      if (act.dataset.act === "nome") {
        editingName = editingName === i ? -1 : i;
        render();
      }
      return;
    }
    if (t.closest("[data-newtrack]")) {
      collect();
      saveEditor(d);
      return openLayout();
    }
    if (t.closest("[data-howto]")) return showHowto();
    if (t.closest("[data-install]")) return m.querySelector<HTMLInputElement>("[data-modfile]")!.click();
    const tb = t.closest<HTMLElement>("[data-tab]");
    if (tb) {
      collect();
      tab = tb.dataset.tab as Tab;
      q = "";
      render();
      return;
    }
    const vb = t.closest<HTMLElement>("[data-voice] button");
    if (vb) {
      const k = vb.parentElement!.dataset.voice as "p1" | "p2";
      d.voices[k] = vb.dataset.v as EditorData["voices"]["p1"];
      render();
      return;
    }
    if (t.closest("[data-save]")) {
      collect();
      saveEditor(d);
      toast("Editor salvo");
      close();
      onDone();
    }
    if (t.closest("[data-reset]")) {
      d.tracks = {};
      d.drivers = {};
      render();
      toast("Nomes originais (clique em SALVAR pra valer)");
    }
    if (t.closest("[data-exp]")) {
      collect();
      saveEditor(d);
      const url = URL.createObjectURL(new Blob([exportEditor()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "pit-wall-manager-nomes.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    if (t.closest("[data-imp]")) m.querySelector<HTMLInputElement>("[data-file]")!.click();
  });
  m.addEventListener("change", async (e) => {
    const inp = e.target as HTMLInputElement;
    // instalar mods: um ou vários pacotes de pista (.json)
    if (inp.matches("[data-modfile]") && inp.files?.length) {
      collect();
      const ok: string[] = [];
      for (const f of inp.files)
        try {
          ok.push(installPack(await f.text()));
        } catch (err) {
          toast(`${f.name}: ${err instanceof Error ? err.message : "não deu pra instalar"}`);
        }
      if (ok.length) toast(ok.length === 1 ? `Mod instalado: "${ok[0]}" (aba MODS na escolha de pista)` : `${ok.length} mods instalados`);
      render();
      return;
    }
    if (!inp.matches("[data-file]") || !inp.files?.[0]) return;
    try {
      const c = importEditor(await inp.files[0].text());
      Object.assign(d, c);
      render();
      toast("Pacote de nomes importado");
      onDone();
    } catch (err) {
      toast(err instanceof Error && /Editor/.test(err.message) ? err.message : "Não consegui ler esse arquivo.");
    }
  });
}
