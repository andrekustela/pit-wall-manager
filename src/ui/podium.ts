import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { engineerLabel } from "../sim/entrants";
import type { Race } from "../sim/race";
import type { CarState } from "../sim/types";
import type { DevArea } from "../sim/development";
import { esc, updateWaitBar } from "./common";
import { resultsTable } from "./results";
import { bindTelemetry, telemetryHtml } from "./telemetry";
import { devInner, devPanelHtml } from "./devPanel";
import { POINTS, standings } from "../sim/championship";
import { CIRCUITS } from "../sim/track";

const W = 320, H = 180;

export class PodiumScreen {
  private raf = 0;
  private ready = false;

  constructor(root: HTMLElement, conn: Connection, race: Race, lobby: LobbyState) {
    const top = race.ordered().filter((c) => !c.retired).slice(0, 3);
    const winner = top[0];
    const eng = race.engineers[winner.team.id];
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    const youWon = winner.team.id === me.teamId;
    root.innerHTML = `
      <div class="screen"><div class="wrap">
        <div class="podium-wrap">
          <h1 class="title">${youWon ? "VITÓRIA <span>DA SUA EQUIPE!</span>" : "PÓDIO"}</h1>
          <canvas width="${W}" height="${H}"></canvas>
          <div style="width:min(100%,900px);text-align:center;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${[top[1], top[0], top[2]]
              .map((c, i) =>
                c
                  ? `<div class="box" style="border-top:3px solid ${c.team.color}"><div class="lbl" style="font-family:var(--pix);color:var(--muted)">${["2º", "1º", "3º"][i]}</div>
                     <b>${esc(c.driver.name)}</b><div class="hint" style="margin:2px 0 0">${esc(c.team.name)} · ${esc(race.engineers[c.team.id]?.name ?? "")}</div></div>`
                  : "<div></div>",
              )
              .join("")}
          </div>
          <div class="engcard">
            <div class="lbl">ENGENHEIRO VENCEDOR</div>
            <div class="nm">${esc(eng?.name ?? "—")}</div>
            <div class="tm">${esc(winner.team.name)} · ${eng?.quality === null ? "humano" : `IA (${engineerLabel(eng?.quality ?? null).toLowerCase()})`} · piloto ${esc(winner.driver.name)}</div>
          </div>
        </div>
        ${champSection(race, lobby)}
        ${devPanelHtml(lobby)}
        <h2>RESULTADO COMPLETO · ${esc(race.track.name)} · ${race.laps} VOLTAS</h2>
        ${resultsTable(race, me.teamId ?? "")}
        ${telemetryHtml(race, me.teamId ?? "")}
        <button class="go" id="pd-go">${goLabel(lobby)}</button>
      </div></div>`;
    bindTelemetry(root);
    root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-dev]");
      if (b && !b.disabled) conn.send({ t: "develop", area: b.dataset.dev as DevArea });
    });
    this.root = root;
    const go = root.querySelector<HTMLButtonElement>("#pd-go")!;
    go.addEventListener("click", () => {
      this.ready = !this.ready;
      conn.send({ t: "ready", ready: this.ready });
      go.textContent = this.ready ? "PRONTO ✓" : goLabel(lobby);
    });
    this.animate(root.querySelector("canvas")!, top);
  }

  private animate(cv: HTMLCanvasElement, top: CarState[]) {
    const g = cv.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const confetti = Array.from({ length: 90 }, () => ({
      x: Math.random() * W,
      y: Math.random() * -H,
      v: 20 + Math.random() * 30,
      c: ["#e8202a", "#ffcc00", "#16c2b0", "#ffffff", "#7b3fe4", "#1f9d3a"][Math.floor(Math.random() * 6)],
    }));
    const crowd = Array.from({ length: 260 }, () => ({
      x: Math.floor(Math.random() * W),
      y: 18 + Math.floor(Math.random() * 40),
      c: ["#e8202a", "#f2f2f2", "#1c6ed4", "#f2c230", "#ff8a1c", "#16c2b0", "#d8b48a", "#222"][Math.floor(Math.random() * 8)],
      p: Math.random() * 6,
    }));
    // ordem visual: 2º, 1º, 3º
    const slots = [
      { car: top[1], x: 98, h: 34, n: "2" },
      { car: top[0], x: 160, h: 50, n: "1" },
      { car: top[2], x: 222, h: 24, n: "3" },
    ];
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      // fundo
      g.fillStyle = "#121726";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#1b2233";
      g.fillRect(0, 14, W, 48);
      for (const p of crowd) {
        g.fillStyle = p.c;
        g.fillRect(p.x, p.y - (Math.sin(t * 6 + p.p) > 0.6 ? 1 : 0), 1, 2);
      }
      g.fillStyle = "#2b3242";
      g.fillRect(0, 62, W, 4);
      g.fillStyle = "#e8202a";
      g.font = "8px Silkscreen, monospace";
      g.textAlign = "center";
      g.fillText("PIT WALL MANAGER · GRANDE PRÊMIO", W / 2, 10);
      // chão
      g.fillStyle = "#30384a";
      g.fillRect(0, H - 34, W, 34);

      for (const s of slots) {
        if (!s.car) continue;
        const baseY = H - 34;
        // bloco
        g.fillStyle = "#d9dde3";
        g.fillRect(s.x - 26, baseY - s.h, 52, s.h);
        g.fillStyle = "#aeb4bf";
        g.fillRect(s.x - 26, baseY - s.h, 52, 3);
        g.fillStyle = "#1b2233";
        g.font = "16px Silkscreen, monospace";
        g.fillText(s.n, s.x, baseY - s.h + 22);
        // boneco
        const jump = s.n === "1" ? Math.abs(Math.sin(t * 4)) * 4 : s.n === "2" ? Math.abs(Math.sin(t * 3 + 1)) * 2 : 0;
        this.person(g, s.x, baseY - s.h - Math.round(jump), s.car, s.n === "1", t);
        // nome
        g.fillStyle = "#fff";
        g.font = "8px Silkscreen, monospace";
        g.fillText(s.car.driver.short, s.x, baseY + 12);
        g.fillStyle = s.car.team.color;
        g.fillRect(s.x - 12, baseY + 15, 24, 2);
      }

      // champanhe do vencedor
      for (let i = 0; i < 14; i++) {
        const k = (t * 1.3 + i / 14) % 1;
        const dir = i % 2 ? 1 : -1;
        const x = 160 + dir * (6 + k * 34);
        const y = H - 34 - 50 - 26 - k * 18 + k * k * 40;
        g.fillStyle = `rgba(255,240,170,${(1 - k).toFixed(2)})`;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }

      for (const c of confetti) {
        c.y += c.v * dt;
        c.x += Math.sin(t * 2 + c.v) * 10 * dt;
        if (c.y > H) {
          c.y = -4;
          c.x = Math.random() * W;
        }
        g.fillStyle = c.c;
        g.fillRect(Math.round(c.x), Math.round(c.y), 2, 1);
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** piloto em pixel art (macacão na cor da equipe, capacete, braços pra cima) */
  private person(g: CanvasRenderingContext2D, cx: number, feetY: number, car: CarState, winner: boolean, t: number) {
    const x = cx - 4;
    const y = feetY - 22;
    const px = (dx: number, dy: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x + dx, y + dy, w, h);
    };
    const suit = car.team.color, acc = car.team.accent;
    // capacete
    px(1, 0, 6, 5, suit);
    px(2, 2, 5, 2, "#1b2233"); // viseira
    px(1, 0, 6, 1, acc);
    // corpo
    px(1, 6, 6, 8, suit);
    px(1, 9, 6, 1, acc);
    // braços (pra cima, balançando)
    const wave = Math.round(Math.sin(t * 5) * 1);
    px(-1, 1 + wave, 2, 6, suit);
    px(7, 1 - wave, 2, 6, suit);
    px(-1, 0 + wave, 2, 1, "#e9c39b");
    px(7, 0 - wave, 2, 1, "#e9c39b");
    // pernas
    px(1, 14, 2, 8, suit);
    px(5, 14, 2, 8, suit);
    px(1, 21, 3, 1, "#111");
    px(5, 21, 3, 1, "#111");
    if (winner) {
      // troféu
      px(8, -7 - wave, 4, 3, "#ffcc00");
      px(9, -4 - wave, 2, 3, "#ffcc00");
      px(8, -2 - wave, 4, 1, "#b88a00");
    }
  }

  private root: HTMLElement | null = null;

  update(lobby: LobbyState) {
    updateWaitBar(lobby);
    const box = this.root?.querySelector("#devbox");
    if (box && lobby.champ) {
      const open = box.querySelector("details")?.open;
      box.innerHTML = devInner(lobby);
      if (open) box.querySelector("details")!.open = true;
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    updateWaitBar(null);
  }
}

function goLabel(lobby: LobbyState): string {
  const ch = lobby.champ;
  if (ch && !ch.finished) return `PRÓXIMA ETAPA: ${CIRCUITS[ch.rounds[ch.round + 1]].name.toUpperCase()} ▶`;
  return lobby.solo ? "NOVO FIM DE SEMANA ▶" : "VOLTAR PRO LOBBY ▶";
}

/** classificação do campeonato (pilotos e equipes) e, no fim, o campeão */
function champSection(race: Race, lobby: LobbyState): string {
  const ch = lobby.champ;
  if (!ch) return "";
  const me = lobby.players.find((p) => p.id === lobby.you)!;
  const last = ch.results[ch.results.length - 1];
  const gained = (id: string) => {
    const i = last?.order.indexOf(id) ?? -1;
    return i >= 0 && !last.retired.includes(id) ? (POINTS[i] ?? 0) : 0;
  };
  const carOf = (id: string) => race.cars.find((c) => c.id === id)!;
  const teamOf = (id: string) => race.teams.find((t) => t.id === id)!;
  const drivers = standings(ch.driverPts, race.cars.map((c) => c.id), ch.results, (d) => carOf(d).team.id);
  const teams = standings(ch.teamPts, race.teams.map((t) => t.id), ch.results, (d) => carOf(d).team.id, true);
  const teamGain = (tid: string) => race.cars.filter((c) => c.team.id === tid).reduce((a, c) => a + gained(c.id), 0);

  let banner = "";
  if (ch.finished) {
    const champ = carOf(drivers[0].id);
    const tChamp = teamOf(teams[0].id);
    const eng = race.engineers[tChamp.id];
    banner = `<div class="engcard" style="margin:24px auto 0;max-width:640px;border-color:#ffcc00">
      <div class="lbl">🏆 CAMPEÃO DO CAMPEONATO 🏆</div>
      <div class="nm">${esc(champ.driver.name)}</div>
      <div class="tm">${esc(champ.team.name)} · ${drivers[0].pts} pontos · ${drivers[0].wins} vitória(s)</div>
      <div class="lbl" style="margin-top:12px">EQUIPE CAMPEÃ</div>
      <div class="nm" style="font-size:20px">${esc(tChamp.name)}</div>
      <div class="tm">Engenheiro: ${esc(eng?.name ?? "—")} (${eng?.quality === null ? "humano" : "IA"}) · ${teams[0].pts} pontos</div>
    </div>`;
  }
  const row = (pos: number, color: string, name: string, sub: string, pts: number, gain: number, mine: boolean) =>
    `<tr class="${mine ? "player" : ""}"><td>${pos}</td><td><span style="display:inline-block;width:4px;height:14px;background:${color};vertical-align:middle;margin-right:8px"></span>${esc(name)}
      <span style="color:var(--muted);font-size:12px">${esc(sub)}</span></td><td class="num"><b>${pts}</b></td><td class="num" style="color:var(--ok)">${gain ? "+" + gain : ""}</td></tr>`;
  return `${banner}
    <h2>CAMPEONATO · ${ch.finished ? "CLASSIFICAÇÃO FINAL" : `DEPOIS DA ETAPA ${ch.results.length} DE ${ch.rounds.length}`}</h2>
    <div class="cols">
      <div class="box" style="padding:0"><table class="results"><tr><th>#</th><th>PILOTOS</th><th>PTS</th><th></th></tr>
        ${drivers.map((d, i) => { const c = carOf(d.id); return row(i + 1, c.team.color, c.driver.name, c.team.name, d.pts, gained(d.id), c.team.id === me.teamId); }).join("")}
      </table></div>
      <div class="box" style="padding:0"><table class="results"><tr><th>#</th><th>EQUIPES</th><th>PTS</th><th></th></tr>
        ${teams.map((t, i) => { const tm = teamOf(t.id); return row(i + 1, tm.color, tm.name, race.engineers[tm.id]?.name ?? "", t.pts, teamGain(t.id), tm.id === me.teamId); }).join("")}
      </table></div>
    </div>`;
}
