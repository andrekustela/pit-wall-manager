// roda NO NAVEGADOR (pelo scripts/export-muros.ts): monta o autódromo automático de cada pista e guarda só as barreiras em window.__muros
(async () => {
  const T = await import("/src/sim/track.ts");
  const W = await import("/src/sim/walls.ts");
  const B = await import("/src/render/track3d.ts");
  const only = window.__only ?? null;
  // Douglas-Peucker: tira pontos que quase não mudam a linha (até 0,25 m)
  const simp = (p, tol = 0.25) => {
    if (p.length < 3) return p;
    const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
    const st = [[0, p.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let best = -1, bd = tol;
      const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / L; if (d > bd) { bd = d; best = i; } }
      if (best >= 0) { keep[best] = 1; st.push([a, best], [best, b]); }
    }
    return p.filter((_, i) => keep[i]);
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const out = {};
  for (let i = 0; i < T.CIRCUITS.length; i++) {
    const def = T.CIRCUITS[i];
    if (def.mod) continue;
    const slug = W.slugOf(def.name);
    if (only && !only.includes(slug)) continue;
    try {
      const res = await B.buildTrack3d(T.getTrack(i), false);
      const linhas = res.paths.items.filter((it) => W.WALL_PATHS.has(it.t)).map((it) => ({ t: it.t, p: simp(it.p).map(([x, z]) => [r1(x), r1(z)]), ...(it.reto ? { reto: true } : {}) }));
      const pecas = res.layer.pieces.filter((pc) => W.WALL_PIECES.has(pc.k)).map((pc) => [pc.k, r1(pc.x), r1(pc.z), Math.round(pc.r * 1000) / 1000, ...(pc.s != null && pc.s !== 1 ? [Math.round(pc.s * 100) / 100] : [])]);
      out[slug] = { pista: def.name, linhas, pecas };
      res.group.traverse((o) => { o.geometry?.dispose?.(); });
    } catch (e) {
      out[slug] = { erro: String(e) };
    }
  }
  window.__muros = out;
  return Object.entries(out).map(([k, v]) => k + ":" + (v.erro ? "ERRO " + v.erro : v.linhas.length + "l/" + v.linhas.reduce((s, l) => s + l.p.length, 0) + "p/" + v.pecas.length + "pc/" + JSON.stringify(v).length + "B")).join(" ");
})()
