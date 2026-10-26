// Bandeira quadriculada tremulando no vento (bandeirada do fim da corrida): presa no mastro à
// esquerda, ondas atravessam o tecido e ficam mais fortes na ponta solta, com luz e sombra nas dobras.
// Só desenha enquanto está na tela.

const COLS = 8, ROWS = 5;

export function mountWavingFlag(cv: HTMLCanvasElement) {
  const g = cv.getContext("2d")!;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0;
  const frame = (now: number) => {
    if (!cv.isConnected) return;
    raf = requestAnimationFrame(frame);
    if (!cv.offsetParent) return; // escondida: não gasta nada
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const t = reduce ? 0 : now / 1000;
    // mastro
    const poleX = 14, top = 10;
    const grad = g.createLinearGradient(poleX - 4, 0, poleX + 4, 0);
    grad.addColorStop(0, "#6b7280");
    grad.addColorStop(0.5, "#e5e7eb");
    grad.addColorStop(1, "#4b5563");
    g.fillStyle = grad;
    g.fillRect(poleX - 3, top, 6, H - top);
    g.fillStyle = "#f3f4f6";
    g.beginPath();
    g.arc(poleX, top, 6, 0, Math.PI * 2);
    g.fill();
    // tecido
    const fx = poleX + 3, fy = top + 4, fw = W - fx - 22, fh = H * 0.62;
    const cw = fw / COLS, ch = fh / ROWS;
    const field = (x: number, y: number) => {
      const u = x / fw; // 0 no mastro, 1 na ponta
      const ph = u * 7.5 - t * 6.2 + (y / fh) * 0.9;
      const ph2 = u * 13 - t * 9.1 + 1.7 - (y / fh) * 1.4;
      const amp = fh * (0.03 + 0.11 * u * u);
      return {
        x: fx + x - Math.cos(ph) * 5 * u - u * u * 6,
        y: fy + y + Math.sin(ph) * amp + Math.sin(ph2) * amp * 0.25 + u * u * 8, // a ponta cai um pouco
        light: Math.cos(ph) * (0.25 + 0.75 * u) + Math.cos(ph2) * 0.2 * u,
      };
    };
    // sombra do tecido no chão de trás
    g.save();
    g.filter = "blur(8px)";
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    for (let i = 0; i <= COLS; i++) {
      const p = field(i * cw, 0);
      i ? g.lineTo(p.x + 10, p.y + 14) : g.moveTo(p.x + 10, p.y + 14);
    }
    for (let i = COLS; i >= 0; i--) {
      const p = field(i * cw, fh);
      g.lineTo(p.x + 10, p.y + 14);
    }
    g.fill();
    g.restore();
    // cada casa em pedacinhos (SUB x SUB): ela curva junto com o tecido em vez de quebrar nas quinas
    const SUB = 3, sw = cw / SUB, sh = ch / SUB;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const dark = (c + r) & 1;
        for (let j = 0; j < SUB; j++)
          for (let i = 0; i < SUB; i++) {
            const x = c * cw + i * sw, y = r * ch + j * sh;
            const a = field(x, y), b = field(x + sw, y), d = field(x, y + sh), e = field(x + sw, y + sh);
            const l = (a.light + b.light + d.light + e.light) / 4; // -1..1: virada pra luz ou pra sombra
            const v = dark ? Math.round(18 + 26 * Math.max(0, l)) : Math.round(238 * (0.8 + 0.2 * l));
            g.fillStyle = `rgb(${v},${v},${v + (dark ? 2 : 0)})`;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.lineTo(e.x, e.y);
            g.lineTo(d.x, d.y);
            g.closePath();
            g.fill();
            // emenda fina entre os pedaços (some a linha clara entre eles)
            g.strokeStyle = g.fillStyle;
            g.lineWidth = 1.3;
            g.lineJoin = "round";
            g.stroke();
          }
      }
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
