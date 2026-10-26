// Safety car e guindaste vistos de cima (renders do Blender: art/render_props.py). Bico pra direita.
interface Prop { img: HTMLImageElement; lenM: number; widM: number; hookF?: number; hookL?: number }
const props = new Map<string, Prop>();
const asked = new Set<string>();

/** a imagem do objeto (null enquanto carrega ou sem o arquivo) */
export function prop(name: "sc" | "crane"): Prop | null {
  const p = props.get(name);
  if (p) return p;
  if (!asked.has(name)) {
    asked.add(name);
    const img = new Image();
    void fetch(`/props/${name}.json`)
      .then((r) => r.json() as Promise<Omit<Prop, "img">>)
      .then(
        (info) =>
          new Promise<void>((ok, fail) => {
            img.onload = () => {
              props.set(name, { ...info, img });
              ok();
            };
            img.onerror = fail;
            img.src = `/props/${name}.png`;
          }),
      )
      .catch(() => {});
  }
  return null;
}

/** desenha centrado em (x, y) px, virado pra h; m = px por metro */
export function drawProp(o: CanvasRenderingContext2D, p: Prop, x: number, y: number, h: number, m: number, alpha = 1) {
  o.save();
  o.translate(x, y);
  o.rotate(h);
  o.globalAlpha = alpha;
  o.drawImage(p.img, (-p.lenM / 2) * m, (-p.widM / 2) * m, p.lenM * m, p.widM * m);
  o.restore();
}
