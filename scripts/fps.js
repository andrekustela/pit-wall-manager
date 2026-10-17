// mede o FPS por 3 segundos (usar com: shot.ts ... "evalfile:scripts/fps.js")
new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  let last = t0;
  let worst = 0;
  const f = (t) => {
    n++;
    worst = Math.max(worst, t - last);
    last = t;
    if (t - t0 < 3000) requestAnimationFrame(f);
    else resolve({ fps: Math.round(n / ((t - t0) / 1000)), piorFrameMs: Math.round(worst) });
  };
  requestAnimationFrame(f);
});
