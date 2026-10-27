// Mapa 2D gerado do autódromo 3D (Editor > Autódromo 3D > GERAR 2D): o 3D visto de cima, fotografado em
// pedaços e guardado no navegador (IndexedDB). Nos modos 2D, a pista que tiver um desses usa as imagens no
// lugar do desenho vetorial: a cara do 3D com o peso do 2D. Dois níveis: um nítido (perto) e um leve (longe).
// Mundo da pista (x, y) com y pra baixo, igual ao 2D.

export interface BakedMeta {
  v: 1;
  /** canto de cima à esquerda do mapa, em metros */
  x0: number;
  y0: number;
  /** níveis: pixels por metro, tamanho do pedaço em metros e quantos pedaços em x e y */
  levels: { ppm: number; size: number; nx: number; ny: number }[];
  /** quando foi gerado */
  at: number;
}
export const BAKE_PX = 512;
/** nome da pista -> chave (igual ao slugOf do track3d, sem puxar o Three.js pro 2D) */
export const mapSlug = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

// ---- guardar no navegador ----
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  return (dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open("pwm-mapas", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("meta");
      r.result.createObjectStore("tiles");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }));
}
function req<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) {
  return db().then(
    (d) =>
      new Promise<T>((ok, fail) => {
        const r = f(d.transaction(store, mode).objectStore(store));
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fail(r.error);
      }),
  );
}
const tileKey = (slug: string, l: number, tx: number, ty: number) => `${slug}:${l}:${tx},${ty}`;

export const getBakedMeta = (slug: string) => req<BakedMeta | undefined>("meta", "readonly", (s) => s.get(slug)).catch(() => undefined);
export const putBakedMeta = (slug: string, m: BakedMeta) => req("meta", "readwrite", (s) => s.put(m, slug));
export const putBakedTile = (slug: string, l: number, tx: number, ty: number, b: Blob) => req("tiles", "readwrite", (s) => s.put(b, tileKey(slug, l, tx, ty)));
const getBakedTile = (slug: string, l: number, tx: number, ty: number) => req<Blob | undefined>("tiles", "readonly", (s) => s.get(tileKey(slug, l, tx, ty)));
/** apaga o 2D gerado desta pista */
export async function deleteBaked(slug: string) {
  await req("meta", "readwrite", (s) => s.delete(slug));
  await req("tiles", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${slug}:`, `${slug}:￿`)));
}

/** desenha o mapa gerado (enquanto os pedaços carregam, o desenho vetorial aparece por baixo) */
export class BakedWorld {
  meta: BakedMeta | null = null;
  private cache = new Map<string, ImageBitmap | "loading" | "none">();
  private order: string[] = [];

  constructor(private slug: string) {
    void getBakedMeta(slug).then((m) => (this.meta = m ?? null));
  }

  get ready() {
    return !!this.meta;
  }

  private tile(l: number, tx: number, ty: number): ImageBitmap | null {
    const k = `${l}:${tx},${ty}`;
    const c = this.cache.get(k);
    if (c && c !== "loading" && c !== "none") {
      // (usado agora: vai pro fim da fila; os mais antigos saem quando passa do limite)
      const i = this.order.indexOf(k);
      if (i >= 0) this.order.splice(i, 1);
      this.order.push(k);
      return c;
    }
    if (!c) {
      this.cache.set(k, "loading");
      void getBakedTile(this.slug, l, tx, ty)
        .then((b) => (b ? createImageBitmap(b) : null))
        .then((bmp) => {
          this.cache.set(k, bmp ?? "none");
          if (bmp) this.order.push(k);
          while (this.order.length > 70) {
            const old = this.order.shift()!;
            const o = this.cache.get(old);
            if (o && typeof o !== "string") o.close();
            this.cache.delete(old);
          }
        })
        .catch(() => this.cache.set(k, "none"));
    }
    return null;
  }

  /**
   * Desenha a área visível (mesmos parâmetros do mapa vetorial). Se algum pedaço ainda está carregando,
   * chama `fallback` antes (o vetorial por baixo) e põe por cima o que já carregou.
   */
  draw(g: CanvasRenderingContext2D, viewX: number, viewY: number, viewW: number, viewH: number, pxPerM: number, fallback: () => void) {
    const m = this.meta;
    if (!m) return fallback();
    // nível: o mais leve que ainda não estica muito (até ~1,25×); senão o mais nítido
    let l = 0;
    for (let i = m.levels.length - 1; i >= 0; i--)
      if (m.levels[i].ppm * 1.25 >= pxPerM) {
        l = i;
        break;
      }
    const L = m.levels[l];
    const tx0 = Math.max(0, Math.floor((viewX - m.x0) / L.size)), tx1 = Math.min(L.nx - 1, Math.floor((viewX + viewW - m.x0) / L.size));
    const ty0 = Math.max(0, Math.floor((viewY - m.y0) / L.size)), ty1 = Math.min(L.ny - 1, Math.floor((viewY + viewH - m.y0) / L.size));
    const list: [ImageBitmap | null, number, number][] = [];
    let all = true;
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const b = this.tile(l, tx, ty);
        if (!b) all = false;
        list.push([b, tx, ty]);
      }
    // (fora do mapa gerado também precisa do vetorial: a borda da tela pode passar do que foi fotografado)
    const outside = viewX < m.x0 || viewY < m.y0 || viewX + viewW > m.x0 + L.nx * L.size || viewY + viewH > m.y0 + L.ny * L.size;
    if (!all || outside) fallback();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const ds = L.size * pxPerM;
    for (const [b, tx, ty] of list) {
      if (!b) continue;
      const dx = Math.floor((m.x0 + tx * L.size - viewX) * pxPerM), dy = Math.floor((m.y0 + ty * L.size - viewY) * pxPerM);
      g.drawImage(b, dx, dy, Math.ceil(ds) + 1, Math.ceil(ds) + 1);
    }
  }

  destroy() {
    for (const c of this.cache.values()) if (c && typeof c !== "string") c.close();
    this.cache.clear();
  }
}
