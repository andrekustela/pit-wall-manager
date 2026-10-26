// IA no rádio: você fala livre (segura V), a IA entende quem você chamou e o que você quer, e o
// piloto responde com uma frase nova, na voz dele. Tudo roda no seu PC, sem servidor e sem custo:
// - ouvir: o Vosk do comando de voz, em ditado livre (sem a lista fechada de palavras)
// - pensar: um modelo pequeno (Qwen 2.5 1,5B) rodando na placa de vídeo pelo WebLLM (WebGPU)
// - falar: as mesmas vozes do rádio (Piper: Faber, Jeff, Cadu) geradas na hora no navegador
// Baixa ~1,1 GB na primeira vez (modelo + vozes); o navegador guarda. É opcional: desligada, o
// rádio continua com as falas prontas.
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type { TtsSession } from "@mintplex-labs/piper-tts-web";
import { storeGet, storeSet } from "../ui/common";
import { getEditor, type VoiceId } from "../ui/editorData";

const MODEL = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
/** vozes do rádio -> modelo Piper; Jeff e Cadu vêm do repositório oficial (o espelho da biblioteca só tem o Faber) */
const PIPER: Record<VoiceId, string> = { faber: "pt_BR-faber-medium", jeff: "pt_BR-jeff-medium", cadu: "pt_BR-cadu-medium" };
const OFFICIAL = "../../../../rhasspy/piper-voices/resolve/main/pt/pt_BR";

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
  private tts = new Map<string, Promise<TtsSession>>();
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
      this.engine = await webllm.CreateMLCEngine(MODEL, {
        initProgressCallback: (p) => {
          this.progress = `IA: ${Math.round((p.progress ?? 0) * 100)}%`;
          this.listeners.forEach((f) => f());
        },
      });
      // vozes dos seus dois pilotos já ficam prontas (a 1ª fala não espera o download)
      const v = getEditor().voices;
      this.progress = "Vozes do rádio...";
      this.listeners.forEach((f) => f());
      await Promise.all([this.session(v.p1), this.session(v.p2)]);
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
    this.progress = "";
    this.set("off");
  }

  /** sessão da voz (uma por voz: a biblioteca só guarda uma de cada vez, então cria separado) */
  private session(voice: VoiceId): Promise<TtsSession> {
    let s = this.tts.get(voice);
    if (!s) {
      s = (async () => {
        const piper = await import("@mintplex-labs/piper-tts-web");
        const id = PIPER[voice];
        const map = piper.PATH_MAP as Record<string, string>;
        if (!map[id]) map[id] = `${OFFICIAL}/${voice}/medium/${id}.onnx`;
        piper.TtsSession._instance = null;
        return piper.TtsSession.create({ voiceId: id });
      })();
      s.catch(() => this.tts.delete(voice));
      this.tts.set(voice, s);
    }
    return s;
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
    const sys = [
      `Você é ${d.name}, piloto de Fórmula 1 da equipe ${team}${d.style ? ` (estilo: ${d.style})` : ""}, falando no rádio com o seu engenheiro durante a corrida.`,
      "Responda SEMPRE em português do Brasil, como piloto no rádio: curto (no máximo 2 frases, até 25 palavras), natural, com a emoção da situação (tranquilo, irritado, empolgado, preocupado).",
      "Use só os dados da situação abaixo. Não invente números, tempos nem nomes que não estão lá. Se não souber, diga o que sente no carro.",
      "Se o engenheiro mandar uma ordem (box, atacar, poupar, motor, deixar o companheiro passar), confirme do seu jeito e coloque a ação. Se for só uma pergunta, a ação é nenhuma.",
      `Responda só em JSON: {"fala": "o que você diz no rádio", "acao": um de ${ACTIONS.map((a) => `"${a}"`).join(", ")}}`,
      "",
      `Situação do seu carro agora:\n${d.status()}`,
      mate ? `Seu companheiro de equipe: ${mate.name}.` : "",
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
      this.hist.set(d.id, [...past, { q: heard, a: text }].slice(-3));
      return { slot, text, action };
    } finally {
      if (this.state === "thinking") this.set("ready");
    }
  }

  /** a fala na voz do piloto (P1/P2 do Editor): endereço de um áudio pronto pra tocar */
  async voice(text: string, slot: number): Promise<string> {
    const v = getEditor().voices[slot === 1 ? "p2" : "p1"];
    const s = await this.session(v);
    return URL.createObjectURL(await s.predict(text));
  }
}

export const radioAI = new RadioAI();
