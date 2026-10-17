import type { Connection } from "../net/connection";
import { LAP_OPTIONS, type LobbyState } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { carImage } from "../render/carArt";
import { CIRCUITS } from "../sim/track";
import { drawTrackThumb, esc } from "./common";

export class LobbyScreen {
  private el: HTMLElement;
  private thumbsDrawn = false;

  constructor(root: HTMLElement, private conn: Connection, lobby: LobbyState, onExit: () => void) {
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    root.innerHTML = `
      <div class="screen"><div class="wrap">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <h1 class="title">${lobby.solo ? "FIM DE <span>SEMANA</span>" : "SALA <span>ONLINE</span>"}</h1>
            <p class="sub">Treino livre (5 voltas de teste) → Classificação (volta única) → Estratégia → Corrida</p>
          </div>
          ${lobby.solo ? "" : `<div class="box" style="text-align:center"><div class="hint" style="margin:0">Código da sala</div><div class="code">${esc(lobby.code)}</div></div>`}
        </div>
        <div class="cols">
          <div class="box">
            <h3>VOCÊ</h3>
            <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="l-name" maxlength="18" value="${esc(me.name)}"></label>
            <label class="fld" style="margin:0"><span>Nome da equipe (vazio = nome original)</span><input class="txt" id="l-team" maxlength="24" value="${esc(me.teamName)}"></label>
          </div>
          <div class="box" id="l-players" ${lobby.solo ? 'style="display:none"' : ""}></div>
        </div>
        <h2>EQUIPE</h2>
        <p class="hint" style="margin-top:-4px">Escolha o carro. Os pilotos são sorteados depois, quando o fim de semana começar (de uma base de 100 pilotos, cada um com seu estilo).</p>
        <div class="teams" id="l-teams"></div>
        <h2>PISTA <span id="l-trackhint" style="color:var(--muted)"></span></h2>
        <div class="tracks" id="l-tracks"></div>
        <h2>REGRAS</h2>
        <div class="box" id="l-opts"></div>
        <div class="row-btns" style="margin-top:24px">
          <button class="go" id="l-start" style="margin:0">INICIAR FIM DE SEMANA ▶</button>
          <button class="btn" id="l-exit">${lobby.solo ? "VOLTAR" : "SAIR DA SALA"}</button>
        </div>
        <p class="hint" id="l-hint"></p>
      </div></div>`;
    this.el = root;
    const sendProfile = () =>
      conn.send({
        t: "profile",
        name: root.querySelector<HTMLInputElement>("#l-name")!.value,
        teamName: root.querySelector<HTMLInputElement>("#l-team")!.value,
      });
    root.querySelector("#l-name")!.addEventListener("change", sendProfile);
    root.querySelector("#l-team")!.addEventListener("change", sendProfile);
    root.querySelector("#l-start")!.addEventListener("click", () => {
      sendProfile();
      conn.send({ t: "startWeekend" });
    });
    root.querySelector("#l-exit")!.addEventListener("click", onExit);

    this.update(lobby);
  }

  update(lobby: LobbyState) {
    const root = this.el;
    const isHost = lobby.hostId === lobby.you;
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    const owner = (teamId: string) => lobby.players.find((p) => p.teamId === teamId);

    root.querySelector("#l-players")!.innerHTML = `<h3>JOGADORES (${lobby.players.length})</h3><div class="plist">${lobby.players
      .map((p) => {
        const t = TEAMS.find((x) => x.id === p.teamId);
        return `<div style="border-left-color:${t?.color ?? "#333"}"><b>${esc(p.name)}</b> ${esc(p.teamName || t?.name || "")}
          <span class="tag">${p.id === lobby.hostId ? "host" : ""}</span></div>`;
      })
      .join("")}</div>`;

    const teams = root.querySelector("#l-teams")!;
    teams.innerHTML = TEAMS.map((t) => {
      const o = owner(t.id);
      const mine = o?.id === lobby.you;
      const taken = o && !mine;
      const name = mine && me.teamName ? me.teamName : o?.teamName || t.name;
      return `<button class="teamcard ${mine ? "on" : ""}" data-team="${t.id}" ${taken ? "disabled" : ""}>
        <canvas data-sprite="${t.id}" width="200" height="80"></canvas>
        <div><div class="tn">${esc(name)}</div><div class="st">${
          taken ? `de ${esc(o!.name)}` : lobby.equalCars ? "Carro igual pra todos" : `Carro ${stars(t.carPace)}`
        }</div></div></button>`;
    }).join("");
    teams.querySelectorAll<HTMLCanvasElement>("canvas[data-sprite]").forEach((cv) => {
      // mesma imagem da corrida, sem esticar (mantém a proporção)
      const img = carImage(TEAMS.find((t) => t.id === cv.dataset.sprite)!).canvas;
      const k = Math.min(cv.width / img.width, cv.height / img.height);
      const w = img.width * k, h = img.height * k;
      cv.getContext("2d")!.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    });
    teams.querySelectorAll<HTMLButtonElement>("[data-team]").forEach((b) =>
      b.addEventListener("click", () => this.conn.send({ t: "team", teamId: b.dataset.team! })),
    );

    const tracks = root.querySelector("#l-tracks")!;
    if (!this.thumbsDrawn) {
      tracks.innerHTML = CIRCUITS.map(
        (c, i) => `<button class="trackcard" data-track="${i}"><canvas></canvas><div class="tn">${esc(c.name)}</div>
          <div class="st">${esc(c.blurb)}</div><div class="st">Chance de chuva: ${Math.round(c.rainChance * 100)}%</div></button>`,
      ).join("");
      tracks.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((b) =>
        b.addEventListener("click", () => this.conn.send({ t: "options", trackIndex: Number(b.dataset.track) })),
      );
      requestAnimationFrame(() =>
        tracks.querySelectorAll<HTMLCanvasElement>("canvas").forEach((cv, i) => drawTrackThumb(cv, i)),
      );
      this.thumbsDrawn = true;
    }
    tracks.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.track) === lobby.trackIndex);
      b.disabled = !isHost || lobby.champMode;
    });
    root.querySelector<HTMLElement>("#l-tracks")!.style.opacity = lobby.champMode ? "0.55" : "";

    root.querySelector("#l-opts")!.innerHTML = `
      <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center">
        <div><div class="hint" style="margin:0 0 6px">Voltas da corrida</div>
          <div class="seg" style="min-width:240px">${LAP_OPTIONS.map(
            (n) => `<button data-laps="${n}" class="${n === lobby.laps ? "on" : ""}" ${isHost ? "" : "disabled"}>${n} voltas</button>`,
          ).join("")}</div></div>
        <label class="toggle"><input type="checkbox" id="l-real" ${lobby.realDrivers ? "checked" : ""} ${isHost ? "" : "disabled"}>
          <span><b>Lendas da F1</b><br><span class="hint" style="margin:0">Sorteia entre 100 pilotos reais de todas as eras (Senna, Schumacher, Hamilton, Verstappen…). Desligado = pilotos fictícios.</span></span></label>
        <label class="toggle"><input type="checkbox" id="l-champ" ${lobby.champMode ? "checked" : ""} ${isHost ? "" : "disabled"}>
          <span><b>Campeonato</b><br><span class="hint" style="margin:0">3 etapas, uma em cada pista (${CIRCUITS.map((c) => esc(c.name)).join(" → ")}). Pontos 25-18-15-12-10-8-6-4-2-1.</span></span></label>
        <label class="toggle"><input type="checkbox" id="l-equal" ${lobby.equalCars ? "checked" : ""} ${isHost ? "" : "disabled"}>
          <span><b>Carros iguais</b><br><span class="hint" style="margin:0">Todo mundo com o mesmo carro e piloto. Ganha quem acertar melhor o carro e a estratégia.</span></span></label>
      </div>
      <p class="hint">Regras: reabastecimento liberado · 2 compostos de pneu obrigatórios (menos se usar pneu de chuva) · pode chover, ter batida e safety car.</p>`;
    root.querySelectorAll<HTMLButtonElement>("[data-laps]").forEach((b) =>
      b.addEventListener("click", () => this.conn.send({ t: "options", laps: Number(b.dataset.laps) })),
    );
    root.querySelector<HTMLInputElement>("#l-real")!.addEventListener("change", (e) =>
      this.conn.send({ t: "options", realDrivers: (e.target as HTMLInputElement).checked }),
    );
    root.querySelector<HTMLInputElement>("#l-champ")!.addEventListener("change", (e) =>
      this.conn.send({ t: "options", champ: (e.target as HTMLInputElement).checked }),
    );
    root.querySelector<HTMLInputElement>("#l-equal")!.addEventListener("change", (e) =>
      this.conn.send({ t: "options", equalCars: (e.target as HTMLInputElement).checked }),
    );

    root.querySelector("#l-trackhint")!.textContent = lobby.champMode ? "· no campeonato corre nas 3, nessa ordem" : "";
    root.querySelector("#l-start")!.textContent = lobby.champMode ? "INICIAR CAMPEONATO ▶" : "INICIAR FIM DE SEMANA ▶";

    const start = root.querySelector<HTMLButtonElement>("#l-start")!;
    start.style.display = isHost ? "" : "none";
    root.querySelector("#l-hint")!.textContent = isHost
      ? lobby.solo
        ? ""
        : "Você é o host: escolhe pista, voltas e regras, e começa quando todos estiverem prontos."
      : "Esperando o host iniciar o fim de semana...";
  }

  destroy() {}
}

function stars(carPace: number): string {
  const n = Math.max(1, Math.round(5 - carPace * 2.7));
  return "★".repeat(n) + "☆".repeat(5 - n);
}
