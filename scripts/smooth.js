// mede o quão liso o carro seguido anda na tela (usar com shot.ts ... "evalfile:scripts/smooth.js")
new Promise((resolve) => {
  const r = window.__view.renderer;
  const pts = [];
  const t0 = performance.now();
  const f = (t) => {
    pts.push({ t, x: r.cam.x, y: r.cam.y });
    if (t - t0 < 3000) requestAnimationFrame(f);
    else {
      let back = 0;
      const sp = [];
      for (let i = 2; i < pts.length; i++) {
        const ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y;
        const bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y;
        if (ax * bx + ay * by < 0) back++;
        sp.push(Math.hypot(bx, by) / (pts[i].t - pts[i - 1].t));
      }
      const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
      const sd = Math.sqrt(sp.reduce((a, b) => a + (b - mean) ** 2, 0) / sp.length);
      resolve({ frames: pts.length, fps: Math.round(pts.length / 3), voltasPraTras: back, variacaoVelocidadePct: Math.round((sd / mean) * 100) });
    }
  };
  requestAnimationFrame(f);
});
