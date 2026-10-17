// Web Worker: desenha os tiles da pista em segundo plano (OffscreenCanvas),
// pra o jogo nunca engasgar esperando um pedaço novo da pista.
import { getTrack } from "../sim/track";
import { VectorWorld } from "./worldVector";

let world: VectorWorld | null = null;

type Msg =
  | { type: "init"; trackIndex: number }
  | { type: "overview"; ppm: number }
  | { type: "tile"; key: string; ppm: number; tx: number; ty: number };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === "init") {
    world = new VectorWorld(getTrack(m.trackIndex));
    return;
  }
  if (!world) return;
  if (m.type === "overview") {
    const bmp = (world.renderOverview(m.ppm) as OffscreenCanvas).transferToImageBitmap();
    (self as unknown as Worker).postMessage({ type: "overview", ppm: m.ppm, bmp }, [bmp]);
  } else if (m.type === "tile") {
    const bmp = (world.renderTile(m.ppm, m.tx, m.ty) as OffscreenCanvas).transferToImageBitmap();
    (self as unknown as Worker).postMessage({ type: "tile", key: m.key, bmp }, [bmp]);
  }
};
