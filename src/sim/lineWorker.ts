// Worker do editor de traçado: monta a pista e roda o carro de teste (lineOpt.ts) fora da tela, pra o
// jogo não travar. Recebe { def, iters }; manda { p } (progresso 0..1) e no fim { o, gain, lap }.
import { Track, type TrackDef } from "./track";
import { geometryOf, optimizeLine } from "./lineOpt";

self.onmessage = (e: MessageEvent<{ def: TrackDef; iters: number }>) => {
  const { def, iters } = e.data;
  // (sem linha: o carro de teste parte do meio da pista)
  const t = new Track({ ...def, lineKey: "-" });
  const r = optimizeLine(geometryOf(t), iters, (p) => postMessage({ p }));
  postMessage({ o: r.o, gain: r.gain, lap: r.lap });
};
