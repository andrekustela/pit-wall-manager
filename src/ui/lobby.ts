import type { Connection } from "../net/connection";
import { LAP_OPTIONS, type LobbyState } from "../net/protocol";
import { isPct, lapChoiceLabel, officialLaps, resolveLaps } from "../sim/officialLaps";
import { TEAMS } from "../sim/data";
import { carImage } from "../render/carArt";
import { previewCanvas } from "../render/car3d";
import { ACTIVE_TRACKS, CIRCUITS, randomTrack } from "../sim/track";
import { champRounds } from "../sim/championship";
import { drawTrackThumb, esc, storeSet, teamName } from "./common";
import { editMyLivery } from "./liveryEditor";
import { emblemSvg } from "../render/emblem";

export class LobbyScreen {
  private el: HTMLElement;
  private thumbsDrawn = false;
  private lobby: LobbyState;

  constructor(root: HTMLElement, private conn: Connection, lobby: LobbyState, onExit: () => void) {
    this.lobby = lobby;
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    root.innerHTML = `
      <div class="screen"><div class="wrap">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <h1 class="title">${lobby.solo ? "FIM DE <span>SEMANA</span>" : "SALA <span>ONLINE</span>"}</h1>
            <p class="sub">Treino livre (5 voltas de teste) → Classificação (Q1, Q2, Q3) → Estratégia → Corrida</p>
          </div>
          ${lobby.solo ? "" : `<div class="box" style="text-align:center"><div class="hint" style="margin:0">Código da sala</div><div class="code">${esc(lobby.code)}</div>
            <div class="row-btns" style="justify-content:center;margin-top:8px"><button class="btn small" data-copy="code">📋 COPIAR CÓDIGO</button><button class="btn small" data-copy="link">🔗 COPIAR CONVITE</button></div></div>`}
        </div>
        <div class="cols">
          <div class="box">
            <h3>VOCÊ</h3>
            <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="l-name" maxlength="18" value="${esc(me.name)}"></label>
            <label class="fld" style="margin:0"><span>Nome da equipe (vazio = nome original)</span><input class="txt" id="l-team" maxlength="24" value="${esc(me.teamName)}"></label>
            <button class="btn small" id="l-livery" style="margin-top:10px">🎨 PINTURA E EMBLEMA</button>
          </div>
          <div class="box" id="l-players" ${lobby.solo ? 'style="display:none"' : ""}></div>
        </div>
        <div class="box resumedbox" id="l-resumed" hidden></div>
        <h2>EQUIPE</h2>
        <p class="hint" style="margin-top:-4px">Escolha o carro. Os pilotos são sorteados depois, quando o fim de semana começar (de uma base de 100 pilotos, cada um com seu estilo).</p>
        <div class="teams" id="l-teams"></div>
        <h2>PISTA <span id="l-trackhint" style="color:var(--muted)"></span></h2>
        <div class="trackbar"><input class="txt" id="l-tsearch" placeholder="Buscar pista (${ACTIVE_TRACKS.length} no total)..."><button class="btn" id="l-trand">🎲 SORTEAR</button></div>
        <div class="trackinfo box" id="l-tinfo"></div>
        <div class="tracks many" id="l-tracks"></div>
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
    root.querySelector("#l-livery")!.addEventListener("click", () => {
      const cur = this.lobby.players.find((p) => p.id === this.lobby.you)!;
      editMyLivery(cur.teamId ?? "", root.querySelector<HTMLInputElement>("#l-team")!.value, conn);
    });
    // copiar o código ou o link de convite (o link abre o jogo com o código preenchido)
    root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) =>
      b.addEventListener("click", async () => {
        const text = b.dataset.copy === "link" ? `${location.origin}/?sala=${lobby.code}` : lobby.code;
        const label = b.textContent;
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = "✓ COPIADO!";
        } catch {
          // sem permissão de área de transferência: mostra pra copiar na mão
          window.prompt("Copie:", text);
        }
        setTimeout(() => (b.textContent = label), 1500);
      }),
    );

    this.update(lobby);
  }

  update(lobby: LobbyState) {
    this.lobby = lobby;
    const root = this.el;
    const myTeam = lobby.players.find((p) => p.id === lobby.you)?.teamId;
    if (myTeam) storeSet("pwm.lastTeam", myTeam);
    const isHost = lobby.hostId === lobby.you;
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    const owner = (teamId: string) => lobby.players.find((p) => p.teamId === teamId);

    root.querySelector("#l-players")!.innerHTML = `<h3>JOGADORES (${lobby.players.length})</h3><div class="plist">${lobby.players
      .map((p) => {
        const t = TEAMS.find((x) => x.id === p.teamId);
        return `<div style="border-left-color:${p.livery?.base ?? t?.color ?? "#333"}">${p.livery ? emblemSvg(p.livery.emblem, 22) + " " : ""}<b>${esc(p.name)}</b> ${esc(p.teamName || t?.name || "")}
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
      const t = TEAMS.find((x) => x.id === cv.dataset.sprite)!;
      const lv = owner(t.id)?.livery;
      const tm = lv ? { ...t, color: lv.base, accent: lv.accent, livery: lv } : t;
      const img = previewCanvas(tm, () => carImage(tm).canvas);
      const k = Math.min(cv.width / img.width, cv.height / img.height);
      const w = img.width * k, h = img.height * k;
      cv.getContext("2d")!.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    });
    teams.querySelectorAll<HTMLButtonElement>("[data-team]").forEach((b) =>
      b.addEventListener("click", () => this.conn.send({ t: "team", teamId: b.dataset.team! })),
    );

    const tracks = root.querySelector("#l-tracks")!;
    if (!this.thumbsDrawn) {
      tracks.innerHTML = ACTIVE_TRACKS.map(
        (i) => [CIRCUITS[i], i] as const,
      ).map(
        ([c, i]) => `<button class="trackcard" data-track="${i}" data-name="${esc(c.name.toLowerCase())}"><canvas></canvas><div class="tn">${esc(c.name)}</div>
          <div class="st">${c.street ? "Rua · " : ""}chuva ${Math.round(c.rainChance * 100)}%</div></button>`,
      ).join("");
      root.querySelector<HTMLInputElement>("#l-tsearch")!.addEventListener("input", (e) => {
        const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
        tracks.querySelectorAll<HTMLElement>("[data-track]").forEach((b) => (b.hidden = !!q && !b.dataset.name!.includes(q)));
      });
      root.querySelector("#l-trand")!.addEventListener("click", () =>
        this.conn.send({ t: "options", trackIndex: randomTrack() }),
      );
      // miniaturas desenhadas aos poucos (uma por quadro), pra tela abrir na hora
      const cvs = [...tracks.querySelectorAll<HTMLCanvasElement>("canvas")];
      let k = 0;
      const drawSome = () => {
        const t0 = performance.now();
        while (k < cvs.length && performance.now() - t0 < 8) drawTrackThumb(cvs[k], Number(cvs[k++].closest<HTMLElement>("[data-track]")!.dataset.track));
        if (k < cvs.length) requestAnimationFrame(drawSome);
      };
      tracks.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((b) =>
        b.addEventListener("click", () => this.conn.send({ t: "options", trackIndex: Number(b.dataset.track) })),
      );
      requestAnimationFrame(drawSome);
      this.thumbsDrawn = true;
    }
    tracks.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.track) === lobby.trackIndex);
      b.disabled = !isHost || lobby.champMode;
    });
    root.querySelector<HTMLElement>("#l-tracks")!.style.opacity = lobby.champMode ? "0.55" : "";
    (root.querySelector("#l-trand") as HTMLButtonElement).disabled = !isHost || lobby.champMode;
    const sel = CIRCUITS[lobby.trackIndex];
    root.querySelector("#l-tinfo")!.innerHTML = lobby.champMode
      ? `<b>Campeonato</b> · as pistas são sorteadas quando começar`
      : `<b>${esc(sel.name)}</b>${sel.street ? " · circuito de rua" : ""} · chance de chuva ${Math.round(sel.rainChance * 100)}%<div class="hint" style="margin:4px 0 0">${esc(sel.blurb)}</div>`;

    root.querySelector("#l-opts")!.innerHTML = `
      <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center">
        <div><div class="hint" style="margin:0 0 6px">Voltas da corrida</div>
          <div class="seg" style="min-width:240px">${LAP_OPTIONS.map(
            (n) => `<button data-laps="${n}" class="${n === lobby.laps ? "on" : ""}" ${isHost ? "" : "disabled"} title="${isPct(n) ? `${-n}% das voltas oficiais da pista (arredonda pra cima)` : ""}">${lapChoiceLabel(n).toLowerCase()}</button>`,
          ).join("")}</div>
          ${isPct(lobby.laps) && lobby.trackIndex >= 0 ? `<div class="hint" style="margin:4px 0 0">${officialLaps(lobby.trackIndex)} voltas oficiais → ${resolveLaps(lobby.laps, lobby.trackIndex)} voltas</div>` : isPct(lobby.laps) ? `<div class="hint" style="margin:4px 0 0">${-lobby.laps}% das voltas oficiais de cada pista</div>` : ""}</div>
        <div><div class="hint" style="margin:0 0 6px">Pilotos de cada jogador</div>
          <div class="seg" style="min-width:220px">
            <button data-pick="draw" class="${lobby.pickMode !== "choose" ? "on" : ""}" ${isHost ? "" : "disabled"} title="Sorteados (dá pra trocar 1 pelo reserva)">🎲 sorteados</button>
            <button data-pick="choose" class="${lobby.pickMode === "choose" ? "on" : ""}" ${isHost ? "" : "disabled"} title="Cada jogador escolhe a sua dupla">✋ escolher</button>
          </div></div>
        <label class="toggle"><input type="checkbox" id="l-real" ${lobby.realDrivers ? "checked" : ""} ${isHost ? "" : "disabled"}>
          <span><b>Lendas da F1</b><br><span class="hint" style="margin:0">Sorteia entre 100 pilotos reais de todas as eras (Senna, Schumacher, Hamilton, Verstappen…). Desligado = pilotos fictícios.</span></span></label>
        <label class="toggle"><input type="checkbox" id="l-champ" ${lobby.champMode ? "checked" : ""} ${isHost ? "" : "disabled"}>
          <span><b>Campeonato</b><br><span class="hint" style="margin:0">Pistas sorteadas entre as ${ACTIVE_TRACKS.length}, em ordem aleatória. Pontos 25-18-15-12-10-8-6-4-2-1.</span></span></label>
        ${lobby.champMode ? `<div style="min-width:240px"><div class="hint" style="margin:0 0 6px">Nome do campeonato</div>
          <input class="txt" id="l-cname" maxlength="40" placeholder="Ex.: Copa dos Amigos 2026" value="${esc(lobby.champName)}" ${isHost ? "" : "disabled"}></div>` : ""}
        ${lobby.champMode ? `<div><div class="hint" style="margin:0 0 6px">Quantas pistas no campeonato</div>
          <div class="seg pctseg">${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => `<button data-pct="${p}" class="${p === lobby.champPct ? "on" : ""}" ${isHost ? "" : "disabled"} title="${champRounds(p)} etapas">${p}%</button>`).join("")}</div>
          <div class="hint" style="margin:4px 0 0">${champRounds(lobby.champPct)} etapas</div></div>` : ""}
        <label class="toggle"><input type="checkbox" id="l-equal" ${lobby.equalCars ? "checked" : ""} ${isHost ? "" : "disabled"}>
          <span><b>Carros iguais</b><br><span class="hint" style="margin:0">Todo mundo com o mesmo carro e piloto. Ganha quem acertar melhor o carro e a estratégia.</span></span></label>
      </div>
      <p class="hint">Regras: reabastecimento liberado · 2 compostos de pneu obrigatórios (menos se usar pneu de chuva) · pode chover, ter batida e safety car.</p>`;
    root.querySelectorAll<HTMLButtonElement>("[data-laps]").forEach((b) =>
      b.addEventListener("click", () => this.conn.send({ t: "options", laps: Number(b.dataset.laps) })),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) =>
      b.addEventListener("click", () => this.conn.send({ t: "options", pickMode: b.dataset.pick as "draw" | "choose" })),
    );
    root.querySelector<HTMLInputElement>("#l-real")!.addEventListener("change", (e) =>
      this.conn.send({ t: "options", realDrivers: (e.target as HTMLInputElement).checked }),
    );
    root.querySelector<HTMLInputElement>("#l-champ")!.addEventListener("change", (e) =>
      this.conn.send({ t: "options", champ: (e.target as HTMLInputElement).checked }),
    );
    root.querySelectorAll<HTMLButtonElement>("[data-pct]").forEach((b) =>
      b.addEventListener("click", () => this.conn.send({ t: "options", champPct: Number(b.dataset.pct) })),
    );
    root.querySelector<HTMLInputElement>("#l-cname")?.addEventListener("change", (e) =>
      this.conn.send({ t: "options", champName: (e.target as HTMLInputElement).value }),
    );
    root.querySelector<HTMLInputElement>("#l-equal")!.addEventListener("change", (e) =>
      this.conn.send({ t: "options", equalCars: (e.target as HTMLInputElement).checked }),
    );

    root.querySelector("#l-trackhint")!.textContent = lobby.champMode ? `· campeonato: ${champRounds(lobby.champPct)} pistas sorteadas` : "";
    root.querySelector("#l-start")!.textContent = lobby.resumed ? "CONTINUAR O CAMPEONATO ▶" : lobby.champMode ? "INICIAR CAMPEONATO ▶" : "INICIAR FIM DE SEMANA ▶";
    // campeonato online retomado: quem ainda falta voltar
    const rb = root.querySelector<HTMLElement>("#l-resumed")!;
    const rs = lobby.resumed;
    rb.hidden = !rs;
    if (rs)
      rb.innerHTML = `<b>🔁 RETOMANDO: ${esc(rs.name)}</b> · ${rs.done} de ${rs.total} etapas feitas. Pontos, evolução do carro, motores e mecânicos continuam de onde pararam.
        <div class="hint" style="margin:6px 0 0">${rs.waiting.length ? `Esperando voltar: ${rs.waiting.map((w) => `<b>${esc(w.name)}</b> (${esc(teamName(lobby, w.teamId))})`).join(", ")}. Entrando com o mesmo nome, cada um cai na equipe dele.` : "Todo mundo voltou! O host pode continuar."}</div>`;

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
