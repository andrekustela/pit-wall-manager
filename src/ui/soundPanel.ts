// Controles de som (Configurações > Sons e o MENU da corrida): volume geral, cada tipo de som,
// o rádio da equipe falado e a música. Muda na hora, sem precisar salvar.
import { music } from "../audio/music";
import { MIX_GROUPS, sound, type MixGroup } from "../audio/sound";
import { teamVoice } from "../audio/voice";
import { esc } from "./common";

export function soundPanelHtml(): string {
  const pct = (v: number) => Math.round(v * 100);
  const slider = (attr: string, label: string, v: number) =>
    `<label class="sndrow"><span>${label}</span><input type="range" min="0" max="100" ${attr} value="${pct(v)}"><b data-pct>${pct(v)}%</b></label>`;
  return `<div class="sndpanel">
    <div class="sndhead"><b>🔊 VOLUME</b><button class="btn small" data-snd="mute">${sound.muted ? "🔇 LIGAR O SOM" : "🔊 MUDO"}</button></div>
    ${slider("data-snd-vol", "Geral", sound.muted ? 0 : sound.volume)}
    <div class="sndsub">CADA TIPO DE SOM</div>
    ${MIX_GROUPS.map((g) => slider(`data-mix="${g.id}"`, g.label, sound.mix[g.id])).join("")}
    ${
      teamVoice.supported
        ? `<div class="sndline"><span>📻 Rádio da equipe falado</span><button class="btn small ${teamVoice.enabled ? "" : "primary"}" data-snd="voice">${teamVoice.enabled ? "DESLIGAR" : "LIGAR"}</button></div>`
        : ""
    }
    <div class="sndline"><span>🎵 Música${music.enabled && music.current ? `: <b>${esc(music.current.title)}</b>` : music.enabled ? "" : " (desligada)"}</span>
      <span class="sndbtns"><button class="btn small" data-snd="prev" title="Anterior">⏮</button><button class="btn small ${music.enabled ? "" : "primary"}" data-snd="music">${music.enabled ? "DESLIGAR" : "LIGAR"}</button><button class="btn small" data-snd="next" title="Próxima">⏭</button></span></div>
  </div>`;
}

/** liga os controles; `rerender` redesenha o painel (botões que mudam de texto) */
export function bindSoundPanel(root: HTMLElement, rerender: () => void) {
  root.addEventListener("input", (e) => {
    const r = e.target as HTMLInputElement;
    const pctEl = r.parentElement?.querySelector<HTMLElement>("[data-pct]");
    if (pctEl) pctEl.textContent = `${r.value}%`;
    if (r.matches("[data-snd-vol]")) {
      if (sound.muted && Number(r.value) > 0) sound.toggleMute();
      sound.setVolume(Number(r.value) / 100);
    } else if (r.dataset.mix) sound.setMix(r.dataset.mix as MixGroup, Number(r.value) / 100);
  });
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-snd]");
    if (!b) return;
    const k = b.dataset.snd;
    if (k === "mute") sound.toggleMute();
    else if (k === "voice") teamVoice.toggle();
    else if (k === "music") music.toggle();
    else if (k === "prev") music.prev();
    else if (k === "next") music.skip();
    rerender();
  });
}
