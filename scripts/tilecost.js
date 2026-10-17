// mede quanto custa criar um tile e quantos tiles são desenhados por frame
new Promise((resolve) => {
  const w = window.__view.renderer.world;
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) w.renderTile(8, 1000 + i, 1000);
  const perTile = (performance.now() - t0) / 5;
  const t1 = performance.now();
  for (let i = 0; i < 5; i++) w.renderTile(8, Math.floor((w.minX + 400) / 32) + i, Math.floor((w.minY + 100) / 32));
  const perTrackTile = (performance.now() - t1) / 5;
  resolve({ msPorTileVazio: perTile.toFixed(1), msPorTileComPista: perTrackTile.toFixed(1), tilesEmCache: w.tiles.size });
});
