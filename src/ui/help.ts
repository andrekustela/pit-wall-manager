import { MIX_GROUPS, sound, type MixGroup } from "../audio/sound";
import { music } from "../audio/music";
import { teamVoice } from "../audio/voice";
import { voiceCmd } from "../audio/voiceCmd";
import { radioAI } from "../audio/radioAI";
import { confirmDialog } from "./confirm";
import { esc } from "./common";

type Tab = "jogo" | "treino" | "estrategia" | "corrida" | "atalhos";

const TABS: [Tab, string][] = [
  ["jogo", "O jogo"],
  ["treino", "Treino e acerto"],
  ["estrategia", "Estratégia"],
  ["corrida", "Corrida"],
  ["atalhos", "Atalhos"],
];

const CONTENT: Record<Tab, string> = {
  jogo: `
    <p>Você é o <b>engenheiro-chefe</b> de uma equipe com 2 pilotos. Eles pilotam sozinhos: você decide o acerto do carro,
    os pneus, o combustível e quando parar nos boxes.</p>
    <p>Um fim de semana tem 4 etapas:</p>
    <ol>
      <li><b>Treino livre:</b> 5 voltas de teste por piloto pra achar o melhor acerto.</li>
      <li><b>Classificação:</b> Q1, Q2 e Q3. Cada piloto dá uma volta por sessão; os 5 mais lentos caem no Q1 e no Q2, e o Q3 decide a pole.</li>
      <li><b>Estratégia:</b> pneu e combustível de largada e o plano de paradas.</li>
      <li><b>Corrida:</b> você acompanha e muda a estratégia ao vivo.</li>
    </ol>
    <p>As outras equipes são da IA, cada uma com um engenheiro sorteado. Uns são excelentes, outros erram bastante.
    No modo <b>Carros iguais</b> todo mundo tem o mesmo carro, então ganha quem acertar melhor.</p>`,
  treino: `
    <p>Cada pista pede um acerto diferente. Mexa nos 3 ajustes e dê uma volta pra ver o tempo:</p>
    <ul>
      <li><b>Asas (dianteira e traseira):</b> mais asa = mais rápido nas curvas e mais lento nas retas.
        Pista travada pede muita asa; pista de retão pede pouca.</li>
      <li><b>Equilíbrio:</b> a diferença entre as duas asas. Se o piloto diz que o carro <i>sai de frente</i>
        (subesterço), ponha mais asa dianteira. Se a <i>traseira escapa</i> (sobresterço), ponha mais traseira.</li>
      <li><b>Altura:</b> carro baixo gruda mais no chão, mas se a pista for ondulada ele <i>bate no chão</i> e perde muito.</li>
    </ul>
    <p>Depois de cada volta, leia o rádio do piloto: ele diz o que mudar. A volta marcada em <b>USAR</b> é o acerto que vai
    pra classificação e pra corrida (parque fechado: depois não muda mais).</p>
    <p><b>RETA</b> é a velocidade máxima na reta, em km/h. <b>D/T/A</b> = asa dianteira / asa traseira / altura.</p>`,
  estrategia: `
    <p><b>Pneus</b> (o número entre parênteses é quantas voltas cada um aguenta antes de começar a perder rendimento):</p>
    <ul>
      <li><b style="color:var(--soft)">S Macio</b>: o mais rápido, mas dura pouco.</li>
      <li><b style="color:var(--med)">M Médio</b>: equilibrado.</li>
      <li><b style="color:var(--hard)">H Duro</b>: mais lento, dura muito.</li>
      <li><b style="color:var(--inter)">I Intermediário</b>: pista molhada ou úmida.</li>
      <li><b style="color:var(--wetc)">W Chuva</b>: muita água. No seco, pneu de chuva derrete rápido.</li>
    </ul>
    <p>Cada trecho entre paradas é um <b>stint</b>. Se um stint for mais longo do que o pneu aguenta, o carro fica muito lento no fim.</p>
    <p><b>Combustível</b> é escolhido em <b>voltas</b>. Mais combustível = carro mais pesado e mais lento, mas parada mais curta.
    Menos combustível = carro leve, mas tem que parar pra reabastecer. Se acabar, o carro abandona!</p>
    <p>Regra: no seco, cada carro tem que usar <b>2 tipos de pneu</b> (senão leva +30s). Usando pneu de chuva, a regra cai.</p>
    <p>O plano é um <b>lembrete</b>: na volta marcada o engenheiro avisa e sugere o box, mas quem decide se para é você.</p>`,
  corrida: `
    <ul>
      <li><b>Estado do carro:</b> o desenho na lateral de cada card mostra o carro peça por peça. Os 4 pneus vão de verde a vermelho conforme gastam (azul = pneu frio)</li>
      <li><b>Temperatura do pneu:</b> pneu novo sai frio do box e leva quase uma volta pra esquentar. Frio, ele escorrega (mais lento e mais chance de rodar). Atacar esquenta, poupar esfria. Pneu quente demais perde rendimento e gasta muito mais. Pneu de seco na chuva esfria; pneu de chuva no seco ferve.</li>
      <li><b>Ar sujo:</b> colado atrás de outro carro, nas curvas o seu perde aderência e o pneu esquenta. Na reta, o vácuo ajuda. Por isso é difícil passar quem anda no mesmo ritmo, as asas e a suspensão piscam em vermelho quando quebram (laranja na suspensão = carro baixo demais, batendo no chão), e a barra no meio é o combustível.</li>
      <li><b>Zoom:</b> roda do mouse ou teclas + e − pra chegar perto dos carros.</li>
      <li><b>Câmera:</b> clique em qualquer carro na pista, na tabela, no minimapa ou no card do seu piloto pra seguir ele.</li>
      <li><b>Ritmo:</b> Atacar é mais rápido, mas gasta mais pneu. Poupar é o contrário.</li>
      <li><b>Motor:</b> mistura Rica é mais rápida e gasta mais combustível. Pobre economiza quando o combustível não vai chegar.</li>
      <li><b>Pneu / Comb.:</b> o que vai ser feito na próxima parada (pneu e combustível em voltas). "até o fim" calcula sozinho o combustível pra terminar a corrida.</li>
      <li><b>Plano de paradas:</b> é só um lembrete. Na volta marcada o engenheiro avisa no rádio e o botão de box fica amarelo, já com o pneu e o combustível do plano, mas <b>você decide</b> se para. Em "editar plano" dá pra mudar, cancelar ou adicionar paradas durante a corrida.</li>
      <li><b>Safety car:</b> clique na faixa amarela, no carro dele na pista ou no minimapa pra câmera seguir o safety car.</li>
      <li><b>Minimizar:</b> o botão em cima dos cards (ou a tecla M) deixa o painel pequeno pra ver mais pista.</li>
      <li><b>CHAMAR PRO BOX:</b> o carro entra na próxima vez que passar pela entrada dos boxes. Clique de novo pra cancelar.</li>
      <li><b>Safety car:</b> depois de uma batida o pelotão anda devagar e ninguém ultrapassa. É a hora mais barata pra parar!</li>
      <li><b>Chuva:</b> a barra azul mostra quanta água tem na pista. O piloto avisa no rádio quando precisa trocar de pneu.</li>
      <li><b>Tabela:</b> GAP é a distância pro líder e ÚLT é o tempo da última volta
        (<span style="color:#c77dff">roxo</span> = mais rápida da corrida, <span style="color:var(--ok)">verde</span> = melhor volta do piloto).</li>
    </ul>`,
  atalhos: `
    <ul>
      <li><b>Espaço</b>: pausar / continuar (só o host, no online)</li>
      <li><b>1 a 5</b>: velocidade 1x, 2x, 4x, 8x, 16x</li>
      <li><b>Tab</b>: alternar a câmera entre seus dois pilotos</li>
      <li><b>B</b>: chamar / cancelar o box do piloto seguido</li>
      <li><b>Q / W / E</b>: ritmo atacar / normal / poupar · <b>Z / X / C</b>: motor rico / normal / pobre (no piloto seguido; a letra aparece no botão)</li>
      <li><b>P</b>: esconder / mostrar a classificação · <b>T</b> ou 📺: modo TV (a câmera segue as disputas)</li>
      <li><b>V</b> (segurar): comando de voz · <b>S / N</b>: aceitar / recusar pedido do piloto</li>
      <li><b>Esc</b>: fecha a janela de cima (ajuda, músicas, confirmações...)</li>
      <li><b>F</b> ou botão ⛶: tela cheia</li>
      <li><b>M</b>: minimizar / expandir o painel dos seus pilotos (pra ver mais pista)</li>
      <li><b>+ / −</b> ou roda do mouse: zoom</li>
      <li><b>?</b> (botão no canto): esta ajuda · <b>🔊</b>: liga/desliga o som</li>
    </ul>`,
};

export class HelpWidget {
  private el: HTMLElement;
  private modal: HTMLElement | null = null;

  /** `onHome`: botão de voltar ao menu (só aparece quando `showHome()` diz que está num jogo) */
  constructor(private currentTab: () => Tab, onHome?: () => void, showHome?: () => boolean) {
    this.el = document.createElement("div");
    this.el.className = "helpbtns";
    this.el.innerHTML = `<button class="hbtn home" data-home title="Voltar ao menu" hidden>⌂</button><button class="hbtn" data-help title="Ajuda">?</button><button class="hbtn" data-full title="Tela cheia (F)">⛶</button><button class="hbtn" data-mute title="Liga/desliga o som"></button><button class="hbtn" data-voice title="Rádio da equipe falado (liga/desliga)">📻</button><button class="hbtn off" data-vcmd title="Comando de voz: ligar (depois segure V e fale, ex.: P1 box)">🎙</button><button class="hbtn off" data-ai title="IA no rádio: conversa livre com os pilotos">🤖</button><button class="hbtn" data-music>🎵</button><input class="vol" type="range" min="0" max="100" title="Volume"><span class="fps" title="Quadros por segundo"></span>`;
    document.body.appendChild(this.el);
    const home = this.el.querySelector<HTMLButtonElement>("[data-home]")!;
    home.addEventListener("click", () => onHome?.());
    // aparece só fora do menu (checagem barata, 2x por segundo)
    if (onHome && showHome) setInterval(() => (home.hidden = !showHome()), 500);
    this.el.querySelector("[data-help]")!.addEventListener("click", () => this.open(this.currentTab()));
    this.el.querySelector("[data-mute]")!.addEventListener("click", () => sound.toggleMute());
    const vb = this.el.querySelector<HTMLButtonElement>("[data-voice]")!;
    vb.hidden = !teamVoice.supported;
    const renderVoice = () => {
      vb.classList.toggle("off", !teamVoice.enabled);
      vb.title = teamVoice.enabled ? "Rádio da equipe falado: ligado (clique pra desligar)" : "Rádio da equipe falado: desligado (clique pra ligar)";
    };
    vb.addEventListener("click", () => teamVoice.toggle());
    teamVoice.onChange(renderVoice);
    renderVoice();
    // comando de voz: liga (pede o microfone e carrega o modelo) / desliga
    const vc = this.el.querySelector<HTMLButtonElement>("[data-vcmd]")!;
    vc.hidden = !voiceCmd.supported;
    const renderVc = () => {
      const st = voiceCmd.state;
      vc.classList.toggle("off", st === "off" || st === "error");
      vc.classList.toggle("busy", st === "loading");
      vc.classList.toggle("live", st === "listening");
      vc.title =
        st === "off" ? "Comando de voz: ligar (depois segure V e fale, ex.: P1 box)"
        : st === "loading" ? "Comando de voz: preparando..."
        : st === "error" ? `Comando de voz: ${voiceCmd.error}`
        : "Comando de voz ligado: segure V e fale (P1 box, P2 atacar, motor rico, cancela box...). Clique pra desligar";
    };
    vc.addEventListener("click", () => (voiceCmd.state === "off" || voiceCmd.state === "error" ? void voiceCmd.enable() : voiceCmd.disable()));
    voiceCmd.onChange(renderVc);
    renderVc();
    // IA no rádio: você fala livre (segura V) e o piloto responde com fala nova, na voz dele
    const ai = this.el.querySelector<HTMLButtonElement>("[data-ai]")!;
    ai.hidden = !radioAI.supported || !voiceCmd.supported;
    const renderAi = () => {
      const st = radioAI.state;
      ai.classList.toggle("off", st === "off" || st === "error");
      ai.classList.toggle("busy", st === "loading" || st === "thinking");
      ai.title =
        st === "off" ? "IA no rádio: ligar (conversa livre com os pilotos, roda no seu PC)"
        : st === "loading" ? `IA no rádio: preparando... ${radioAI.progress}`
        : st === "error" ? `IA no rádio: ${radioAI.error}`
        : st === "thinking" ? "IA no rádio: o piloto está pensando..."
        : "IA no rádio ligada: segure V e fale (\"Senna, como tá o carro?\", \"P2, pode atacar\"). Clique pra desligar";
    };
    ai.addEventListener("click", async () => {
      if (radioAI.ready || radioAI.state === "loading") return radioAI.disable();
      const ok = await confirmDialog({
        title: "IA no rádio",
        icon: "🤖",
        text: `Segure V e fale livre com seus pilotos: "Senna, como tá o carro?", "P2, pode atacar". Eles entendem, respondem com fala nova na voz deles e cumprem a ordem.
Roda no seu PC, sem custo: na primeira vez baixa uns 1,2 GB (o ouvido, a IA e as vozes) e o navegador guarda. Precisa de placa de vídeo razoável. A resposta leva alguns segundos.`,
        ok: "LIGAR",
      });
      if (!ok) return;
      if (voiceCmd.state === "off" || voiceCmd.state === "error") void voiceCmd.enable();
      void radioAI.enable();
    });
    radioAI.onChange(renderAi);
    renderAi();
    this.el.querySelector("[data-full]")!.addEventListener("click", () => toggleFullscreen());
    document.addEventListener("keydown", (e) => {
      if ((e.key === "f" || e.key === "F") && !(e.target as HTMLElement)?.closest("input, textarea")) toggleFullscreen();
    });
    document.addEventListener("fullscreenchange", () => {
      this.el.querySelector("[data-full]")!.textContent = document.fullscreenElement ? "🗗" : "⛶";
    });
    const vol = this.el.querySelector<HTMLInputElement>(".vol")!;
    vol.value = String(Math.round(sound.volume * 100));
    vol.addEventListener("input", () => sound.setVolume(Number(vol.value) / 100));
    sound.onChange(() => this.renderMute());
    this.renderMute();
    // música: clique abre o player (lista, anterior/próxima, liga/desliga); clique direito pula
    const mb = this.el.querySelector<HTMLButtonElement>("[data-music]")!;
    const player = document.createElement("div");
    player.className = "musicplayer panel";
    player.hidden = true;
    document.body.appendChild(player);
    mb.addEventListener("click", (e) => {
      e.stopPropagation();
      player.hidden = !player.hidden;
      renderMusic();
    });
    mb.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      music.skip();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!player.hidden && !player.contains(e.target as Node) && e.target !== mb) player.hidden = true;
    });
    // Esc fecha a janela de cima: o player de música, depois a janela aberta por último; sem nada aberto,
    // na corrida, abre o MENU
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!player.hidden) {
        player.hidden = true;
        return;
      }
      const top = [...document.querySelectorAll<HTMLElement>(".helpmodal")].pop();
      // nada aberto e na corrida: Esc abre o MENU (pausa no solo)
      if (!top) {
        if (!(e.target as HTMLElement)?.closest?.("input, textarea")) document.querySelector<HTMLElement>(".racecorner [data-racemenu]")?.click();
        return;
      }
      const x = top.querySelector<HTMLElement>("[data-x], [data-close], [data-cancel]");
      if (x) x.click();
      else top.remove();
      if (top === this.modal) this.modal = null;
    });
    // mixer: um controle por grupo de som (motor, torcida/chuva, efeitos, rádio, música)
    player.addEventListener("input", (e) => {
      const r = e.target as HTMLInputElement;
      if (r.dataset.mix) sound.setMix(r.dataset.mix as MixGroup, Number(r.value) / 100);
    });
    player.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const b = t.closest<HTMLElement>("[data-mp]");
      if (b?.dataset.mp === "prev") music.prev();
      else if (b?.dataset.mp === "next") music.skip();
      else if (b?.dataset.mp === "toggle") music.toggle();
      const tr = t.closest<HTMLElement>("[data-track]");
      if (tr) music.pick(tr.dataset.track);
    });
    const renderMusic = () => {
      mb.classList.toggle("off", !music.enabled);
      mb.title = music.enabled ? `Música${music.current ? `: "${music.current.title}"` : ""} · clique pra escolher` : "Música desligada · clique pra abrir o player";
      if (player.hidden) return;
      const list = music.tracks();
      player.innerHTML = `<div class="mphead"><b>🎵 MÚSICAS</b><span class="hint" style="margin:0">tocam fora da corrida</span></div>
        <div class="mpnow">${music.enabled && music.current ? `Tocando: <b>${esc(music.current.title)}</b>` : music.enabled ? "Começa no próximo clique / fora da corrida" : "Música desligada"}</div>
        <div class="mpbtns"><button class="btn small" data-mp="prev" title="Anterior">⏮</button><button class="btn small ${music.enabled ? "" : "primary"}" data-mp="toggle">${music.enabled ? "DESLIGAR" : "LIGAR"}</button><button class="btn small" data-mp="next" title="Próxima">⏭</button></div>
        <div class="mpmix"><b>🎚 VOLUMES</b>${MIX_GROUPS.map((g) => `<label><span>${g.label}</span><input type="range" min="0" max="100" data-mix="${g.id}" value="${Math.round(sound.mix[g.id] * 100)}"></label>`).join("")}</div>
        <div class="mplist">${list
          .map((t, i) => `<button class="mptrack ${music.current?.file === t.file && music.enabled ? "on" : ""}" data-track="${esc(t.file)}"><span>${i + 1}</span>${esc(t.title)}${music.current?.file === t.file && music.enabled ? " <i>♪</i>" : ""}</button>`)
          .join("")}</div>`;
    };
    music.onChange(renderMusic);
    renderMusic();
    // na corrida a barra some: MENU, ajuda e tela cheia ficam no canto de baixo (voltar ao menu e o
    // microfone, dentro do MENU)
    setInterval(() => document.body.classList.toggle("inrace", !!document.querySelector(".racecorner")), 400);
    // som, rádio falado, música, volume e FPS ficam no MENU da corrida e em Configurações > Sons
    this.el.querySelectorAll<HTMLElement>("[data-mute], [data-voice], [data-music], .vol, .fps").forEach((x) => (x.hidden = true));
  }

  private renderMute() {
    this.el.querySelector("[data-mute]")!.textContent = sound.muted || sound.volume === 0 ? "🔇" : sound.volume < 0.4 ? "🔉" : "🔊";
    const vol = this.el.querySelector<HTMLInputElement>(".vol");
    if (vol) vol.value = String(sound.muted ? 0 : Math.round(sound.volume * 100));
  }

  open(tab: Tab) {
    this.close();
    const m = document.createElement("div");
    m.className = "helpmodal";
    m.innerHTML = `<div class="helpbox panel">
      <div class="helphead"><b>COMO JOGAR</b><button class="hbtn" data-close>✕</button></div>
      <div class="seg helptabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="helpbody">${CONTENT[tab]}</div></div>`;
    m.addEventListener("click", (e) => {
      if (e.target === m) this.close();
    });
    m.querySelector("[data-close]")!.addEventListener("click", () => this.close());
    m.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => this.open(b.dataset.tab as Tab)));
    document.body.appendChild(m);
    this.modal = m;
  }

  close() {
    this.modal?.remove();
    this.modal = null;
  }
}

export type HelpTab = Tab;

// ---------- contador de FPS (no canto da corrida, do lado do MENU) ----------
let frames = 0;
let since = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** chamado a cada frame da corrida; atualiza o contador 2x por segundo */
export function reportFrame(now: number) {
  frames++;
  if (!since) since = now;
  const el = document.querySelector<HTMLElement>(".racecorner .fps");
  if (!el) return;
  if (now - since >= 500) {
    const fps = Math.round((frames * 1000) / (now - since));
    el.textContent = `${fps} FPS`;
    el.style.color = fps >= 55 ? "var(--ok)" : fps >= 40 ? "var(--warn)" : "var(--soft)";
    el.style.display = "inline-block";
    frames = 0;
    since = now;
  }
  // fora da corrida (sem frames) o contador some
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.style.display = "none";
    since = 0;
    frames = 0;
  }, 1000);
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
