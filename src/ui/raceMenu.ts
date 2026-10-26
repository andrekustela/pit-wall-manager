// MENU da corrida (botão no canto de baixo, do lado do FPS): continuar, sons, configurações e voltar
// ao menu. No solo pausa a corrida enquanto está aberto; online não (online não tem pausa).
import { voiceCmd } from "../audio/voiceCmd";
import { bindSoundPanel, soundPanelHtml } from "./soundPanel";
import { confirmDialog } from "./confirm";

export interface RaceMenuHooks {
  /** online: a corrida não pausa */
  online: boolean;
  pause: () => void;
  resume: () => void;
  settings: () => void;
  leave: () => void;
}

let open: HTMLElement | null = null;

export function showRaceMenu(h: RaceMenuHooks) {
  if (open) return;
  if (!h.online) h.pause();
  const m = document.createElement("div");
  m.className = "helpmodal racemenu";
  const render = () => {
    m.innerHTML = `<div class="helpbox panel rmbox">
      <div class="helphead"><b>${h.online ? "☰ MENU" : "⏸ PAUSADO"}</b><button class="btn small" data-x>✕</button></div>
      ${h.online ? `<p class="hint" style="margin:-4px 0 10px">Online não tem pausa: a corrida continua rodando.</p>` : ""}
      <button class="go rmgo" data-x>▶ CONTINUAR</button>
      ${soundPanelHtml()}
      ${
        voiceCmd.supported
          ? `<div class="sndline rmmic"><span>🎙 Comando de voz <small class="hint">(segure V e fale: "P1 box", "P2 atacar")</small></span><button class="btn small ${voiceCmd.state === "listening" ? "" : "primary"}" data-mic>${voiceCmd.state === "listening" ? "DESLIGAR" : voiceCmd.state === "loading" ? "PREPARANDO..." : "LIGAR"}</button></div>`
          : ""
      }
      <div class="row-btns rmbtns"><button class="btn" data-settings>⚙ CONFIGURAÇÕES</button><button class="btn" data-leave>⌂ VOLTAR AO MENU</button></div>
    </div>`;
  };
  render();
  bindSoundPanel(m, render);
  const close = () => {
    m.remove();
    open = null;
    window.removeEventListener("keydown", onKey, true);
    if (!h.online) h.resume();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);
  m.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    if (t.closest("[data-settings]")) return h.settings();
    if (t.closest("[data-mic]")) {
      if (voiceCmd.state === "off" || voiceCmd.state === "error") void voiceCmd.enable();
      else voiceCmd.disable();
      setTimeout(render, 50);
      return;
    }
    if (t.closest("[data-leave]")) {
      const ok = await confirmDialog({ title: "VOLTAR AO MENU", icon: "⌂", text: "Sair da corrida e voltar pro menu?", ok: "SAIR" });
      if (!ok) return;
      m.remove();
      open = null;
      window.removeEventListener("keydown", onKey, true);
      h.leave();
    }
  });
  document.body.appendChild(m);
  open = m;
}
