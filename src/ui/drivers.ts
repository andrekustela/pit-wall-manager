// Tela dos pilotos (no começo do fim de semana; no campeonato, no começo da temporada), no lugar
// da janelinha do sorteio. Dois jeitos:
// - sorteados: as cartas dos seus pilotos viram e dá pra trocar 1 pelo reserva (surpresa)
// - escolher: você monta a dupla entre todos os pilotos; quem entra troca de lugar com quem sai
import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { poolOf, type DriverProfile } from "../sim/drivers";
import { confirmDialog } from "./confirm";
import { esc, natBadge, teamDrivers, teamName } from "./common";
import { driverCardHtml } from "./driverCard";
import { mountFlagBackdrop } from "./flagField";

type Sort = "rating" | "pace" | "wet" | "name";

export class DriversScreen {
  private seat = 0;
  private query = "";
  private sort: Sort = "rating";
  private shown = new Set<string>(); // cartas que já viraram (não repete a animação)

  constructor(
    private root: HTMLElement,
    private conn: Connection,
    private lobby: LobbyState,
    /** pronto: segue pro treino (ou estratégia, na corrida única) */
    private onDone: () => void,
    private nextLabel: string,
  ) {
    this.render();
  }

  private get me() {
    return this.lobby.players.find((p) => p.id === this.lobby.you)!;
  }

  private render() {
    const l = this.lobby;
    const myTeam = TEAMS.find((t) => t.id === this.me.teamId)!;
    const tn = teamName(l, myTeam.id);
    const mine = teamDrivers(l, myTeam.id);
    const choose = l.pickMode === "choose";
    const canSwap = !choose && !l.swapUsed?.includes(myTeam.id);
    const listScroll = this.root.querySelector<HTMLElement>(".dlist")?.scrollTop ?? 0;
    this.root.innerHTML = `
      <div class="screen drvscreen"><div class="dwrap">
        <header class="dtop">
          <div><h1 class="title">${choose ? "ESCOLHA DOS" : "SORTEIO DOS"} <span>PILOTOS</span></h1>
            <p class="sub">${esc(tn)} · ${choose ? "monte sua dupla: quem entra troca de lugar com quem sai" : `sorteados da base de ${poolOf(l.realDrivers).length} pilotos`}</p></div>
          <button class="go" data-go>${esc(this.nextLabel)}</button>
        </header>
        <div class="dmain ${choose ? "choose" : ""}">
          <section class="dmine">
            <h3>SEUS PILOTOS${choose ? " · clique num pra trocar" : ""}</h3>
            <div class="dseats">${mine
              .map(
                (d, i) => `<div class="dseat ${choose && i === this.seat ? "sel" : ""}" data-seat="${i}">
                  <div class="flip ${this.shown.has(d.id) ? "on still" : ""}" data-id="${d.id}"><div class="flip-back">?</div><div class="flip-front">${driverCardHtml(d, tn, myTeam.color)}</div></div>
                  ${canSwap ? `<button class="btn small swapbtn" data-swap="${d.id}">🎲 TROCAR PELO RESERVA</button>` : ""}
                  ${choose ? `<div class="dseat-tag">${i === this.seat ? "▶ TROCANDO ESTE" : "clique pra trocar este"}</div>` : ""}
                </div>`,
              )
              .join("")}</div>
            ${canSwap ? `<p class="hint">Não gostou de algum? Dá pra <b>trocar 1 piloto pelo reserva</b>, uma vez só${l.champ ? " no campeonato todo" : ""}. O reserva é surpresa: pode ser melhor ou pior.</p>` : ""}
          </section>
          <section class="dright">${choose ? this.listHtml(mine) : this.othersHtml(myTeam.id)}</section>
        </div>
      </div></div>`;
    // a tela é redesenhada a cada troca: a bandeira do fundo volta junto
    mountFlagBackdrop(this.root.querySelector<HTMLElement>(".screen")!);
    // cartas novas viram uma de cada vez
    let k = 0;
    this.root.querySelectorAll<HTMLElement>(".flip:not(.on)").forEach((el) => {
      const id = el.dataset.id!;
      setTimeout(() => {
        el.classList.add("on");
        this.shown.add(id);
      }, 400 + k++ * 650);
    });
    this.root.querySelectorAll<HTMLElement>(".dteam").forEach((el, i) => setTimeout(() => el.classList.add("on"), 300 + i * 70));
    this.bind(mine);
    const list = this.root.querySelector<HTMLElement>(".dlist");
    if (list) list.scrollTop = listScroll;
  }

  private othersHtml(myTeamId: string) {
    const l = this.lobby;
    return `<h3>AS OUTRAS EQUIPES</h3><div class="draft-others">${TEAMS.filter((t) => t.id !== myTeamId)
      .map(
        (t) => `<div class="dteam" style="border-left:4px solid ${t.color}"><b>${esc(teamName(l, t.id))}</b>
        ${teamDrivers(l, t.id).map((d) => `<span>${natBadge(d)} ${esc(d.name)} <i>${d.rating}</i> <small>${esc(d.style)}</small></span>`).join("")}</div>`,
      )
      .join("")}</div>`;
  }

  /** todos os pilotos, com a equipe de cada um (quem é de outro jogador não dá pra pegar) */
  private listHtml(mine: DriverProfile[]) {
    const l = this.lobby;
    const humans = new Set(l.players.map((p) => p.teamId).filter(Boolean));
    const teamOf = new Map<string, string>();
    for (const [t, ids] of Object.entries(l.lineup)) for (const id of ids) teamOf.set(id, t);
    const q = this.query.trim().toLowerCase();
    const all = poolOf(l.realDrivers)
      .filter((d) => !q || d.name.toLowerCase().includes(q) || d.nat.toLowerCase().includes(q) || d.style.toLowerCase().includes(q))
      .sort((a, b) => (this.sort === "name" ? a.name.localeCompare(b.name, "pt-BR") : this.sort === "pace" ? b.pace - a.pace : this.sort === "wet" ? b.wet - a.wet : b.rating - a.rating));
    const sorts: [Sort, string][] = [["rating", "Nota"], ["pace", "Velocidade"], ["wet", "Chuva"], ["name", "Nome"]];
    return `<div class="dlisthead"><h3>TODOS OS PILOTOS</h3>
        <input class="txt dsearch" placeholder="Buscar piloto, país ou estilo" value="${esc(this.query)}">
        <div class="seg dsort">${sorts.map(([k, t]) => `<button data-sort="${k}" class="${k === this.sort ? "on" : ""}">${t}</button>`).join("")}</div></div>
      <div class="dlist">${all
        .map((d) => {
          const t = teamOf.get(d.id);
          const team = t ? TEAMS.find((x) => x.id === t) : null;
          const isMine = mine.some((m) => m.id === d.id);
          const taken = !!t && !isMine && humans.has(t);
          const where = isMine ? "na sua equipe" : team ? teamName(l, team.id) : "sem equipe";
          return `<button class="drow ${isMine ? "mine" : ""}" data-pick="${d.id}" ${isMine || taken ? "disabled" : ""} title="${taken ? "Piloto de outro jogador" : isMine ? "Já é seu" : `Trazer pra sua equipe no lugar do piloto selecionado`}">
            <span class="dn">${natBadge(d)} <b>${esc(d.name)}</b> <small>${esc(d.style)}</small></span>
            <span class="dstat" title="Velocidade · Chuva">${d.pace} · ${d.wet}</span>
            <i class="drate">${d.rating}</i>
            <span class="dteamtag" style="--tc:${team?.color ?? "#555"}">${esc(where)}${taken ? " 👤" : ""}</span>
          </button>`;
        })
        .join("")}</div>`;
  }

  private bind(mine: DriverProfile[]) {
    const r = this.root;
    r.querySelector("[data-go]")!.addEventListener("click", () => this.onDone());
    // sorteio: troca pelo reserva
    r.querySelectorAll<HTMLButtonElement>("[data-swap]").forEach((b) =>
      b.addEventListener("click", async () => {
        const d = mine.find((x) => x.id === b.dataset.swap)!;
        const ok = await confirmDialog({
          title: "TROCAR PELO RESERVA",
          icon: "🎲",
          text: `Trocar ${d.name} pelo piloto reserva?\n\nO reserva é surpresa: pode ser melhor ou pior. Só dá pra trocar UMA vez${this.lobby.champ ? " no campeonato todo" : ""}.`,
          ok: "TROCAR",
        });
        if (ok) this.conn.send({ t: "swapDriver", carId: d.id });
      }),
    );
    // escolha: qual vaga troca
    r.querySelectorAll<HTMLElement>("[data-seat]").forEach((el) =>
      el.addEventListener("click", () => {
        if (this.lobby.pickMode !== "choose") return;
        this.seat = Number(el.dataset.seat);
        this.render();
      }),
    );
    r.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) =>
      b.addEventListener("click", () => {
        const out = mine[this.seat];
        if (out) this.conn.send({ t: "pickDriver", carId: out.id, driverId: b.dataset.pick! });
      }),
    );
    const search = r.querySelector<HTMLInputElement>(".dsearch");
    search?.addEventListener("input", () => {
      this.query = search.value;
      const pos = search.selectionStart ?? search.value.length;
      this.render();
      const s2 = this.root.querySelector<HTMLInputElement>(".dsearch")!;
      s2.focus();
      s2.setSelectionRange(pos, pos);
    });
    r.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((b) =>
      b.addEventListener("click", () => {
        this.sort = b.dataset.sort as Sort;
        this.render();
      }),
    );
  }

  /** a sala mudou (troca feita, outro jogador escolheu): redesenha mantendo a busca */
  update(lobby: LobbyState) {
    const before = JSON.stringify(this.lobby.lineup);
    this.lobby = lobby;
    if (JSON.stringify(lobby.lineup) !== before) this.render();
  }

  destroy() {}
}
