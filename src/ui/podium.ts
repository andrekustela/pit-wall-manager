import type { Connection } from "../net/connection";
import type { LobbyState } from "../net/protocol";
import { engineerLabel } from "../sim/entrants";
import type { Race } from "../sim/race";
import type { CarState } from "../sim/types";
import type { DevArea } from "../sim/development";
import { driverCanvas, driverGround, loadDriver3d, uniformOf } from "../render/driver3d";
import { esc, updateWaitBar } from "./common";
import { resultsTable } from "./results";
import { bindTelemetry, telemetryHtml } from "./telemetry";

import { POINTS, standings } from "../sim/championship";


const W = 960, H = 520;

export class PodiumScreen {
  private raf = 0;
  private ready = false;
  private dead = false;
  private stop3d: (() => void) | null = null;

  constructor(root: HTMLElement, conn: Connection, race: Race, lobby: LobbyState, onReplay?: () => void) {
    const top = race.ordered().filter((c) => !c.retired).slice(0, 3);
    const winner = top[0];
    const eng = race.engineers[winner.team.id];
    const me = lobby.players.find((p) => p.id === lobby.you)!;
    const youWon = winner.team.id === me.teamId;
    root.innerHTML = `
      <div class="screen"><div class="wrap">
        <div class="podium-wrap">
          <h1 class="title">${youWon ? "VITÓRIA <span>DA SUA EQUIPE!</span>" : "PÓDIO"}</h1>
          <canvas class="podium3d"></canvas>
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

        <h2>RESULTADO COMPLETO · ${esc(race.track.name)} · ${race.laps} VOLTAS</h2>
        ${resultsTable(race, me.teamId ?? "")}
        ${telemetryHtml(race, me.teamId ?? "")}
        <div class="row-btns" style="align-items:center"><button class="go" id="pd-go" style="margin:0">${goLabel(lobby)}</button>${onReplay ? `<button class="btn" id="pd-replay">🎬 REPLAYS / MELHORES MOMENTOS</button>` : ""}</div>
      </div></div>`;
    bindTelemetry(root);
    root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-dev]");
      if (b && !b.disabled) conn.send({ t: "develop", carId: b.dataset.car!, area: b.dataset.dev as DevArea });
      const r = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-repair]");
      if (r && !r.disabled) conn.send({ t: "repairEngine", carId: r.dataset.repair! });
    });

    root.querySelector("#pd-replay")?.addEventListener("click", () => onReplay?.());
    const go = root.querySelector<HTMLButtonElement>("#pd-go")!;
    go.addEventListener("click", () => {
      this.ready = !this.ready;
      conn.send({ t: "ready", ready: this.ready });
      go.textContent = this.ready ? "PRONTO ✓" : goLabel(lobby);
    });
    const cv = root.querySelector("canvas")!;
    const title = `GRANDE PRÊMIO · ${race.track.name.toUpperCase()}`;
    // 3D (Three.js, carregado só aqui); sem WebGL, o pódio desenhado em 2D
    void import("../render/podium3d")
      .then((m) =>
        m.mountPodium3d(
          cv,
          [top[0], top[1], top[2]].map((c) => (c ? { name: c.driver.name, team: c.team.name, teamColor: c.team.color, ...uniformOf(c.team) } : null)),
          title,
        ),
      )
      .then((stop) => {
        if (this.dead) stop();
        else this.stop3d = stop;
      })
      .catch(() => {
        if (this.dead) return;
        // canvas novo (o antigo pode ter ficado preso no WebGL)
        const c2 = cv.cloneNode() as HTMLCanvasElement;
        cv.replaceWith(c2);
        this.animate(c2, top, title);
      });
  }

  private animate(cv: HTMLCanvasElement, top: CarState[], title: string) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    void loadDriver3d();
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const teamCols = top.flatMap((c) => (c ? [c.team.color, c.team.accent] : []));
    const confetti = Array.from({ length: 140 }, () => ({
      x: Math.random() * W,
      y: Math.random() * -H,
      v: 40 + Math.random() * 60,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 8,
      c: pick([...teamCols, "#ffd23b", "#ffffff", "#ffd23b"]),
    }));
    const flashes = Array.from({ length: 50 }, () => ({ x: Math.random() * W, y: 40 + Math.random() * 120, t: Math.random() * 4 }));
    const spray: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    // ordem visual: 2º, 1º, 3º (altura do degrau, cor do metal)
    const FLOOR = H - 92;
    const slots = [
      { car: top[1], x: W / 2 - 190, h: 78, n: "2", pose: "p2" as const, metal: ["#e9edf3", "#aab3c2"] },
      { car: top[0], x: W / 2, h: 118, n: "1", pose: "win" as const, metal: ["#ffe9a3", "#d4a937"] },
      { car: top[2], x: W / 2 + 190, h: 56, n: "3", pose: "p3" as const, metal: ["#f1c9a3", "#b57a46"] },
    ];
    const BW = 150, TOPD = 18; // largura do degrau e profundidade do tampo
    const DRIVER_H = 220; // px da imagem do piloto
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // ---- fundo: palco à noite, holofotes e flashes da torcida ----
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#070a12");
      bg.addColorStop(0.55, "#101626");
      bg.addColorStop(1, "#05070c");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      for (const f of flashes) {
        f.t -= dt;
        if (f.t < 0) {
          f.t = 1 + Math.random() * 4;
          f.x = Math.random() * W;
        }
        if (f.t < 0.08) {
          g.fillStyle = `rgba(255,255,255,${(1 - f.t / 0.08) * 0.9})`;
          g.beginPath();
          g.arc(f.x, f.y, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      // torcida: silhuetas no escuro
      g.fillStyle = "#0b0f19";
      for (let x = 0; x < W; x += 9) g.fillRect(x, 150 + Math.sin(x * 0.7 + Math.sin(t * 3 + x) * 0.6) * 4, 7, 40);
      // painel do fundo com o nome do GP
      g.fillStyle = "#141b2c";
      g.fillRect(60, 34, W - 120, 58);
      g.fillStyle = "#e8202a";
      g.fillRect(60, 88, W - 120, 4);
      g.fillStyle = "#f2f4f8";
      g.font = "700 26px Oswald, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(title, W / 2, 62);
      // holofotes balançando
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const sx = W * (0.2 + i * 0.3), a = Math.sin(t * 0.6 + i * 2) * 0.35;
        const tx = W / 2 + Math.sin(a) * 420;
        const gr = g.createLinearGradient(sx, 0, tx, FLOOR);
        gr.addColorStop(0, "rgba(255,240,200,.16)");
        gr.addColorStop(1, "rgba(255,240,200,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(sx - 6, 0);
        g.lineTo(sx + 6, 0);
        g.lineTo(tx + 110, FLOOR);
        g.lineTo(tx - 110, FLOOR);
        g.closePath();
        g.fill();
      }
      g.restore();
      // chão e a luz embaixo do 1º
      const fl = g.createLinearGradient(0, FLOOR, 0, H);
      fl.addColorStop(0, "#1d2434");
      fl.addColorStop(1, "#0b0e15");
      g.fillStyle = fl;
      g.fillRect(0, FLOOR, W, H - FLOOR);
      const glow = g.createRadialGradient(W / 2, FLOOR, 10, W / 2, FLOOR, 360);
      glow.addColorStop(0, "rgba(255,210,90,.22)");
      glow.addColorStop(1, "rgba(255,210,90,0)");
      g.fillStyle = glow;
      g.fillRect(0, FLOOR - 200, W, 300);

      for (const s of slots) {
        if (!s.car) continue;
        const x0 = s.x - BW / 2, top0 = FLOOR - s.h;
        // tampo (em perspectiva) e frente do degrau
        g.fillStyle = s.metal[0];
        g.beginPath();
        g.moveTo(x0 + 10, top0 - TOPD);
        g.lineTo(x0 + BW - 10, top0 - TOPD);
        g.lineTo(x0 + BW, top0);
        g.lineTo(x0, top0);
        g.closePath();
        g.fill();
        const fr = g.createLinearGradient(0, top0, 0, FLOOR);
        fr.addColorStop(0, s.metal[1]);
        fr.addColorStop(1, "#2a2f3a");
        g.fillStyle = fr;
        g.fillRect(x0, top0, BW, s.h);
        g.fillStyle = s.car.team.color;
        g.fillRect(x0, top0, BW, 5);
        g.fillStyle = "rgba(10,12,18,.82)";
        g.font = `700 ${Math.round(Math.min(64, s.h * 0.7))}px Oswald, sans-serif`;
        g.fillText(s.n, s.x, top0 + s.h / 2 + 4);
        // piloto 3D com o uniforme da equipe (o 1º pula de alegria)
        const d = driverCanvas(s.pose, uniformOf(s.car.team));
        const jump = s.n === "1" ? Math.abs(Math.sin(t * 3.2)) * 10 : s.n === "2" ? Math.abs(Math.sin(t * 2.4 + 1)) * 4 : 0;
        const footY = top0 - TOPD / 2;
        g.fillStyle = "rgba(0,0,0,.35)";
        g.beginPath();
        g.ellipse(s.x, footY, 34 - jump, 6, 0, 0, Math.PI * 2);
        g.fill();
        if (d) {
          const k = DRIVER_H / d.height;
          g.drawImage(d, s.x - (d.width * k) / 2, footY - jump - driverGround() * d.height * k, d.width * k, d.height * k);
          // champanhe saindo das mãos do vencedor
          if (s.n === "1" && Math.random() < dt * 70) {
            const hx = s.x + (Math.random() < 0.5 ? -1 : 1) * 14, hy = footY - jump - DRIVER_H * 0.93;
            spray.push({ x: hx, y: hy, vx: (Math.random() - 0.5) * 220, vy: -60 - Math.random() * 140, life: 1 });
          }
        }
        // placa com o nome
        g.fillStyle = "#f2f4f8";
        g.font = "600 17px Oswald, sans-serif";
        g.fillText(s.car.driver.name.toUpperCase(), s.x, FLOOR + 22);
        g.fillStyle = "#8e98aa";
        g.font = "500 13px Oswald, sans-serif";
        g.fillText(s.car.team.name, s.x, FLOOR + 42);
        g.fillStyle = s.car.team.color;
        g.fillRect(s.x - 30, FLOOR + 54, 60, 3);
      }
      // champanhe
      for (const p of spray) {
        p.life -= dt * 0.9;
        p.vy += 260 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        g.fillStyle = `rgba(255,236,160,${Math.max(0, p.life) * 0.8})`;
        g.beginPath();
        g.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        g.fill();
      }
      for (let i = spray.length - 1; i >= 0; i--) if (spray[i].life <= 0) spray.splice(i, 1);
      // confete girando
      for (const c of confetti) {
        c.y += c.v * dt;
        c.x += Math.sin(t * 2 + c.v) * 20 * dt;
        c.r += c.vr * dt;
        if (c.y > H) {
          c.y = -6;
          c.x = Math.random() * W;
        }
        g.save();
        g.translate(c.x, c.y);
        g.rotate(c.r);
        g.fillStyle = c.c;
        const sq = Math.abs(Math.cos(c.r * 1.7));
        g.fillRect(-3, -1.5 * sq, 6, 3 * sq + 0.5);
        g.restore();
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  update(lobby: LobbyState) {
    updateWaitBar(lobby);
  }

  destroy() {
    this.dead = true;
    this.stop3d?.();
    cancelAnimationFrame(this.raf);
    updateWaitBar(null);
  }
}

function goLabel(lobby: LobbyState): string {
  // campeonato: o pódio leva pra sede da equipe (troféus, fábrica, mecânicos...)
  if (lobby.champ) return "IR PRA SEDE DA EQUIPE ▶";
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
