// Voz da IA do rádio (Piper) gerada fora do fio do jogo: a conta pesada da voz não trava a corrida.
// Pedido: { id, voice, text } ou { id, voice, warm: true } (só carrega). Resposta: { id, wav } ou { id, error }.
import type { TtsSession } from "@mintplex-labs/piper-tts-web";

/** Jeff e Cadu vêm do repositório oficial (o espelho da biblioteca só tem o Faber) */
const OFFICIAL = "../../../../rhasspy/piper-voices/resolve/main/pt/pt_BR";
const sessions = new Map<string, Promise<TtsSession>>();

function session(voice: string): Promise<TtsSession> {
  let s = sessions.get(voice);
  if (!s) {
    s = (async () => {
      const piper = await import("@mintplex-labs/piper-tts-web");
      const id = `pt_BR-${voice}-medium`;
      const map = piper.PATH_MAP as Record<string, string>;
      if (!map[id]) map[id] = `${OFFICIAL}/${voice}/medium/${id}.onnx`;
      // a biblioteca guarda uma voz só: cada voz ganha a sua sessão
      piper.TtsSession._instance = null;
      return piper.TtsSession.create({ voiceId: id });
    })();
    s.catch(() => sessions.delete(voice));
    sessions.set(voice, s);
  }
  return s;
}

self.onmessage = async (e: MessageEvent<{ id: number; voice: string; text?: string; warm?: boolean }>) => {
  const { id, voice, text, warm } = e.data;
  try {
    const s = await session(voice);
    if (warm || !text) return void self.postMessage({ id });
    const wav = await s.predict(text);
    self.postMessage({ id, wav });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
