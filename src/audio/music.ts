// Trilha sonora das telas fora da corrida (login, menu, sala, treino,
// classificação, estratégia e pódio). As músicas ficam em public/music e a
// lista em public/music/playlist.json. Na corrida a música sai suave.
import { storeGet, storeSet } from "../ui/common";
import { sound } from "./sound";

interface Track {
  file: string;
  title: string;
}

/** a música fica um pouco abaixo dos efeitos */
const MUSIC_LEVEL = 0.55;

class Music {
  private el = new Audio();
  private list: Track[] = [];
  private queue: Track[] = [];
  private playing = false;
  private wantPlay = false;
  private unlocked = false;
  private fade: ReturnType<typeof setInterval> | null = null;
  enabled = storeGet("pwm.music") !== "0";
  current: Track | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    this.el.preload = "auto";
    this.el.addEventListener("ended", () => this.next());
    this.el.addEventListener("error", () => this.next());
    sound.onChange(() => this.applyVolume());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.el.pause();
      else if (this.playing) void this.el.play().catch(() => {});
    });
    void fetch("/music/playlist.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((l: Track[]) => {
        this.list = Array.isArray(l) ? l.filter((t) => t?.file) : [];
        if (this.wantPlay) this.start();
        this.listeners.forEach((f) => f());
      })
      .catch(() => {});
  }

  private target() {
    return this.enabled && !sound.muted ? sound.volume * MUSIC_LEVEL * sound.mix.musica : 0;
  }

  private applyVolume() {
    if (!this.fade) this.el.volume = this.playing ? this.target() : 0;
  }

  /** o navegador só deixa tocar depois do primeiro clique */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.wantPlay) this.start();
  }

  /** telas fora da corrida: toca; corrida: para */
  setPlaying(on: boolean) {
    this.wantPlay = on;
    if (on) this.start();
    else this.stop();
  }

  private start() {
    if (!this.unlocked || !this.enabled || !this.list.length || this.playing) return;
    this.playing = true;
    if (!this.current) this.next(false);
    else this.fadeTo(this.target(), 1200, () => {});
    void this.el.play().catch(() => (this.playing = false));
    this.fadeTo(this.target(), 1200, () => {});
  }

  private stop() {
    if (!this.playing) return;
    this.playing = false;
    this.fadeTo(0, 1500, () => this.el.pause());
  }

  /** próxima música (embaralha sem repetir até acabar a lista) */
  private next(play = true) {
    if (!this.list.length) return;
    if (!this.queue.length) {
      this.queue = [...this.list].sort(() => Math.random() - 0.5);
      if (this.current && this.queue.length > 1 && this.queue[0].file === this.current.file) this.queue.push(this.queue.shift()!);
    }
    this.current = this.queue.shift()!;
    this.el.src = `/music/${encodeURIComponent(this.current.file)}`;
    this.el.volume = 0;
    if (play && this.playing) {
      void this.el.play().catch(() => {});
      this.fadeTo(this.target(), 1200, () => {});
    }
    this.listeners.forEach((f) => f());
  }

  skip() {
    if (this.playing) this.next();
    else if (this.enabled) this.pick(this.nextFile(1));
  }

  /** música anterior da lista */
  prev() {
    this.pick(this.nextFile(-1));
  }

  private nextFile(step: number): string | undefined {
    if (!this.list.length) return undefined;
    const i = this.list.findIndex((t) => t.file === this.current?.file);
    return this.list[(i + step + this.list.length) % this.list.length].file;
  }

  /** toca essa música agora (e liga a música se estava desligada) */
  pick(file?: string) {
    const t = this.list.find((x) => x.file === file);
    if (!t) return;
    this.unlocked = true; // escolher no player já é um clique: o navegador libera o som
    if (!this.enabled) {
      this.enabled = true;
      storeSet("pwm.music", "1");
    }
    this.queue = this.queue.filter((x) => x.file !== t.file);
    this.queue.unshift(t);
    if (this.playing) this.next();
    else {
      this.current = null;
      this.queue.unshift(t);
      this.queue = this.queue.filter((x, i, a) => a.findIndex((y) => y.file === x.file) === i);
      if (this.wantPlay) this.start();
      else this.listeners.forEach((f) => f());
    }
  }

  /** lista de músicas (pro player) */
  tracks(): readonly Track[] {
    return this.list;
  }

  isPlaying() {
    return this.playing;
  }

  toggle() {
    this.enabled = !this.enabled;
    storeSet("pwm.music", this.enabled ? "1" : "0");
    if (this.enabled) {
      if (this.wantPlay) this.start();
    } else if (this.playing) {
      this.playing = false;
      this.fadeTo(0, 600, () => this.el.pause());
    }
    this.listeners.forEach((f) => f());
  }

  onChange(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private fadeTo(to: number, ms: number, done: () => void) {
    if (this.fade) clearInterval(this.fade);
    const from = this.el.volume;
    const t0 = performance.now();
    this.fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) {
        clearInterval(this.fade!);
        this.fade = null;
        done();
      }
    }, 40);
  }
}

export const music = new Music();
