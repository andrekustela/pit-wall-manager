import { sound } from "../audio/sound";

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
      <li><b>Classificação:</b> uma volta única que define o grid de largada.</li>
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
      <li><b>Estado do carro:</b> o desenho na lateral de cada card mostra o carro peça por peça. Os 4 pneus vão de verde a vermelho conforme gastam (azul = pneu frio, recém-colocado), as asas e a suspensão piscam em vermelho quando quebram (laranja na suspensão = carro baixo demais, batendo no chão), e a barra no meio é o combustível.</li>
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
      <li><b>M</b>: minimizar / expandir o painel dos seus pilotos (pra ver mais pista)</li>
      <li><b>+ / −</b> ou roda do mouse: zoom</li>
      <li><b>?</b> (botão no canto): esta ajuda · <b>🔊</b>: liga/desliga o som</li>
    </ul>`,
};

export class HelpWidget {
  private el: HTMLElement;
  private modal: HTMLElement | null = null;

  constructor(private currentTab: () => Tab) {
    this.el = document.createElement("div");
    this.el.className = "helpbtns";
    this.el.innerHTML = `<button class="hbtn" data-help title="Ajuda">?</button><button class="hbtn" data-mute title="Liga/desliga o som"></button><input class="vol" type="range" min="0" max="100" title="Volume"><span class="fps" title="Quadros por segundo"></span>`;
    document.body.appendChild(this.el);
    this.el.querySelector("[data-help]")!.addEventListener("click", () => this.open(this.currentTab()));
    this.el.querySelector("[data-mute]")!.addEventListener("click", () => sound.toggleMute());
    const vol = this.el.querySelector<HTMLInputElement>(".vol")!;
    vol.value = String(Math.round(sound.volume * 100));
    vol.addEventListener("input", () => sound.setVolume(Number(vol.value) / 100));
    sound.onChange(() => this.renderMute());
    this.renderMute();
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

// ---------- contador de FPS (ao lado do som) ----------
let frames = 0;
let since = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** chamado a cada frame da corrida; atualiza o contador 2x por segundo */
export function reportFrame(now: number) {
  frames++;
  if (!since) since = now;
  const el = document.querySelector<HTMLElement>(".helpbtns .fps");
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
