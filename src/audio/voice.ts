// Rádio da equipe falado: as mensagens de rádio da SUA equipe viram voz (síntese de fala do
// navegador/Windows, em português). Piloto e engenheiro com vozes diferentes; fila curta pra
// não acumular quando a corrida está acelerada.
import { storeGet, storeSet } from "../ui/common";

type Who = "driver" | "engineer";
interface Line {
  text: string;
  who: Who;
  at: number;
}

/** troca abreviações do texto da tela pelo jeito falado */
function speakable(t: string): string {
  return t
    .replace(/\bp\/\s*/g, "pra ")
    .replace(/\s*\(([^)]*)\)/g, ", $1")
    .replace(/(\d+)[.,](\d)s\b/g, "$1 vírgula $2 segundos")
    .replace(/(\d+)s\b/g, "$1 segundos")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,([.!?])/g, "$1")
    .trim();
}

/** "Rádio ABC: "texto"" (piloto), "Rádio: "texto"" (engenheiro), "Plano ABC: texto" (engenheiro) */
export function parseRadio(text: string, kind?: string): { who: Who; text: string } | null {
  const m = /^Rádio( [^:]+)?: "(.*)"$/.exec(text);
  if (m) return { who: m[1] ? "driver" : "engineer", text: m[2] };
  if (kind === "plan") {
    const p = /^Plano [^:]+: (.*)$/.exec(text);
    if (p) return { who: "engineer", text: p[1] };
  }
  return null;
}

class TeamVoice {
  enabled = storeGet("pwm.voice") !== "0";
  private queue: Line[] = [];
  private busy = false;
  private lineId = 0;
  private listeners: (() => void)[] = [];
  /** volume e bipes vêm do som do jogo */
  volume = () => 0.7;
  beepIn = () => {};
  beepOut = () => {};

  get supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  toggle() {
    this.enabled = !this.enabled;
    storeSet("pwm.voice", this.enabled ? "1" : "0");
    if (!this.enabled) this.stop();
    this.listeners.forEach((f) => f());
  }

  onChange(f: () => void) {
    this.listeners.push(f);
  }

  stop() {
    this.queue = [];
    if (this.supported) speechSynthesis.cancel();
    this.busy = false;
  }

  say(text: string, who: Who) {
    if (!this.enabled || !this.supported || this.volume() <= 0) return;
    // no máximo 2 esperando: com a corrida acelerada, o que ficou velho é descartado
    this.queue.push({ text: speakable(text), who, at: performance.now() });
    while (this.queue.length > 2) this.queue.shift();
    this.next();
  }

  /** vozes em português: as "naturais" (Edge/Windows online) soam bem melhor */
  private voiceFor(who: Who): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
    const all = speechSynthesis.getVoices().filter((v) => /^pt/i.test(v.lang));
    const br = all.filter((v) => /pt[-_]BR/i.test(v.lang));
    const pool = br.length ? br : all;
    const rank = (v: SpeechSynthesisVoice) => (/natural|online/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2);
    const sorted = [...pool].sort((a, b) => rank(a) - rank(b));
    // nome sem acento ("Antônio" -> "Antonio")
    const nm = (v: SpeechSynthesisVoice) => v.name.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const male = sorted.filter((v) => /antonio|daniel|\bmale|masculin|donato|fabio|humberto|julio|nicolau|valerio/i.test(nm(v)));
    const female = sorted.filter((v) => /francisca|maria|thalita|female|feminin|brenda|elza|giovanna|leila|leticia|manuela|yara/i.test(nm(v)));
    if (who === "driver") {
      const v = male[0] ?? sorted[0] ?? null;
      // piloto: mais rápido e um pouco mais agudo (falando no meio da corrida)
      return { voice: v, pitch: male[0] ? 1.05 : 0.85, rate: 1.12 };
    }
    // engenheiro: outra voz (se tiver), mais calma
    const v = female[0] ?? sorted.find((x) => x !== (male[0] ?? sorted[0])) ?? sorted[0] ?? null;
    return { voice: v, pitch: v && female[0] ? 1 : 0.7, rate: 1.02 };
  }

  private next() {
    if (this.busy) return;
    const now = performance.now();
    while (this.queue.length && now - this.queue[0].at > 8000) this.queue.shift();
    const line = this.queue.shift();
    if (!line) return;
    this.busy = true;
    const id = ++this.lineId;
    const u = new SpeechSynthesisUtterance(line.text);
    const v = this.voiceFor(line.who);
    if (v.voice) u.voice = v.voice;
    u.lang = v.voice?.lang ?? "pt-BR";
    u.pitch = v.pitch;
    u.rate = v.rate;
    u.volume = Math.min(1, this.volume() * 1.2);
    const done = () => {
      if (!this.busy || id !== this.lineId) return;
      this.beepOut();
      this.busy = false;
      setTimeout(() => this.next(), 250);
    };
    u.onend = done;
    u.onerror = done;
    // trava de segurança: alguns navegadores não disparam onend
    setTimeout(done, 1500 + line.text.length * 110);
    this.beepIn();
    setTimeout(() => speechSynthesis.speak(u), 180);
  }
}

export const teamVoice = new TeamVoice();
// a lista de vozes chega depois no Chrome/Edge: pedir cedo pra estar pronta na corrida
if (teamVoice.supported) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
}
