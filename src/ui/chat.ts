// Chat do modo online: só entre os jogadores (a IA não fala). Fica no canto em
// todas as telas; na corrida, Enter abre pra escrever e as mensagens novas
// aparecem um tempinho mesmo com o chat fechado.
import type { ChatLine } from "../net/protocol";
import { TEAMS } from "../sim/data";
import { esc } from "./common";

export class ChatWidget {
  private el: HTMLElement;
  private list: HTMLElement;
  private input: HTMLInputElement;
  private feed: HTMLElement;
  private open = false;
  private unread = 0;
  private lines: ChatLine[] = [];

  constructor(private send: (text: string) => void, private myId: () => string) {
    this.el = document.createElement("div");
    this.el.className = "chat closed";
    this.el.innerHTML = `
      <button class="chatbtn" data-toggle title="Chat (Enter)">💬 CHAT <span class="badge" hidden></span></button>
      <div class="chatbox">
        <div class="chathead"><b>CHAT DA SALA</b><span class="hint" style="margin:0">só os jogadores</span><button class="linkbtn" data-toggle>fechar</button></div>
        <div class="chatlist"></div>
        <form class="chatform"><input class="txt" maxlength="200" placeholder="Escreva e aperte Enter..." autocomplete="off"><button class="btn small">ENVIAR</button></form>
      </div>
      <div class="chatfeed"></div>`;
    document.body.appendChild(this.el);
    this.list = this.el.querySelector(".chatlist")!;
    this.input = this.el.querySelector("input")!;
    this.feed = this.el.querySelector(".chatfeed")!;
    this.el.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => this.setOpen(!this.open)));
    this.el.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const t = this.input.value.trim();
      if (t) this.send(t);
      this.input.value = "";
    });
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // não dispara atalhos do jogo enquanto escreve
      if (e.key === "Escape") this.setOpen(false);
    });
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.key === "Enter" && !this.open && tag !== "INPUT" && tag !== "TEXTAREA" && !document.querySelector(".helpmodal")) {
      e.preventDefault();
      this.setOpen(true);
    }
  };

  setOpen(v: boolean) {
    this.open = v;
    this.el.classList.toggle("closed", !v);
    if (v) {
      this.unread = 0;
      this.renderBadge();
      this.list.scrollTop = this.list.scrollHeight;
      this.input.focus();
    } else this.input.blur();
  }

  add(line: ChatLine) {
    this.lines.push(line);
    if (this.lines.length > 80) this.lines.shift();
    const html = lineHtml(line, line.from === this.myId());
    this.list.insertAdjacentHTML("beforeend", html);
    while (this.list.children.length > 80) this.list.firstElementChild!.remove();
    this.list.scrollTop = this.list.scrollHeight;
    if (!this.open) {
      if (line.from !== this.myId()) this.unread++;
      this.renderBadge();
      // aparece um tempinho por cima do jogo
      const div = document.createElement("div");
      div.innerHTML = html;
      const item = div.firstElementChild as HTMLElement;
      this.feed.appendChild(item);
      while (this.feed.children.length > 4) this.feed.firstElementChild!.remove();
      setTimeout(() => item.classList.add("fade"), 6000);
      setTimeout(() => item.remove(), 7000);
    }
  }

  private renderBadge() {
    const b = this.el.querySelector<HTMLElement>(".badge")!;
    b.hidden = this.unread === 0;
    b.textContent = String(this.unread);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.el.remove();
  }
}

function lineHtml(l: ChatLine, mine: boolean): string {
  const color = TEAMS.find((t) => t.id === l.teamId)?.color ?? "#aaa";
  return `<div class="chatline ${mine ? "mine" : ""}"><b style="color:${color}">${esc(l.name)}:</b> ${esc(l.text)}</div>`;
}
