// Ouvido da IA do rádio: o Whisper (transformers.js) transcreve o que você falou, fora do fio do
// jogo e na CPU (não disputa a placa de vídeo com a corrida nem com a IA de texto).
// Pedido: { id, audio: Float32Array, rate } ou { id, warm: true }. Resposta: { id, text } ou { id, error }.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-base";
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load() {
  // (tipo simplificado: o da biblioteca é grande demais pro TypeScript)
  const make = pipeline as unknown as (task: string, model: string, opts: object) => Promise<AutomaticSpeechRecognitionPipeline>;
  asr ??= make("automatic-speech-recognition", MODEL, { device: "wasm", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } });
  asr.catch(() => (asr = null));
  return asr;
}

/** o Whisper quer 16 kHz */
function to16k(a: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return a;
  const n = Math.floor((a.length * 16000) / rate), out = new Float32Array(n), k = rate / 16000;
  for (let i = 0; i < n; i++) {
    const t = i * k, j = Math.floor(t), f = t - j;
    out[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? a[j] ?? 0) * f;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<{ id: number; audio?: Float32Array; rate?: number; warm?: boolean }>) => {
  const { id, audio, rate, warm } = e.data;
  try {
    const p = await load();
    if (warm || !audio) return void self.postMessage({ id });
    const out = (await p(to16k(audio, rate ?? 48000), { language: "portuguese", task: "transcribe" })) as { text?: string };
    self.postMessage({ id, text: (out.text ?? "").trim() });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
