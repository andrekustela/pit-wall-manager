// Gerencia os tiles da pista: pede pro Web Worker desenhar os que vão aparecer
// (inclusive uma borda em volta da tela, antes de precisar), guarda os prontos
// e, enquanto um não chega, mostra o mapa de baixa resolução no lugar.
// Sem suporte a Worker/OffscreenCanvas, desenha na própria página aos poucos.
import { getTrack } from "../sim/track";
import { BLEED, TILE_PX, VectorWorld } from "./worldVector";

type Img = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

const MAX_TILES = 220;
const MAX_PENDING = 12;
/** tiles a mais em volta da tela, pedidos antes de aparecer */
const PREFETCH = 1;

export class WorldTiles {
  readonly minX: number;
  readonly minY: number;
  private tiles = new Map<string, Img>();
  private pending = new Set<string>();
  /** circuito inteiro pré-carregado (primeiro rápido e borrado, depois em boa qualidade) */
  private overview: Img | null = null;
  private overviewPpm = 1;
  private worker: Worker | null = null;
  private local: VectorWorld | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  /** o mapa da pista inteira já chegou (dá pra desenhar sem buraco) */
  get ready(): boolean {
    return !!this.overview;
  }

  constructor(trackIndex: number) {
    const track = getTrack(trackIndex);
    // mesma margem do VectorWorld (só pra posicionar o mapa de baixa resolução)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    this.minX = minX - 90;
    this.minY = minY - 90;
    // maior resolução do circuito inteiro que cabe em ~12 M pixels (limite seguro até no celular)
    const area = (maxX - minX + 180) * (maxY - minY + 180);
    const fullPpm = Math.max(1, Math.min(3, Math.floor(Math.sqrt(12e6 / area) * 4) / 4));

    if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
      try {
        this.worker = new Worker(new URL("./tileWorker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (e) => {
          const m = e.data as { type: string; key?: string; bmp: ImageBitmap };
          const mm = m as { ppm?: number };
          if (m.type === "overview") {
            // fica sempre com a melhor versão que já chegou
            if (!this.overview || (mm.ppm ?? 1) >= this.overviewPpm) {
              if (this.overview && "close" in this.overview) this.overview.close();
              this.overview = m.bmp;
              this.overviewPpm = mm.ppm ?? 1;
            } else m.bmp.close();
          }
          else if (m.key) {
            this.pending.delete(m.key);
            this.tiles.set(m.key, m.bmp);
          }
        };
        this.worker.onerror = () => this.fallback(trackIndex);
        this.worker.postMessage({ type: "init", trackIndex });
        this.worker.postMessage({ type: "overview", ppm: 1 });
        this.worker.postMessage({ type: "overview", ppm: fullPpm });
        // plano B: se o Worker não mandar nada a tempo, monta a pista aqui mesmo
        this.watchdog = setTimeout(() => {
          if (!this.overview && this.worker) this.fallback(trackIndex);
        }, 3500);
      } catch {
        this.fallback(trackIndex);
      }
    } else this.fallback(trackIndex);
  }

  /** sem Worker: desenha na página mesmo */
  private fallback(trackIndex: number) {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.local = new VectorWorld(getTrack(trackIndex));
    this.overview = this.local.renderOverview(1) as HTMLCanvasElement;
    this.overviewPpm = 1;
  }

  destroy() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.worker?.terminate();
    for (const t of this.tiles.values()) if ("close" in t) t.close();
    this.tiles.clear();
  }

  private request(key: string, ppm: number, tx: number, ty: number) {
    if (this.pending.has(key)) return;
    if (this.worker) {
      if (this.pending.size >= MAX_PENDING) return;
      this.pending.add(key);
      this.worker.postMessage({ type: "tile", key, ppm, tx, ty });
    } else if (this.local) {
      this.tiles.set(key, this.local.renderTile(ppm, tx, ty));
    }
  }

  /**
   * Desenha a área visível. `pxPerM` = pixels do canvas por metro; `lod` < 1
   * usa tiles mais leves (câmera rápida).
   */
  draw(g: CanvasRenderingContext2D, viewX: number, viewY: number, viewW: number, viewH: number, pxPerM: number, lod: number) {
    const ppm = Math.round(pxPerM * lod * 1000) / 1000;
    const exact = lod === 1;
    const sizeM = TILE_PX / ppm;
    const scale = pxPerM / ppm;
    g.imageSmoothingEnabled = !exact;
    g.imageSmoothingQuality = "low";
    const tx0 = Math.floor(viewX / sizeM), ty0 = Math.floor(viewY / sizeM);
    const tx1 = Math.floor((viewX + viewW) / sizeM), ty1 = Math.floor((viewY + viewH) / sizeM);
    const cx = (tx0 + tx1) / 2, cy = (ty0 + ty1) / 2;

    // pedidos: visíveis primeiro (do centro pra fora), depois a borda de pré-carga
    const want: [string, number, number, number][] = [];
    let localBudget = this.local ? 2 : Infinity; // sem Worker: no máximo 2 tiles por frame
    for (let ty = ty0 - PREFETCH; ty <= ty1 + PREFETCH; ty++) {
      for (let tx = tx0 - PREFETCH; tx <= tx1 + PREFETCH; tx++) {
        const key = `${ppm}:${tx}:${ty}`;
        const visible = tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1;
        const tile = this.tiles.get(key);
        if (!tile) {
          want.push([key, tx, ty, (tx - cx) ** 2 + (ty - cy) ** 2 + (visible ? 0 : 1000)]);
          if (!visible) continue;
        } else {
          this.tiles.delete(key); // LRU: marca como usado
          this.tiles.set(key, tile);
        }
        if (!visible) continue;
        const dx = Math.round((tx * sizeM - viewX) * pxPerM);
        const dy = Math.round((ty * sizeM - viewY) * pxPerM);
        if (tile) {
          if (exact) g.drawImage(tile, dx - BLEED, dy - BLEED);
          else {
            const s = (TILE_PX + 2 * BLEED) * scale;
            g.drawImage(tile, dx - BLEED * scale, dy - BLEED * scale, s, s);
          }
        } else if (this.overview) {
          const o = this.overviewPpm;
          const sx = (tx * sizeM - this.minX) * o, sy = (ty * sizeM - this.minY) * o;
          const ds = Math.ceil(sizeM * pxPerM) + 1;
          g.imageSmoothingEnabled = true;
          g.drawImage(this.overview, sx, sy, sizeM * o, sizeM * o, dx, dy, ds, ds);
          g.imageSmoothingEnabled = !exact;
        } else {
          // nada pronto ainda: pinta o fundo (senão fica a imagem do quadro anterior e os carros "replicam")
          g.fillStyle = "#151a14";
          g.fillRect(dx, dy, Math.ceil(sizeM * pxPerM) + 1, Math.ceil(sizeM * pxPerM) + 1);
        }
      }
    }
    want.sort((a, b) => a[3] - b[3]);
    for (const [key, tx, ty] of want) {
      if (this.local && localBudget-- <= 0) break;
      this.request(key, ppm, tx, ty);
    }
    while (this.tiles.size > MAX_TILES) {
      const k = this.tiles.keys().next().value!;
      const t = this.tiles.get(k)!;
      if ("close" in t) t.close();
      this.tiles.delete(k);
    }
  }
}
