// Bandeira quadriculada bem apagada tremulando no vento, de fundo: no menu e nas telas do fim de
// semana (lobby, treino, classificação, estratégia, sede). Presa à esquerda, solta à direita: as
// ondas ficam mais fortes na ponta, as casas se deformam e as dobras ganham luz e sombra.

const S = 54;

export interface FlagOpts {
  /** onde o tecido "prende" (fração da largura) */
  x0: number;
  /** some do lado esquerdo (menu: atrás dos botões) */
  fadeLeft: boolean;
  /** força (1 = a do menu) */
  strength: number;
}

/** desenha a bandeira (coordenadas em px de CSS; o contexto já vem com a escala da tela) */
export function drawWaveFlag(g: CanvasRenderingContext2D, W: number, H: number, t: number, o: FlagOpts) {
  const x0 = W * o.x0;
  const field = (x: number, y: number) => {
    const u = Math.max(0, Math.min(1, (x - x0) / (W - x0)));
    const ph = x * 0.011 + y * 0.0022 - t * 2.1;
    const ph2 = x * 0.019 - y * 0.004 - t * 3.3 + 1.3;
    const amp = 4 + 22 * u * u;
    return {
      x: x - Math.cos(ph) * 5 * u,
      y: y + Math.sin(ph) * amp + Math.sin(ph2) * 5 * u,
      light: Math.cos(ph) * (0.35 + 0.65 * u) + Math.cos(ph2) * 0.25 * u,
    };
  };
  for (let iy = -1; iy * S < H + S; iy++)
    for (let ix = 0; ix * S < W + S; ix++) {
      if ((ix + iy) & 1) continue;
      const x = ix * S, y = iy * S;
      const cx = x / W, cy = y / H;
      const left = o.fadeLeft ? Math.min(1, Math.max(0, (cx - 0.12) * 2.2)) : Math.min(1, cx * 6 + 0.2);
      const fade = left * Math.min(1, cy * 4 + 0.2, (1 - cy) * 4, (1 - cx) * 5 + 0.15);
      if (fade <= 0) continue;
      const a = field(x, y), b = field(x + S, y), c = field(x + S, y + S), d = field(x, y + S);
      const light = (a.light + b.light + c.light + d.light) / 4;
      // dobra virada pra luz = mais clara; virada pro outro lado = quase some
      const alpha = Math.max(0, (0.016 + 0.03 * (0.5 + 0.5 * light)) * fade * o.strength);
      if (alpha < 0.003) continue;
      g.fillStyle = `rgba(205,215,240,${alpha.toFixed(4)})`;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineTo(c.x, c.y);
      g.lineTo(d.x, d.y);
      g.closePath();
      g.fill();
    }
}

/**
 * Fundo das telas do fim de semana: um canvas atrás do conteúdo da tela (.screen) com a bandeira.
 * Para sozinho quando a tela sai.
 */
export function mountFlagBackdrop(screen: HTMLElement) {
  if (screen.querySelector(":scope > .flagbg")) return;
  const cv = document.createElement("canvas");
  cv.className = "flagbg";
  screen.prepend(cv);
  const g = cv.getContext("2d")!;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = (now: number) => {
    if (!cv.isConnected) return;
    requestAnimationFrame(frame);
    // todo quadro (com limite de quadros ela engasgava); resolução de 1x basta pra uma bandeira apagada
    const dpr = 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    drawWaveFlag(g, W, H, reduce ? 0 : now / 1000, SCREEN_FLAG);
  };
  requestAnimationFrame(frame);
}

/** a mesma bandeira das telas (a transição usa esta, pra parecer que ela nunca parou) */
export const SCREEN_FLAG: FlagOpts = { x0: 0.05, fadeLeft: false, strength: 0.8 };

/** canvas com a bandeira animada (pra transição): para sozinho quando sai da tela */
export function flagCanvas(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  const g = cv.getContext("2d")!;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = (now: number) => {
    if (!cv.isConnected && cv.dataset.started) return;
    cv.dataset.started = "1";
    requestAnimationFrame(frame);
    const dpr = 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    drawWaveFlag(g, W, H, reduce ? 0 : now / 1000, SCREEN_FLAG);
  };
  requestAnimationFrame(frame);
  return cv;
}
