// Comando de voz (aperta e fala): segura V, fala "P1 box", solta. Reconhecimento OFFLINE com o
// Vosk (vosk-browser, Apache 2.0) e o modelo pequeno de português — funciona em qualquer navegador
// (Opera incluso) e no programa de PC, sem mandar áudio pra servidor nenhum.
// Só reconhece as palavras dos comandos (gramática fechada): bem mais certeiro que ditado livre.
import type { Model, KaldiRecognizer } from "vosk-browser";

const MODEL_URL = "/vosk/model-pt.tar.gz";

/** palavras que o reconhecedor pode ouvir (o resto vira "[unk]") */
const WORDS = [
  "pê", "pé", "piloto", "carro", "um", "dois", "primeiro", "segundo",
  "box", "boxe", "cancela", "cancelar", "ataca", "atacar", "ataque", "força", "forçar", "poupa", "poupar", "economiza",
  "normal", "ritmo", "motor", "rico", "rica", "pobre", "deixa", "passar", "mantenham", "mantém", "posição", "posições",
  "liberados", "livre", "pneu", "macio", "médio", "duro", "chuva", "intermediário",
  "sim", "pode", "aceito", "aceita", "não", "negativo", "nega",
];

export type VoiceAction =
  | { kind: "yes"; slot: null }
  | { kind: "no"; slot: null }
  | { kind: "box"; slot: number | null }
  | { kind: "cancelBox"; slot: number | null }
  | { kind: "tyre"; slot: number | null; compound: "S" | "M" | "H" | "I" | "W"; box: boolean }
  | { kind: "pace"; slot: number | null; mode: "push" | "normal" | "conserve" }
  | { kind: "engine"; slot: number | null; mode: "rich" | "normal" | "lean" }
  | { kind: "order"; slot: number | null; mode: "letPass" | "hold" | "none" };

/** texto reconhecido -> comando (null = não entendi) */
export function parseCommand(raw: string): VoiceAction | null {
  const t = ` ${raw.toLowerCase().replace(/\[unk\]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (!t.trim()) return null;
  // resposta a um pedido do piloto
  if (/ (não|negativo|nega) /.test(t)) return { kind: "no", slot: null };
  if (/ (sim|aceito|aceita) /.test(t) || t.trim() === "pode") return { kind: "yes", slot: null };
  const slot = / (um|primeiro) /.test(t) ? 0 : / (dois|segundo) /.test(t) ? 1 : null;
  const box = / box(e)? /.test(t);
  if (/ cancela(r)? /.test(t)) return { kind: "cancelBox", slot };
  const tyre = / macio /.test(t) ? "S" : / médio /.test(t) ? "M" : / duro /.test(t) ? "H" : / intermediário /.test(t) ? "I" : / chuva /.test(t) ? "W" : null;
  if (tyre) return { kind: "tyre", slot, compound: tyre, box };
  if (box) return { kind: "box", slot };
  if (/ motor /.test(t)) {
    if (/ ric[oa] /.test(t)) return { kind: "engine", slot, mode: "rich" };
    if (/ pobre /.test(t)) return { kind: "engine", slot, mode: "lean" };
    if (/ normal /.test(t)) return { kind: "engine", slot, mode: "normal" };
  }
  if (/ (ataca|atacar|ataque|força|forçar) /.test(t)) return { kind: "pace", slot, mode: "push" };
  if (/ (poupa|poupar|economiza) /.test(t)) return { kind: "pace", slot, mode: "conserve" };
  if (/ deixa .*passar /.test(t)) return { kind: "order", slot, mode: "letPass" };
  if (/ (mantenham|mantém) /.test(t)) return { kind: "order", slot, mode: "hold" };
  if (/ (liberados|livre) /.test(t)) return { kind: "order", slot, mode: "none" };
  if (/ normal /.test(t)) return { kind: "pace", slot, mode: "normal" };
  return null;
}

type State = "off" | "loading" | "ready" | "listening" | "error";

class VoiceCommands {
  state: State = "off";
  error = "";
  private model: Model | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private rec: KaldiRecognizer | null = null;
  private listeners: (() => void)[] = [];
  /** comando reconhecido (texto bruto junto, pra mostrar) */
  onCommand: (a: VoiceAction | null, heard: string) => void = () => {};

  onChange(f: () => void) {
    this.listeners.push(f);
  }
  private set(s: State, err = "") {
    this.state = s;
    this.error = err;
    this.listeners.forEach((f) => f());
  }

  get supported() {
    return !!navigator.mediaDevices?.getUserMedia && typeof WebAssembly !== "undefined";
  }

  /** liga: pede o microfone e carrega o modelo (~32 MB, só na 1ª vez; o navegador guarda) */
  async enable() {
    if (this.state !== "off" && this.state !== "error") return;
    this.set("loading");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const { createModel } = await import("vosk-browser");
      this.model = await createModel(MODEL_URL);
      this.ctx = new AudioContext();
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.set("ready");
    } catch (e) {
      this.disable();
      const msg = String((e as Error)?.message ?? e);
      this.set("error", /denied|permission|notallowed/i.test(msg) ? "O microfone foi bloqueado. Libere o acesso nas permissões do site." : "Não consegui ligar o comando de voz.");
    }
  }

  disable() {
    this.stopListening(true);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    void this.ctx?.close();
    this.ctx = null;
    this.model?.terminate();
    this.model = null;
    this.set("off");
  }

  /** segurou a tecla: começa a ouvir */
  startListening() {
    if (this.state !== "ready" || !this.model || !this.ctx || !this.source) return;
    void this.ctx.resume();
    const rec = new this.model.KaldiRecognizer(this.ctx.sampleRate, JSON.stringify([...WORDS, "[unk]"]));
    let partial = "";
    rec.on("partialresult", (m) => {
      if (m.event === "partialresult") partial = m.result.partial;
    });
    rec.on("result", (m) => {
      if (m.event !== "result" || this.rec !== rec) return;
      const heard = m.result.text || partial;
      this.rec = null;
      rec.remove();
      this.onCommand(parseCommand(heard), heard);
    });
    this.rec = rec;
    // ScriptProcessor ainda é o jeito mais simples e compatível de pegar o áudio cru
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.proc.onaudioprocess = (ev) => {
      try {
        this.rec?.acceptWaveform(ev.inputBuffer);
      } catch {
        /* reconhecedor já fechado */
      }
    };
    this.source.connect(this.proc);
    this.proc.connect(this.ctx.destination);
    this.set("listening");
  }

  /** soltou a tecla: fecha a frase e pega o resultado */
  stopListening(silent = false) {
    if (this.state !== "listening") return;
    const rec = this.rec;
    // um pedacinho a mais de áudio, pra não cortar a última palavra
    setTimeout(() => {
      this.proc?.disconnect();
      this.source?.disconnect();
      this.proc = null;
      if (!rec) return;
      if (silent) {
        this.rec = null;
        rec.remove();
      } else rec.retrieveFinalResult();
    }, 220);
    this.set("ready");
  }
}

export const voiceCmd = new VoiceCommands();

/** teste (depuração): reconhece um arquivo de áudio com a mesma gramática dos comandos */
export async function recognizeClip(url: string, free = false): Promise<string> {
  const { createModel } = await import("vosk-browser");
  const model = await createModel(MODEL_URL);
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const rec = new model.KaldiRecognizer(buf.sampleRate, free ? undefined : JSON.stringify([...WORDS, "[unk]"]));
  const text = await new Promise<string>((done) => {
    rec.on("result", (m) => m.event === "result" && done(m.result.text));
    rec.acceptWaveformFloat(buf.getChannelData(0), buf.sampleRate);
    rec.retrieveFinalResult();
  });
  model.terminate();
  void ctx.close();
  return text;
}
