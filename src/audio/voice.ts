// Rádio da equipe falado: as mensagens de rádio da SUA equipe viram voz (síntese de fala do
// navegador/Windows, em português). Piloto e engenheiro com vozes diferentes; fila curta pra
// não acumular quando a corrida está acelerada.
import { storeGet, storeSet } from "../ui/common";
import { RADIO_LINES, radioLineFor, reactionFor, type RadioLine } from "./radioLines";
import { voiceSuffix } from "../ui/editorData";

type Who = "driver" | "engineer";
interface Line {
  text: string;
  who: Who;
  at: number;
  /** piloto 1 ou 2 da equipe (cada um com sua voz) */
  slot: number;
  /** fala já escolhida (reações) */
  rec?: RadioLine;
}

/** arquivo da fala: o 2º piloto da equipe tem voz própria (sufixo _b) */
const clipUrl = (id: string, n: number, who: Who, slot: number) => `/radio/${id}_${n}${who === "driver" ? voiceSuffix(slot) : ""}.wav`;
/** a voz base (Faber), pra quando a escolhida não tiver aquela fala */
const baseUrl = (id: string, n: number) => `/radio/${id}_${n}.wav`;

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
export function parseRadio(text: string, kind?: string): { who: Who; text: string; short?: string } | null {
  const m = /^Rádio( [^:]+)?: "(.*)"$/.exec(text);
  if (m) return { who: m[1] ? "driver" : "engineer", text: m[2], short: m[1]?.trim() };
  if (kind === "plan") {
    const p = /^Plano ([^:]+): (.*)$/.exec(text);
    if (p) return { who: "driver", text: p[2], short: p[1].trim() };
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
  /** toca a fala gravada (com filtro de rádio); null = não tem o arquivo */
  playClip: (url: string) => Promise<number | null> = async () => null;
  private lastVariant = new Map<string, number>();
  /** pilotos da sua equipe na corrida, na ordem (1º, 2º) */
  drivers: () => { id: string; short: string; name: string }[] = () => [];
  /** avisa quem está falando agora (id do carro do piloto, ou null) — o HUD mostra o 📻 no nome */
  onTalk: (carId: string | null) => void = () => {};
  private talk(carId: string | null) {
    this.onTalk(carId);
  }

  /** qual piloto da equipe aparece no texto (o 1º citado, ou o último com target "last"); -1 = nenhum */
  private slotOf(text: string, target?: "last"): number {
    let best = -1, bestPos = target ? -1 : Infinity;
    this.drivers().forEach((d, i) => {
      const at = [d.short, d.name].map((k) => (target ? text.lastIndexOf(k) : text.indexOf(k))).filter((x) => x >= 0);
      if (!at.length) return;
      const pos = target ? Math.max(...at) : Math.min(...at);
      if (target ? pos > bestPos : pos < bestPos) {
        bestPos = pos;
        best = i;
      }
    });
    // "A passa B": só reclama se quem foi passado é da equipe
    if (target && best >= 0 && bestPos < text.indexOf(" passa ")) return -1;
    return best;
  }

  /** aviso de rádio do jogo ("Rádio ABC: ...", ordens, plano): fala com a voz de quem mandou */
  radio(text: string, kind?: string): boolean {
    const r = parseRadio(text, kind);
    if (!r) return false;
    // "Rádio ABC: ..." = o piloto ABC; "Rádio: ..." = você falando (ordem): responde o piloto citado
    const slot = r.short ? Math.max(0, this.drivers().findIndex((d) => d.short === r.short)) : Math.max(0, this.slotOf(r.text));
    this.say(r.text, r.who, slot);
    return true;
  }

  /** fala gravada pelo id (ex.: resposta do engenheiro ao comando de voz) */
  sayId(id: string, slot = 0) {
    const rec = RADIO_LINES.find((l) => l.id === id);
    if (rec) this.say(rec.lines[0], rec.who, slot, rec);
  }

  /** piloto reagindo a um evento (box lento, toque, punição...) */
  react(text: string) {
    const rec = reactionFor(text);
    if (!rec || Math.random() > (rec.chance ?? 1)) return;
    const slot = this.slotOf(text, rec.target);
    if (slot < 0) return;
    this.say(text, "driver", slot, rec);
  }

  /** falas gravadas funcionam em qualquer navegador */
  get supported() {
    return typeof window !== "undefined";
  }

  /** voz do navegador (plano B quando falta a fala gravada; o Opera, por exemplo, não tem) */
  private get tts() {
    return "speechSynthesis" in window && speechSynthesis.getVoices().some((v) => /^pt/i.test(v.lang));
  }

  toggle() {
    this.enabled = !this.enabled;
    storeSet("pwm.voice", this.enabled ? "1" : "0");
    if (!this.enabled) this.stop();
    // ligou: fala na hora, pra conferir se o som chega
    else this.say("Rádio ligado. Tá me ouvindo bem?", "engineer");
    this.listeners.forEach((f) => f());
  }

  onChange(f: () => void) {
    this.listeners.push(f);
  }

  stop() {
    this.talk(null);
    this.queue = [];
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.busy = false;
  }

  /** short = sigla do piloto que está falando (decide a voz) */
  say(text: string, who: Who, slot = 0, rec?: RadioLine) {
    if (!this.enabled || !this.supported || this.volume() <= 0) return;
    // no máximo 2 esperando: com a corrida acelerada, o que ficou velho é descartado
    this.queue.push({ text, who, at: performance.now(), slot, rec });
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
    const done = () => {
      if (!this.busy || id !== this.lineId) return;
      this.talk(null);
      this.beepOut();
      this.busy = false;
      setTimeout(() => this.next(), 250);
    };
    const rec = line.rec ?? radioLineFor(line.text);
    // quem fala de verdade é o da fala gravada (ex.: ordem sua -> o piloto responde)
    if (rec) line.who = rec.who;
    this.talk(line.who === "driver" ? (this.drivers()[line.slot]?.id ?? null) : null);
    if (rec) {
      // fala gravada: sorteia uma versão (sem repetir a última)
      const last = this.lastVariant.get(rec.id) ?? -1;
      let n = Math.floor(Math.random() * rec.lines.length);
      if (rec.lines.length > 1 && n === last) n = (n + 1) % rec.lines.length;
      this.lastVariant.set(rec.id, n);
      // reação: o texto falado é a fala (o aviso da tela é narração)
      if (line.rec) line.text = rec.lines[n];
      this.beepIn();
      const play = async () => (await this.playClip(clipUrl(rec.id, n, line.who, line.slot))) ?? (voiceSuffix(line.slot) ? this.playClip(baseUrl(rec.id, n)) : null);
      void play().then((dur) => {
        if (id !== this.lineId) return;
        if (dur !== null) setTimeout(done, dur * 1000 + 60);
        else this.speak(line, done, false);
      });
      return;
    }
    this.speak(line, done, true);
  }

  /** demonstração (?radio no endereço): toca todas as falas gravadas, uma atrás da outra */
  async demo(log: (t: string) => void) {
    this.stop();
    for (const l of RADIO_LINES)
      for (let n = 0; n < l.lines.length * (l.who === "driver" ? 2 : 1); n++) {
        // piloto: toca a versão do 1º e a do 2º piloto
        const k = n % l.lines.length, slot = n >= l.lines.length ? 1 : 0;
        log(`${l.who === "driver" ? `🏎 Piloto ${slot + 1}` : "🎧 Engenheiro"}: ${l.lines[k]}`);
        this.beepIn();
        const dur = await this.playClip(clipUrl(l.id, k, l.who, slot));
        if (dur === null) {
          log("(arquivo não encontrado: rode npx tsx scripts/gen-radio.ts)");
          return;
        }
        await new Promise((r) => setTimeout(r, dur * 1000 + 80));
        this.beepOut();
        await new Promise((r) => setTimeout(r, 700));
      }
    log("fim da demonstração");
  }

  /** voz do navegador */
  private speak(line: Line, done: () => void, beep: boolean) {
    if (!this.tts) {
      // sem voz nenhuma: fica só o bipe
      if (beep) this.beepIn();
      setTimeout(done, 300);
      return;
    }
    const u = new SpeechSynthesisUtterance(speakable(line.text));
    const v = this.voiceFor(line.who);
    if (v.voice) u.voice = v.voice;
    u.lang = v.voice?.lang ?? "pt-BR";
    u.pitch = v.pitch;
    u.rate = v.rate;
    u.volume = Math.min(1, this.volume() * 1.2);
    u.onend = done;
    u.onerror = done;
    // trava de segurança: alguns navegadores não disparam onend
    setTimeout(done, 1500 + line.text.length * 110);
    if (beep) this.beepIn();
    setTimeout(() => {
      // o Chrome às vezes fica "falando" travado ou pausado e não toca mais nada
      if (speechSynthesis.paused) speechSynthesis.resume();
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }, 180);
  }
}

export const teamVoice = new TeamVoice();
// a lista de vozes chega depois no Chrome/Edge: pedir cedo pra estar pronta na corrida
if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
}
