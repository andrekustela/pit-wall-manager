// Tela de carregamento: logo enchendo no canto (com "CARREGANDO 73%"), ficha da
// pista com o traçado se desenhando e dicas do engenheiro trocando. Aparece sempre
// por um tempo mínimo (mesmo que já esteja tudo pronto), pra dar ritmo de jogo.
import { CIRCUITS, getTrack } from "../sim/track";
import { fmtLap } from "../sim/race";
import { esc, trackTagsHtml } from "./common";
import { loadRecords } from "./records";
import { TRACK_HISTORY } from "../sim/trackHistory";
import { originalTrackName } from "./editorData";

export const ENGINEER_TIPS = [
  "Pneu novo sai frio do box: segure o ritmo na primeira volta do stint.",
  "Combustível é escolhido em voltas. Tanque cheio deixa o carro mais pesado e mais lento.",
  "Atrás de outro carro o ar fica sujo: o pneu esquenta e gasta mais rápido.",
  "Começou a chover? Pneu intermediário (I) na garoa, de chuva (W) no aguaceiro.",
  "Safety car na pista é a hora mais barata pra parar no box.",
  "Motor no modo Rico é mais rápido, mas gasta motor e combustível.",
  "Ritmo Atacar ganha décimos, mas gasta pneu e aumenta a chance de erro.",
  "Pista ondulada: carro muito baixo bate no chão e perde tempo.",
  "Circuito de rua tem muro colado: errar ali costuma acabar a corrida.",
  "Na corrida é obrigatório usar 2 tipos de pneu de pista seca (a chuva libera).",
  "No treino, compare as voltas: o melhor acerto muda a cada pista e a cada piloto.",
  "Sem motor reserva, trocar o motor custa 10 posições no grid.",
  "Mecânicos treinados param mais rápido e erram menos no box.",
  "Cada carro tem seus pontos de desenvolvimento: decida onde investir em cada um.",
  "Ordens de equipe: 'Deixar passar' ajuda o companheiro mais rápido.",
  "Na Q1 caem os 5 mais lentos; só os 10 melhores brigam pela pole na Q3.",
  "Asa dianteira e traseira mexem no equilíbrio do carro: muita asa ajuda na curva e perde na reta.",
  "Corrida noturna: a pista esfria e o pneu demora mais pra aquecer.",
  "Pneu macio é rápido mas dura pouco; o duro aguenta o stint longo.",
  "O plano de paradas é só um lembrete: na hora, quem decide é você.",
];

export interface LoadingOpts {
  /** pista da ficha (sem = só logo e dicas, ex.: abrindo o jogo) */
  trackIndex?: number;
  laps?: number;
  /** título acima do nome da pista (ex.: "LARGADA", "FIM DE SEMANA") */
  label?: string;
  /** tempo mínimo na tela (ms) */
  minMs?: number;
  /** o que de fato precisa estar pronto pra sair (ex.: a pista desenhada) */
  ready?: () => boolean;
  /** depois dos 100%, espera o jogador apertar "Vamos começar!" */
  play?: boolean;
  /** onde colocar (padrão: body) */
  host?: HTMLElement;
}

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** mostra a tela de carregamento; a promessa resolve quando ela some */
export function showLoading(o: LoadingOpts = {}): Promise<void> {
  const minMs = o.minMs ?? 2600;
  const t = o.trackIndex !== undefined ? CIRCUITS[o.trackIndex] : undefined;
  const el = document.createElement("div");
  el.className = "loadscreen";
  const tip0 = Math.floor(Math.random() * ENGINEER_TIPS.length);
  el.innerHTML = `
    ${t ? `<div class="ldtrack">
      <div class="ldlabel">${esc(o.label ?? "PRÓXIMA PISTA")}</div>
      <h1 class="ldname">${esc(t.name.toUpperCase())}</h1>
      ${t.official && t.official !== t.name ? `<div class="ldofficial">${esc(t.official)}</div>` : ""}
      <div class="ttags ldtags">${trackTagsHtml(o.trackIndex!, 6)}</div>
      <div class="ldmain"><canvas class="ldmap"></canvas>
        <div class="ldfacts">
          <div><span>EXTENSÃO</span><b>${(t.targetLength / 1000).toFixed(2).replace(".", ",")} km</b></div>
          ${o.laps ? `<div><span>VOLTAS</span><b>${o.laps}</b></div>` : ""}
          ${t.firstGP ? `<div><span>PRIMEIRO GP</span><b>${t.firstGP}</b></div>` : ""}
          <div><span>CHANCE DE CHUVA</span><b>${Math.round(t.rainChance * 100)}%</b></div>
          <div><span>ULTRAPASSAGEM</span><b>${(t.overtake ?? 1) <= 0.8 ? "Difícil" : (t.overtake ?? 1) >= 1.2 ? "Fácil" : "Normal"}</b></div>
          <div class="ldrec"><span>RECORDE</span><b data-rec>—</b></div>
        </div></div>
      <p class="ldblurb">${esc(t.blurb)}</p>
    </div>` : ""}
    ${t && TRACK_HISTORY[originalTrackName(o.trackIndex!)] ? `<aside class="ldhist"><span>📜 HISTÓRIA DA PISTA</span><p>${esc(TRACK_HISTORY[originalTrackName(o.trackIndex!)])}</p></aside>` : ""}
    <div class="ldtip"><span>📻 DICA DO ENGENHEIRO</span><p data-tip>${esc(ENGINEER_TIPS[tip0])}</p></div>
    <div class="ldlogo"><div class="ldlogobox"><img class="base" src="/brand/logo.png" alt=""><img class="fill" src="/brand/logo.png" alt="Pit Wall Manager"></div>
      <div class="ldpct"><span>CARREGANDO</span><b data-pct>0%</b></div>
      ${o.play ? `<button class="ldplay" hidden>VAMOS COMEÇAR! <i>▶</i></button>` : ""}</div>`;
  (o.host ?? document.body).appendChild(el);

  const fill = el.querySelector<HTMLElement>(".fill")!;
  const pctEl = el.querySelector<HTMLElement>("[data-pct]")!;
  const tipEl = el.querySelector<HTMLElement>("[data-tip]")!;
  const map = el.querySelector<HTMLCanvasElement>(".ldmap");

  // recorde da pista (do jeito escolhido no perfil)
  if (o.trackIndex !== undefined)
    void loadRecords().then((f) => {
      const r = f(o.trackIndex!)[0];
      const b = el.querySelector<HTMLElement>("[data-rec]");
      if (b) b.textContent = r ? `${fmtLap(r.time)} · ${r.who}` : "sem tempo ainda";
    });

  // traçado da pista (desenha até a fração p)
  let drawMap = (_p: number) => {};
  if (map && o.trackIndex !== undefined) {
    const pts = getTrack(o.trackIndex).pts;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of pts) {
      minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = map.clientWidth || 420, H = map.clientHeight || 300;
    map.width = W * dpr;
    map.height = H * dpr;
    const g = map.getContext("2d")!;
    g.scale(dpr, dpr);
    const pad = 16;
    const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
    const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
    const X = (q: { x: number; y: number }) => ox + (q.x - minX) * sc, Y = (q: { x: number; y: number }) => oy + (q.y - minY) * sc;
    drawMap = (p: number) => {
      g.clearRect(0, 0, W, H);
      g.lineJoin = "round";
      g.lineCap = "round";
      // traçado inteiro bem fraco
      g.beginPath();
      pts.forEach((q, i) => (i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))));
      g.closePath();
      g.strokeStyle = "rgba(233,237,245,.12)";
      g.lineWidth = 4;
      g.stroke();
      // parte já "carregada", com brilho
      const n = Math.max(2, Math.floor(pts.length * p));
      g.beginPath();
      for (let i = 0; i < n; i++) (i ? g.lineTo(X(pts[i]), Y(pts[i])) : g.moveTo(X(pts[i]), Y(pts[i])));
      g.shadowColor = "rgba(232,32,42,.7)";
      g.shadowBlur = 14;
      g.strokeStyle = "#e9edf5";
      g.lineWidth = 3;
      g.stroke();
      g.shadowBlur = 0;
      // carro na ponta
      const h = pts[n - 1];
      g.fillStyle = "#ff2a32";
      g.beginPath();
      g.arc(X(h), Y(h), 5, 0, Math.PI * 2);
      g.fill();
      // largada
      g.fillStyle = "#fff";
      g.fillRect(X(pts[0]) - 2, Y(pts[0]) - 7, 4, 14);
    };
  }

  // dicas trocando
  let tipI = tip0;
  const tipTimer = setInterval(() => {
    tipI = (tipI + 1) % ENGINEER_TIPS.length;
    const out = tipEl.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px)" }], { duration: 180, fill: "forwards" });
    out.onfinish = () => {
      tipEl.textContent = ENGINEER_TIPS[tipI];
      tipEl.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
    };
  }, 3600);

  return new Promise((done) => {
    const t0 = performance.now();
    let shown = 0;
    const step = (now: number) => {
      if (!el.isConnected) {
        window.removeEventListener("keydown", onKey, true);
        clearInterval(tipTimer);
        return done();
      }
      const ready = o.ready ? o.ready() : true;
      const k = Math.min(1, (now - t0) / minMs);
      // sobe com o tempo; sem estar pronto, para em 94% (até 8 s, aí segue de qualquer jeito)
      let target = easeOut(k);
      if (!ready && now - t0 < 8000) target = Math.min(target, 0.94);
      shown += (target - shown) * 0.18;
      if (target >= 1 && shown > 0.995) shown = 1;
      const pct = Math.round(shown * 100);
      fill.style.clipPath = `inset(0 ${100 - shown * 100}% 0 0)`;
      pctEl.textContent = `${pct}%`;
      drawMap(Math.max(0.02, shown));
      if (shown < 1) return void requestAnimationFrame(step);
      if (o.play) return void waitPlay();
      leave();
    };
    // 100%: troca o "CARREGANDO" pelo botão (clique, Enter ou espaço); a dica continua trocando
    const waitPlay = () => {
      const btn = el.querySelector<HTMLButtonElement>(".ldplay")!;
      const pct = el.querySelector<HTMLElement>(".ldpct")!;
      pct.hidden = true;
      btn.hidden = false;
      el.classList.add("loaded");
      if (!reduce()) btn.animate([{ opacity: 0, transform: "translateY(8px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      btn.focus({ preventScroll: true });
      btn.addEventListener("click", leave);
    };
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      window.removeEventListener("keydown", onKey, true);
      clearInterval(tipTimer);
      const outA = el.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(4px)" }], { duration: reduce() ? 1 : 360, easing: "ease-out", fill: "forwards" });
      outA.onfinish = () => {
        el.remove();
        done();
      };
    };
    // com o botão, as teclas ficam aqui (o espaço não pode soltar a corrida pausada por baixo)
    const onKey = (e: KeyboardEvent) => {
      if (!o.play) return;
      e.stopImmediatePropagation();
      if ((e.code === "Space" || e.key === "Enter") && el.classList.contains("loaded")) {
        e.preventDefault();
        leave();
      }
    };
    window.addEventListener("keydown", onKey, true);
    requestAnimationFrame(step);
  });
}
