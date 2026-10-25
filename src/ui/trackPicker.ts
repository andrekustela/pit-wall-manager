// Escolher pista com validação (estilo "validação de dados" do Excel): um campo
// que abre a lista de pistas, filtra enquanto digita e só aceita uma pista que
// existe (ou "sorteada"). Setas + Enter escolhem, Esc fecha.
import { CIRCUITS } from "../sim/track";
import { drawTrackThumb, esc, trackTags, trackTagsHtml } from "./common";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** monta o seletor em `host`; `value` -1 = sorteada. Devolve como ler o valor atual. */
export function mountTrackPicker(host: HTMLElement, value: number, onChange?: (v: number) => void) {
  const all = [{ i: -1, name: "🎲 Sorteada na hora", key: "sorteada aleatoria" }].concat(
    CIRCUITS.flatMap((c, i) => (c.standby ? [] : [{ i, name: c.name, key: norm(`${c.name} ${c.official ?? ""} ${trackTags(i).map((x) => x.t).join(" ")}`) }])).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  );
  let cur = value;
  let open = false;
  let hi = 0; // item destacado na lista
  host.classList.add("tpick");
  host.innerHTML = `<div class="tpick-box"><canvas class="tpick-thumb"></canvas><input class="txt tpick-in" spellcheck="false" autocomplete="off"><button class="tpick-arrow" tabindex="-1">▾</button></div>
    <div class="tpick-msg" hidden></div><div class="tpick-list" hidden></div>`;
  const input = host.querySelector<HTMLInputElement>(".tpick-in")!;
  const list = host.querySelector<HTMLElement>(".tpick-list")!;
  const msg = host.querySelector<HTMLElement>(".tpick-msg")!;
  const thumb = host.querySelector<HTMLCanvasElement>(".tpick-thumb")!;
  const nameOf = (i: number) => all.find((x) => x.i === i)?.name ?? "";

  const drawThumb = () => {
    if (cur >= 0) return drawTrackThumb(thumb, cur);
    thumb.width = thumb.clientWidth;
    thumb.height = thumb.clientHeight;
    const g = thumb.getContext("2d")!;
    g.fillStyle = "#8a93a6";
    g.font = "600 22px Oswald, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("?", thumb.width / 2, thumb.height / 2);
  };
  const setValue = (i: number) => {
    cur = i;
    input.value = nameOf(i);
    msg.hidden = true;
    input.classList.remove("bad");
    requestAnimationFrame(drawThumb);
    onChange?.(i);
  };

  let shown: typeof all = all;
  const renderList = () => {
    const q = norm(input.value.trim());
    // ao abrir, o texto é o da pista atual: mostra tudo
    shown = !q || q === norm(nameOf(cur)) ? all : all.filter((x) => x.key.includes(q) || norm(x.name).includes(q));
    hi = Math.max(0, Math.min(hi, shown.length - 1));
    list.innerHTML = shown.length
      ? shown.map((x, k) => `<button class="tpick-item ${k === hi ? "hi" : ""} ${x.i === cur ? "cur" : ""}" data-i="${x.i}"><canvas data-th="${x.i}"></canvas><span>${esc(x.name)}</span><span class="ttags">${x.i >= 0 ? trackTagsHtml(x.i, 3) : ""}</span></button>`).join("")
      : `<div class="tpick-none">Nenhuma pista com esse nome</div>`;
    // miniaturas aos poucos (não trava a lista)
    const cvs = [...list.querySelectorAll<HTMLCanvasElement>("canvas[data-th]")];
    let k = 0;
    const some = () => {
      const t0 = performance.now();
      while (k < cvs.length && performance.now() - t0 < 6) {
        const c = cvs[k++];
        const i = Number(c.dataset.th);
        if (i >= 0 && c.isConnected) drawTrackThumb(c, i, "#c9d1e0");
      }
      if (k < cvs.length && open) requestAnimationFrame(some);
    };
    requestAnimationFrame(some);
  };
  const scrollHi = () => list.querySelector<HTMLElement>(".tpick-item.hi")?.scrollIntoView({ block: "nearest" });
  const openList = () => {
    if (open) return;
    open = true;
    list.hidden = false;
    hi = Math.max(0, all.findIndex((x) => x.i === cur));
    renderList();
    requestAnimationFrame(scrollHi);
  };
  const closeList = (validate = true) => {
    if (!open) return;
    open = false;
    list.hidden = true;
    if (!validate) return setValue(cur);
    // só aceita o que existe: texto igual ao nome de uma pista, senão volta pra escolha anterior
    const q = norm(input.value.trim());
    const exact = all.find((x) => norm(x.name) === q);
    if (exact) setValue(exact.i);
    else {
      const was = nameOf(cur);
      input.value = was;
      if (q && q !== norm(was)) {
        msg.textContent = "Pista não encontrada: escolha uma da lista.";
        msg.hidden = false;
        input.classList.add("bad");
        setTimeout(() => {
          msg.hidden = true;
          input.classList.remove("bad");
        }, 2200);
      }
    }
  };

  input.addEventListener("focus", () => {
    openList();
    input.select();
  });
  input.addEventListener("input", () => {
    if (!open) openList();
    hi = 0;
    renderList();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openList();
      hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === "ArrowDown" ? 1 : -1)));
      list.querySelectorAll(".tpick-item").forEach((b, k) => b.classList.toggle("hi", k === hi));
      scrollHi();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = shown[hi];
      if (open && pick) {
        open = false;
        list.hidden = true;
        setValue(pick.i);
        input.blur();
      }
    } else if (e.key === "Escape") {
      e.stopPropagation();
      closeList(false);
      input.blur();
    }
  });
  // escolher na lista (mousedown pra não perder o foco antes)
  list.addEventListener("mousedown", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!b) return;
    e.preventDefault();
    open = false;
    list.hidden = true;
    setValue(Number(b.dataset.i));
    input.blur();
  });
  host.querySelector(".tpick-arrow")!.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (open) closeList(false);
    else input.focus();
  });
  input.addEventListener("blur", () => closeList(true));

  setValue(cur);
  return { get: () => cur };
}
