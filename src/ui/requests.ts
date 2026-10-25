// Pedidos de autorização do piloto no rádio: o piloto pede (atacar, mais motor, parar, passar o
// companheiro, poupar combustível) e você aceita ou recusa — botão, tecla S/N ou voz ("sim"/"não").
// Sem resposta em 12 s, conta como recusado. Atacar e motor rico voltam ao normal sozinhos depois.
import type { Race } from "../sim/race";
import type { CarState } from "../sim/types";
import type { VoiceAction } from "../audio/voiceCmd";
import { teamVoice } from "../audio/voice";
import { esc } from "./common";

type Kind = "atacar" | "motor" | "box" | "trocar" | "poupar";
type Act = Exclude<VoiceAction, { kind: "yes" } | { kind: "no" }>;
interface Req { kind: Kind; slot: number; carId: string; text: string; t0: number }

const WAIT_MS = 12000;
/** tempo de corrida (s) sem outro pedido do mesmo carro */
const COOLDOWN = 70;
const MAX_PER_CAR = 4;
/** tempo de corrida (s) entre um pedido e outro (de qualquer carro) */
const GAP_ANY = 20;

export class DriverRequests {
  private el = document.createElement("div");
  private cur: Req | null = null;
  private nextOk = new Map<string, number>();
  private count = new Map<string, number>();
  /** há quanto tempo (s de corrida) cada condição vale, por carro: só pede se durar */
  private since = new Map<string, number>();
  private reverts: { carId: string; slot: number; lap: number; act: Act; what: string }[] = [];
  private lastTick = 0;
  private lastAsk = -999;

  constructor(
    private race: Race,
    private act: (a: Act, slot: number) => { what: string; ack: string } | null,
    private note: (t: string) => void,
  ) {
    this.el.className = "reqbox";
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ans]");
      if (b) this.answer(b.dataset.ans === "sim");
    });
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.cur || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
    if (e.code === "KeyS") this.answer(true);
    else if (e.code === "KeyN") this.answer(false);
  };

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.el.remove();
  }

  /** responde o pedido aberto (false = não tinha pedido) */
  answer(yes: boolean): boolean {
    const r = this.cur;
    if (!r) return false;
    this.cur = null;
    this.el.hidden = true;
    const car = this.race.cars.find((c) => c.id === r.carId);
    if (!yes || !car) {
      teamVoice.sayId("req_nao", r.slot);
      this.note(`📻 Você recusou o pedido de P${r.slot + 1}`);
      return true;
    }
    const mate = this.race.cars.find((c) => c.team.id === car.team.id && c.id !== car.id);
    const plan: Record<Kind, () => void> = {
      atacar: () => this.run({ kind: "pace", slot: r.slot, mode: "push" }, r, { kind: "pace", slot: r.slot, mode: "normal" }, 3, "ritmo de volta ao normal"),
      motor: () => this.run({ kind: "engine", slot: r.slot, mode: "rich" }, r, { kind: "engine", slot: r.slot, mode: "normal" }, 2, "motor de volta ao normal"),
      box: () => this.run({ kind: "box", slot: r.slot }, r),
      poupar: () => this.run({ kind: "engine", slot: r.slot, mode: "lean" }, r),
      // a ordem vai pro companheiro (o que está na frente abre)
      trocar: () => {
        const ms = mate ? 1 - r.slot : r.slot;
        const res = this.act({ kind: "order", slot: ms, mode: "letPass" }, ms);
        if (res) this.note(`📻 Você → P${ms + 1}: ${res.what}`);
      },
    };
    plan[r.kind]();
    return true;
  }

  private run(a: Act, r: Req, back?: Act, laps = 0, backWhat = "") {
    const res = this.act(a, r.slot);
    if (!res) return;
    this.note(`📻 Você → P${r.slot + 1}: ${res.what}`);
    if (res.ack) teamVoice.sayId(res.ack, r.slot);
    const car = this.race.cars.find((c) => c.id === r.carId);
    if (back && car) this.reverts.push({ carId: r.carId, slot: r.slot, lap: car.lap + laps, act: back, what: backWhat });
  }

  /** chamado todo quadro: confere as condições ~1x por segundo e mostra/expira o pedido */
  tick(myTeam: string) {
    const race = this.race;
    if (this.cur) {
      const left = WAIT_MS - (performance.now() - this.cur.t0);
      const bar = this.el.querySelector<HTMLElement>(".reqbar i");
      if (bar) bar.style.width = `${Math.max(0, (left / WAIT_MS) * 100)}%`;
      if (left <= 0) this.answer(false);
      return;
    }
    if (race.time - this.lastTick < 1) return;
    const dt = race.time - this.lastTick;
    this.lastTick = race.time;
    // voltas de ataque/motor que acabaram: volta ao normal
    for (const rv of [...this.reverts]) {
      const c = race.cars.find((x) => x.id === rv.carId);
      if (!c || c.lap >= rv.lap || c.retired || c.finished) {
        this.reverts.splice(this.reverts.indexOf(rv), 1);
        if (c && !c.retired && !c.finished && this.act(rv.act, rv.slot)) this.note(`📻 P${rv.slot + 1}: ${rv.what}`);
      }
    }
    if (race.phase !== "racing" || race.sc.active || race.checkered || race.time - this.lastAsk < GAP_ANY) return;
    const order = race.ordered();
    const mine = race.cars.filter((c) => c.team.id === myTeam);
    mine.forEach((c, slot) => {
      if (this.cur || c.retired || c.finished || c.pit !== "none" || c.spin > 0 || c.offTrack > 0) return;
      if ((this.nextOk.get(c.id) ?? 0) > race.time || (this.count.get(c.id) ?? 0) >= MAX_PER_CAR) return;
      const i = order.indexOf(c), ahead = i > 0 ? order[i - 1] : null;
      const gap = ahead ? (race.dist(ahead) - race.dist(c)) / Math.max(25, c.v) : 99;
      const left = race.lapsLeft(c);
      const fuelLaps = c.fuel / race.consumption(c);
      const hold = (key: string, cond: boolean, secs: number) => {
        const k = `${c.id}|${key}`;
        if (!cond) {
          this.since.delete(k);
          return false;
        }
        const v = (this.since.get(k) ?? 0) + dt;
        this.since.set(k, v);
        return v >= secs;
      };
      const name = (x: CarState) => x.driver.name.split(" ").slice(-1)[0];
      const asks: [Kind, boolean, string][] = [
        ["box", hold("box", c.wear > 0.72 && !c.boxRequest && left > 2, 3), "Os pneus já foram. Posso parar?"],
        ["poupar", hold("poupar", fuelLaps < left - 0.3 && c.engine !== "lean" && !c.boxRequest && (c.plan?.length ?? 0) <= (c.planIdx ?? 0), 4), "O combustível não vai chegar. Posso poupar?"],
        ["trocar", hold("trocar", !!ahead && ahead.team.id === c.team.id && gap < 0.8 && (c.lastLap ?? 99) < (ahead.lastLap ?? 99) - 0.25 && c.order === "none" && ahead.order === "none", 8), `Sou mais rápido que o ${ahead ? name(ahead) : ""}. Pede pra ele abrir?`],
        ["motor", hold("motor", !!ahead && ahead.team.id !== c.team.id && gap < 0.6 && c.engine === "normal" && (c.engineHealth ?? 1) > 0.55 && fuelLaps > left + 0.6 && !c.engineSave, 4), `Me dá mais motor, quero passar o ${ahead ? name(ahead) : ""} na reta!`],
        ["atacar", hold("atacar", !!ahead && ahead.team.id !== c.team.id && gap < 1.0 && c.pace !== "push" && c.wear < 0.6 && c.lap >= 1 && !c.engineSave, 6), `Tô mais rápido que o ${ahead ? name(ahead) : ""}. Posso atacar?`],
      ];
      const ask = asks.find((x) => x[1]);
      if (!ask) return;
      this.nextOk.set(c.id, race.time + COOLDOWN);
      this.lastAsk = race.time;
      this.count.set(c.id, (this.count.get(c.id) ?? 0) + 1);
      this.cur = { kind: ask[0], slot, carId: c.id, text: ask[2], t0: performance.now() };
      teamVoice.sayId(`req_${ask[0]}`, slot);
      this.el.innerHTML = `<div class="reqtop"><b>📻 P${slot + 1} ${esc(c.driver.short)}</b><span>${esc(ask[2])}</span></div>
        <div class="reqbtns"><button class="btn small primary" data-ans="sim">✓ ACEITAR <kbd>S</kbd></button><button class="btn small" data-ans="nao">✗ RECUSAR <kbd>N</kbd></button>
        <span class="hint" style="margin:0">ou fale "sim" / "não" (V)</span></div><div class="reqbar"><i></i></div>`;
      this.el.hidden = false;
    });
  }
}
