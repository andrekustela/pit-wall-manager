// IA no rádio: você fala livre (segura V), a IA entende quem você chamou e o que você quer, e o
// piloto responde com uma frase nova, na voz dele. Tudo roda no seu PC, sem servidor e sem custo:
// - ouvir: o Vosk do comando de voz, em ditado livre (sem a lista fechada de palavras)
// - pensar: um modelo pequeno (Qwen 2.5 1,5B) rodando na placa de vídeo pelo WebLLM (WebGPU)
// - falar: as mesmas vozes do rádio (Piper: Faber, Jeff, Cadu) geradas na hora no navegador
// Baixa ~1,1 GB na primeira vez (modelo + vozes); o navegador guarda. É opcional: desligada, o
// rádio continua com as falas prontas.
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { storeGet, storeSet } from "../ui/common";
import { getEditor, type VoiceId } from "../ui/editorData";

const MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

/** o que a IA pode mandar o jogo fazer (o piloto confirma do jeito dele) */
export type AIAction =
  | "nenhuma" | "box" | "cancelar_box" | "atacar" | "normal" | "poupar"
  | "motor_rico" | "motor_normal" | "motor_pobre" | "deixar_passar" | "manter" | "livre";
const ACTIONS: AIAction[] = ["nenhuma", "box", "cancelar_box", "atacar", "normal", "poupar", "motor_rico", "motor_normal", "motor_pobre", "deixar_passar", "manter", "livre"];

export interface AIDriver {
  id: string;
  name: string;
  short: string;
  /** jeito do piloto (ficha): "Agressivo", "Rei da chuva"... */
  style?: string;
  /** situação do carro agora, em texto (posição, pneu, combustível, danos, rivais...) */
  status: () => string;
}

export interface AIReply {
  slot: number;
  text: string;
  action: AIAction;
}

type State = "off" | "loading" | "ready" | "thinking" | "error";

/** tira acento e caixa: "Sênna" -> "senna" */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Quem você chamou: "Senna, tudo certo?", "Ayrton", "P1", "pê um", "piloto dois", "carro 2".
 * O reconhecimento de voz erra nome estrangeiro ("Sena", "Hamiltom"): aceita parecido. -1 = ninguém.
 */
export function pickSlot(heard: string, drivers: { name: string; short: string }[]): number {
  const t = ` ${norm(heard).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  if (/ (p|pe|piloto|carro) ?(1|um) | primeiro /.test(t)) return 0;
  if (/ (p|pe|piloto|carro) ?(2|dois) | segundo /.test(t)) return 1;
  const words = t.trim().split(" ");
  let best = -1, bestD = Infinity;
  drivers.forEach((d, i) => {
    const keys = [...norm(d.name).split(/[\s-]+/), norm(d.short)].filter((k) => k.length >= 3);
    for (const k of keys)
      for (const w of words) {
        if (w.length < 3) continue;
        const dist = lev(w, k), tol = k.length >= 7 ? 2 : k.length >= 4 ? 1 : 0;
        if (dist <= tol && dist < bestD) {
          bestD = dist;
          best = i;
        }
      }
  });
  return best;
}

class RadioAI {
  state: State = "off";
  error = "";
  /** o que está carregando agora (pra mostrar) */
  progress = "";
  /** o jogador ligou (fica lembrado; religa sozinho na próxima vez) */
  wanted = storeGet("pwm.radioai") === "1";
  private engine: MLCEngineInterface | null = null;
  /** a IA e a voz rodam em processos separados (workers): a corrida não trava enquanto elas trabalham */
  private llmWorker: Worker | null = null;
  private ttsWorker: Worker | null = null;
  private ttsSeq = 0;
  private ttsWait = new Map<number, { ok: (wav: Blob | null) => void; fail: (e: Error) => void }>();
  private sttWorker: Worker | null = null;
  private sttWait = new Map<number, { ok: (text: string) => void; fail: (e: Error) => void }>();
  /** conversa recente com cada piloto (pra ele lembrar do que você perguntou) */
  private hist = new Map<string, { q: string; a: string }[]>();
  private listeners: (() => void)[] = [];

  onChange(f: () => void) {
    this.listeners.push(f);
  }
  private set(s: State, err = "") {
    this.state = s;
    this.error = err;
    this.listeners.forEach((f) => f());
  }

  /** precisa de WebGPU (Chrome, Edge, Opera e o programa de PC atualizados) */
  get supported() {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }

  get ready() {
    return this.state === "ready" || this.state === "thinking";
  }

  async enable() {
    if (this.state === "loading" || this.ready) return;
    if (!this.supported) return this.set("error", "Este navegador não tem WebGPU (precisa do Chrome, Edge ou Opera atualizados).");
    this.wanted = true;
    storeSet("pwm.radioai", "1");
    this.set("loading");
    try {
      const webllm = await import("@mlc-ai/web-llm");
      this.llmWorker = new Worker(new URL("./llmWorker.ts", import.meta.url), { type: "module" });
      this.engine = await webllm.CreateWebWorkerMLCEngine(this.llmWorker, MODEL, {
        initProgressCallback: (p) => {
          this.progress = `IA: ${Math.round((p.progress ?? 0) * 100)}%`;
          this.listeners.forEach((f) => f());
        },
      });
      // vozes dos seus dois pilotos já ficam prontas (a 1ª fala não espera o download)
      const v = getEditor().voices;
      this.progress = "Vozes do rádio...";
      this.listeners.forEach((f) => f());
      await Promise.all([this.tts(v.p1, null), this.tts(v.p2, null), this.stt(null, 0)]);
      this.progress = "";
      this.set("ready");
    } catch (e) {
      this.engine = null;
      const msg = String((e as Error)?.message ?? e);
      this.set("error", /gpu|adapter|webgpu/i.test(msg) ? "A placa de vídeo não conseguiu rodar a IA (WebGPU)." : `Não consegui ligar a IA do rádio (${msg.slice(0, 80)}).`);
    }
  }

  disable() {
    this.wanted = false;
    storeSet("pwm.radioai", "0");
    void this.engine?.unload();
    this.engine = null;
    this.llmWorker?.terminate();
    this.llmWorker = null;
    this.ttsWorker?.terminate();
    this.ttsWorker = null;
    this.ttsWait.forEach((w) => w.fail(new Error("IA desligada")));
    this.ttsWait.clear();
    this.sttWorker?.terminate();
    this.sttWorker = null;
    this.sttWait.forEach((w) => w.fail(new Error("IA desligada")));
    this.sttWait.clear();
    this.progress = "";
    this.set("off");
  }

  /** ouvido (Whisper) no processo separado: audio = null só carrega o modelo */
  private stt(audio: Float32Array | null, rate: number): Promise<string> {
    if (!this.sttWorker) {
      this.sttWorker = new Worker(new URL("./sttWorker.ts", import.meta.url), { type: "module" });
      this.sttWorker.onmessage = (e: MessageEvent<{ id: number; text?: string; error?: string }>) => {
        const w = this.sttWait.get(e.data.id);
        if (!w) return;
        this.sttWait.delete(e.data.id);
        if (e.data.error) w.fail(new Error(e.data.error));
        else w.ok(e.data.text ?? "");
      };
    }
    const id = ++this.ttsSeq;
    return new Promise((ok, fail) => {
      this.sttWait.set(id, { ok, fail });
      this.sttWorker!.postMessage(audio ? { id, audio, rate } : { id, warm: true }, audio ? [audio.buffer] : []);
    });
  }

  /** o que você falou, em texto (Whisper) */
  hear(pcm: Float32Array, rate: number): Promise<string> {
    return this.stt(pcm, rate);
  }

  /** voz no processo separado: text = null só carrega a voz (pra 1ª fala não esperar o download) */
  private tts(voice: VoiceId, text: string | null): Promise<Blob | null> {
    if (!this.ttsWorker) {
      this.ttsWorker = new Worker(new URL("./ttsWorker.ts", import.meta.url), { type: "module" });
      this.ttsWorker.onmessage = (e: MessageEvent<{ id: number; wav?: Blob; error?: string }>) => {
        const w = this.ttsWait.get(e.data.id);
        if (!w) return;
        this.ttsWait.delete(e.data.id);
        if (e.data.error) w.fail(new Error(e.data.error));
        else w.ok(e.data.wav ?? null);
      };
    }
    const id = ++this.ttsSeq;
    return new Promise((ok, fail) => {
      this.ttsWait.set(id, { ok, fail });
      this.ttsWorker!.postMessage(text === null ? { id, voice, warm: true } : { id, voice, text });
    });
  }

  /**
   * Você falou; o piloto responde. `slot` já vem decidido (pelo nome ou o piloto seguido).
   * Devolve a fala e a ação (o jogo executa a ação e toca a fala).
   */
  async ask(heard: string, slot: number, drivers: AIDriver[], team: string): Promise<AIReply> {
    if (!this.engine) throw new Error("IA desligada");
    const d = drivers[slot];
    const mate = drivers[1 - slot];
    const past = this.hist.get(d.id) ?? [];
    // instrução curta: a placa de vídeo lê tudo isto antes de responder (texto longo = mais lento e pesado)
    const sys = [
      `Você é ${d.name}, piloto de F1 (${team}${d.style ? `, ${d.style}` : ""}), dentro do carro. Quem fala com você no rádio é o seu engenheiro.`,
      "Responda como PILOTO, em primeira pessoa, em português do Brasil: no máximo 2 frases curtas, com emoção. Nunca fale como engenheiro nem dê ordens.",
      "Use só a situação abaixo; não invente números nem nomes. Se ele mandar uma ordem, confirme e ponha a ação; pergunta = ação nenhuma.",
      `Só JSON: {"fala": "...", "acao": ${ACTIONS.map((a) => `"${a}"`).join("|")}}`,
      `Situação:\n${d.status()}${mate ? `\nCompanheiro: ${mate.name}.` : ""}`,
    ].join("\n");
    const msgs = [
      { role: "system" as const, content: sys },
      ...past.flatMap((h) => [
        { role: "user" as const, content: h.q },
        { role: "assistant" as const, content: JSON.stringify({ fala: h.a, acao: "nenhuma" }) },
      ]),
      { role: "user" as const, content: `O engenheiro disse (reconhecimento de voz, pode ter palavras erradas, interprete o que ele quis dizer): "${heard}"` },
    ];
    this.set("thinking");
    try {
      const r = await this.engine.chat.completions.create({ messages: msgs, temperature: 0.8, max_tokens: 90, response_format: { type: "json_object" } });
      const raw = r.choices[0]?.message?.content ?? "";
      let text = "", action: AIAction = "nenhuma";
      try {
        const j = JSON.parse(raw) as { fala?: unknown; acao?: unknown };
        text = typeof j.fala === "string" ? j.fala : "";
        if (typeof j.acao === "string" && (ACTIONS as string[]).includes(j.acao)) action = j.acao as AIAction;
      } catch {
        text = raw;
      }
      text = text.replace(/^["'“”\s-]+|["'“”\s]+$/g, "").replace(/\s+/g, " ").slice(0, 220);
      if (!text) text = "Copiado.";
      this.hist.set(d.id, [...past, { q: heard, a: text }].slice(-2));
      return { slot, text, action };
    } finally {
      if (this.state === "thinking") this.set("ready");
    }
  }

  /**
   * Reação a um evento da corrida (ultrapassagem, toque, box lento...): o piloto fala por conta
   * própria. null = a IA está ocupada (toca a fala pronta).
   */
  async react(event: string, slot: number, drivers: AIDriver[], team: string): Promise<AIReply | null> {
    if (!this.engine || this.state !== "ready") return null;
    const d = drivers[slot];
    const sys = [
      `Você é ${d.name}, PILOTO de Fórmula 1 da equipe ${team}${d.style ? ` (estilo: ${d.style})` : ""}, dentro do carro, falando no rádio com o seu engenheiro. Você não é o engenheiro: fale em primeira pessoa, sobre você.`,
      "Acabou de acontecer algo com você. Fale no rádio o que sente sobre isso, em português do Brasil: uma frase curta (até 15 palavras), natural, com a emoção certa (bravo se te fecharam, empolgado se passou, preocupado se quebrou).",
      "Use só os fatos dados. Não invente números nem nomes.",
      'Responda só em JSON: {"fala": "o que você diz no rádio"}',
      "",
      `Situação do seu carro:\n${d.status()}`,
    ].join("\n");
    this.set("thinking");
    try {
      const r = await this.engine.chat.completions.create({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `O que aconteceu agora: ${event}` },
        ],
        temperature: 0.9,
        max_tokens: 60,
        response_format: { type: "json_object" },
      });
      const raw = r.choices[0]?.message?.content ?? "";
      let text = "";
      try {
        const j = JSON.parse(raw) as { fala?: unknown };
        text = typeof j.fala === "string" ? j.fala : "";
      } catch {
        text = raw;
      }
      text = text.replace(/^["'“”\s-]+|["'“”\s]+$/g, "").replace(/\s+/g, " ").slice(0, 160);
      return text ? { slot, text, action: "nenhuma" } : null;
    } finally {
      if ((this.state as State) === "thinking") this.set("ready");
    }
  }

  /** a fala na voz do piloto (P1/P2 do Editor): endereço de um áudio pronto pra tocar */
  async voice(text: string, slot: number): Promise<string> {
    const v = getEditor().voices[slot === 1 ? "p2" : "p1"];
    const wav = await this.tts(v, text);
    if (!wav) throw new Error("sem áudio");
    return URL.createObjectURL(wav);
  }
}

export const radioAI = new RadioAI();
